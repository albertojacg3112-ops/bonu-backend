// index.js - Bonü Backend v8.1 PRODUCCIÓN COMPLETA (Checkout API + Dashboard + WebSocket + Auditoría + Reportes)
// v8.1: FIXES AliExpress — firma HMAC-SHA256 correcta, ciclo de tokens con expiraciones,
// callback OAuth /api/aliexpress/callback, token desde Firestore (no env var) y mapeo real de campos del producto.
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const http = require('http');
const https = require('https');
const socketIo = require('socket.io');

const app = express();
const PORT = process.env.PORT || 3001;
const NODE_ENV = process.env.NODE_ENV || 'production';

/* ========== SEGURIDAD ========== */
app.use(helmet({ 
    contentSecurityPolicy: false, 
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" }
}));
app.set('trust proxy', 1);

const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: NODE_ENV === 'production' ? 100 : 1000,
    message: { success: false, error: 'Demasiadas peticiones. Intenta más tarde.' },
    standardHeaders: true,
    legacyHeaders: false
});
app.use('/api/', globalLimiter);

const checkoutLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 3,
    message: { success: false, error: 'Demasiados intentos de compra. Espera 1 minuto.' }
});

const paymentLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    message: { success: false, error: 'Demasiados intentos de pago.' }
});

/* ========== EMAIL ========== */
let emailTransporter = null;
let emailConfigurado = false;
if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
    try {
        emailTransporter = nodemailer.createTransport({
            service: process.env.EMAIL_SERVICE || 'gmail',
            auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
            pool: true,
            connectionTimeout: 10000
        });
        emailConfigurado = true;
        console.log('✅ Email configurado');
    } catch (error) { 
        console.warn('⚠️ Email error:', error.message); 
    }
}

function formatCurrency(amount) {
    return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(amount);
}

function isValidEmail(email) {
    const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return regex.test(email);
}

function sanitize(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// ===== OPTIMIZACIÓN DE IMÁGENES CON CLOUDINARY =====
function getOptimizedImageUrl(imageUrl, width = 500, height = 500, crop = 'fill') {
    if (!imageUrl) return null;
    
    // Si Cloudinary está configurado y la imagen es de ImgBB, usar Cloudinary como proxy
    if (CLOUDINARY_CLOUD_NAME && imageUrl.includes('i.ibb.co')) {
        return `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/fetch/w_${width},h_${height},c_${crop},f_auto,q_auto/${encodeURIComponent(imageUrl)}`;
    }
    
    // Si la imagen es de Unsplash, agregar parámetros
    if (imageUrl.includes('unsplash.com')) {
        const separator = imageUrl.includes('?') ? '&' : '?';
        return `${imageUrl}${separator}w=${width}&h=${height}&fit=crop&crop=center&auto=format`;
    }
    
    // Si Cloudinary está configurado, usarlo para cualquier imagen
    if (CLOUDINARY_CLOUD_NAME) {
        return `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/fetch/w_${width},h_${height},c_${crop},f_auto,q_auto/${encodeURIComponent(imageUrl)}`;
    }
    
    // Fallback: devolver la imagen original
    return imageUrl;
}

function getOptimizedProductImages(product) {
    if (!product || !product.imagenes || !Array.isArray(product.imagenes)) {
        return product;
    }
    
    return {
        ...product,
        imagenes: product.imagenes.map(img => getOptimizedImageUrl(img)),
        thumbnail: product.imagenes[0] ? getOptimizedImageUrl(product.imagenes[0], 200, 200) : null,
        medium: product.imagenes[0] ? getOptimizedImageUrl(product.imagenes[0], 400, 400) : null,
        large: product.imagenes[0] ? getOptimizedImageUrl(product.imagenes[0], 800, 800) : null
    };
}
/* ========== [ENTREGA 2026-11-10] Correo de agradecimiento + fechas aproximadas ========== */
/* Promesa de entrega: 7 a 20 días hábiles (fechas concretas calculadas desde la compra). */
const ENTREGA_MIN_HABILES = 7;
const ENTREGA_MAX_HABILES = 20;
function sumarDiasHabiles(dias, desde = new Date()) {
    /* Base en hora de México (UTC-6 fijo, sin horario de verano).
       Se fija mediodía UTC para que la fecha es-MX nunca ruede un día. */
    const d = new Date(desde.getTime() - 6 * 3600 * 1000);
    d.setUTCHours(12, 0, 0, 0);
    let agregados = 0;
    while (agregados < dias) {
        d.setUTCDate(d.getUTCDate() + 1);
        const w = d.getUTCDay();
        if (w !== 0 && w !== 6) agregados++; /* sábados y domingos no cuentan */
    }
    return d;
}
function fechaEntregaTxt(d) {
    const s = d.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Mexico_City' });
    return s.charAt(0).toUpperCase() + s.slice(1);
}
/* Referencias públicas de los proveedores (días hábiles; varían por aduana y temporada):
   · AliExpress Standard a México: 7 a 30 (hasta 45 en temporada alta) — es.aliexpress.com
   · CJ Dropshipping (CJPaket/CJPacket) a México: 12 a 25 — blog oficial CJ */
function refsProveedorDe(items) {
    const tiene = (p) => (items || []).some(it => String(it.proveedor || '').toLowerCase().includes(p));
    const refs = [];
    if (tiene('aliexpress')) refs.push('<b>AliExpress:</b> 7 a 30 días hábiles');
    if (tiene('cj')) refs.push('<b>CJ Dropshipping:</b> 12 a 25 días hábiles');
    return refs;
}

/* ========== NOTA DE COMPRA PROFESIONAL ========== */
async function sendConfirmationEmail(orderData) {
    if (!emailConfigurado || !emailTransporter) return false;
    
    const { 
        orderId, 
        customerEmail, 
        customerName, 
        total, 
        items, 
        shippingAddress, 
        paymentMethod, 
        date,
        subtotal = 0,
        envio = 0,
        iva = 0,
        descuento = 0,
        cashbackUsado = 0,
        rfc = '',
        razonSocial = '',
        regimenFiscal = '',
        usoCFDI = '',
        requireInvoice = false,
        phone = '',
        estado = 'pagado',
        cuponAplicado = ''
    } = orderData;
    
    const safeName = sanitize(customerName);
    const safeAddress = sanitize(typeof shippingAddress === 'string' ? shippingAddress : shippingAddress?.direccion || '');
    const safeRfc = sanitize(rfc);
    const safeRazonSocial = sanitize(razonSocial);
    const safeRegimenFiscal = sanitize(regimenFiscal);
    const safeUsoCFDI = sanitize(usoCFDI);
    const safePhone = sanitize(phone);
    const safeCupon = sanitize(cuponAplicado);
    
    const itemsHtml = (items || []).map(item => {
        const precioItem = (item.precioReal || item.precio || 0) * (item.cantidad || 1);
        return `
            <tr>
                <td style="padding:8px 4px;border-bottom:1px solid #e5e7eb;font-size:14px;">${sanitize(item.nombre)}</td>
                <td style="padding:8px 4px;border-bottom:1px solid #e5e7eb;font-size:14px;text-align:center;">x${item.cantidad || 1}</td>
                <td style="padding:8px 4px;border-bottom:1px solid #e5e7eb;font-size:14px;text-align:right;">${formatCurrency(precioItem)}</td>
            </tr>
        `;
    }).join('');
    
    /* [ENTREGA 2026-11-10] fechas aproximadas de entrega para este pedido */
    const baseEntrega = date ? new Date(date) : new Date();
    const fMin = fechaEntregaTxt(sumarDiasHabiles(ENTREGA_MIN_HABILES, baseEntrega));
    const fMax = fechaEntregaTxt(sumarDiasHabiles(ENTREGA_MAX_HABILES, baseEntrega));
    const refsProv = refsProveedorDe(items);
    
    const empresa = {
        nombre: 'Bonü Marketplace',
        direccion: '2da de Iztacihuatl #20, Col. El Popo, Atlixco, Puebla',
        telefono: '322 270 0732',
        email: 'bonu.marketplace@gmail.com',
        rfc: 'CAGJ791031159',
        sitio: 'https://bonü.com'
    };
    
    const fechaFormateada = new Date(date).toLocaleString('es-MX', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
    
    const html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Nota de Compra #${orderId}</title>
    <style>
        * { margin:0; padding:0; box-sizing:border-box; }
        body { font-family: 'Arial', 'Helvetica', sans-serif; background:#f5f5f5; }
        .container { max-width:650px; margin:0 auto; background:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 4px 20px rgba(0,0,0,0.08); }
        .header { background:linear-gradient(135deg,#facc15,#fbbf24); padding:28px 32px; text-align:center; border-bottom:4px solid #eab308; }
        .header h1 { font-size:28px; font-weight:800; color:#000000; letter-spacing:-0.5px; }
        .header .subtitle { font-size:14px; color:#4a4a4a; margin-top:4px; font-weight:500; }
        .header .badge { display:inline-block; background:#000000; color:#facc15; padding:4px 16px; border-radius:20px; font-size:12px; font-weight:700; margin-top:8px; letter-spacing:0.5px; }
        .body { padding:28px 32px; }
        .section { margin-bottom:24px; }
        .section-title { font-size:14px; font-weight:700; color:#6b7280; text-transform:uppercase; letter-spacing:0.5px; border-bottom:2px solid #f3f4f6; padding-bottom:8px; margin-bottom:12px; }
        .row { display:flex; justify-content:space-between; padding:6px 0; font-size:14px; }
        .row-label { color:#6b7280; }
        .row-value { font-weight:500; color:#1f2937; }
        .row-value.bold { font-weight:700; }
        .total-row { border-top:2px solid #facc15; padding-top:12px; margin-top:8px; }
        .total-row .row-value { font-size:20px; font-weight:800; color:#10b981; }
        table { width:100%; border-collapse:collapse; margin:8px 0; }
        table th { text-align:left; font-size:12px; color:#6b7280; text-transform:uppercase; font-weight:600; padding:8px 4px; border-bottom:2px solid #e5e7eb; }
        table td { padding:8px 4px; font-size:14px; border-bottom:1px solid #f3f4f6; }
        .legal { background:#fef9c3; border-left:4px solid #facc15; padding:12px 16px; border-radius:8px; margin:16px 0; font-size:13px; color:#4a4a4a; }
        .legal strong { color:#000000; }
        .footer { background:#111827; padding:24px 32px; text-align:center; color:#9ca3af; font-size:13px; }
        .footer a { color:#facc15; text-decoration:none; }
        .footer a:hover { text-decoration:underline; }
        .footer .company { color:#ffffff; font-weight:600; margin-bottom:4px; }
        .footer .contact { font-size:12px; margin-top:4px; }
        .badge-pagado { display:inline-block; background:#dcfce7; color:#166534; padding:2px 12px; border-radius:20px; font-size:12px; font-weight:600; }
        .info-grid { display:grid; grid-template-columns:1fr 1fr; gap:4px 16px; }
        @media (max-width:480px) { .info-grid { grid-template-columns:1fr; } .header { padding:20px; } .header h1 { font-size:22px; } .body { padding:20px; } }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>⭐ Bonü</h1>
            <div class="subtitle">Global Marketplace Enterprise</div>
            <div class="badge">NOTA DE COMPRA</div>
        </div>
        <div class="body">
            <div class="section">
                <div class="info-grid">
                    <div>
                        <div class="row">
                            <span class="row-label">Número:</span>
                            <span class="row-value bold">#${orderId}</span>
                        </div>
                        <div class="row">
                            <span class="row-label">Fecha:</span>
                            <span class="row-value">${fechaFormateada}</span>
                        </div>
                    </div>
                    <div>
                        <div class="row">
                            <span class="row-label">Estado:</span>
                            <span class="badge-pagado">${estado === 'pagado' ? '✅ Pagado' : estado}</span>
                        </div>
                        <div class="row">
                            <span class="row-label">Método de pago:</span>
                            <span class="row-value">${paymentMethod}</span>
                        </div>
                    </div>
                </div>
            </div>
            <div class="section">
                <div class="section-title">📋 Datos del Cliente</div>
                <div class="row"><span class="row-label">Nombre:</span><span class="row-value">${safeName}</span></div>
                <div class="row"><span class="row-label">Email:</span><span class="row-value">${sanitize(customerEmail)}</span></div>
                ${safePhone ? `<div class="row"><span class="row-label">Teléfono:</span><span class="row-value">${safePhone}</span></div>` : ''}
                ${safeAddress ? `<div class="row"><span class="row-label">Dirección:</span><span class="row-value">${safeAddress}</span></div>` : ''}
            </div>
            <div class="section">
                <div class="section-title">📦 Productos</div>
                <table>
                    <thead>
                        <tr>
                            <th>Producto</th>
                            <th style="text-align:center;">Cant.</th>
                            <th style="text-align:right;">Importe</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${itemsHtml}
                    </tbody>
                </table>
            </div>
            <div class="section">
                <div class="section-title">💰 Resumen de Pago</div>
                <div class="row"><span class="row-label">Subtotal:</span><span class="row-value">${formatCurrency(subtotal)}</span></div>
                ${envio > 0 ? `<div class="row"><span class="row-label">Envío:</span><span class="row-value">${formatCurrency(envio)}</span></div>` : `<div class="row"><span class="row-label">Envío:</span><span class="row-value" style="color:#10b981;">Gratis</span></div>`}
                ${descuento > 0 ? `<div class="row"><span class="row-label">Descuento:</span><span class="row-value" style="color:#ef4444;">-${formatCurrency(descuento)}</span></div>` : ''}
                ${cashbackUsado > 0 ? `<div class="row"><span class="row-label">Cashback usado:</span><span class="row-value" style="color:#3b82f6;">-${formatCurrency(cashbackUsado)}</span></div>` : ''}
                ${safeCupon ? `<div class="row"><span class="row-label">Cupón aplicado:</span><span class="row-value" style="color:#8b5cf6;">${safeCupon}</span></div>` : ''}
                <div class="row total-row">
                    <span class="row-label" style="font-weight:700;">TOTAL:</span>
                    <span class="row-value">${formatCurrency(total)}</span>
                </div>
            </div>
            ${requireInvoice && (safeRfc || safeRazonSocial) ? `
            <div class="section">
                <div class="section-title">📄 Datos de Facturación</div>
                ${safeRfc ? `<div class="row"><span class="row-label">RFC:</span><span class="row-value">${safeRfc}</span></div>` : ''}
                ${safeRazonSocial ? `<div class="row"><span class="row-label">Razón Social:</span><span class="row-value">${safeRazonSocial}</span></div>` : ''}
                ${safeRegimenFiscal ? `<div class="row"><span class="row-label">Régimen Fiscal:</span><span class="row-value">${safeRegimenFiscal}</span></div>` : ''}
                ${safeUsoCFDI ? `<div class="row"><span class="row-label">Uso CFDI:</span><span class="row-value">${safeUsoCFDI}</span></div>` : ''}
            </div>
            ` : ''}
            <div style="background:#fffbeb;border:1px solid #fde68a;border-left:4px solid #f59e0b;border-radius:10px;padding:16px 18px;margin:18px 0;">
                <p style="margin:0 0 6px 0;font-size:15px;font-weight:800;color:#111827;">🚚 ¿Cuándo llega mi pedido?</p>
                <p style="margin:0 0 8px 0;font-size:13.5px;color:#4a4a4a;line-height:1.6;">El tiempo de entrega es de <strong>7 a 20 días hábiles</strong> a partir de tu compra. Enviamos a todo México.</p>
                <p style="margin:0;font-size:14px;color:#166534;font-weight:700;">📅 Tu pedido llegaría entre el ${fMin} y el ${fMax}.</p>
                ${refsProv.length ? `<p style="margin:10px 0 0 0;font-size:12px;color:#6b7280;line-height:1.7;">Referencia del proveedor: ${refsProv.join(' &nbsp;·&nbsp; ')}. Estos plazos pueden variar por aduana, temporada o destino.</p>` : ''}
            </div>
            <div class="legal">
                <strong>⚠️ IMPORTANTE:</strong> Este documento es una <strong>NOTA DE COMPRA</strong> y <strong>NO tiene validez fiscal</strong>.<br>
                Para efectos fiscales, este comprobante no es un CFDI. Si requieres factura con validez fiscal, por favor contáctanos.
            </div>
            <div style="background:#f0fdf4;border-radius:8px;padding:14px 16px;margin:16px 0;border:1px solid #bbf7d0;">
                <p style="font-size:14px;color:#166534;font-weight:500;margin-bottom:4px;">📧 ¿Necesitas factura con validez fiscal?</p>
                <p style="font-size:13px;color:#4a4a4a;">Escríbenos a <strong>bonu.marketplace@gmail.com</strong> o llama al <strong>322 270 0732</strong> y te enviaremos tu factura CFDI.</p>
            </div>
            <div style="text-align:center;padding:10px 0 4px 0;border-top:1px solid #f3f4f6;margin-top:8px;">
                <p style="font-size:17px;font-weight:700;color:#1f2937;">${safeName ? `¡Gracias por tu compra, ${safeName}! ❤️` : '¡Gracias por tu compra! ❤️'}</p>
                <p style="font-size:13px;color:#6b7280;">Tu pedido ya está en proceso. Te avisaremos por correo en cada avance.</p>
            </div>
        </div>
        <div class="footer">
            <div class="company">⭐ Bonü Marketplace</div>
            <div>2da de Iztacihuatl #20, Col. El Popo, Atlixco, Puebla</div>
            <div class="contact">
                📧 bonu.marketplace@gmail.com &nbsp;|&nbsp; 📞 322 270 0732 &nbsp;|&nbsp; RFC: CAGJ791031159
            </div>
            <div style="margin-top:8px;font-size:11px;color:#6b7280;">
                © 2007-${new Date().getFullYear()} Bonü - Todos los derechos reservados
                <br>
                <a href="https://bonü.com" target="_blank">https://bonü.com</a>
            </div>
        </div>
    </div>
</body>
</html>`;
    
    const subject = `🎉 ¡Gracias por tu compra! - Nota de Compra #${orderId} - Bonü`;
    
    try {
        await Promise.race([
            emailTransporter.sendMail({
                from: `"Bonü Marketplace" <${process.env.EMAIL_USER}>`,
                to: customerEmail,
                subject: subject,
                html: html
            }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Email timeout')), 15000))
        ]);
        console.log(`📧 Nota de Compra enviada a ${customerEmail} - #${orderId}`);
        return true;
    } catch (error) {
        console.error('❌ Error enviando nota de compra:', error.message);
        return false;
    }
}

/* ========== FIREBASE ADMIN ========== */
if (!admin.apps.length) {
    try {
        if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
            admin.initializeApp({
                credential: admin.credential.cert({
                    projectId: process.env.FIREBASE_PROJECT_ID,
                    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
                })
            });
            console.log('✅ Firebase Admin inicializado');
        } else {
            console.error('❌ Faltan credenciales de Firebase en variables de entorno');
        }
    } catch (error) {
        console.error('❌ Error Firebase:', error.message);
    }
}
const firestore = admin.apps.length ? admin.firestore() : null;
if (!firestore) console.error('❌ CRÍTICO: Firestore no disponible');

/* ========== MIDDLEWARE AUTH ========== */
async function verificarAdmin(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, error: 'No autorizado: token requerido' });
    }
    const idToken = authHeader.split('Bearer ')[1];
    try {
        const decoded = await admin.auth().verifyIdToken(idToken);
        
        let esAdmin = decoded.admin === true;
        if (!esAdmin && firestore) {
            const adminDoc = await firestore.collection('admins').doc(decoded.uid).get();
            esAdmin = adminDoc.exists;
        }
        
        if (!esAdmin) {
            console.warn(`⚠️ Intento de acceso admin rechazado: ${decoded.email}`);
            return res.status(403).json({ success: false, error: 'Acceso denegado: se requiere rol admin' });
        }
        
        req.user = decoded;
        next();
    } catch (error) {
        console.error('❌ Token inválido:', error.message);
        return res.status(401).json({ success: false, error: 'Token inválido o expirado' });
    }
}

async function verificarAuthOpcional(req, res, next) {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
        try {
            const idToken = authHeader.split('Bearer ')[1];
            req.user = await admin.auth().verifyIdToken(idToken);
        } catch (e) {
            req.user = null;
        }
    }
    next();
}

/* ============================================================
   ========== SAGA 4 · MOTOR DE PRECIOS + CASHBACK v10 ==========
   Reglas de negocio (definidas por el dueño de Bonü):
   · Cashback base 5% en TODAS las compras.
   · 10% si el total supera $45,000 MXN y TODOS los productos
     van en cantidades de 6 piezas o más.
   · 15% si el total supera $60,000 MXN.
   · 7%, 8%, 10%, 12%, 15%, 18% y 20%: promos por producto
     (campo cashbackPromo en el documento del producto) que el
     admin publica cuando decida; se aplican línea por línea
     cuando son mayores al nivel del carrito. Tope: 20%.
   · El precio de venta se calcula para que DESPUÉS de regalar
     el cashback quede la ganancia elegida sobre el costo:
       precio = (costo + envío) × (1 + margen%) / (1 − cashback%)
   ============================================================ */
const LISTA_MARGENES = [5, 10, 15, 20, 25, 30, 35, 40, 50, 60, 65, 70, 75, 80, 85, 90, 95, 100, 110, 120];
const LISTA_CASHBACK = [5, 7, 8, 10, 12, 15, 18, 20];
const CASHBACK_BASE = 5;
const CASHBACK_MAX_PRODUCTO = 20;
const UMBRAL_CASHBACK_10 = 45000;
const UMBRAL_CASHBACK_15 = 60000;
const QTY_MIN_CASHBACK_10 = 6;

/* Config editable guardada en Firestore (config/precios); valores por defecto si no existe */
const CONFIG_PRECIOS_DEFAULT = { margenDefault: 40, cashbackDefault: 5, descMayoreo6: 10 };
let configPrecios = { ...CONFIG_PRECIOS_DEFAULT };

async function cargarConfigPrecios() {
    if (!firestore) return configPrecios;
    try {
        const docCfg = await firestore.collection('config').doc('precios').get();
        if (docCfg.exists) {
            const d = docCfg.data();
            configPrecios = {
                margenDefault: LISTA_MARGENES.includes(d.margenDefault) ? d.margenDefault : CONFIG_PRECIOS_DEFAULT.margenDefault,
                cashbackDefault: LISTA_CASHBACK.includes(d.cashbackDefault) ? d.cashbackDefault : CONFIG_PRECIOS_DEFAULT.cashbackDefault,
                descMayoreo6: (typeof d.descMayoreo6 === 'number' && d.descMayoreo6 >= 0 && d.descMayoreo6 <= 50) ? d.descMayoreo6 : CONFIG_PRECIOS_DEFAULT.descMayoreo6
            };
        }
    } catch (e) {
        console.error('⚠️ No pude leer config/precios (uso valores por defecto):', e.message);
    }
    return configPrecios;
}

/* Redondeo comercial: termina en .99 y NUNCA queda por debajo del cálculo */
function redondeo99(x) {
    if (!Number.isFinite(x) || x <= 0) return 0;
    let p = Math.floor(x) + 0.99;
    if (p < x - 1e-9) p += 1;
    return Math.round(p * 100) / 100;
}

/* Motor principal: precio de venta que deja la ganancia elegida DESPUÉS del cashback */
function calcularPrecioVenta({ costo, envio = 0, margen, cashback = CASHBACK_BASE, descMayoreo6 = null }) {
    const dm = (typeof descMayoreo6 === 'number' && descMayoreo6 >= 0 && descMayoreo6 <= 50) ? descMayoreo6 : configPrecios.descMayoreo6;
    const costoTotal = (parseFloat(costo) || 0) + (parseFloat(envio) || 0);
    const m = Math.max(0, parseFloat(margen) || 0);
    const cb = Math.min(CASHBACK_MAX_PRODUCTO, Math.max(0, parseFloat(cashback) || CASHBACK_BASE));
    const netoDeseado = costoTotal * (1 + m / 100);                 // lo que quiero recibir neto por pieza
    const precioFinal = redondeo99(netoDeseado / (1 - cb / 100));   // precio que anula el costo del cashback
    const precio6 = redondeo99(precioFinal * 6 * (1 - dm / 100));   // paquete 6 piezas con desc. mayoreo
    const gananciaReal = Math.round((precioFinal * (1 - cb / 100) - costoTotal) * 100) / 100;
    return {
        costo: Math.round(costoTotal * 100) / 100,
        margen: m,
        cashback: cb,
        descMayoreo6: dm,
        precioFinal,
        precio6,
        gananciaRealPorPieza: gananciaReal,
        margenRealSobrePrecio: precioFinal > 0 ? Math.round(gananciaReal / precioFinal * 1000) / 10 : 0
    };
}

/* Tabla comparativa: el mismo costo a TODOS los márgenes de la lista fija */
function tablaPreciosPorMargen({ costo, envio = 0, cashback = CASHBACK_BASE, descMayoreo6 = null }) {
    return LISTA_MARGENES.map(m => {
        const r = calcularPrecioVenta({ costo, envio, margen: m, cashback, descMayoreo6 });
        return { margen: m, precioFinal: r.precioFinal, precio6: r.precio6, gananciaRealPorPieza: r.gananciaRealPorPieza };
    });
}

/* Nivel de cashback de un carrito según las reglas del dueño */
function nivelCashbackCarrito(items, totalCompra) {
    const total = Math.max(parseFloat(totalCompra) || 0, 0);
    let pct = CASHBACK_BASE, nivel = 'base_5';
    const todasQty6 = Array.isArray(items) && items.length > 0 && items.every(i => (parseInt(i.cantidad) || 0) >= QTY_MIN_CASHBACK_10);
    if (total > UMBRAL_CASHBACK_15) { pct = 15; nivel = 'total_mayor_60000'; }
    else if (total > UMBRAL_CASHBACK_10 && todasQty6) { pct = 10; nivel = 'total_mayor_45000_y_6piezas'; }
    return { pct, nivel, todasQty6, total };
}

/* Cashback total de una orden: nivel del carrito, o el promo del producto si es mayor (línea por línea) */
function calcularCashbackOrden(items, totalCompra) {
    const { pct: pctNivel, nivel } = nivelCashbackCarrito(items, totalCompra);
    let monto = 0;
    const lineas = [];
    for (const i of (Array.isArray(items) ? items : [])) {
        const baseLinea = (parseFloat(i.precioReal) || 0) * (parseInt(i.cantidad) || 0);
        const promo = Math.min(CASHBACK_MAX_PRODUCTO, Math.max(0, parseFloat(i.cashbackPromo) || 0));
        const pctLinea = Math.max(pctNivel, promo);
        const montoLinea = baseLinea * pctLinea / 100;
        monto += montoLinea;
        lineas.push({ id: i.id, nombre: i.nombre || '', pct: pctLinea, monto: Math.round(montoLinea * 100) / 100 });
    }
    return {
        porcentajeNivel: pctNivel,
        nivel,
        monto: Math.round(monto * 100) / 100,
        lineas
    };
}
cargarConfigPrecios(); // precarga inicial (no bloquea el arranque)

/* ========== VARIABLES DE ENTORNO ========== */
const STRIPE_SECRET_KEY = (process.env.STRIPE_SECRET_KEY || '').trim();
const STRIPE_WEBHOOK_SECRET = (process.env.STRIPE_WEBHOOK_SECRET || '').trim();
const MERCADO_PAGO_ACCESS_TOKEN = (process.env.MERCADO_PAGO_ACCESS_TOKEN || '').trim();
const BONUPAY_ACCESS_TOKEN = (process.env.BONUPAY_ACCESS_TOKEN || '').trim();
const PAYPAL_CLIENT_ID = (process.env.PAYPAL_CLIENT_ID || '').trim();
const PAYPAL_CLIENT_SECRET = (process.env.PAYPAL_CLIENT_SECRET || '').trim();
const PAYPAL_MODE = process.env.PAYPAL_MODE || 'live';
const CJ_API_KEY = process.env.CJ_API_KEY;
const CJ_API_URL = 'https://developers.cjdropshipping.com/api2.0/v1';
const TVCMALL_API_URL = process.env.TVCMALL_API_URL || 'https://api.tvcmall.com/v1';
const TVCMALL_API_KEY = process.env.TVCMALL_API_KEY;
const TVCMALL_API_SECRET = process.env.TVCMALL_API_SECRET;
const SUNSKY_API_URL = process.env.SUNSKY_API_URL || 'https://api.sunsky-online.com';
const SUNSKY_API_KEY = process.env.SUNSKY_API_KEY;
const SUNSKY_API_SECRET = process.env.SUNSKY_API_SECRET;

// ===== CLOUDINARY (NUEVO) =====
const cloudinary = require('cloudinary').v2;
const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY;
const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET;

if (CLOUDINARY_CLOUD_NAME && CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET) {
    cloudinary.config({
        cloud_name: CLOUDINARY_CLOUD_NAME,
        api_key: CLOUDINARY_API_KEY,
        api_secret: CLOUDINARY_API_SECRET
    });
    console.log('✅ Cloudinary configurado');
} else {
    console.log('⚠️ Cloudinary no configurado (opcional)');
}
/* ========== CORS ========== */
const allowedOrigins = [
    'http://localhost:5500', 
    'http://localhost:3000',
    'http://localhost:8080',
    'https://bonumktp.web.app', 
    'https://bonumktp.firebaseapp.com',
    'https://xn--bon-joa.com',
    'https://www.xn--bon-joa.com',
    process.env.FRONTEND_URL
].filter(Boolean);

app.use(cors({
    origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) {
            return callback(null, true);
        }
        if (NODE_ENV === 'production') {
            console.warn(`🚫 CORS bloqueado en producción: ${origin}`);
            return callback(new Error('Origen no permitido por CORS'));
        }
        console.log(`⚠️ CORS permitido en desarrollo: ${origin}`);
        return callback(null, true);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'CJ-Access-Token']
}));

app.use('/api/webhook/stripe', express.raw({ type: 'application/json' }));
app.use('/api/webhook/mercadopago', express.raw({ type: 'application/json' }));
app.use('/api/webhook/bonupay', express.raw({ type: 'application/json' }));
app.use('/api/webhook/paypal', express.raw({ type: 'application/json' }));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

/* ========== CATEGORÍAS ========== */
const CATEGORIAS = [
    'Ropa de hombre', 'Ropa de mujer', 'Tecnología', 'Belleza', 'Juguetes',
    'Celulares y Accesorios', 'Hogar y jardín', 'Accesorios de hombre',
    'Accesorios de mujer', 'Calzado de Hombre', 'Calzado de mujer',
    'Perfumes', 'Joyería y relojes', 'Ropa de niños', 'Calzado de niños',
    'Consolas y videojuegos', 'Equipo de gym', 'Mascotas y accesorios',
    'Herramientas y accesorios de Auto', 'General'
];

function detectarCategoria(nombre = '', descripcion = '') {
    const txt = (nombre + ' ' + descripcion).toLowerCase();
    const mapa = [
        ['Celulares y Accesorios', ['celular','iphone','samsung','funda','cargador']],
        ['Tecnología', ['computadora','laptop','tablet','teclado','mouse']],
        ['Ropa de mujer', ['vestido','blusa','falda','mujer']],
        ['Ropa de hombre', ['camisa','pantalon','hombre']]
    ];
    for (const [cat, kws] of mapa) {
        if (kws.some(k => txt.includes(k))) return cat;
    }
    return 'General';
}

const generarId = () => `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

/* ========== STRIPE ========== */
const Stripe = require('stripe');
let stripe = null;
if (STRIPE_SECRET_KEY) { 
    stripe = new Stripe(STRIPE_SECRET_KEY); 
    console.log('✅ Stripe configurado'); 
}

app.post('/api/payments/stripe/create-intent', paymentLimiter, async (req, res) => {
    if (!stripe) return res.status(500).json({ success: false, error: 'Stripe no configurado' });
    const { checkoutToken, customerEmail } = req.body;
    
    if (!checkoutToken) {
        return res.status(400).json({ success: false, error: 'Token de checkout requerido' });
    }
    
    try {
        const tokenDoc = await firestore.collection('checkoutTokens').doc(checkoutToken).get();
        if (!tokenDoc.exists) {
            return res.status(400).json({ success: false, error: 'Token inválido' });
        }
        
        const tokenData = tokenDoc.data();
        
        if (tokenData.exp < Date.now()) {
            return res.status(400).json({ success: false, error: 'Token expirado' });
        }
        
        const amount = tokenData.total;
        
        if (!amount || amount <= 0) {
            return res.status(400).json({ success: false, error: 'Monto inválido' });
        }
        
        const paymentIntent = await stripe.paymentIntents.create({
            amount: Math.round(amount * 100),
            currency: 'mxn',
            metadata: { checkoutToken },
            receipt_email: customerEmail || tokenData.customerEmail,
                       statement_descriptor_suffix: 'Bonu',
            description: `Pedido Bonü - ${checkoutToken.substring(0, 8)}`
        });
        
        console.log(`✅ Stripe PaymentIntent creado: ${paymentIntent.id} - $${amount} MXN`);
        
        res.json({ 
            success: true, 
            clientSecret: paymentIntent.client_secret, 
            paymentIntentId: paymentIntent.id 
        });
    } catch (error) {
        console.error('❌ Error Stripe:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

/* ========== MERCADO PAGO ========== */
const MERCADO_PAGO_API_URL = 'https://api.mercadopago.com/v1';

app.post('/api/payments/mercadopago/create-payment', paymentLimiter, async (req, res) => {
    if (!MERCADO_PAGO_ACCESS_TOKEN) {
        return res.status(500).json({ success: false, error: 'Mercado Pago no configurado' });
    }
    
    const { checkoutToken, payer, cardToken, paymentMethodId } = req.body;
    
    if (!checkoutToken || !cardToken) {
        return res.status(400).json({ success: false, error: 'Token de checkout y token de tarjeta requeridos' });
    }
    
    try {
        const tokenDoc = await firestore.collection('checkoutTokens').doc(checkoutToken).get();
        if (!tokenDoc.exists || tokenDoc.data().exp < Date.now()) {
            return res.status(400).json({ success: false, error: 'Token inválido o expirado' });
        }
        
        const tokenData = tokenDoc.data();
        const total = tokenData.total;
        
        const paymentData = {
            transaction_amount: parseFloat(total.toFixed(2)),
            token: cardToken,
            description: `Compra Bonü - ${checkoutToken.substring(0, 8)}`,
            installments: 1,
            payment_method_id: paymentMethodId || 'visa',
            payer: {
                email: payer?.email || tokenData.customerEmail || 'cliente@bonu.com',
                
            },
            external_reference: checkoutToken,
            metadata: {
                checkoutToken: checkoutToken,
                orderId: `ORD-${Date.now()}`
            }
        };
        
        console.log('📤 Creando pago en MP (Checkout API - MercadoPago):', JSON.stringify(paymentData, null, 2));
        
        const response = await fetch('https://api.mercadopago.com/v1/payments', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${MERCADO_PAGO_ACCESS_TOKEN}`,
                'Content-Type': 'application/json',
                'X-Idempotency-Key': checkoutToken
            },
            body: JSON.stringify(paymentData)
        });
        
        const data = await response.json();
        console.log('📥 Respuesta MP (Checkout API - MercadoPago):', JSON.stringify(data, null, 2));
        
        if (data.id && data.status === 'approved') {
            const result = await finalizarOrden(checkoutToken, 'MercadoPago', data.id, data.payer?.email);
            res.json({
                success: true,
                paymentId: data.id,
                status: data.status,
                orderId: result.orderId,
                paymentMethod: data.payment_method_id
            });
        } else if (data.id && (data.status === 'in_process' || data.status === 'pending')) {
            res.json({
                success: true,
                paymentId: data.id,
                status: data.status,
                message: 'Pago en proceso. Recibirás confirmación por correo.',
                paymentMethod: data.payment_method_id
            });
        } else {
            console.error('❌ Error MP (Checkout API - MercadoPago):', data);
            res.status(400).json({
                success: false,
                error: data.message || 'Error al procesar el pago',
                details: data
            });
        }
    } catch (error) {
        console.error('❌ Error en Checkout API (MercadoPago):', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/payments/bonupay/create-payment', paymentLimiter, async (req, res) => {
    if (!BONUPAY_ACCESS_TOKEN && !MERCADO_PAGO_ACCESS_TOKEN) {
        return res.status(500).json({ success: false, error: 'BonuPay no configurado' });
    }
    
    const accessToken = BONUPAY_ACCESS_TOKEN || MERCADO_PAGO_ACCESS_TOKEN;
    const { checkoutToken, payer, cardToken, paymentMethodId } = req.body;
    
    if (!checkoutToken || !cardToken) {
        return res.status(400).json({ success: false, error: 'Token de checkout y token de tarjeta requeridos' });
    }
    
    try {
        const tokenDoc = await firestore.collection('checkoutTokens').doc(checkoutToken).get();
        if (!tokenDoc.exists || tokenDoc.data().exp < Date.now()) {
            return res.status(400).json({ success: false, error: 'Token inválido o expirado' });
        }
        
        const tokenData = tokenDoc.data();
        const total = tokenData.total;
        
        const paymentData = {
            transaction_amount: parseFloat(total.toFixed(2)),
            token: cardToken,
            description: `Compra Bonü - ${checkoutToken.substring(0, 8)}`,
            installments: 1,
            payment_method_id: paymentMethodId || 'visa',
            payer: {
                email: payer?.email || tokenData.customerEmail || 'cliente@bonu.com',
                
            },
            external_reference: checkoutToken,
            metadata: {
                checkoutToken: checkoutToken,
                orderId: `ORD-${Date.now()}`
            }
        };
        
        console.log('📤 Creando pago en MP (Checkout API - BonuPay):', JSON.stringify(paymentData, null, 2));
        
        const response = await fetch('https://api.mercadopago.com/v1/payments', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                'X-Idempotency-Key': checkoutToken
            },
            body: JSON.stringify(paymentData)
        });
        
        const data = await response.json();
        console.log('📥 Respuesta MP (Checkout API - BonuPay):', JSON.stringify(data, null, 2));
        
        if (data.id && data.status === 'approved') {
            const result = await finalizarOrden(checkoutToken, 'BonuPay', data.id, data.payer?.email);
            res.json({
                success: true,
                paymentId: data.id,
                status: data.status,
                orderId: result.orderId,
                paymentMethod: data.payment_method_id
            });
        } else if (data.id && (data.status === 'in_process' || data.status === 'pending')) {
            res.json({
                success: true,
                paymentId: data.id,
                status: data.status,
                message: 'Pago en proceso. Recibirás confirmación por correo.',
                paymentMethod: data.payment_method_id
            });
        } else {
            console.error('❌ Error MP (Checkout API - BonuPay):', data);
            res.status(400).json({
                success: false,
                error: data.message || 'Error al procesar el pago',
                details: data
            });
        }
    } catch (error) {
        console.error('❌ Error en Checkout API (BonuPay):', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/payments/mercadopago/capture', paymentLimiter, async (req, res) => {
    const { paymentId, checkoutToken } = req.body;
    
    if (!paymentId || !checkoutToken) {
        return res.status(400).json({ success: false, error: 'paymentId y checkoutToken requeridos' });
    }
    
    if (!MERCADO_PAGO_ACCESS_TOKEN) {
        return res.status(500).json({ success: false, error: 'Mercado Pago no configurado' });
    }
    
    try {
        const paymentResponse = await fetch(`${MERCADO_PAGO_API_URL}/payments/${paymentId}`, {
            headers: { 'Authorization': `Bearer ${MERCADO_PAGO_ACCESS_TOKEN}` }
        });
        
        const payment = await paymentResponse.json();
        
        if (payment.status !== 'approved') {
            console.warn(`⚠️ Pago MP no aprobado: ${paymentId} - Status: ${payment.status}`);
            return res.status(400).json({ 
                success: false, 
                error: `Pago no aprobado. Status: ${payment.status}` 
            });
        }
        
        if (payment.external_reference !== checkoutToken) {
            console.error(`🚫 MP external_reference no coincide: ${payment.external_reference} vs ${checkoutToken}`);
            return res.status(400).json({ success: false, error: 'Referencia de pago no coincide' });
        }
        
        const tokenDoc = await firestore.collection('checkoutTokens').doc(checkoutToken).get();
        if (!tokenDoc.exists) {
            return res.status(400).json({ success: false, error: 'Token no encontrado' });
        }
        
        const tokenData = tokenDoc.data();
        if (Math.abs(payment.transaction_amount - tokenData.total) > 0.01) {
            console.error(`🚫 MP monto no coincide: ${payment.transaction_amount} vs ${tokenData.total}`);
            return res.status(400).json({ success: false, error: 'Monto no coincide' });
        }
        
        const result = await finalizarOrden(checkoutToken, 'MercadoPago', paymentId, payment.payer?.email);
        
        console.log(`✅ Orden creada desde MP capture: ${result.orderId}`);
        
        res.json({ 
            success: true, 
            orderId: result.orderId,
            paymentStatus: payment.status
        });
    } catch (error) {
        console.error('❌ Error capturando MP:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/payments/bonupay/capture', paymentLimiter, async (req, res) => {
    const { paymentId, checkoutToken } = req.body;
    
    if (!paymentId || !checkoutToken) {
        return res.status(400).json({ success: false, error: 'paymentId y checkoutToken requeridos' });
    }
    
    const accessToken = BONUPAY_ACCESS_TOKEN || MERCADO_PAGO_ACCESS_TOKEN;
    if (!accessToken) {
        return res.status(500).json({ success: false, error: 'BonuPay no configurado' });
    }
    
    try {
        const paymentResponse = await fetch(`${MERCADO_PAGO_API_URL}/payments/${paymentId}`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        
        const payment = await paymentResponse.json();
        
        if (payment.status !== 'approved') {
            return res.status(400).json({ success: false, error: `Pago no aprobado. Status: ${payment.status}` });
        }
        
        if (payment.external_reference !== checkoutToken) {
            return res.status(400).json({ success: false, error: 'Referencia no coincide' });
        }
        
        const tokenDoc = await firestore.collection('checkoutTokens').doc(checkoutToken).get();
        if (!tokenDoc.exists) {
            return res.status(400).json({ success: false, error: 'Token no encontrado' });
        }
        
        const tokenData = tokenDoc.data();
        if (Math.abs(payment.transaction_amount - tokenData.total) > 0.01) {
            return res.status(400).json({ success: false, error: 'Monto no coincide' });
        }
        
        const result = await finalizarOrden(checkoutToken, 'BonuPay', paymentId, payment.payer?.email);
        
        res.json({ success: true, orderId: result.orderId, paymentStatus: payment.status });
    } catch (error) {
        console.error('❌ Error capturando BonuPay:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

/* ========== PAYPAL ========== */
const PAYPAL_API_URL = PAYPAL_MODE === 'sandbox' 
    ? 'https://api-m.sandbox.paypal.com' 
    : 'https://api-m.paypal.com';

async function getPayPalAccessToken() {
    if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
        throw new Error('PayPal no configurado');
    }
    
    const auth = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString('base64');
    const response = await fetch(`${PAYPAL_API_URL}/v1/oauth2/token`, {
        method: 'POST',
        headers: { 
            'Authorization': `Basic ${auth}`, 
            'Content-Type': 'application/x-www-form-urlencoded' 
        },
        body: 'grant_type=client_credentials'
    });
    
    const data = await response.json();
    if (!data.access_token) {
        throw new Error('Error obteniendo token de PayPal');
    }
    
    return data.access_token;
}

app.post('/api/payments/paypal/create-order', paymentLimiter, async (req, res) => {
    const { checkoutToken, returnUrl = 'https://xn--bon-joa.com/pago-exitoso', cancelUrl = 'https://xn--bon-joa.com/carrito' } = req.body;
    
    if (!checkoutToken) {
        return res.status(400).json({ success: false, error: 'Token requerido' });
    }
    
    try {
        const tokenDoc = await firestore.collection('checkoutTokens').doc(checkoutToken).get();
        if (!tokenDoc.exists || tokenDoc.data().exp < Date.now()) {
            return res.status(400).json({ success: false, error: 'Token inválido o expirado' });
        }
        
        const tokenData = tokenDoc.data();
        const total = tokenData.total;
        const accessToken = await getPayPalAccessToken();
        
        const orderData = {
            intent: 'CAPTURE',
            purchase_units: [{
                reference_id: checkoutToken.substring(0, 64),
                custom_id: checkoutToken.substring(0, 127),
                amount: {
                    currency_code: 'MXN',
                    value: total.toFixed(2)
                },
                items: tokenData.validatedItems.map(item => ({
                    name: item.nombre.substring(0, 127),
                    quantity: String(item.cantidad || 1),
                    unit_amount: { 
                        currency_code: 'MXN', 
                        value: item.precioReal.toFixed(2) 
                    }
                }))
            }],
            application_context: {
                return_url: returnUrl,
                cancel_url: cancelUrl,
                brand_name: 'Bonu Marketplace',
                user_action: 'PAY_NOW',
                shipping_preference: 'NO_SHIPPING'
            }
        };
        
        const response = await fetch(`${PAYPAL_API_URL}/v2/checkout/orders`, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${accessToken}`, 
                'Content-Type': 'application/json' 
            },
            body: JSON.stringify(orderData)
        });
        
        const data = await response.json();
        
        if (data.id) {
            const approveLink = data.links?.find(link => link.rel === 'approve')?.href;
            console.log(`✅ PayPal orden creada: ${data.id} - $${total} MXN`);
            
            res.json({ 
                success: true, 
                orderId: data.id, 
                approveLink 
            });
        } else {
            console.error('❌ Error PayPal:', data);
            res.status(500).json({ 
                success: false, 
                error: data.message || data.details?.[0]?.description || 'Error al crear orden PayPal' 
            });
        }
    } catch (error) {
        console.error('❌ Error PayPal:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/payments/paypal/capture', paymentLimiter, async (req, res) => {
    const { orderID, checkoutToken } = req.body;
    
    if (!orderID || !checkoutToken) {
        return res.status(400).json({ 
            success: false, 
            error: 'orderID y checkoutToken requeridos' 
        });
    }
    
    try {
        const accessToken = await getPayPalAccessToken();
        
        const captureRes = await fetch(`${PAYPAL_API_URL}/v2/checkout/orders/${orderID}/capture`, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${accessToken}`, 
                'Content-Type': 'application/json' 
            }
        });
        
        const captureData = await captureRes.json();
        
        if (captureData.status !== 'COMPLETED') {
            console.warn(`⚠️ PayPal capture no completado: ${orderID} - Status: ${captureData.status}`);
            return res.status(400).json({ 
                success: false, 
                error: `Pago no completado. Status: ${captureData.status}`,
                details: captureData.details
            });
        }
        
        const purchaseUnit = captureData.purchase_units?.[0];
        const tokenFromPayPal = purchaseUnit?.custom_id || purchaseUnit?.reference_id;
        
        if (tokenFromPayPal !== checkoutToken) {
            console.error(`🚫 PayPal token no coincide: ${tokenFromPayPal} vs ${checkoutToken}`);
            return res.status(400).json({ 
                success: false, 
                error: 'Token de checkout no coincide' 
            });
        }
        
        const tokenDoc = await firestore.collection('checkoutTokens').doc(checkoutToken).get();
        if (!tokenDoc.exists) {
            return res.status(400).json({ success: false, error: 'Token no encontrado' });
        }
        
        const tokenData = tokenDoc.data();
        const paypalAmount = parseFloat(purchaseUnit?.payments?.captures?.[0]?.amount?.value || 0);
        
        if (Math.abs(paypalAmount - tokenData.total) > 0.01) {
            console.error(`🚫 PayPal monto no coincide: ${paypalAmount} vs ${tokenData.total}`);
            return res.status(400).json({ success: false, error: 'Monto no coincide' });
        }
        
        const captureId = purchaseUnit?.payments?.captures?.[0]?.id || captureData.id;
        const payerEmail = captureData.payer?.email_address;
        
        const result = await finalizarOrden(checkoutToken, 'PayPal', captureId, payerEmail);
        
        console.log(`✅ Orden creada desde PayPal capture: ${result.orderId}`);
        
        res.json({ 
            success: true, 
            orderId: result.orderId,
            captureId,
            paymentStatus: captureData.status
        });
    } catch (error) {
        console.error('❌ Error capturando PayPal:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

/* ========== CHECKOUT SEGURO ========== */
app.post('/api/checkout', checkoutLimiter, async (req, res) => {
    if (!firestore) {
        return res.status(500).json({ success: false, error: 'Firestore no disponible' });
    }
    
    const { 
        cart, 
        cuponCode, 
        cashbackToUse, 
        userId, 
        customerEmail, 
        customerName, 
        shippingAddress,
        rfc = '',
        razonSocial = '',
        regimenFiscal = '',
        usoCFDI = '',
        requireInvoice = false,
        phone = ''
    } = req.body;
    
    if (!cart?.length) {
        return res.status(400).json({ success: false, error: 'Carrito vacío' });
    }
    
    if (!customerName || !customerEmail || !shippingAddress) {
        return res.status(400).json({ 
            success: false, 
            error: 'Nombre, email y dirección son requeridos' 
        });
    }
    
    if (!isValidEmail(customerEmail)) {
        return res.status(400).json({ success: false, error: 'Email inválido' });
    }
    
    const safeCustomerName = sanitize(customerName).substring(0, 200);
    const safeCustomerEmail = customerEmail.toLowerCase().trim().substring(0, 200);
    const safeRfc = sanitize(rfc).substring(0, 20);
    const safeRazonSocial = sanitize(razonSocial).substring(0, 200);
    const safeRegimenFiscal = sanitize(regimenFiscal).substring(0, 100);
    const safeUsoCFDI = sanitize(usoCFDI).substring(0, 50);
    const safePhone = sanitize(phone).substring(0, 20);
    
    let subtotal = 0;
    const validatedItems = [];
    
    for (const item of cart) {
        if (!item.id) {
            return res.status(400).json({ success: false, error: 'Producto sin ID' });
        }
        
        const cantidad = parseInt(item.cantidad) || 1;
        if (cantidad < 1 || cantidad > 99) {
            return res.status(400).json({ 
                success: false, 
                error: `Cantidad inválida para producto ${item.id}` 
            });
        }
        
        const prodRef = firestore.collection('productos').doc(item.id);
        const prodDoc = await prodRef.get();
        
        if (!prodDoc.exists) {
            return res.status(404).json({ 
                success: false, 
                error: `Producto ${item.id} no existe` 
            });
        }
        
        const prod = prodDoc.data();
        
        if ((prod.stock || 0) < cantidad) {
            return res.status(409).json({ 
                success: false, 
                error: `"${prod.nombre}" sin stock suficiente. Disponible: ${prod.stock || 0}` 
            });
        }
        
        const precioReal = parseFloat(prod.precioFinal) || 0;
        
        if (precioReal <= 0) {
            return res.status(400).json({ 
                success: false, 
                error: `Precio inválido para "${prod.nombre}"` 
            });
        }
        
        if (item.precioFinal !== undefined && Math.abs(precioReal - item.precioFinal) > 0.01) {
            console.warn(`⚠️ Intento de manipulación de precio detectado:`);
            console.warn(`   Producto: ${prod.nombre}`);
            console.warn(`   Precio real: ${precioReal}`);
            console.warn(`   Precio enviado: ${item.precioFinal}`);
            console.warn(`   IP: ${req.ip}`);
        }
        
        validatedItems.push({
            id: item.id,
            nombre: prod.nombre,
            cantidad: cantidad,
            precioReal: precioReal,
            costoEnvio: parseFloat(prod.costoEnvio) || 0,
            proveedor: prod.proveedor || 'Bonü',
            precioProveedor: parseFloat(prod.precioProveedor) || precioReal,
            /* SAGA 4: cashback promo publicado para este producto (7,8,10,12,15,18,20) si existe */
            cashbackPromo: Math.min(CASHBACK_MAX_PRODUCTO, parseFloat(prod.cashbackPromo) || 0)
        });
        
        subtotal += precioReal * cantidad;
    }
    
    let descuento = 0;
    let cuponAplicado = null;
    
    if (cuponCode) {
        const cuponSnap = await firestore.collection('cupones')
            .where('codigo', '==', cuponCode.toUpperCase())
            .where('activo', '==', true)
            .get();
        
        if (!cuponSnap.empty) {
            const cuponDoc = cuponSnap.docs[0];
            const cupon = cuponDoc.data();
            const expira = cupon.expira ? new Date(cupon.expira) : null;
            
            if ((!expira || expira > new Date()) && 
                (!cupon.usosMax || (cupon.usos || 0) < cupon.usosMax) && 
                subtotal >= (cupon.minimoCompra || 0)) {
                
                descuento = subtotal * (cupon.descuento || 0) / 100;
                cuponAplicado = { 
                    id: cuponDoc.id, 
                    codigo: cupon.codigo, 
                    descuento: cupon.descuento 
                };
            }
        }
    }
    
    let cashbackUsar = 0;
    let userCashbackBalance = 0;
    
    if (userId && cashbackToUse > 0) {
        const userDoc = await firestore.collection('clientes').doc(userId).get();
        if (userDoc.exists) {
            userCashbackBalance = userDoc.data().cashbackBalance || 0;
            const maxPermitido = (subtotal - descuento) * 0.5;
            cashbackUsar = Math.min(
                parseFloat(cashbackToUse) || 0, 
                userCashbackBalance, 
                maxPermitido
            );
        }
    }
    
    const envio = subtotal >= 999 ? 0 : validatedItems.reduce((s, i) => s + (i.costoEnvio || 0), 0);
    /* [IVA INCLUIDO 2026-11-10] El precio publicado YA trae el IVA 16% dentro.
       Ya NO se suma al total: el cliente paga lo publicado + envío.
       Solo se registra el IVA contenido (16/116) para SAT / Caja BonuPay. */
    const iva = Math.round(((subtotal - descuento) * 16 / 116) * 100) / 100;
    const total = Math.round((subtotal - descuento - cashbackUsar + envio) * 100) / 100;
    
    if (total <= 0) {
        return res.status(400).json({ success: false, error: 'Total inválido' });
    }
    
    const token = crypto.randomBytes(32).toString('hex');
    const payload = {
        token,
        userId: userId || null,
        customerEmail: safeCustomerEmail,
        customerName: safeCustomerName,
        shippingAddress: typeof shippingAddress === 'string' ? { direccion: shippingAddress } : shippingAddress,
        validatedItems,
        subtotal,
        descuento,
        cuponAplicado,
        cashbackUsar,
        userCashbackBalance,
        envio,
        iva,
        total,
        rfc: safeRfc,
        razonSocial: safeRazonSocial,
        regimenFiscal: safeRegimenFiscal,
        usoCFDI: safeUsoCFDI,
        requireInvoice: requireInvoice,
        phone: safePhone,
        exp: Date.now() + 10 * 60 * 1000,
        createdAt: new Date().toISOString(),
        ip: req.ip
    };
    
    await firestore.collection('checkoutTokens').doc(token).set(payload);
    
    console.log(`✅ Checkout token creado: ${token.substring(0, 8)}... - Total: $${total} MXN`);
    
    res.json({ 
        success: true, 
        token, 
        total,
        expiresAt: payload.exp
    });
});

/* ========== FUNCIÓN PARA CREAR ORDEN ========== */
let finalizarOrden = async (checkoutToken, paymentMethod, paymentId, payerEmail = null) => {
    if (!firestore) throw new Error('Firestore no disponible');
    
    const tokenDoc = await firestore.collection('checkoutTokens').doc(checkoutToken).get();
    if (!tokenDoc.exists) throw new Error('Token no encontrado');
    
    const data = tokenDoc.data();
    
    if (data.exp < Date.now()) throw new Error('Token expirado');
    
    const processedRef = firestore.collection('processedPayments').doc(paymentId);
    const processedDoc = await processedRef.get();
    
    if (processedDoc.exists) {
        console.log(`⚠️ Pago ${paymentId} ya procesado. Orden: ${processedDoc.data().orderId}`);
        return { alreadyProcessed: true, orderId: processedDoc.data().orderId };
    }
    
    const orderId = `ORD-${Date.now()}`;
    const orderData = {
        id: orderId,
        usuario: data.customerName || (data.userId ? 'Cliente' : 'Invitado'),
        emailCliente: data.customerEmail || payerEmail,
        items: data.validatedItems.map(i => ({
            id: i.id,
            nombre: i.nombre,
            cantidad: i.cantidad,
            precio: i.precioReal,
            proveedor: i.proveedor
        })),
        direccion: data.shippingAddress || {},
        total: data.total,
        pasarela: paymentMethod,
        estado: 'pagado',
        fecha: new Date().toISOString(),
        cuponAplicado: data.cuponAplicado?.codigo || null,
        cashbackUsado: data.cashbackUsar || 0,
        paymentId: paymentId,
        rfc: data.rfc || '',
        razonSocial: data.razonSocial || '',
        regimenFiscal: data.regimenFiscal || '',
        usoCFDI: data.usoCFDI || '',
        requireInvoice: data.requireInvoice || false,
        phone: data.phone || '',
        subtotal: data.subtotal || 0,
        envio: data.envio || 0,
        iva: data.iva || 0,
        descuento: data.descuento || 0
    };
    
    await firestore.collection('pedidos').doc(orderId).set(orderData);
    
    const batch = firestore.batch();
    
    for (const item of data.validatedItems) {
        const prodRef = firestore.collection('productos').doc(item.id);
        batch.update(prodRef, { 
            stock: admin.firestore.FieldValue.increment(-item.cantidad) 
        });
    }
    
    if (data.userId) {
        const userRef = firestore.collection('clientes').doc(data.userId);
        /* SAGA 4: cashback por niveles (5% base · 10% >$45,000 con 6 pzas c/u · 15% >$60,000)
           más las promos por producto publicadas (cashbackPromo) cuando son mayores */
        const cashbackOrden = calcularCashbackOrden(data.validatedItems, data.total);
        const cashbackGanado = cashbackOrden.monto;
        console.log(`💰 Cashback nivel ${cashbackOrden.porcentajeNivel}% (${cashbackOrden.nivel}): $${cashbackGanado} de $${data.total}`);
        
        batch.update(userRef, {
            cashbackBalance: admin.firestore.FieldValue.increment(
                -(data.cashbackUsar || 0) + cashbackGanado
            ),
            cashbackHistory: admin.firestore.FieldValue.arrayUnion({
                amount: cashbackGanado,
                porcentaje: cashbackOrden.porcentajeNivel,
                nivel: cashbackOrden.nivel,
                detalle: cashbackOrden.lineas,
                orderId,
                date: new Date().toISOString(),
                type: 'earned'
            })
        });
    }
    
    if (data.cuponAplicado?.id) {
        const cuponRef = firestore.collection('cupones').doc(data.cuponAplicado.id);
        batch.update(cuponRef, { 
            usos: admin.firestore.FieldValue.increment(1) 
        });
    }
    
    const txRef = firestore.collection('transacciones').doc();
    batch.set(txRef, {
        ordenId: orderId,
        monto: data.total,
        pasarela: paymentMethod,
        estado: 'completada',
        paymentId: paymentId,
        fecha: new Date().toISOString()
    });
    
    await batch.commit();
    
    await processedRef.set({ 
        orderId, 
        paymentId, 
        processedAt: new Date().toISOString() 
    });
    
    await tokenDoc.ref.delete();
    
    if (data.customerEmail) {
        sendConfirmationEmail({
            orderId,
            customerEmail: data.customerEmail,
            customerName: data.customerName || 'Cliente',
            total: data.total,
            items: data.validatedItems,
            shippingAddress: data.shippingAddress,
            paymentMethod,
            date: orderData.fecha,
            subtotal: data.subtotal || 0,
            envio: data.envio || 0,
            iva: data.iva || 0,
            descuento: data.descuento || 0,
            cashbackUsado: data.cashbackUsar || 0,
            rfc: data.rfc || '',
            razonSocial: data.razonSocial || '',
            regimenFiscal: data.regimenFiscal || '',
            usoCFDI: data.usoCFDI || '',
            requireInvoice: data.requireInvoice || false,
            phone: data.phone || '',
            estado: 'pagado',
            cuponAplicado: data.cuponAplicado?.codigo || ''
        }).catch(err => console.error('Error email:', err.message));
    }
    
        try {
        emitNewOrder({ id: orderId, usuario: data.customerName || 'Cliente', total: data.total });
    } catch (err) {
        console.error('emitNewOrder fallo:', err.message);
    }
    
    /* 📲 Aviso WhatsApp: nueva venta (con entrega estimada) */
    try {
        const fVMin = fechaEntregaTxt(sumarDiasHabiles(ENTREGA_MIN_HABILES));
        const fVMax = fechaEntregaTxt(sumarDiasHabiles(ENTREGA_MAX_HABILES));
        const itemsVenta = data.validatedItems || [];
        const nPiezas = itemsVenta.reduce((a, it) => a + (Number(it.cantidad) || 1), 0);
        const listaArt = itemsVenta.slice(0, 5).map(it => '• ' + waSanitizar(it.nombre || it.id, 42) + (Number(it.cantidad) > 1 ? ' x' + it.cantidad : '')).join('\n');
        waEnviarCallMeBot('💰 ¡VENTA EN BONÜ.COM! 🎉\n\n🧾 Orden: ' + orderId + '\n💳 Pago: ' + paymentMethod + '\n📦 ' + nPiezas + ' pza(s):\n' + listaArt + (itemsVenta.length > 5 ? '\n• +' + (itemsVenta.length - 5) + ' más' : '') + '\n💵 Total: $' + Number(data.total).toFixed(2) + ' MXN\n👤 ' + waSanitizar(data.customerName || 'Cliente', 60) + '\n🚚 Entrega estimada: ' + fVMin + ' — ' + fVMax + '\n🗓️ ' + new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' })).catch(() => {});
    } catch (errW) { console.warn('Aviso WhatsApp venta fallo:', errW.message); }

    console.log(`✅ Orden creada: ${orderId} - ${paymentMethod} - $${data.total} MXN`);
    
    return { orderId };
};
/* ========== WEBHOOKS ========== */
app.post('/api/webhook/stripe', async (req, res) => {
    if (!stripe || !STRIPE_WEBHOOK_SECRET) return res.sendStatus(200);
    
    const sig = req.headers['stripe-signature'];
    let event;
    
    try {
        event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        console.error('❌ Firma Stripe inválida:', err.message);
        return res.status(400).send();
    }
    
    if (event.type === 'payment_intent.succeeded') {
        const intent = event.data.object;
        const checkoutToken = intent.metadata?.checkoutToken;
        
        if (!checkoutToken) {
            console.warn('⚠️ Stripe webhook sin checkoutToken');
            return res.sendStatus(200);
        }
        
        try {
            await finalizarOrden(checkoutToken, 'Stripe', intent.id, intent.receipt_email);
            console.log(`✅ Orden creada desde Stripe webhook: ${checkoutToken}`);
        } catch (error) {
    console.error('❌ Error procesando webhook Stripe:', error.message);
    return res.status(500).send();
}
    } else if (event.type === 'payment_intent.payment_failed') {
        const intent = event.data.object;
        console.warn(`⚠️ Stripe payment failed: ${intent.id}`);
    }
    
    res.sendStatus(200);
});

app.post('/api/webhook/mercadopago', async (req, res) => {
    res.sendStatus(200);
    
    try {
        const body = JSON.parse(req.body.toString());
        const { type, data } = body;
        
        if (type === 'payment' && data?.id) {
            const paymentResponse = await fetch(`${MERCADO_PAGO_API_URL}/payments/${data.id}`, {
                headers: { 'Authorization': `Bearer ${MERCADO_PAGO_ACCESS_TOKEN}` }
            });
            
            const payment = await paymentResponse.json();
            
            if (payment.status === 'approved') {
                const checkoutToken = payment.external_reference;
                
                if (checkoutToken) {
                    await finalizarOrden(checkoutToken, 'MercadoPago', payment.id, payment.payer?.email);
                    console.log(`✅ Orden creada desde MP webhook: ${checkoutToken}`);
                }
            } else {
                console.log(`ℹ️ MP payment ${data.id} status: ${payment.status}`);
            }
        }
    } catch (error) { 
        console.error('❌ Error webhook MP:', error.message); 
    }
});

app.post('/api/webhook/bonupay', async (req, res) => {
    res.sendStatus(200);
    
    try {
        const body = JSON.parse(req.body.toString());
        const { type, data } = body;
        
        if (type === 'payment' && data?.id) {
            const accessToken = BONUPAY_ACCESS_TOKEN || MERCADO_PAGO_ACCESS_TOKEN;
            
            const paymentResponse = await fetch(`${MERCADO_PAGO_API_URL}/payments/${data.id}`, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });
            
            const payment = await paymentResponse.json();
            
            if (payment.status === 'approved') {
                const checkoutToken = payment.external_reference;
                if (checkoutToken) {
                    await finalizarOrden(checkoutToken, 'BonuPay', payment.id, payment.payer?.email);
                }
            }
        }
    } catch (error) { 
        console.error('❌ Error webhook BonuPay:', error.message); 
    }
});

app.post('/api/webhook/paypal', async (req, res) => {
    res.sendStatus(200);
    
    try {
        const event = JSON.parse(req.body.toString());
        
        if (event.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
            const capture = event.resource;
            const checkoutToken = capture.custom_id;
            
            if (checkoutToken) {
                const accessToken = await getPayPalAccessToken();
                const orderRes = await fetch(`${PAYPAL_API_URL}/v2/checkout/orders/${capture.supplementary_data?.related_ids?.order_id || capture.id}`, {
                    headers: { 'Authorization': `Bearer ${accessToken}` }
                });
                
                const orderData = await orderRes.json();
                
                if (orderData.status === 'COMPLETED') {
                    await finalizarOrden(checkoutToken, 'PayPal', capture.id);
                    console.log(`✅ Orden creada desde PayPal webhook: ${checkoutToken}`);
                }
            }
        }
    } catch (error) { 
        console.error('❌ Error webhook PayPal:', error.message); 
    }
});

/* ========== RUTAS PÚBLICAS ========== */
app.get('/', (req, res) => res.json({ 
    success: true, 
    message: 'Bonü Backend v8.0 - Producción Completa', 
    env: NODE_ENV,
    timestamp: new Date().toISOString()
}));

app.get('/health', (req, res) => res.json({ 
    status: 'healthy', 
    firestore: !!firestore, 
    timestamp: Date.now() 
}));

/* ========== [CORREO BONUGIFT 2026-11-09] Envío del correo del código ========== */
const BONUGIFT_IMG_CORREO = 'https://i.ibb.co/wZXNvvXy/bonugift-1000-correo.jpg';
const BONUGIFT_SITIO = 'https://xn--bon-joa.com';
const BONUGIFT_PROMO_FIN = '15 de diciembre de 2026';

function correoBonuGiftHTMLServer(email, codigo, montoTxt, nombre) {
    const saludo = nombre ? 'Hola ' + sanitize(nombre) + ' \uD83D\uDC4B' : '\u00A1Hola! \uD83D\uDC4B';
    return `<div style="margin:0;padding:24px 8px;background:#f5f5f4;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:2px solid #facc15;">
    <tr><td style="background:#0a0a0a;padding:18px 24px;text-align:center;"><span style="color:#facc15;font-size:30px;font-weight:800;letter-spacing:1px;">bon&uuml;</span><span style="color:#ffffff;font-size:13px;">&nbsp;&nbsp;|&nbsp;&nbsp;bon&uuml;.com — el mercado que te paga</span></td></tr>
    <tr><td style="padding:24px 24px 6px 24px;text-align:center;"><p style="margin:0;color:#111827;font-size:16px;">${saludo}</p><p style="margin:8px 0 0 0;color:#111827;font-size:17px;font-weight:800;line-height:1.5;">&#127881; FELICIDADES, CUMPLISTE NUESTRA DIN&Aacute;MICA<br>Y ESO TE HACE GANADOR DE:</p></td></tr>
    <tr><td style="padding:16px 24px 4px 24px;text-align:center;"><img src="${BONUGIFT_IMG_CORREO}" alt="Bon&uuml;Gift ${montoTxt}" width="560" style="width:100%;max-width:560px;height:auto;border-radius:14px;border:2px solid #facc15;display:block;"></td></tr>
    <tr><td style="padding:14px 24px 4px 24px;text-align:center;"><p style="margin:0;color:#374151;font-size:14px;font-weight:700;">TU C&Oacute;DIGO DE ACTIVACI&Oacute;N — FREE CASH ${montoTxt}</p>
      <div style="margin:10px auto 0 auto;border:3px dashed #facc15;background:#fefce8;border-radius:14px;padding:12px 26px;display:inline-block;"><span style="color:#111827;font-size:26px;font-weight:800;letter-spacing:3px;">${sanitize(codigo)}</span></div>
      <p style="margin:10px 0 0 0;color:#6b7280;font-size:12px;">Escr&iacute;belo tal cual en bon&uuml;.com (caja dorada debajo del buscador)</p></td></tr>
    <tr><td style="padding:14px 28px;"><p style="margin:0;color:#111827;font-size:14px;font-weight:700;text-align:center;line-height:1.6;">BON&Uuml; TE ADELANTA TU AGUINALDO PARA QUE PAGUES PARTE DE TUS REGALOS NAVIDE&Ntilde;OS PARA TU FAMILIA, AMIGOS O CONOCIDOS.</p>
      <p style="margin:8px 0 0 0;color:#a16207;font-size:15px;font-weight:800;text-align:center;">&iexcl;DISFRUTA TU BON&Uuml;GIFT Y TU FREE CASH EN BON&Uuml;.COM!</p></td></tr>
    <tr><td style="padding:6px 24px 16px 24px;text-align:center;"><a href="${BONUGIFT_SITIO}" style="display:inline-block;background:#facc15;color:#111827;font-size:15px;font-weight:800;padding:13px 30px;border-radius:999px;text-decoration:none;">&#128722; ACTIVAR Y COMPRAR EN BON&Uuml;.COM</a></td></tr>
    <tr><td style="padding:0 28px 18px 28px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border-radius:12px;"><tr><td style="padding:14px 16px;">
      <p style="margin:0 0 6px 0;color:#111827;font-size:13px;font-weight:800;">&iquest;C&oacute;mo uso mi Bon&uuml;Gift? (3 pasos)</p>
      <p style="margin:0;color:#4b5563;font-size:12.5px;line-height:1.7;">1&#65039;&#8419; Reg&iacute;strate en bon&uuml;.com y activa tu c&oacute;digo en la <b>caja dorada</b> debajo del buscador: tu Free Cash se suma a tu saldo al instante.<br>2&#65039;&#8419; Elige productos con el <b>&iacute;cono del regalo dorado &#127873;</b> y agr&eacute;alos a tu carrito.<br>3&#65039;&#8419; En el checkout paga <b>10/15/20/25%</b> con tu saldo Bon&uuml;Gift y el resto con tu tarjeta. &iexcl;Y ganas 5% de cashback en tu compra!</p>
    </td></tr></table></td></tr>
    <tr><td style="padding:0 28px 22px 28px;"><p style="margin:0;color:#6b7280;font-size:11px;line-height:1.7;text-align:center;background:#f3f4f6;border-radius:10px;padding:10px 12px;">T&eacute;rminos: tu c&oacute;digo es <b>v&aacute;lido solo 1 vez</b>, <b>no es transferible</b> ni acumulable con otras promociones u ofertas. Aplica &uacute;nicamente en productos marcados con el <b>&iacute;cono del regalo dorado &#127873;</b>. Vigencia: <b>15 d&iacute;as naturales a partir de la activaci&oacute;n</b> de tu c&oacute;digo. Promoci&oacute;n vigente hasta el <b>${BONUGIFT_PROMO_FIN}</b>. Cashback y saldo Bon&uuml;Gift aplican seg&uacute;n la pol&iacute;tica de bon&uuml;.com.</p></td></tr>
    <tr><td style="background:#0a0a0a;padding:14px 24px;text-align:center;"><p style="margin:0;color:#facc15;font-size:12px;font-weight:700;">bon&uuml; te adelanta tu aguinaldo &#127876;</p><p style="margin:4px 0 0 0;color:#9ca3af;font-size:11px;">bon&uuml;.com · Puerto Vallarta, Jal. · Env&iacute;os a todo M&eacute;xico</p></td></tr>
  </table>
</div>`;
}

const giftEmailLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false,
    message: { success: false, error: 'Demasiados correos. Intenta más tarde.' } });

/* ========== 📲 WHATSAPP (CallMeBot) [v4] — avisos a Alberto (2 números) ========== */
/* CallMeBot México: el número activado va con prefijo 521 (ej. 5216444374228 = +52 1 644 437 4228).
   Opcional en Render → Variables de entorno:
     WHATSAPP_TARGETS  = 5216444374228:apikey1,5213222700732:apikey2   (sobrescribe todo)
     WHATSAPP_APIKEY   = apikey del 644   ·   WHATSAPP_APIKEY2 = apikey del 322
   Sin variables: usa el default de abajo (el 644 ya quedó activado con su apikey).
   Para el 322 270 0732: envía "I allow callmebot to send me messages" al +34 644 51 95 23
   desde ese WhatsApp, copia la apikey que te llegue y ponla en WHATSAPP_APIKEY2. */
function waParseTargets(){
    const raw = (process.env.WHATSAPP_TARGETS || '').trim();
    if(raw){
        return raw.split(',').map(p => { const [tel, key] = p.trim().split(':');
            return { phone: (tel || '').replace(/\D/g, ''), apikey: (key || '').trim() }; })
            .filter(t => t.phone && t.apikey);
    }
    const t1 = { phone: '5216444374228', apikey: (process.env.WHATSAPP_APIKEY || '4905091').trim() };
    const t2 = { phone: '5213222700732', apikey: (process.env.WHATSAPP_APIKEY2 || '').trim() };
    return [t1, t2].filter(t => t.phone && t.apikey);
}
const WA_TARGETS = waParseTargets();
const waConfigurado = WA_TARGETS.length > 0;
const waLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false,
    message: { success: false, error: 'Demasiados avisos. Intenta más tarde.' } });
function waSanitizar(s, n){ return String(s || '').replace(/[\r\n]+/g, ' ').replace(/[*_~`]/g, '').trim().substring(0, n || 80); }
function waEnviarUno(phone, apikey, msg){
    return new Promise((resolve) => {
        const url = 'https://api.callmebot.com/whatsapp.php?phone=' + encodeURIComponent('+' + phone) + '&text=' + encodeURIComponent(String(msg).substring(0, 1400)) + '&apikey=' + encodeURIComponent(apikey);
        const req = https.get(url, (r) => { r.resume(); resolve({ ok: r.statusCode >= 200 && r.statusCode < 300, status: r.statusCode }); });
        req.on('error', (e) => resolve({ ok: false, error: e.message }));
        req.setTimeout(12000, () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    });
}
/* Envía el aviso a TODOS los WhatsApp configurados (fan-out) */
async function waEnviarCallMeBot(msg){
    if(!waConfigurado) return { ok: false, enviados: 0, total: 0, error: 'WhatsApp sin apikey CallMeBot activa' };
    const rs = await Promise.all(WA_TARGETS.map(t => waEnviarUno(t.phone, t.apikey, msg)));
    const enviados = rs.filter(r => r.ok).length;
    rs.forEach((r, i) => { if(!r.ok) console.warn('📲 WhatsApp falló a +' + WA_TARGETS[i].phone + ':', r.error || ('HTTP ' + r.status)); });
    return { ok: enviados > 0, enviados, total: WA_TARGETS.length, detalles: rs };
}

app.post('/api/send-gift-email', giftEmailLimiter, verificarAdmin, async (req, res) => {
    try {
        if (!emailConfigurado || !emailTransporter) {
            return res.status(500).json({ success: false, error: 'Email no configurado en el servidor (EMAIL_USER/EMAIL_PASS)' });
        }
        const to = String(req.body.to || '').trim().toLowerCase();
        const codigo = String(req.body.codigo || '').trim().toUpperCase();
        const monto = Number(req.body.monto) || 1000;
        const nombre = String(req.body.nombre || '').trim().substring(0, 60);
        if (!isValidEmail(to)) return res.status(400).json({ success: false, error: 'Correo del cliente inválido' });
        if (!codigo || codigo.length < 4 || codigo.length > 24) return res.status(400).json({ success: false, error: 'Código inválido' });
        if (!(monto > 0) || monto > 100000) return res.status(400).json({ success: false, error: 'Monto inválido' });
        const montoTxt = formatCurrency(monto);
        const html = correoBonuGiftHTMLServer(to, codigo, montoTxt, nombre);
        await Promise.race([
            emailTransporter.sendMail({
                from: `"Bonü Marketplace" <${process.env.EMAIL_USER}>`,
                to: to,
                subject: `🎁 Tu BonüGift de ${montoTxt} — ¡Felicidades, ganaste tu Free Cash!`,
                html: html
            }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Email timeout')), 15000))
        ]);
        console.log(`📧 BonüGift ${codigo} enviada a ${to} (${montoTxt})`);
        /* 📲 Aviso WhatsApp: entrega de tarjeta BonüGift */
        waEnviarCallMeBot('🎁 BONÜGIFT ENTREGADA\n\n👤 ' + waSanitizar(nombre || 'Cliente', 60) + '\n📧 ' + waSanitizar(to, 60) + '\n💳 Código: ' + codigo + '\n💵 Monto: ' + montoTxt + '\n🗓️ ' + new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' })).catch(() => {});
        try {
            if (firestore) {
                await firestore.collection('auditoria').add({
                    fecha: new Date().toISOString(), admin: (req.user && req.user.email) || 'Backend',
                    accion: 'Correo BonüGift 📧', detalle: 'Enviado a ' + to + ' · código ' + codigo + ' (' + montoTxt + ')', ip: 'backend'
                });
            }
        } catch (e) { console.warn('No se pudo registrar en auditoría:', e.message); }
        res.json({ success: true });
    } catch (error) {
        console.error('❌ Error send-gift-email:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

/* ========== [DINAMICA NAVIDAD 2026-11-11] Envío AUTOMÁTICO del código BonüGift ==========
   Dinámica 1 (Facebook):    seguir la página oficial + "me gusta" a la publicación → registrarse.
   Dinámica 2 (WhatsApp):    unirse al canal oficial de WhatsApp → registrarse.
   Al registrarse y declarar cualquiera de las 2, este endpoint:
     1) valida y bloquea duplicados (1 código por correo),
     2) respeta un tope total de códigos (BONUGIFT_MAX_CLAIMS, default 500) — "códigos limitados",
     3) genera un código BG-XXXX-XXXX compatible con la colección `bonugift` (caja dorada),
     4) ENVÍA SOLO el correo del código al cliente (correoBonuGiftHTMLServer),
     5) avisa a Alberto por WhatsApp y registra auditoría.
   Así Alberto ya NO necesita asignar el código a mano desde el Panel → Promoción. */
const claimGiftLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false,
    message: { success: false, error: 'Demasiados intentos. Intenta más tarde.' } });
function bonuGiftCodigoNavidad(){
    const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; /* sin I,L,O,0,1 (mismo criterio que el panel) */
    const seg = () => Array.from({ length: 4 }, () => abc[crypto.randomInt(abc.length)]).join('');
    return 'BG-' + seg() + '-' + seg();
}
app.post('/api/bonugift-claim', claimGiftLimiter, async (req, res) => {
    try {
        if (!firestore) return res.status(500).json({ success: false, error: 'Base de datos no disponible en el servidor' });
        if (!emailConfigurado || !emailTransporter) {
            return res.status(500).json({ success: false, error: 'Email no configurado en el servidor (EMAIL_USER/EMAIL_PASS)' });
        }
        const b = req.body || {};
        const email = String(b.email || '').trim().toLowerCase();
        const nombre = String(b.nombre || '').trim().substring(0, 60);
        const uid = String(b.uid || '').trim().substring(0, 64);
        const dinamica = String(b.dinamica || '').trim().toLowerCase();
        if (!isValidEmail(email)) return res.status(400).json({ success: false, error: 'Correo inválido' });
        if (!['facebook', 'whatsapp'].includes(dinamica)) return res.status(400).json({ success: false, error: 'Dinámica inválida (usa facebook o whatsapp)' });

        /* 1) Un solo código por correo */
        const claimRef = firestore.collection('bonugift_claims').doc(email.replace(/[^a-z0-9@._-]/g, '_'));
        const claimDoc = await claimRef.get();
        if (claimDoc.exists) {
            return res.status(200).json({ success: false, yaReclamado: true,
                error: 'Ese correo ya reclamó su BonüGift. Revisa tu bandeja (y spam) o escríbenos por WhatsApp.' });
        }

        /* 2) Códigos limitados */
        let maxClaims = 500;
        const mv = parseInt(process.env.BONUGIFT_MAX_CLAIMS, 10);
        if (mv > 0) maxClaims = mv;
        try {
            const todos = await firestore.collection('bonugift_claims').get();
            if (todos.size >= maxClaims) {
                return res.status(200).json({ success: false, agotado: true,
                    error: '¡Los códigos se han agotado! Sé el primero en enterarte de la próxima dinámica siguiéndonos en Facebook.' });
            }
        } catch (e) { console.warn('No se pudo contar bonugift_claims (sigo):', e.message); }

        /* 3) Código único compatible con la caja dorada (colección `bonugift`) */
        let codigo = null;
        for (let i = 0; i < 12; i++) {
            const c = bonuGiftCodigoNavidad();
            const ex = await firestore.collection('bonugift').doc(c).get();
            if (!ex.exists) { codigo = c; break; }
        }
        if (!codigo) return res.status(500).json({ success: false, error: 'No se pudo generar el código, intenta de nuevo' });

        /* 4) Correo del código al cliente */
        const montoTxt = formatCurrency(1000);
        const html = correoBonuGiftHTMLServer(email, codigo, montoTxt, nombre);
        await Promise.race([
            emailTransporter.sendMail({
                from: `"Bonü Marketplace" <${process.env.EMAIL_USER}>`,
                to: email,
                subject: `🎁 Tu BonüGift de ${montoTxt} — ¡Felicidades, ganaste tu Free Cash!`,
                html: html
            }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Email timeout')), 15000))
        ]);

        /* 5) Resguardo del código + claim + aviso + auditoría */
        await firestore.collection('bonugift').doc(codigo).set({
            codigo: codigo, monto: 1000, estado: 'disponible', lote: 'PROMO-NAVIDAD2026',
            creadoEn: new Date().toISOString(), activadoPor: null,
            activadoEmail: null, activadoEn: null, dinamica: dinamica, reclamadoEmail: email
        });
        await claimRef.set({
            email: email, nombre: nombre, uid: uid || null, dinamica: dinamica,
            codigo: codigo, monto: 1000, fecha: new Date().toISOString()
        });
        console.log(`🎁 BonüGift auto ${codigo} → ${email} (dinámica: ${dinamica})`);
        waEnviarCallMeBot('🎁 BONÜGIFT AUTOMÁTICA — DINÁMICA NAVIDAD\n\n🎯 Dinámica: ' + (dinamica === 'facebook' ? '📘 Facebook (seguir + like)' : '💬 Canal de WhatsApp') + '\n👤 ' + waSanitizar(nombre || 'Cliente', 60) + '\n📧 ' + waSanitizar(email, 60) + '\n💳 Código: ' + codigo + '\n💵 Monto: ' + montoTxt + '\n🗓️ ' + new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' })).catch(() => {});
        try {
            await firestore.collection('auditoria').add({
                fecha: new Date().toISOString(), admin: 'Auto (dinámica navideña)',
                accion: 'BonüGift automática 🎁', detalle: dinamicaTxt(dinamica) + ' · ' + email + ' · código ' + codigo, ip: 'backend'
            });
        } catch (e) { console.warn('No se pudo registrar en auditoría:', e.message); }
        res.json({ success: true, codigo: codigo });
    } catch (error) {
        console.error('❌ Error bonugift-claim:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});
function dinamicaTxt(d){ return d === 'facebook' ? '📘 Facebook' : (d === 'whatsapp' ? '💬 WhatsApp' : String(d || '—')); }

/* Aviso admin (mensaje libre) — protegido con token de administrador */
app.post('/api/whatsapp', waLimiter, verificarAdmin, async (req, res) => {
    try {
        const msg = waSanitizar(req.body && req.body.msg, 1400);
        if(!msg) return res.status(400).json({ success: false, error: 'Falta el mensaje' });
        const r = await waEnviarCallMeBot(msg);
        if(!r.ok) return res.status(502).json({ success: false, configurado: waConfigurado, error: r.error || ('CallMeBot respondió ' + r.status) });
        res.json({ success: true, via: 'callmebot' });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

/* Aviso público de registro/dinámica (rate-limited, mensaje con plantilla fija) */
app.post('/api/notify-register', waLimiter, async (req, res) => {
    try {
        if(!waConfigurado) return res.json({ success: false, configurado: false, error: 'WhatsApp no configurado en el servidor' });
        const b = req.body || {};
        const pasos = Math.max(0, Math.min(5, parseInt(b.pasos, 10) || 0));
        let msg;
        if(b.dinamica){
            msg = '🎄 DINÁMICA COMPLETA EN BONÜ.COM\n\n👤 ' + waSanitizar(b.nombre, 60) + '\n📧 ' + waSanitizar(b.email, 60) + '\n✅ 5 likes ❤️ + pasos de redes\n👉 Panel → Promoción: asigna su BonüGift $1,000';
        } else {
            msg = '🔔 NUEVO REGISTRO EN BONÜ.COM\n\n👤 ' + waSanitizar(b.nombre, 60) + '\n📧 ' + waSanitizar(b.email, 60) + '\n📱 ' + waSanitizar(b.telefono, 30) + '\n🏷️ ' + (b.tipo === 'vendedor' ? 'Vendedor' : 'Cliente') + '\n🎯 Dinámica: ' + pasos + '/5 pasos declarados\n🗓️ ' + new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
        }
        const r = await waEnviarCallMeBot(msg);
        if(!r.ok) return res.status(502).json({ success: false, error: r.error || ('CallMeBot respondió ' + r.status) });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/status', (req, res) => res.json({
    success: true,
    firestore: !!firestore,
    email: emailConfigurado,
    whatsapp: waConfigurado,
    whatsappNums: WA_TARGETS.length,
    stripe: !!stripe,
    mercadoPago: !!MERCADO_PAGO_ACCESS_TOKEN,
    bonupay: !!(BONUPAY_ACCESS_TOKEN || MERCADO_PAGO_ACCESS_TOKEN),
    paypal: !!(PAYPAL_CLIENT_ID && PAYPAL_CLIENT_SECRET)
}));

app.get('/api/categorias', (req, res) => res.json({ 
    success: true, 
    categorias: CATEGORIAS 
}));

app.get('/api/config', (req, res) => res.json({
    success: true,
    stripePublicKey: process.env.STRIPE_PUBLIC_KEY || null,
    mercadoPagoPublicKey: process.env.MERCADO_PAGO_PUBLIC_KEY || null,
    paypalClientId: process.env.PAYPAL_CLIENT_ID || null,
    paypalMode: PAYPAL_MODE,
    /* SAGA 4: reglas públicas de cashback para que el frontend las muestre */
    cashbackReglas: {
        base: CASHBACK_BASE,
        niveles: [
            { pct: 10, totalMinimo: UMBRAL_CASHBACK_10, piezasMinimasPorProducto: QTY_MIN_CASHBACK_10 },
            { pct: 15, totalMinimo: UMBRAL_CASHBACK_15 }
        ],
        maxProducto: CASHBACK_MAX_PRODUCTO,
        listaPromos: LISTA_CASHBACK
    }
}));

app.post('/api/verify-stock', async (req, res) => {
    const { items } = req.body;
    
    if (!firestore || !items?.length) {
        return res.json({ success: true, available: true });
    }
    
    try {
        const results = [];
        
        for (const item of items) {
            const prodDoc = await firestore.collection('productos').doc(item.id).get();
            
            if (!prodDoc.exists) {
                results.push({ id: item.id, available: false, reason: 'No existe' });
                continue;
            }
            
            const prod = prodDoc.data();
            const cantidad = parseInt(item.cantidad) || 1;
            
            results.push({
                id: item.id,
                available: (prod.stock || 0) >= cantidad,
                stock: prod.stock || 0,
                precioFinal: prod.precioFinal
            });
        }
        
        const allAvailable = results.every(r => r.available);
        
        res.json({ 
            success: true, 
            available: allAvailable,
            items: results
        });
    } catch (error) {
        res.json({ success: true, available: true });
    }
});

/* ========== PRODUCTOS PÚBLICOS ========== */
app.get('/api/products', async (req, res) => {
    if (!firestore) {
        return res.status(500).json({ success: false, error: 'Firestore no disponible' });
    }
    
    try {
        const { limit = 50, categoria, tipo, search } = req.query;
        let query = firestore.collection('productos');
        
        if (categoria) query = query.where('categoria', '==', categoria);
        if (tipo) query = query.where('tipo', '==', tipo);
        
         const snapshot = await query.limit(parseInt(limit)).get();
        let productos = [];
        
        snapshot.forEach(doc => {
            const data = doc.data();
            // Optimizar imágenes con Cloudinary
            const optimizedData = getOptimizedProductImages(data);
            productos.push({ id: doc.id, ...optimizedData });
        });
        
        if (search?.trim()) {
            const s = search.toLowerCase();
            productos = productos.filter(p =>
                p.nombre?.toLowerCase().includes(s) ||
                p.categoria?.toLowerCase().includes(s) ||
                p.descripcion?.toLowerCase().includes(s)
            );
        }
        
        productos.sort((a, b) => String(b.fechaAgregado || '').localeCompare(String(a.fechaAgregado || '')));
        res.json({ success: true, productos });
    } catch (error) {
        console.error('Error en /api/products:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
app.get('/api/products/:id', async (req, res) => {
    if (!firestore) {
        return res.status(500).json({ success: false, error: 'Firestore no disponible' });
    }
    
    try {
        const productDoc = await firestore.collection('productos').doc(req.params.id).get();
        
        if (!productDoc.exists) {
            return res.status(404).json({ success: false, error: 'Producto no encontrado' });
        }
        
        const data = productDoc.data();
        const optimizedData = getOptimizedProductImages(data);
        
        res.json({ 
            success: true, 
            producto: { id: productDoc.id, ...optimizedData } 
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/* ========== PROVEEDORES ========== */
let cjAccessToken = null, cjTokenExpiry = null, cjTokenPromise = null;

async function getCJToken() {
    if (!CJ_API_KEY) throw new Error('CJ_API_KEY no configurada');
    
    if (cjAccessToken && cjTokenExpiry && new Date() < new Date(cjTokenExpiry)) {
        return cjAccessToken;
    }
    
    if (cjTokenPromise) return cjTokenPromise;
    
    cjTokenPromise = (async () => {
        try {
            const response = await fetch(`${CJ_API_URL}/authentication/getAccessToken`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ apiKey: CJ_API_KEY })
            });
            
            const data = await response.json();
            
            if (data.code === 200 && data.data?.accessToken) {
                cjAccessToken = data.data.accessToken;
                cjTokenExpiry = data.data.accessTokenExpiryDate;
                return cjAccessToken;
            }
            
            throw new Error(`Error CJ: ${data.message}`);
        } finally { 
            cjTokenPromise = null; 
        }
    })();
    
    return cjTokenPromise;
}

app.get('/api/cj/product/:sku', verificarAdmin, async (req, res) => {
    const { sku } = req.params;
    
    if (!CJ_API_KEY) {
        return res.status(500).json({ success: false, error: 'CJ_API_KEY no configurada' });
    }
    
    try {
        const token = await getCJToken();
        const searchRes = await fetch(`${CJ_API_URL}/product/list?productSku=${encodeURIComponent(sku)}&pageNum=1&pageSize=1`, {
            headers: { 'CJ-Access-Token': token }
        });
        
        const searchData = await searchRes.json();
        
        if (searchData.code !== 200 || !searchData.data?.list?.length) {
            return res.status(404).json({ 
                success: false, 
                error: `Producto ${sku} no encontrado en CJ` 
            });
        }
        
        const product = searchData.data.list[0];
        
        res.json({ 
            success: true, 
            product: {
                name: product.productNameEn || product.productName || `Producto ${sku}`,
                description: product.productDescription || '',
                price: parseFloat(product.sellingPrice) || 0,
                cost: parseFloat(product.costPrice) || 0,
                images: product.productImage ? [product.productImage] : [],
                sku: product.productSku || sku
            }
        });
    } catch (error) {
        console.error('Error CJ product:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/cj/import', verificarAdmin, async (req, res) => {
    let { sku, precioVenta, tipo, categoria } = req.body;
    
    if (!sku || !precioVenta) {
        return res.status(400).json({ success: false, error: 'SKU y precioVenta requeridos' });
    }
    
    if (!firestore) {
        return res.status(500).json({ success: false, error: 'Firestore no disponible' });
    }
    
    try {
        const token = await getCJToken();
        const listRes = await fetch(`${CJ_API_URL}/product/list?productSku=${encodeURIComponent(sku)}&pageNum=1&pageSize=1`, {
            headers: { 'CJ-Access-Token': token }
        });
        
        const listData = await listRes.json();
        
        if (listData.code !== 200 || !listData.data?.list?.length) {
            throw new Error(`Producto ${sku} no encontrado`);
        }
        
        const producto = listData.data.list[0];
        const nombre = producto.productNameEn || producto.productName || `Producto ${sku}`;
        
        const productoFinal = {
            sku,
            nombre,
            descripcion: producto.productDescription || '',
            categoria: categoria || detectarCategoria(nombre, ''),
            precioFinal: parseFloat(precioVenta),
            precioOriginal: parseFloat(precioVenta) * 1.15,
            descuento: 13,
            stock: producto.inventory || 100,
            tipo: tipo || 'Ofertas',
            rating: 0,
            imagenes: producto.productImage ? [producto.productImage] : ['https://picsum.photos/500/500'],
            proveedor: 'CJ Dropshipping',
            fechaAgregado: new Date().toISOString()
        };
        
        const docRef = await firestore.collection('productos').add(productoFinal);
        
        console.log(`✅ Producto CJ guardado: ${docRef.id}`);
        
        res.json({ 
            success: true, 
            message: 'Producto importado', 
            id: docRef.id, 
            product: productoFinal 
        });
    } catch (error) {
        console.error('❌ Error CJ:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/tvcmall/product/:sku', verificarAdmin, async (req, res) => {
    const { sku } = req.params;
    
    if (!TVCMALL_API_KEY || !TVCMALL_API_SECRET) {
        return res.status(500).json({ success: false, error: 'TVCmall no configurado' });
    }
    
    try {
        const timestamp = Date.now();
        const sign = crypto.createHash('md5')
            .update(`${TVCMALL_API_KEY}${timestamp}${TVCMALL_API_SECRET}`)
            .digest('hex');
        
        const response = await fetch(`${TVCMALL_API_URL}/product/detail`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json', 
                'X-API-Key': TVCMALL_API_KEY, 
                'X-Timestamp': timestamp, 
                'X-Sign': sign 
            },
            body: JSON.stringify({ sku })
        });
        
        const data = await response.json();
        
        if (!data?.success || !data.product) {
            return res.status(404).json({ 
                success: false, 
                error: `Producto ${sku} no encontrado en TVCmall` 
            });
        }
        
        const product = data.product;
        
        res.json({ 
            success: true, 
            product: {
                name: product.name || `Producto ${sku}`,
                description: product.description || '',
                price: parseFloat(product.price) || 0,
                cost: parseFloat(product.costPrice) || 0,
                images: product.images || (product.image ? [product.image] : []),
                sku: product.sku || sku
            }
        });
    } catch (error) {
        console.error('Error TVCmall product:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/tvcmall/import', verificarAdmin, async (req, res) => {
    const { sku, precioVenta, tipo, categoria } = req.body;
    
    if (!sku || !precioVenta) {
        return res.status(400).json({ success: false, error: 'SKU y precioVenta requeridos' });
    }
    
    if (!TVCMALL_API_KEY || !TVCMALL_API_SECRET) {
        return res.status(500).json({ success: false, error: 'TVCmall no configurado' });
    }
    
    if (!firestore) {
        return res.status(500).json({ success: false, error: 'Firestore no disponible' });
    }
    
    try {
        const timestamp = Date.now();
        const sign = crypto.createHash('md5')
            .update(`${TVCMALL_API_KEY}${timestamp}${TVCMALL_API_SECRET}`)
            .digest('hex');
        
        const response = await fetch(`${TVCMALL_API_URL}/product/detail`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json', 
                'X-API-Key': TVCMALL_API_KEY, 
                'X-Timestamp': timestamp, 
                'X-Sign': sign 
            },
            body: JSON.stringify({ sku })
        });
        
        const data = await response.json();
        
        if (!data?.success || !data.product) {
            throw new Error(`Producto ${sku} no encontrado en TVCmall`);
        }
        
        const product = data.product;
        const nombre = product.name || `Producto ${sku}`;
        
        const productoFinal = {
            sku,
            nombre,
            descripcion: product.description || '',
            categoria: categoria || detectarCategoria(nombre, ''),
            precioFinal: parseFloat(precioVenta),
            precioOriginal: parseFloat(precioVenta) * 1.15,
            descuento: 13,
            stock: product.stock || 0,
            tipo: tipo || 'Ofertas',
            rating: 0,
            imagenes: product.images || (product.image ? [product.image] : ['https://picsum.photos/500/500']),
            proveedor: 'TVCmall',
            fechaAgregado: new Date().toISOString()
        };
        
        const docRef = await firestore.collection('productos').add(productoFinal);
        
        res.json({ 
            success: true, 
            message: 'Producto TVCmall importado', 
            id: docRef.id, 
            product: productoFinal 
        });
    } catch (error) {
        console.error('❌ Error TVCmall import:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/sunsky/product/:sku', verificarAdmin, async (req, res) => {
    const { sku } = req.params;
    
    if (!SUNSKY_API_KEY || !SUNSKY_API_SECRET) {
        return res.status(500).json({ success: false, error: 'SunSky no configurado' });
    }
    
    try {
        const response = await fetch(`${SUNSKY_API_URL}/v1/product/details`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json', 
                'X-API-Key': SUNSKY_API_KEY, 
                'X-API-Secret': SUNSKY_API_SECRET 
            },
            body: JSON.stringify({ sku })
        });
        
        const data = await response.json();
        
        if (!data?.success || !data.product) {
            return res.status(404).json({ 
                success: false, 
                error: `Producto ${sku} no encontrado en SunSky` 
            });
        }
        
        const product = data.product;
        
        res.json({ 
            success: true, 
            product: {
                name: product.name || `Producto ${sku}`,
                description: product.description || '',
                price: parseFloat(product.price) || 0,
                cost: parseFloat(product.costPrice) || 0,
                images: product.images || (product.image ? [product.image] : []),
                sku: product.sku || sku
            }
        });
    } catch (error) {
        console.error('Error SunSky product:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/sunsky/import', verificarAdmin, async (req, res) => {
    const { sku, precioVenta, tipo, categoria } = req.body;
    
    if (!sku || !precioVenta) {
        return res.status(400).json({ success: false, error: 'SKU y precioVenta requeridos' });
    }
    
    if (!SUNSKY_API_KEY || !SUNSKY_API_SECRET) {
        return res.status(500).json({ success: false, error: 'SunSky no configurado' });
    }
    
    if (!firestore) {
        return res.status(500).json({ success: false, error: 'Firestore no disponible' });
    }
    
    try {
        const response = await fetch(`${SUNSKY_API_URL}/v1/product/details`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json', 
                'X-API-Key': SUNSKY_API_KEY, 
                'X-API-Secret': SUNSKY_API_SECRET 
            },
            body: JSON.stringify({ sku })
        });
        
        const data = await response.json();
        
        if (!data?.success || !data.product) {
            throw new Error(`Producto ${sku} no encontrado en SunSky`);
        }
        
        const product = data.product;
        const nombre = product.name || `Producto ${sku}`;
        
        const productoFinal = {
            sku,
            nombre,
            descripcion: product.description || '',
            categoria: categoria || detectarCategoria(nombre, ''),
            precioFinal: parseFloat(precioVenta),
            precioOriginal: parseFloat(precioVenta) * 1.15,
            descuento: 13,
            stock: product.stock || 0,
            tipo: tipo || 'Ofertas',
            rating: 0,
            imagenes: product.images || (product.image ? [product.image] : ['https://picsum.photos/500/500']),
            proveedor: 'SunSky',
            fechaAgregado: new Date().toISOString()
        };
        
        const docRef = await firestore.collection('productos').add(productoFinal);
        
        res.json({ 
            success: true, 
            message: 'Producto SunSky importado', 
            id: docRef.id, 
            product: productoFinal 
        });
    } catch (error) {
        console.error('❌ Error SunSky import:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

/* ========== TRACKING ========== */
/* 📈 Monitor de tráfico (avisa por WhatsApp cuando sube de golpe) — v4 */
const traficoEstado = { horaActual: '', conteo: 0, avisadoEn: '', previos: [] };
function traficoRegistrarVisita(){
    const hora = new Date().toISOString().substring(0, 13);
    if(traficoEstado.horaActual !== hora){
        traficoEstado.previos.push(traficoEstado.conteo);
        if(traficoEstado.previos.length > 6) traficoEstado.previos.shift();
        traficoEstado.horaActual = hora;
        traficoEstado.conteo = 0;
        traficoEstado.avisadoEn = '';
    }
    traficoEstado.conteo++;
    try {
        const previos = traficoEstado.previos.filter(c => c > 0);
        const promedio = previos.length ? previos.reduce((a, b) => a + b, 0) / previos.length : 0;
        if(waConfigurado && traficoEstado.conteo >= 30 && traficoEstado.conteo >= promedio * 2 && traficoEstado.avisadoEn !== traficoEstado.horaActual){
            traficoEstado.avisadoEn = traficoEstado.horaActual;
            waEnviarCallMeBot('📈 AUMENTO DE TRÁFICO EN BONÜ.COM\n\n👀 ' + traficoEstado.conteo + ' visitas en la última hora' + (promedio ? ' (promedio horas previas: ' + Math.round(promedio) + '/h)' : '') + '\n🗓️ ' + new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' })).catch(() => {});
        }
    } catch (e) { /* nunca romper el tracking */ }
}
app.post('/api/tracking/visita', async (req, res) => {
    const { pagina = '/', origen = 'directo', dispositivo = 'desktop' } = req.body;
    traficoRegistrarVisita();
    if (!firestore) return res.json({ success: true });
    
    try {
        await firestore.collection('trafico').add({ 
            pagina, 
            origen, 
            dispositivo, 
            fecha: new Date().toISOString(), 
            ip: req.ip 
        });
        res.json({ success: true });
    } catch { 
        res.json({ success: true }); 
    }
});

/* ========== ADMIN ENDPOINTS MEJORADOS ========== */

// Dashboard completo
app.get('/api/admin/dashboard-full', verificarAdmin, async (req, res) => {
    if (!firestore) {
        return res.status(500).json({ success: false, error: 'Firestore no disponible' });
    }
    
    try {
        const [pedidosSnap, productosSnap, usuariosSnap, transaccionesSnap] = await Promise.all([
            firestore.collection('pedidos').get(),
            firestore.collection('productos').get(),
            firestore.collection('clientes').get(),
            firestore.collection('transacciones').get()
        ]);
        
        const ordenes = [];
        pedidosSnap.forEach(doc => ordenes.push({ id: doc.id, ...doc.data() }));
        
        const hoy = new Date().toISOString().split('T')[0];
        let totalVentas = 0;
        let totalOrdenes = ordenes.length;
        let estados = { pendiente: 0, pagado: 0, enviado: 0, entregado: 0, cancelado: 0 };
        
        const ventasPorDia = Array(7).fill(0);
        const diasSemana = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
        const hoyDate = new Date();
        
        const productSales = {};
        
        ordenes.forEach(o => {
            totalVentas += o.total || 0;
            if (estados[o.estado] !== undefined) estados[o.estado]++;
            
            if (o.fecha) {
                const fecha = new Date(o.fecha);
                const diff = Math.floor((hoyDate - fecha) / (1000 * 60 * 60 * 24));
                if (diff >= 0 && diff < 7) {
                    ventasPorDia[6 - diff] += o.total || 0;
                }
            }
            
            if (o.items) {
                o.items.forEach(item => {
                    const key = item.id || item.nombre;
                    if (!productSales[key]) {
                        productSales[key] = { nombre: item.nombre, cantidad: 0, total: 0 };
                    }
                    productSales[key].cantidad += item.cantidad || 1;
                    productSales[key].total += (item.precio || 0) * (item.cantidad || 1);
                });
            }
        });
        
        const topProducts = Object.values(productSales)
            .sort((a, b) => b.cantidad - a.cantidad)
            .slice(0, 5);
        
        const lowStockProducts = [];
        productosSnap.forEach(doc => {
            const p = doc.data();
            if ((p.stock || 0) < 5) {
                lowStockProducts.push({ id: doc.id, nombre: p.nombre, stock: p.stock || 0 });
            }
        });
        
        const paymentMethods = {};
        ordenes.forEach(o => {
            const llavePago = o.pasarela || 'Desconocido';
            paymentMethods[llavePago] = (paymentMethods[llavePago] || 0) + 1;
        });
        
        const recentOrders = ordenes
            .sort((a, b) => new Date(b.fecha) - new Date(a.fecha))
            .slice(0, 5);
        
        let visits = 0;
        try {
            const visitasDoc = await firestore.collection('config').doc('visitas').get();
            if (visitasDoc.exists) visits = visitasDoc.data().count || 0;
        } catch (e) {}
        
        res.json({
            success: true,
            data: {
                totalVentas,
                totalOrdenes,
                totalUsuarios: usuariosSnap.size,
                totalProductos: productosSnap.size,
                visits,
                topProducts,
                lowStock: lowStockProducts,
                salesChart: {
                    labels: diasSemana,
                    data: ventasPorDia
                },
                paymentMethods: {
                    labels: Object.keys(paymentMethods),
                    data: Object.values(paymentMethods)
                },
                recentOrders: recentOrders.map(o => ({
                    id: o.id,
                    usuario: o.usuario || 'Cliente',
                    total: o.total || 0,
                    estado: o.estado || 'pagado',
                    fecha: o.fecha
                })),
                estados
            }
        });
    } catch (error) {
        console.error('Error en dashboard-full:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Órdenes con paginación
app.get('/api/admin/ordenes-full', verificarAdmin, async (req, res) => {
    if (!firestore) {
        return res.status(500).json({ success: false, error: 'Firestore no disponible' });
    }
    
    const { estado, search, page = 1, limit = 10 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    try {
        let query = firestore.collection('pedidos');
        
        if (estado) {
            query = query.where('estado', '==', estado);
        }
        
        const snapshot = await query.orderBy('fecha', 'desc').get();
        let ordenes = [];
        snapshot.forEach(doc => ordenes.push({ id: doc.id, ...doc.data() }));
        
        if (search) {
            const s = search.toLowerCase();
            ordenes = ordenes.filter(o => 
                (o.id || '').toLowerCase().includes(s) ||
                (o.usuario || '').toLowerCase().includes(s) ||
                (o.emailCliente || '').toLowerCase().includes(s)
            );
        }
        
        const total = ordenes.length;
        const paginados = ordenes.slice(skip, skip + parseInt(limit));
        
        res.json({
            success: true,
            data: paginados,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Detalle de orden
app.get('/api/admin/ordenes/:id', verificarAdmin, async (req, res) => {
    if (!firestore) {
        return res.status(500).json({ success: false, error: 'Firestore no disponible' });
    }
    
    try {
        const doc = await firestore.collection('pedidos').doc(req.params.id).get();
        
        if (!doc.exists) {
            return res.status(404).json({ success: false, error: 'Orden no encontrada' });
        }
        
        res.json({ success: true, orden: { id: doc.id, ...doc.data() } });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Usuarios con filtros
app.get('/api/admin/usuarios-full', verificarAdmin, async (req, res) => {
    if (!firestore) {
        return res.status(500).json({ success: false, error: 'Firestore no disponible' });
    }
    
    const { tipo, search, gastoMin, gastoMax, page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    try {
        let query = firestore.collection('clientes');
        let usuarios = [];
        const snapshot = await query.get();
        snapshot.forEach(doc => usuarios.push({ id: doc.id, ...doc.data() }));
        
        if (tipo) {
            usuarios = usuarios.filter(u => u.tipo === tipo);
        }
        
        if (search) {
            const s = search.toLowerCase();
            usuarios = usuarios.filter(u => 
                (u.nombre || '').toLowerCase().includes(s) ||
                (u.email || '').toLowerCase().includes(s)
            );
        }
        
        const pedidosSnap = await firestore.collection('pedidos').get();
        const gastosPorUsuario = {};
        pedidosSnap.forEach(doc => {
            const o = doc.data();
            if (o.emailCliente) {
                gastosPorUsuario[o.emailCliente] = (gastosPorUsuario[o.emailCliente] || 0) + (o.total || 0);
            }
        });
        
        if (gastoMin || gastoMax) {
            usuarios = usuarios.filter(u => {
                const gasto = gastosPorUsuario[u.email] || 0;
                if (gastoMin && gasto < parseFloat(gastoMin)) return false;
                if (gastoMax && gasto > parseFloat(gastoMax)) return false;
                return true;
            });
        }
        
        const total = usuarios.length;
        const paginados = usuarios.slice(skip, skip + parseInt(limit));
        
        const result = paginados.map(u => ({
            ...u,
            totalSpent: gastosPorUsuario[u.email] || 0
        }));
        
        res.json({
            success: true,
            data: result,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Vendedores con comisiones
app.get('/api/admin/vendedores-full', verificarAdmin, async (req, res) => {
    if (!firestore) {
        return res.status(500).json({ success: false, error: 'Firestore no disponible' });
    }
    
    try {
        const snapshot = await firestore.collection('vendedores').get();
        const vendedores = [];
        snapshot.forEach(doc => vendedores.push({ id: doc.id, ...doc.data() }));
        
        const pedidosSnap = await firestore.collection('pedidos').get();
        const comisionesPorVendedor = {};
        
        pedidosSnap.forEach(doc => {
            const o = doc.data();
            if (o.items) {
                o.items.forEach(item => {
                    const prov = item.proveedor || 'Bonü';
                    if (!comisionesPorVendedor[prov]) {
                        comisionesPorVendedor[prov] = { totalVentas: 0, comisionTotal: 0, comisionPagada: 0 };
                    }
                    const precio = (item.precio || 0) * (item.cantidad || 1);
                    comisionesPorVendedor[prov].totalVentas += precio;
                    comisionesPorVendedor[prov].comisionTotal += precio * 0.05;
                });
            }
        });
        
        const result = vendedores.map(v => ({
            ...v,
            totalVentas: comisionesPorVendedor[v.nombre]?.totalVentas || 0,
            comisionTotal: comisionesPorVendedor[v.nombre]?.comisionTotal || 0,
            comisionPagada: comisionesPorVendedor[v.nombre]?.comisionPagada || 0
        }));
        
        res.json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Finanzas - Balance
app.get('/api/admin/finanzas/balance', verificarAdmin, async (req, res) => {
    if (!firestore) {
        return res.status(500).json({ success: false, error: 'Firestore no disponible' });
    }
    
    const { startDate, endDate } = req.query;
    
    try {
        let query = firestore.collection('pedidos');
        const snapshot = await query.get();
        let ordenes = [];
        snapshot.forEach(doc => ordenes.push({ id: doc.id, ...doc.data() }));
        
        if (startDate) {
            const inicio = new Date(startDate);
            ordenes = ordenes.filter(o => new Date(o.fecha) >= inicio);
        }
        if (endDate) {
            const fin = new Date(endDate);
            fin.setHours(23, 59, 59, 999);
            ordenes = ordenes.filter(o => new Date(o.fecha) <= fin);
        }
        
        let ingresos = 0;
        let comisiones = 0;
        let ivaCobrado = 0;
        const ventasPorMes = {};
        
        ordenes.forEach(o => {
            ingresos += o.total || 0;
            comisiones += (o.total || 0) * 0.05;
            ivaCobrado += (o.total || 0) * 0.16;
            
            const fecha = new Date(o.fecha);
            const llaveMes = `${fecha.getFullYear()}-${String(fecha.getMonth()+1).padStart(2,'0')}`;
            if (!ventasPorMes[llaveMes]) ventasPorMes[llaveMes] = 0;
            ventasPorMes[llaveMes] += o.total || 0;
        });
        
        const gananciaNeta = ingresos - comisiones;
        
        const mesesOrdenados = Object.keys(ventasPorMes).sort();
        const labels = mesesOrdenados.map(k => {
            const [year, month] = k.split('-');
            return `${month}/${year.slice(2)}`;
        });
        const data = mesesOrdenados.map(k => ventasPorMes[k]);
        
        res.json({
            success: true,
            data: {
                ingresos,
                comisiones,
                gananciaNeta,
                ivaCobrado,
                ivaPagado: comisiones * 0.16,
                ivaAPagar: ivaCobrado - (comisiones * 0.16),
                ventasPorMes: {
                    labels,
                    data
                }
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Auditoría
app.get('/api/admin/auditoria', verificarAdmin, async (req, res) => {
    if (!firestore) {
        return res.status(500).json({ success: false, error: 'Firestore no disponible' });
    }
    
    const { limit = 100, page = 1 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    try {
        const snapshot = await firestore.collection('auditoria')
            .orderBy('fecha', 'desc')
            .limit(parseInt(limit))
            .get();
        
        const logs = [];
        snapshot.forEach(doc => logs.push({ id: doc.id, ...doc.data() }));
        
        res.json({
            success: true,
            data: logs,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: logs.length
            }
        });
    } catch (error) {
        res.json({ success: true, data: [], pagination: { page: 1, limit: 100, total: 0 } });
    }
});

app.post('/api/admin/auditoria', verificarAdmin, async (req, res) => {
    if (!firestore) {
        return res.status(500).json({ success: false, error: 'Firestore no disponible' });
    }
    
    const { accion, detalle } = req.body;
    
    if (!accion) {
        return res.status(400).json({ success: false, error: 'Acción requerida' });
    }
    
    try {
        await firestore.collection('auditoria').add({
            fecha: new Date().toISOString(),
            admin: req.user?.email || 'Sistema',
            accion,
            detalle: detalle || '',
            ip: req.ip
        });
        
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Reportes avanzados
app.post('/api/admin/reportes/generar', verificarAdmin, async (req, res) => {
    if (!firestore) {
        return res.status(500).json({ success: false, error: 'Firestore no disponible' });
    }
    
    const { tipo, startDate, endDate, format } = req.body;
    
    if (!tipo || !startDate || !endDate) {
        return res.status(400).json({ success: false, error: 'Tipo y fechas requeridos' });
    }
    
    try {
        const inicio = new Date(startDate);
        const fin = new Date(endDate);
        fin.setHours(23, 59, 59, 999);
        
        const snapshot = await firestore.collection('pedidos').get();
        let pedidos = [];
        snapshot.forEach(doc => {
            const o = doc.data();
            const fecha = new Date(o.fecha);
            if (fecha >= inicio && fecha <= fin) {
                pedidos.push({ id: doc.id, ...o });
            }
        });
        
        let resultado = {};
        
        switch (tipo) {
            case 'ventas': {
                const total = pedidos.reduce((s, o) => s + (o.total || 0), 0);
                resultado = {
                    total,
                    cantidad: pedidos.length,
                    promedio: pedidos.length ? total / pedidos.length : 0,
                    datos: pedidos.map(o => ({
                        id: o.id,
                        cliente: o.usuario || 'Cliente',
                        total: o.total || 0,
                        fecha: o.fecha
                    }))
                };
                break;
            }
            case 'productos': {
                const prodCount = {};
                pedidos.forEach(o => {
                    (o.items || []).forEach(item => {
                        const key = item.id || item.nombre;
                        if (!prodCount[key]) {
                            prodCount[key] = { nombre: item.nombre, cantidad: 0, total: 0 };
                        }
                        prodCount[key].cantidad += item.cantidad || 1;
                        prodCount[key].total += (item.precio || 0) * (item.cantidad || 1);
                    });
                });
                const sorted = Object.values(prodCount).sort((a, b) => b.cantidad - a.cantidad);
                resultado = { productos: sorted };
                break;
            }
            case 'clientes': {
                const clientes = {};
                pedidos.forEach(o => {
                    const email = o.emailCliente || o.usuario;
                    if (!clientes[email]) {
                        clientes[email] = { nombre: o.usuario || email, email, total: 0, compras: 0 };
                    }
                    clientes[email].total += o.total || 0;
                    clientes[email].compras += 1;
                });
                const sorted = Object.values(clientes).sort((a, b) => b.total - a.total);
                resultado = { clientes: sorted };
                break;
            }
            case 'vendedores': {
                const vendedores = {};
                pedidos.forEach(o => {
                    (o.items || []).forEach(item => {
                        const prov = item.proveedor || 'Bonü';
                        if (!vendedores[prov]) {
                            vendedores[prov] = { nombre: prov, total: 0, items: 0 };
                        }
                        vendedores[prov].total += (item.precio || 0) * (item.cantidad || 1);
                        vendedores[prov].items += item.cantidad || 1;
                    });
                });
                const sorted = Object.values(vendedores).sort((a, b) => b.total - a.total);
                resultado = { vendedores: sorted };
                break;
            }
            case 'impuestos': {
                const totalIva = pedidos.reduce((s, o) => s + ((o.total || 0) * 16 / 116), 0);
                resultado = {
                    totalVentas: pedidos.reduce((s, o) => s + (o.total || 0), 0),
                    totalIVA: totalIva,
                    transacciones: pedidos.length
                };
                break;
            }
            default:
                return res.status(400).json({ success: false, error: 'Tipo de reporte inválido' });
        }
        
        res.json({ success: true, data: resultado });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Generar factura
app.post('/api/admin/factura/generar', verificarAdmin, async (req, res) => {
    if (!firestore) {
        return res.status(500).json({ success: false, error: 'Firestore no disponible' });
    }
    
    const { orderId } = req.body;
    
    if (!orderId) {
        return res.status(400).json({ success: false, error: 'orderId requerido' });
    }
    
    try {
        const doc = await firestore.collection('pedidos').doc(orderId).get();
        
        if (!doc.exists) {
            return res.status(404).json({ success: false, error: 'Orden no encontrada' });
        }
        
        const orden = doc.data();
        const invoiceNumber = `INV-${Date.now()}-${orderId.slice(-6)}`;
        
        await firestore.collection('transacciones').add({
            ordenId: orderId,
            monto: orden.total || 0,
            pasarela: orden.pasarela || 'Facturación',
            estado: 'facturada',
            invoiceNumber,
            fecha: new Date().toISOString()
        });
        
        await firestore.collection('pedidos').doc(orderId).update({
            invoiceNumber,
            facturado: true,
            fechaFactura: new Date().toISOString()
        });
        
        await firestore.collection('auditoria').add({
            fecha: new Date().toISOString(),
            admin: req.user?.email || 'Sistema',
            accion: 'Generación de factura',
            detalle: `Factura ${invoiceNumber} generada para orden ${orderId}`,
            ip: req.ip
        });
        
        res.json({ 
            success: true, 
            invoiceNumber,
            message: `Factura ${invoiceNumber} generada correctamente`
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Stock bajo
app.get('/api/admin/inventory/low-stock', verificarAdmin, async (req, res) => {
    if (!firestore) {
        return res.status(500).json({ success: false, error: 'Firestore no disponible' });
    }
    
    const { threshold = 5 } = req.query;
    
    try {
        const snapshot = await firestore.collection('productos').get();
        const lowStock = [];
        
        snapshot.forEach(doc => {
            const p = doc.data();
            if ((p.stock || 0) < parseInt(threshold)) {
                lowStock.push({ id: doc.id, ...p });
            }
        });
        
        res.json({ 
            success: true, 
            data: lowStock,
            count: lowStock.length
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Movimientos de inventario
app.get('/api/admin/inventory/movements', verificarAdmin, async (req, res) => {
    if (!firestore) {
        return res.status(500).json({ success: false, error: 'Firestore no disponible' });
    }
    
    const { productId, limit = 50 } = req.query;
    
    try {
        let query = firestore.collection('inventoryMovements');
        
        if (productId) {
            query = query.where('productId', '==', productId);
        }
        
        const snapshot = await query.orderBy('createdAt', 'desc').limit(parseInt(limit)).get();
        const movements = [];
        snapshot.forEach(doc => movements.push({ id: doc.id, ...doc.data() }));
        
        res.json({ success: true, data: movements });
    } catch (error) {
        res.json({ success: true, data: [] });
    }
});

app.post('/api/admin/inventory/movement', verificarAdmin, async (req, res) => {
    if (!firestore) {
        return res.status(500).json({ success: false, error: 'Firestore no disponible' });
    }
    
    const { productId, type, quantity, reference } = req.body;
    
    if (!productId || !type || quantity === undefined) {
        return res.status(400).json({ success: false, error: 'productId, type y quantity requeridos' });
    }
    
    try {
        const productRef = firestore.collection('productos').doc(productId);
        const productDoc = await productRef.get();
        
        if (!productDoc.exists) {
            return res.status(404).json({ success: false, error: 'Producto no encontrado' });
        }
        
        const product = productDoc.data();
        const previousStock = product.stock || 0;
        let newStock = previousStock;
        
        switch (type) {
            case 'PURCHASE':
            case 'RETURN':
                newStock = previousStock + parseInt(quantity);
                break;
            case 'SALE':
            case 'TRANSFER':
                newStock = previousStock - parseInt(quantity);
                break;
            case 'ADJUSTMENT':
                newStock = parseInt(quantity);
                break;
            default:
                return res.status(400).json({ success: false, error: 'Tipo de movimiento inválido' });
        }
        
        if (newStock < 0) {
            return res.status(400).json({ success: false, error: 'Stock insuficiente' });
        }
        
        await productRef.update({ stock: newStock });
        
        await firestore.collection('inventoryMovements').add({
            productId,
            type,
            quantity: parseInt(quantity),
            previousStock,
            newStock,
            reference: reference || null,
            createdBy: req.user?.email || 'Sistema',
            createdAt: new Date().toISOString()
        });
        
        await firestore.collection('auditoria').add({
            fecha: new Date().toISOString(),
            admin: req.user?.email || 'Sistema',
            accion: 'Movimiento de inventario',
            detalle: `${type} - Producto: ${product.nombre}, Cantidad: ${quantity}, Stock: ${previousStock} → ${newStock}`,
            ip: req.ip
        });
        
        res.json({ 
            success: true, 
            message: 'Movimiento registrado',
            previousStock,
            newStock
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Admin endpoints existentes
app.get('/api/admin/trafico', verificarAdmin, async (req, res) => {
    if (!firestore) return res.json({ total: 0, hoy: 0, mes: 0 });
    
    try {
        const snap = await firestore.collection('trafico').get();
        const hoy = new Date().toISOString().split('T')[0];
        let total = 0, hoyCount = 0;
        
        snap.forEach(doc => { 
            total++; 
            if (doc.data().fecha?.startsWith(hoy)) hoyCount++; 
        });
        
        res.json({ total, hoy: hoyCount, mes: total });
    } catch (error) { 
        res.json({ total: 0, hoy: 0, mes: 0 }); 
    }
});

app.get('/api/admin/ordenes', verificarAdmin, async (req, res) => {
    if (!firestore) {
        return res.status(500).json({ success: false, error: 'Firestore no disponible' });
    }
    
    try {
        const { estado, limit = 50 } = req.query;
        let query = firestore.collection('pedidos');
        
        if (estado) query = query.where('estado', '==', estado);
        
        const snapshot = await query.orderBy('fecha', 'desc').limit(parseInt(limit)).get();
        const ordenes = [];
        
        snapshot.forEach(doc => ordenes.push({ id: doc.id, ...doc.data() }));
        
        res.json({ success: true, total: ordenes.length, ordenes });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.patch('/api/admin/ordenes/:id/estado', verificarAdmin, async (req, res) => {
    if (!firestore) {
        return res.status(500).json({ success: false, error: 'Firestore no disponible' });
    }
    
    const { estado } = req.body;
    const validos = ['pendiente', 'pagado', 'enviado', 'entregado', 'cancelado', 'devuelto'];
    
    if (!validos.includes(estado)) {
        return res.status(400).json({ success: false, error: 'Estado inválido' });
    }
    
    try {
        const ordenRef = firestore.collection('pedidos').doc(req.params.id);
        
        if (!(await ordenRef.get()).exists) {
            return res.status(404).json({ success: false, error: 'Orden no encontrada' });
        }
        
        await ordenRef.update({ 
            estado, 
            fechaActualizacion: new Date().toISOString() 
        });
        
        res.json({ success: true, mensaje: 'Estado actualizado' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.delete('/api/admin/ordenes/:id', verificarAdmin, async (req, res) => {
    if (!firestore) {
        return res.status(500).json({ success: false, error: 'Firestore no disponible' });
    }
    
    try {
        await firestore.collection('pedidos').doc(req.params.id).delete();
        res.json({ success: true, mensaje: 'Orden eliminada' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/admin/ordenes', verificarAdmin, async (req, res) => {
    if (!firestore) {
        return res.status(500).json({ success: false, error: 'Firestore no disponible' });
    }
    
    const { usuario, items, direccion, total, pasarela, customerEmail } = req.body;
    
    if (!items?.length || !total) {
        return res.status(400).json({ success: false, error: 'items y total requeridos' });
    }
    
    try {
        const ordenId = `ORD-${generarId()}`;
        const orden = {
            id: ordenId,
            usuario: usuario || 'Invitado',
            items: items.map(item => ({ ...item, precio: item.precioFinal || item.precio || 0 })),
            direccion: direccion || {},
            total: parseFloat(total),
            pasarela: pasarela || 'Manual',
            estado: 'pagado',
            emailCliente: customerEmail || direccion?.email,
            fecha: new Date().toISOString(),
            tipo: 'manual'
        };
        
        await firestore.collection('pedidos').doc(ordenId).set(orden);
        
        await firestore.collection('transacciones').add({
            ordenId,
            monto: orden.total,
            pasarela: orden.pasarela,
            estado: 'pagado',
            fecha: new Date().toISOString()
        });
        
        if (orden.emailCliente) {
            sendConfirmationEmail({
                orderId: orden.id,
                customerEmail: orden.emailCliente,
                customerName: usuario || 'Cliente',
                total: orden.total,
                items: orden.items,
                shippingAddress: direccion,
                paymentMethod: pasarela,
                date: orden.fecha
            }).catch(err => console.error('Error email:', err.message));
        }
        
        res.json({ success: true, orden });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/admin/usuarios', verificarAdmin, async (req, res) => {
    if (!firestore) {
        return res.status(500).json({ success: false, error: 'Firestore no disponible' });
    }
    
    try {
        const snapshot = await firestore.collection('clientes').limit(100).get();
        const usuarios = [];
        
        snapshot.forEach(doc => usuarios.push({ id: doc.id, ...doc.data() }));
        
        res.json({ success: true, usuarios });
    } catch (error) { 
        res.status(500).json({ success: false, error: error.message }); 
    }
});

app.get('/api/admin/transacciones', verificarAdmin, async (req, res) => {
    if (!firestore) {
        return res.status(500).json({ success: false, error: 'Firestore no disponible' });
    }
    
    try {
        const snapshot = await firestore.collection('transacciones')
            .orderBy('fecha', 'desc')
            .limit(100)
            .get();
        
        const transacciones = [];
        snapshot.forEach(doc => transacciones.push({ id: doc.id, ...doc.data() }));
        
        res.json({ success: true, transacciones });
    } catch (error) { 
        res.status(500).json({ success: false, error: error.message }); 
    }
});

app.get('/api/admin/productos', verificarAdmin, async (req, res) => {
    if (!firestore) {
        return res.status(500).json({ success: false, error: 'Firestore no disponible' });
    }
    
    try {
        const snapshot = await firestore.collection('productos').limit(200).get();
        const productos = [];
        
        snapshot.forEach(doc => productos.push({ id: doc.id, ...doc.data() }));
        
        res.json({ success: true, productos });
    } catch (error) { 
        res.status(500).json({ success: false, error: error.message }); 
    }
});

app.patch('/api/admin/productos/:id', verificarAdmin, async (req, res) => {
    if (!firestore) {
        return res.status(500).json({ success: false, error: 'Firestore no disponible' });
    }
    
    try {
        const productRef = firestore.collection('productos').doc(req.params.id);
        
        if (!(await productRef.get()).exists) {
            return res.status(404).json({ success: false, error: 'Producto no encontrado' });
        }
        
        await productRef.update({ 
            ...req.body, 
            fechaActualizacion: new Date().toISOString() 
        });
        
        res.json({ success: true, mensaje: 'Producto actualizado' });
    } catch (error) { 
        res.status(500).json({ success: false, error: error.message }); 
    }
});

app.delete('/api/admin/productos/:id', verificarAdmin, async (req, res) => {
    if (!firestore) {
        return res.status(500).json({ success: false, error: 'Firestore no disponible' });
    }
    
    try {
        await firestore.collection('productos').doc(req.params.id).delete();
        res.json({ success: true, mensaje: 'Producto eliminado' });
    } catch (error) { 
        res.status(500).json({ success: false, error: error.message }); 
    }
});

app.get('/api/admin/cupones', verificarAdmin, async (req, res) => {
    if (!firestore) {
        return res.status(500).json({ success: false, error: 'Firestore no disponible' });
    }
    
    try {
        const snapshot = await firestore.collection('cupones').get();
        const cupones = [];
        
        snapshot.forEach(doc => cupones.push({ id: doc.id, ...doc.data() }));
        
        res.json({ success: true, cupones });
    } catch (error) { 
        res.status(500).json({ success: false, error: error.message }); 
    }
});

app.post('/api/admin/cupones', verificarAdmin, async (req, res) => {
    if (!firestore) {
        return res.status(500).json({ success: false, error: 'Firestore no disponible' });
    }
    
    const { codigo, descuento, minimoCompra, expira, usosMax } = req.body;
    
    if (!codigo || !descuento) {
        return res.status(400).json({ success: false, error: 'Código y descuento requeridos' });
    }
    
    try {
        const cuponRef = await firestore.collection('cupones').add({
            codigo: codigo.toUpperCase(),
            descuento: parseInt(descuento),
            minimoCompra: parseFloat(minimoCompra) || 0,
            expira: expira || null,
            usosMax: parseInt(usosMax) || null,
            usos: 0,
            activo: true,
            fechaCreacion: new Date().toISOString()
        });
        
        res.json({ success: true, id: cuponRef.id, mensaje: 'Cupón creado' });
    } catch (error) { 
        res.status(500).json({ success: false, error: error.message }); 
    }
});

app.delete('/api/admin/cupones/:id', verificarAdmin, async (req, res) => {
    if (!firestore) {
        return res.status(500).json({ success: false, error: 'Firestore no disponible' });
    }
    
    try {
        await firestore.collection('cupones').doc(req.params.id).delete();
        res.json({ success: true, mensaje: 'Cupón eliminado' });
    } catch (error) { 
        res.status(500).json({ success: false, error: error.message }); 
    }
});

app.get('/api/admin/withdraw-requests', verificarAdmin, async (req, res) => {
    if (!firestore) {
        return res.status(500).json({ success: false, error: 'Firestore no disponible' });
    }
    
    try {
        const snapshot = await firestore.collection('withdrawRequests')
            .orderBy('fecha', 'desc')
            .limit(50)
            .get();
        
        const requests = [];
        snapshot.forEach(doc => requests.push({ id: doc.id, ...doc.data() }));
        
        res.json({ success: true, requests });
    } catch (error) { 
        res.status(500).json({ success: false, error: error.message }); 
    }
});

app.patch('/api/admin/withdraw-requests/:id', verificarAdmin, async (req, res) => {
    if (!firestore) {
        return res.status(500).json({ success: false, error: 'Firestore no disponible' });
    }
    
    const { estado } = req.body;
    const validos = ['pendiente', 'aprobado', 'pagado', 'rechazado'];
    
    if (!validos.includes(estado)) {
        return res.status(400).json({ success: false, error: 'Estado inválido' });
    }
    
    try {
        await firestore.collection('withdrawRequests').doc(req.params.id).update({
            estado,
            fechaActualizacion: new Date().toISOString()
        });
        
        res.json({ success: true, mensaje: 'Estado actualizado' });
    } catch (error) { 
        res.status(500).json({ success: false, error: error.message }); 
    }
});

app.get('/api/admin/dashboard', verificarAdmin, async (req, res) => {
    if (!firestore) {
        return res.status(500).json({ success: false, error: 'Firestore no disponible' });
    }
    
    try {
        const [pedidosSnap, productosSnap, usuariosSnap] = await Promise.all([
            firestore.collection('pedidos').get(),
            firestore.collection('productos').get(),
            firestore.collection('clientes').get()
        ]);
        
        const ordenes = [];
        pedidosSnap.forEach(doc => ordenes.push({ id: doc.id, ...doc.data() }));
        
        const hoy = new Date().toISOString().split('T')[0];
        const estados = { pendiente: 0, pagado: 0, enviado: 0, cancelado: 0 };
        let montoTotal = 0;
        
        ordenes.forEach(o => { 
            montoTotal += o.total || 0; 
            if (estados[o.estado] !== undefined) estados[o.estado]++; 
        });
        
        res.json({
            success: true,
            resumen: {
                totalOrdenes: ordenes.length,
                ordenesHoy: ordenes.filter(o => o.fecha?.startsWith(hoy)).length,
                totalUsuarios: usuariosSnap.size,
                totalProductos: productosSnap.size,
                montoTotal
            },
            ordenes: { estados }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/admin/set-role', verificarAdmin, async (req, res) => {
    const { uid, email } = req.body;
    
    if (!uid && !email) {
        return res.status(400).json({ error: 'Se requiere uid o email' });
    }
    
    try {
        const user = uid 
            ? await admin.auth().getUser(uid) 
            : await admin.auth().getUserByEmail(email);
        
        await admin.auth().setCustomUserClaims(user.uid, { admin: true });
        
        if (firestore) {
            await firestore.collection('admins').doc(user.uid).set({
                email: user.email,
                nombre: user.displayName || user.email,
                asignado: new Date().toISOString()
            });
        }
        
        console.log(`✅ ${user.email} (${user.uid}) ahora es ADMIN`);
        
        res.json({ 
            success: true, 
            message: `✅ ${user.email} ahora es administrador`, 
            uid: user.uid, 
            email: user.email 
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/* ========== OPEN GRAPH ========== */
app.get('/og/producto/:id', async (req, res) => {
    if (!firestore) return res.redirect('https://xn--bon-joa.com');
    
    try {
        const productDoc = await firestore.collection('productos').doc(req.params.id).get();
        
        if (!productDoc.exists) return res.redirect('https://xn--bon-joa.com');
        
        const p = productDoc.data();
        const imagen = p.imagenes?.[0] || 'https://xn--bon-joa.com/og-image.jpg';
        const titulo = (p.nombre || 'Bonü Marketplace').replace(/"/g, '&quot;');
        const descripcionRaw = p.descripcion?.substring(0, 160) || 'Compra en Bonü con cashback y envío gratis';
        const descripcion = (p.precioFinal ? `$${p.precioFinal} MXN - ` : '') + descripcionRaw.replace(/"/g, '&quot;');
        const url = `https://xn--bon-joa.com/producto/${req.params.id}`;
        
        res.set('Cache-Control', 'public, max-age=3600');
        res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${titulo} | Bonü</title>
        <meta property="og:type" content="product">
        <meta property="og:title" content="${titulo}">
        <meta property="og:description" content="${descripcion}">
        <meta property="og:image" content="${imagen}">
        <meta property="og:url" content="${url}">
        <meta name="twitter:card" content="summary_large_image">
        </head><body><p>Redirigiendo...</p><script>window.location.href="${url}";</script></body></html>`);
    } catch { 
        res.redirect('https://xn--bon-joa.com'); 
    }
});
/* ========== ALIEXPRESS DROPSHIPPING (API REAL) ========== */
const AE_KEY = process.env.ALIEXPRESS_APP_KEY || '';
const AE_SECRET = process.env.ALIEXPRESS_APP_SECRET || '';
let AE_TOKEN = process.env.ALIEXPRESS_ACCESS_TOKEN || '';
const AE_API_URL = 'https://api-sg.aliexpress.com/sync';

/* FIX 1: firma oficial de AliExpress Open Platform con sign_method=sha256.
   HMAC-SHA256 donde la CLAVE es el app_secret y el MENSAJE es la concatenación
   ordenada "key1value1key2value2..." — SIN envolver el string con el secret
   (eso era el estilo MD5 y producía el error de firma inválida).
   Los parámetros con valor vacío no participan en la firma.
   Si el gateway rechazara ese estilo, aeLlamar() reintenta automáticamente con la
   variante que antepone el nombre del API y memoriza el modo válido (AE_SIGN_MODE). */
let AE_SIGN_MODE = 'plain';

function aeFirmar(params, metodo) {
    const sorted = Object.keys(params)
        .filter(k => params[k] !== undefined && params[k] !== null && params[k] !== '')
        .sort();
    let base = sorted.map(k => k + params[k]).join('');
    if (AE_SIGN_MODE === 'prepend' && metodo) base = metodo + base;
    return crypto.createHmac('sha256', AE_SECRET).update(base, 'utf8').digest('hex').toUpperCase();
}

function aeEsErrorFirma(data) {
    const er = data && data.error_response;
    if (!er) return false;
    return /sign|signature|签名/i.test(`${er.msg || ''} ${er.sub_msg || ''} ${er.sub_code || ''}`);
}

async function aePost(params) {
    const qs = new URLSearchParams(params).toString();
    const resp = await fetch(`${AE_API_URL}?${qs}`, { method: 'POST' });
    if (!resp.ok) throw new Error(`AliExpress HTTP ${resp.status}`);
    return resp.json();
}

async function aeLlamar(metodo, paramsNegocio = {}) {
    const token = await aeTokenFresco();
    const construir = () => {
        const params = {
            method: metodo,
            app_key: AE_KEY,
            timestamp: Date.now(),
            format: 'json',
            v: '2.0',
            sign_method: 'sha256',
            ...paramsNegocio
        };
        if (token) params.session = token; // sin token no se envía session (evita firmar un vacío)
        delete params.sign;
        params.sign = aeFirmar(params, metodo);
        return params;
    };
    let data = await aePost(construir());
    if (aeEsErrorFirma(data)) {
        const modoPrevio = AE_SIGN_MODE;
        AE_SIGN_MODE = modoPrevio === 'plain' ? 'prepend' : 'plain';
        console.warn(`⚠️ AliExpress rechazó la firma (modo "${modoPrevio}"). Reintentando con modo "${AE_SIGN_MODE}"...`);
        const data2 = await aePost(construir());
        if (aeEsErrorFirma(data2)) {
            AE_SIGN_MODE = modoPrevio;
            console.error('❌ AliExpress: la firma falló en ambos modos. Revisa ALIEXPRESS_APP_SECRET.');
        }
        return data2;
    }
    return data;
}

function extraerIdAliexpress(texto) {
    const t = String(texto || '').trim();
    if (/^\d+$/.test(t)) return t;
    const m = t.match(/item\/(\d+)\.html/) || t.match(/product\/(\d+)/);
    return m ? m[1] : t;
}
/* ========== TOKENS ALIEXPRESS: CANJE + AUTO-RENOVACIÓN ========== */
const AE_REDIRECT_URI = process.env.ALIEXPRESS_REDIRECT_URI || 'https://bonu-backend.onrender.com/api/aliexpress/callback';
const AE_AUTORIZAR_URL = `https://api-sg.aliexpress.com/oauth/authorize?response_type=code&force_auth=true&client_id=${encodeURIComponent(AE_KEY)}&redirect_uri=${encodeURIComponent(AE_REDIRECT_URI)}&sp=ae`;

async function aeLeerTokens() {
    if (!firestore) return null;
    try {
        const d = await firestore.collection('config').doc('aliexpress_tokens').get();
        return d.exists ? d.data() : null;
    } catch (e) { return null; }
}

let AE_RENOVANDO = null;          // lock: evita refreshes concurrentes
let aeUltimoIntentoRefresh = 0;   // throttle: no martillar si el refresh_token ya murió

async function aeGuardarTokens(data) {
    const ahora = Date.now();
        let accessExpira = Number(data.expire_time) || (ahora + (Number(data.expires_in) || 6 * 86400) * 1000);
    let refreshExpira = Number(data.refresh_token_valid_time) || (ahora + (Number(data.refresh_expires_in) || 25 * 86400) * 1000);
    if (accessExpira < 1e12) accessExpira *= 1000;   // por si viniera en segundos
    if (refreshExpira < 1e12) refreshExpira *= 1000;
    const registro = {
        access_token: data.access_token,
        access_expira: accessExpira,
        refresh_expira: refreshExpira,
        emitido: ahora
    };
    if (data.refresh_token) registro.refresh_token = data.refresh_token; // no borra el refresh_token previo si la respuesta no lo trae
    if (firestore) await firestore.collection('config').doc('aliexpress_tokens').set(registro, { merge: true });
    AE_TOKEN = registro.access_token;
    return registro;
}

/* Normaliza la respuesta de token: plana, dentro de result (objeto/string),
   o envuelta al estilo GOP: {"/auth/token/create_response": {...}} o
   {"/auth/token/refresh_response": {...}} — aquí se desenrolla la envoltura. */
function aeExtraerTokenPayload(d) {
    if (!d) return null;
    if (typeof d.result === 'string') { try { return JSON.parse(d.result); } catch (_) { return null; } }
    if (d.result && typeof d.result === 'object' && d.result.access_token) return d.result;
    if (d.access_token) return d;
    for (const k of Object.keys(d)) {
        if (k.endsWith('_response') && d[k] && typeof d[k] === 'object' && d[k].access_token) return d[k];
    }
    return null;
}
async function aeTokenFresco() {
    const t = await aeLeerTokens();
    if (!t || !t.access_token) return AE_TOKEN;
    /* FIX 2: el access_token de AliExpress vive 7 días (app en Test) o 30 días (app Online)
       y el refresh_token 30/180 días. Antes se refrescaba hasta el día 40, cuando ambos ya
       habían expirado. Ahora se guardan las expiraciones reales en Firestore y se renueva
       automáticamente cuando al access token le queda menos de 24 h. */
    const porExpirar = !t.access_expira || (t.access_expira - Date.now()) < 24 * 3600 * 1000;
    const refreshValido = !!t.refresh_token && (!t.refresh_expira || t.refresh_expira > Date.now());
    const hacePoco = (Date.now() - aeUltimoIntentoRefresh) < 10 * 60 * 1000;
    if (porExpirar && refreshValido && !hacePoco) {
        if (AE_RENOVANDO) return AE_RENOVANDO; // otra petición ya está renovando
        aeUltimoIntentoRefresh = Date.now();
                AE_RENOVANDO = (async () => {
            try {
                console.log('🔄 Renovando token AliExpress automáticamente (expira pronto)...');
                const d = await aePostFirmado('/auth/token/refresh', { refresh_token: t.refresh_token });
                const payload = aeExtraerTokenPayload(d);
                if (payload && payload.access_token) {
                    await aeGuardarTokens(payload);
                    console.log('✅ Token AliExpress renovado');
                    return payload.access_token;
                }
                console.warn('⚠️ Refresh AliExpress falló:', JSON.stringify(d).slice(0, 300));
                return t.access_token;
            } catch (e) {
                console.warn('⚠️ Error refresh:', e.message);
                return t.access_token;
            } finally {
                AE_RENOVANDO = null;
            }
        })();
        return AE_RENOVANDO;
    }
    return t.access_token;
}

/* POST firmado genérico al gateway /sync (protocolo GOP de openservice).
   Lo usan /auth/token/create (canje) y /auth/token/refresh (renovación):
   en la plataforma nueva NO existe /oauth/token, los tokens se piden
   como APIs firmadas igual que los demás endpoints. */
async function aePostFirmado(metodo, paramsNegocio = {}) {
    const construir = () => {
        const params = {
            method: metodo,
            app_key: AE_KEY,
            timestamp: Date.now(),
            format: 'json',
            v: '2.0',
            sign_method: 'sha256',
            ...paramsNegocio
        };
        delete params.sign;
        params.sign = aeFirmar(params, metodo);
        return params;
    };
    let data = await aePost(construir());
    if (aeEsErrorFirma(data)) {
        const modoPrevio = AE_SIGN_MODE;
        AE_SIGN_MODE = modoPrevio === 'plain' ? 'prepend' : 'plain';
        console.warn(`⚠️ AliExpress rechazó la firma (modo "${modoPrevio}") en ${metodo}. Reintentando con modo "${AE_SIGN_MODE}"...`);
        const data2 = await aePost(construir());
        if (aeEsErrorFirma(data2)) {
            AE_SIGN_MODE = modoPrevio;
            console.error('❌ AliExpress: la firma falló en ambos modos. Revisa ALIEXPRESS_APP_SECRET.');
        }
        return data2;
    }
    return data;
}
// Canjea un code de autorización por tokens y los guarda (API oficial /auth/token/create).
async function aeCanjearCode(code) {
    const d = await aePostFirmado('/auth/token/create', { code: String(code).trim() });
    console.log('🔍 RAW canje:', JSON.stringify(d).slice(0, 800));
    if (d.error_response) {
        const er = d.error_response;
        throw new Error('AliExpress rechazó el code: ' + (er.sub_msg || er.msg || JSON.stringify(er).slice(0, 200)));
    }
    if (d.code !== undefined && String(d.code) !== '0') {
        throw new Error(('AliExpress rechazó el code: ' + (d.msg || '') + ' ' + (d.sub_msg || '')).trim());
    }
    const payload = aeExtraerTokenPayload(d);
    if (!payload || !payload.access_token) {
        throw new Error('Respuesta sin access_token: ' + JSON.stringify(d).slice(0, 300));
    }
    await aeGuardarTokens(payload);
    console.log('✅ Token AliExpress canjeado y guardado');
    return payload;
}
app.post('/api/admin/aliexpress/token/canjear', verificarAdmin, async (req, res) => {
    const { code } = req.body || {};
    if (!code) return res.status(400).json({ success: false, error: 'Falta el code' });
    if (!AE_KEY || !AE_SECRET) return res.status(500).json({ success: false, error: 'Credenciales AliExpress no configuradas' });
    try {
        await aeCanjearCode(code);
        res.json({ success: true, message: 'Token canjeado y guardado. Auto-renovación activa.' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

/* FIX 4a: endpoint de estado que consume el frontend ("Conectar token AliExpress").
   Antes NO existía: el modal se quedaba en "Cargando..." y el botón de autorización estaba muerto. */
app.get('/api/admin/aliexpress/token/estado', verificarAdmin, async (req, res) => {
    if (!AE_KEY || !AE_SECRET) {
        return res.status(500).json({ success: false, error: 'Credenciales AliExpress no configuradas (ALIEXPRESS_APP_KEY / ALIEXPRESS_APP_SECRET)' });
    }
    try {
        const t = await aeLeerTokens();
        const autoRenovacion = !!(t?.refresh_token && (t.refresh_expira || 0) > Date.now());
        res.json({
            success: true,
            hayTokenFirestore: !!t?.access_token,
            hayTokenEnv: !!AE_TOKEN,
            diasDesde: t?.emitido ? Math.floor((Date.now() - t.emitido) / 86400000) : null,
            accessExpiraEnHoras: t?.access_expira ? Math.max(0, Math.floor((t.access_expira - Date.now()) / 3600000)) : null,
            autoRenovacion,
            necesitaReautorizar: !!t && !autoRenovacion && (t.access_expira || 0) <= Date.now(),
            autorizarUrl: AE_AUTORIZAR_URL,
            redirectUri: AE_REDIRECT_URI
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

/* FIX 4b: Callback OAuth de AliExpress.
   La consola de autorización redirige aquí tras el login: ?code=XXXX
   El code expira en 30 minutos, así que se canjea inmediatamente y se guardan los
   tokens (sin requerir sesión admin: es un redirect del navegador de AliExpress). */
app.get('/api/aliexpress/callback', async (req, res) => {
    const { code, error, error_description } = req.query;
    if (error) return res.status(400).send(`❌ Error de autorización AliExpress: ${error_description || error}`);
    if (!code) return res.status(400).send('Falta el parámetro code');
    if (!AE_KEY || !AE_SECRET) return res.status(500).send('Credenciales AliExpress no configuradas en el servidor');
    try {
        await aeCanjearCode(code);
        res.send('<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Bonü · AliExpress</title></head><body style="font-family:sans-serif;text-align:center;padding:3rem;"><h1>✅ AliExpress conectado</h1><p>Token canjeado y guardado con auto-renovación. Ya puedes cerrar esta ventana y volver al panel de Bonü.</p></body></html>');
    } catch (e) {
        console.error('❌ Error canjeando code en callback AliExpress:', e.message);
        res.status(500).send('❌ Error canjeando el token: ' + e.message);
    }
});

app.get('/api/admin/aliexpress/producto', verificarAdmin, async (req, res) => {
    if (!AE_KEY || !AE_SECRET) {
        return res.status(500).json({ success: false, error: 'Credenciales AliExpress no configuradas en el servidor' });
    }
    const tokenDisponible = await aeTokenFresco();
    if (!tokenDisponible) {
        return res.status(500).json({ success: false, error: 'No hay token de AliExpress. Autoriza la app y canjea el code primero.' });
    }
    const raw = req.query.id || '';
    if (!raw) return res.status(400).json({ success: false, error: 'Falta id o URL del producto' });
    const productId = extraerIdAliexpress(raw);
    if (!productId) return res.status(400).json({ success: false, error: 'No pude extraer el ID del producto de: ' + raw });

    /* Busca una clave a CUALQUIER profundidad del objeto. La respuesta real de
       aliexpress.ds.product.get cambia de forma según versión/región: a veces
       anida todo en result.item y a veces los DTOs cuelgan directo de result.
       Esto hace el mapeo inmune a esas diferencias (v9). */
    const buscar = (obj, clave, prof = 0) => {
        if (!obj || typeof obj !== 'object' || prof > 8) return undefined;
        if (obj[clave] !== undefined) return obj[clave];
        for (const k of Object.keys(obj)) {
            const v = obj[k];
            if (v && typeof v === 'object') {
                const hallado = buscar(v, clave, prof + 1);
                if (hallado !== undefined) return hallado;
            }
        }
        return undefined;
    };

    try {
        const data = await aeLlamar('aliexpress.ds.product.get', {
            product_id: productId,
            ship_to_country: 'MX',
            target_currency: 'MXN',
            target_language: 'es'
        });
        console.log('🔍 RAW AliExpress:', JSON.stringify(data).slice(0, 1500));
        if (data.error_response) {
            const er = data.error_response;
            return res.status(400).json({
                success: false,
                error: `AliExpress gateway: ${er.msg || 'error'} ${er.sub_msg || ''}`,
                codigo: er.code
            });
        }
        const r = data?.aliexpress_ds_product_get_response || {};
        if (r.error_response) {
            return res.status(400).json({
                success: false,
                error: `AliExpress: ${r.error_response.msg || 'error'} ${r.error_response.sub_msg || ''}`,
                codigo: r.error_response.code
            });
        }
        const result = r.result || {};
        if (!result || typeof result !== 'object' || Object.keys(result).length === 0) {
            return res.status(400).json({
                success: false,
                error: `AliExpress no devolvió datos del producto ${productId} (código ${result.error_code || '?'}).`,
                raw: JSON.stringify(data).slice(0, 2000)
            });
        }

        /* ---------- MAPEO ANTIFRÁGIL v9 (basado en la respuesta REAL) ---------- */

        // 1) Nombre e imágenes base (ae_item_base_info_dto, donde sea que esté)
        const base = buscar(result, 'ae_item_base_info_dto') || {};
        let nombre = base.subject || buscar(result, 'subject') || '';

        let imagenes = [];
        const urlsImg = base.image_urls ?? buscar(result, 'image_urls');
        if (Array.isArray(urlsImg)) imagenes = urlsImg.filter(Boolean);
        else if (typeof urlsImg === 'string') imagenes = urlsImg.split(';').filter(Boolean);

        // 2) Galería (ae_media_dtos) por si base.image_urls viene vacío
        if (!imagenes.length) {
            const media = buscar(result, 'ae_media_dtos');
            const lista = media?.ae_media_v_o || media?.medias || [];
            for (const m of (Array.isArray(lista) ? lista : [])) {
                if (m.media_url) imagenes.push(m.media_url);
            }
        }

        // 3) SKUs / variantes — clave confirmada en la respuesta real
        const skuDtos = buscar(result, 'ae_item_sku_info_dtos');
        let skus = [];
        if (skuDtos) {
            skus = Array.isArray(skuDtos.ae_item_sku_info_d_t_o) ? skuDtos.ae_item_sku_info_d_t_o
                 : Array.isArray(skuDtos.ae_item_sku_info_dto) ? skuDtos.ae_item_sku_info_dto
                 : Array.isArray(skuDtos) ? skuDtos : [];
        }

        // 4) Precio: el menor entre variantes CON stock; si ninguna tiene, el menor global.
        //    Campos reales: offer_sale_price (con descuento) y sku_price (lista).
        const precioDe = s => {
            const p = parseFloat(s.target_sale_price ?? s.offer_sale_price ?? s.sku_price ?? s.sale_price);
            return Number.isNaN(p) ? 0 : p;
        };
        const stockDe = s => parseInt(s.sku_available_stock ?? s.total_available_quantity ?? s.available_quantity ?? 0, 10) || 0;
        const conStock = skus.filter(s => stockDe(s) > 0);
        const fuente = conStock.length ? conStock : skus;
        let precio = 0, moneda = 'MXN';
        for (const s of fuente) {
            const p = precioDe(s);
            if (p > 0 && (precio === 0 || p < precio)) {
                precio = p;
                moneda = s.target_sale_price_currency || s.currency_code || moneda;
            }
        }

        // 5) Stock total: suma de sku_available_stock de todas las variantes
        let stock = null;
        const cantidades = skus.map(s => stockDe(s)).filter(n => !Number.isNaN(n));
        if (cantidades.length) stock = cantidades.reduce((a, b) => a + b, 0);

        // 6) Último recurso para imágenes: las fotos de las variantes (sku_image)
        if (!imagenes.length) {
            for (const s of skus) {
                const props = s.ae_sku_property_dtos?.ae_sku_property_d_t_o
                           || s.ae_sku_property_dtos?.ae_sku_property_d_t_o_s || [];
                for (const pr of (Array.isArray(props) ? props : [])) {
                    if (pr.sku_image && !imagenes.includes(pr.sku_image)) imagenes.push(pr.sku_image);
                }
            }
        }

        // 7) Variantes legibles (color/talla + precio + stock + foto) para uso futuro
        const variantes = skus.map(s => {
            const props = s.ae_sku_property_dtos?.ae_sku_property_d_t_o || [];
            const atributos = (Array.isArray(props) ? props : [])
                .map(pr => `${pr.sku_property_name || ''}: ${pr.sku_property_value || pr.property_value_definition_name || ''}`.trim())
                .filter(Boolean);
            return {
                atributos,
                precio: precioDe(s),
                moneda: s.target_sale_price_currency || s.currency_code || 'MXN',
                stock: stockDe(s),
                imagen: (Array.isArray(props) ? props : [])[0]?.sku_image || ''
            };
        });

        // 8) Descripción (si viene; la API a veces la sirve aparte)
        const descripcion = base.detail || buscar(result, 'detail') || '';

        // 9) Guarda: si a pesar de todo no hay nada útil, error honesto
        if (!nombre && !skus.length && !imagenes.length) {
            return res.status(400).json({
                success: false,
                error: 'AliExpress respondió pero sin datos útiles (posible producto restringido o no autorizado).',
                raw: JSON.stringify(data).slice(0, 1500)
            });
        }
        if (!nombre) nombre = 'Producto AliExpress ' + productId;

        // 10) SAGA 4: precio de venta sugerido automático (margen + cashback configurados)
        await cargarConfigPrecios();
        const sugerido = calcularPrecioVenta({ costo: precio, margen: configPrecios.margenDefault, cashback: configPrecios.cashbackDefault });
        const tablaMargenes = tablaPreciosPorMargen({ costo: precio, cashback: configPrecios.cashbackDefault });

        res.json({
            success: true,
            data: { id: productId, nombre, precio, moneda, imagenes, descripcion, stock, variantes },
            preciosSugeridos: {
                margenUsado: configPrecios.margenDefault,
                cashbackUsado: configPrecios.cashbackDefault,
                descMayoreo6: configPrecios.descMayoreo6,
                precioUnitario: sugerido.precioFinal,
                precio6: sugerido.precio6,
                gananciaRealPorPieza: sugerido.gananciaRealPorPieza,
                tablaMargenes
            }
        });
    } catch (error) {
        console.error('❌ Error AliExpress:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

/* ============================================================
   ========== SAGA 4 · RUTAS DE PRECIOS AUTOMÁTICOS ============
   ============================================================ */

// Configuración de precios (margen por defecto, cashback por defecto, desc. mayoreo)
app.get('/api/admin/precios/config', verificarAdmin, async (req, res) => {
    await cargarConfigPrecios();
    res.json({
        success: true,
        config: { ...configPrecios },
        listaMargenes: LISTA_MARGENES,
        listaCashback: LISTA_CASHBACK,
        reglas: {
            cashbackBase: CASHBACK_BASE,
            umbral10: UMBRAL_CASHBACK_10,
            piezasMin10: QTY_MIN_CASHBACK_10,
            umbral15: UMBRAL_CASHBACK_15,
            maxProducto: CASHBACK_MAX_PRODUCTO
        }
    });
});

app.put('/api/admin/precios/config', verificarAdmin, async (req, res) => {
    if (!firestore) return res.status(500).json({ success: false, error: 'Firestore no disponible' });
    const { margenDefault, cashbackDefault, descMayoreo6 } = req.body || {};
    await cargarConfigPrecios();
    if (margenDefault !== undefined && !LISTA_MARGENES.includes(Number(margenDefault)))
        return res.status(400).json({ success: false, error: `margenDefault debe ser uno de: ${LISTA_MARGENES.join(', ')}` });
    if (cashbackDefault !== undefined && !LISTA_CASHBACK.includes(Number(cashbackDefault)))
        return res.status(400).json({ success: false, error: `cashbackDefault debe ser uno de: ${LISTA_CASHBACK.join(', ')}` });
    if (descMayoreo6 !== undefined) {
        const d = Number(descMayoreo6);
        if (!Number.isFinite(d) || d < 0 || d > 50) return res.status(400).json({ success: false, error: 'descMayoreo6 debe estar entre 0 y 50' });
    }
    const nueva = {
        margenDefault: margenDefault !== undefined ? Number(margenDefault) : configPrecios.margenDefault,
        cashbackDefault: cashbackDefault !== undefined ? Number(cashbackDefault) : configPrecios.cashbackDefault,
        descMayoreo6: descMayoreo6 !== undefined ? Number(descMayoreo6) : configPrecios.descMayoreo6
    };
    try {
        await firestore.collection('config').doc('precios').set(nueva, { merge: true });
        configPrecios = nueva;
        console.log(`💰 Config de precios actualizada: margen ${nueva.margenDefault}% · cashback ${nueva.cashbackDefault}% · mayoreo ${nueva.descMayoreo6}%`);
        res.json({ success: true, config: nueva });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Calculadora: costo + margen + cashback → precio de venta sugerido (con tabla comparativa)
app.post('/api/admin/precios/calcular', verificarAdmin, async (req, res) => {
    await cargarConfigPrecios();
    const { costo, envio = 0, margen, cashback, descMayoreo6, conTabla = true } = req.body || {};
    const c = parseFloat(costo);
    if (!Number.isFinite(c) || c <= 0) return res.status(400).json({ success: false, error: 'Envía "costo" mayor a 0' });
    const resultado = calcularPrecioVenta({
        costo: c,
        envio: parseFloat(envio) || 0,
        margen: margen !== undefined ? margen : configPrecios.margenDefault,
        cashback: cashback !== undefined ? cashback : configPrecios.cashbackDefault,
        descMayoreo6: descMayoreo6 !== undefined ? descMayoreo6 : null
    });
    res.json({
        success: true,
        calculo: resultado,
        tabla: conTabla ? tablaPreciosPorMargen({ costo: c, envio: parseFloat(envio) || 0, cashback: resultado.cashback, descMayoreo6: resultado.descMayoreo6 }) : undefined
    });
});

// Recálculo masivo: aplica el margen a los precios de venta de productos existentes
// (usa el campo precioProveedor de cada producto como costo)
app.post('/api/admin/precios/aplicar-masivo', verificarAdmin, async (req, res) => {
    if (!firestore) return res.status(500).json({ success: false, error: 'Firestore no disponible' });
    const { ids, margen, cashback, descMayoreo6 } = req.body || {};
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ success: false, error: 'Envía "ids": [lista de ids de productos]' });
    await cargarConfigPrecios();
    const m = margen !== undefined ? Number(margen) : configPrecios.margenDefault;
    if (!LISTA_MARGENES.includes(m)) return res.status(400).json({ success: false, error: `margen debe ser uno de: ${LISTA_MARGENES.join(', ')}` });
    const cb = cashback !== undefined ? Number(cashback) : configPrecios.cashbackDefault;
    if (!LISTA_CASHBACK.includes(cb)) return res.status(400).json({ success: false, error: `cashback debe ser uno de: ${LISTA_CASHBACK.join(', ')}` });
    const resultados = [];
    for (const id of ids.slice(0, 200)) {
        try {
            const ref = firestore.collection('productos').doc(String(id));
            const docProd = await ref.get();
            if (!docProd.exists) { resultados.push({ id, ok: false, error: 'No existe' }); continue; }
            const prod = docProd.data();
            const costo = parseFloat(prod.precioProveedor);
            if (!Number.isFinite(costo) || costo <= 0) { resultados.push({ id, ok: false, error: 'Sin precioProveedor válido' }); continue; }
            const r = calcularPrecioVenta({ costo, margen: m, cashback: cb, descMayoreo6: descMayoreo6 !== undefined ? descMayoreo6 : null });
            await ref.update({
                precioFinal: r.precioFinal,
                precio6: r.precio6,
                margen: m,
                cashbackPromo: cb,
                precioCalculado: true,
                fechaRecalculo: new Date().toISOString()
            });
            resultados.push({ id, ok: true, costo, precioFinal: r.precioFinal, precio6: r.precio6, gananciaRealPorPieza: r.gananciaRealPorPieza });
        } catch (e) {
            resultados.push({ id, ok: false, error: e.message });
        }
    }
    const ok = resultados.filter(r => r.ok).length;
    console.log(`💰 Recálculo masivo: ${ok}/${resultados.length} productos (margen ${m}% · cashback ${cb}%)`);
    try {
        await firestore.collection('auditoria').add({
            fecha: new Date().toISOString(),
            admin: req.user?.email || 'Sistema',
            accion: 'Recálculo de precios',
            detalle: `Margen ${m}% · cashback ${cb}% · ${ok} productos actualizados`,
            ip: req.ip
        });
    } catch (_) { /* la auditoría no debe romper la respuesta */ }
    res.json({ success: true, margen: m, cashback: cb, actualizados: ok, fallidos: resultados.length - ok, resultados });
});

/* ========== EMAIL DE CAMPAÑAS (consumido por el panel admin del frontend) ========== */
// FIX: este endpoint no existía y el botón "enviar campaña" del frontend siempre fallaba con 404.
app.post('/api/admin/send-email', verificarAdmin, async (req, res) => {
    const { to, subject, body, imageUrl } = req.body || {};
    if (!to || !subject || !body) {
        return res.status(400).json({ success: false, error: 'Faltan to, subject o body' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(to))) {
        return res.status(400).json({ success: false, error: 'Email destinatario inválido' });
    }
    if (!emailTransporter) {
        return res.status(500).json({ success: false, error: 'Email no configurado en el servidor (EMAIL_USER / EMAIL_PASS)' });
    }
    const imgHtml = imageUrl
        ? `<img src="${String(imageUrl).replace(/"/g, '&quot;')}" alt="Bonü" style="max-width:100%;border-radius:12px;display:block;margin:0 auto 16px;">`
        : '';
    const html = `<!DOCTYPE html><html lang="es"><body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,sans-serif;">
        <div style="max-width:600px;margin:0 auto;padding:24px;background:#ffffff;border-radius:16px;">
            <div style="text-align:center;padding-bottom:16px;border-bottom:2px solid #facc15;">
                <span style="font-size:28px;font-weight:800;color:#0a0a0a;">Bon<span style="color:#facc15;">ü</span></span>
                <div style="font-size:12px;color:#6b7280;">Global Marketplace</div>
            </div>
            ${imgHtml}
            <div style="font-size:15px;color:#111827;line-height:1.6;">${String(body)}</div>
            <div style="margin-top:24px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:11px;color:#6b7280;text-align:center;">
                📧 bonu.marketplace@gmail.com &nbsp;|&nbsp; 📞 322 270 0732 &nbsp;|&nbsp; RFC: CAGJ791031159<br>
                © 2007-${new Date().getFullYear()} Bonü - Todos los derechos reservados
            </div>
        </div></body></html>`;
    try {
        await Promise.race([
            emailTransporter.sendMail({
                from: `"Bonü Marketplace" <${process.env.EMAIL_USER}>`,
                to: String(to),
                subject: String(subject).slice(0, 200),
                html
            }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Email timeout')), 15000))
        ]);
        console.log(`📧 Campaña/envío admin enviado a ${to}`);
        res.json({ success: true, message: 'Correo enviado a ' + to });
    } catch (e) {
        console.error('❌ Error send-email:', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

/* ========== WEBSOCKET ========== */
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: allowedOrigins,
        methods: ['GET', 'POST'],
        credentials: true
    },
    transports: ['websocket', 'polling']
});

io.use(async (socket, next) => {
    const token = socket.handshake.auth.token;
    
    if (!token) {
        return next(new Error('Token requerido'));
    }
    
    try {
        const decoded = await admin.auth().verifyIdToken(token);
        socket.userId = decoded.uid;
        socket.email = decoded.email;
        
        let esAdmin = decoded.admin === true;
        if (!esAdmin && firestore) {
            const adminDoc = await firestore.collection('admins').doc(decoded.uid).get();
            esAdmin = adminDoc.exists;
        }
        
        socket.isAdmin = esAdmin;
        next();
    } catch (error) {
        console.error('❌ Error en autenticación WebSocket:', error.message);
        next(new Error('Token inválido'));
    }
});

io.on('connection', (socket) => {
    console.log(`🔌 Cliente conectado: ${socket.id} - ${socket.email || 'anonimo'}`);
    
    if (socket.isAdmin) {
        socket.join('admin-room');
        console.log(`👑 Admin ${socket.email} unido a admin-room`);
    }
    
    if (socket.userId) {
        socket.join(`user-${socket.userId}`);
    }
    
    socket.on('ping', () => {
        socket.emit('pong', { timestamp: Date.now() });
    });
    
    socket.on('disconnect', () => {
        console.log(`🔌 Cliente desconectado: ${socket.id}`);
    });
});

function emitNewOrder(orderData) {
    io.to('admin-room').emit('new-order', {
        orderId: orderData.id || orderData.orderId,
        customer: orderData.usuario || orderData.customerName || 'Cliente',
        total: orderData.total || 0,
        timestamp: new Date().toISOString()
    });
    console.log(`📦 Notificación de nueva orden enviada: ${orderData.id || orderData.orderId}`);
}

function emitPaymentFailed(orderData) {
    io.to('admin-room').emit('payment-failed', {
        orderId: orderData.id || orderData.orderId,
        customer: orderData.usuario || orderData.customerName || 'Cliente',
        amount: orderData.total || 0,
        timestamp: new Date().toISOString()
    });
    console.log(`⚠️ Notificación de pago fallido enviada: ${orderData.id || orderData.orderId}`);
}

function emitLowStock(productData) {
    io.to('admin-room').emit('low-stock-alert', {
        productId: productData.id,
        productName: productData.nombre,
        currentStock: productData.stock || 0,
        threshold: 5,
        timestamp: new Date().toISOString()
    });
    console.log(`⚠️ Alerta de stock bajo enviada: ${productData.nombre}`);
}

function emitNewVendor(vendorData) {
    io.to('admin-room').emit('new-vendor', {
        vendorId: vendorData.id,
        name: vendorData.nombre,
        email: vendorData.email,
        timestamp: new Date().toISOString()
    });
    console.log(`📢 Notificación de nuevo vendedor: ${vendorData.nombre}`);
}

/* ========== MANEJO DE ERRORES ========== */
app.use((req, res) => res.status(404).json({ error: 'Endpoint no encontrado' }));

app.use((err, req, res, next) => {
    console.error('❌ Error:', err.stack);
    res.status(500).json({ 
        success: false, 
        error: NODE_ENV === 'production' ? 'Error interno del servidor' : err.message 
    });
});

/* ========== ARRANQUE ========== */
server.listen(PORT, '0.0.0.0', () => {
    console.log('==================================================');
    console.log('✅ Bonü Backend v8.1 - PRODUCCIÓN COMPLETA (AliExpress FIX aplicado)');
    console.log(`📡 Puerto: ${PORT}`);
    console.log(`🌍 Entorno: ${NODE_ENV}`);
    console.log(`🔥 Firestore: ${firestore ? '✅ CONECTADO' : '❌ NO DISPONIBLE'}`);
    console.log(`📧 Email: ${emailConfigurado ? '✅' : '⚠️'}`);
    console.log(`💳 Stripe: ${stripe ? '✅' : '❌'}`);
    console.log(`💳 Mercado Pago: ${MERCADO_PAGO_ACCESS_TOKEN ? '✅' : '❌'}`);
    console.log(`💳 BonuPay: ${BONUPAY_ACCESS_TOKEN ? '✅' : '⚠️ Usando MP'}`);
    console.log(`💳 PayPal: ${PAYPAL_CLIENT_ID ? '✅' : '❌'}`);
    console.log(`📦 CJ: ${CJ_API_KEY ? '✅' : '❌'}`);
    console.log(`🌐 AliExpress: ${AE_KEY ? '✅' : '❌'}`);
    console.log(`📺 TVCmall: ${TVCMALL_API_KEY ? '✅' : '❌'}`);
    console.log(`☀️ SunSky: ${SUNSKY_API_KEY ? '✅' : '❌'}`);
    console.log('==================================================');
    console.log('📄 NOTA DE COMPRA PROFESIONAL ACTIVADA');
    console.log('🔌 WEBSOCKET ACTIVADO - Notificaciones en tiempo real');
    console.log('📊 DASHBOARD COMPLETO - Analytics y reportes');
    console.log('📋 AUDITORÍA - Log de actividades');
    console.log('💰 FINANZAS - Balance y reportes fiscales');
    console.log(`🏢 Bonü Marketplace - RFC: CAGJ791031159`);
    console.log(`📧 bonu.marketplace@gmail.com | 📞 322 270 0732`);
    console.log('==================================================');
    iniciarAutoreparador();
});

process.on('SIGTERM', () => {
    console.log('🛑 SIGTERM recibido. Cerrando servidor...');
    server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
    console.log('🛑 SIGINT recibido. Cerrando servidor...');
    server.close(() => process.exit(0));
});

/* ========== [AUTOREPARADOR BONU 2026-11-13] inicio — anti-sleep + blindaje de proceso ==========
 * Problema diagnosticado 2026-11-13: Render FREE duerme el servicio tras ~15 min sin tráfico
 * y al despertar tarda 23-60 s (cold start). El cliente percibe que "la página se cae".
 * Solución en 2 capas:
 *  1) Auto-ping cada KEEP_ALIVE_MIN minutos a /api/status -> el servicio NUNCA se duerme.
 *  2) uncaughtException / unhandledRejection capturados -> un error ya no mata el proceso
 *     (si el proceso muere, Render lo reinicia dormido y vuelve el cold start).
 * Config opcional en Render: KEEP_ALIVE_URL (url propia) y KEEP_ALIVE_MIN (min 5).
 */
const AUTOREPARADOR = {
    url: (process.env.KEEP_ALIVE_URL || process.env.RENDER_EXTERNAL_URL || 'https://bonu-backend.onrender.com').replace(/\/+$/, ''),
    minutos: Math.max(5, parseInt(process.env.KEEP_ALIVE_MIN || '10', 10) || 10),
    timer: null,
    fallos: 0,
    exito: 0
};

function autoreparadorPing() {
    const t0 = Date.now();
    const reportar = (ok, detalle) => {
        if (ok) {
            AUTOREPARADOR.fallos = 0;
            AUTOREPARADOR.exito++;
            console.log(`[AUTOREPARADOR] ping OK en ${Date.now() - t0}ms (total #${AUTOREPARADOR.exito})`);
        } else {
            AUTOREPARADOR.fallos++;
            console.log(`[AUTOREPARADOR] ping FALLA #${AUTOREPARADOR.fallos}: ${detalle}`);
        }
    };
    try {
        if (typeof fetch === 'function') {
            fetch(`${AUTOREPARADOR.url}/api/status`, { method: 'GET' })
                .then(r => reportar(!!(r && r.status === 200), `HTTP ${r ? r.status : 'sin respuesta'}`))
                .catch(e => reportar(false, e && e.message ? e.message : 'error de red'));
        } else {
            const req = https.get(`${AUTOREPARADOR.url}/api/status`, (res) => {
                res.resume();
                reportar(res.statusCode === 200, `HTTP ${res.statusCode}`);
            });
            req.on('error', (e) => reportar(false, e.message));
            req.setTimeout(30000, () => req.destroy(new Error('timeout 30s')));
        }
    } catch (e) {
        reportar(false, e.message);
    }
}

function iniciarAutoreparador() {
    if (AUTOREPARADOR.timer) return;
    console.log(`[AUTOREPARADOR] ACTIVO - auto-ping cada ${AUTOREPARADOR.minutos} min a ${AUTOREPARADOR.url}/api/status (evita el sueño de Render y los cold starts)`);
    autoreparadorPing();
    AUTOREPARADOR.timer = setInterval(autoreparadorPing, AUTOREPARADOR.minutos * 60 * 1000);
}

process.on('uncaughtException', (err) => {
    console.error('[AUTOREPARADOR] uncaughtException capturado - el servidor SIGUE VIVO:', err && err.stack ? err.stack : err);
});
process.on('unhandledRejection', (reason) => {
    console.error('[AUTOREPARADOR] unhandledRejection capturado - el servidor SIGUE VIVO:', reason && reason.stack ? reason.stack : reason);
});
/* ========== [AUTOREPARADOR BONU 2026-11-13] fin ========== */

module.exports = { app, io, emitNewOrder, emitPaymentFailed, emitLowStock, emitNewVendor };
