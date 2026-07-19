// index.js - Bonü Backend v8.0 PRODUCCIÓN COMPLETA (Checkout API + Dashboard + WebSocket + Auditoría + Reportes)
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const http = require('http');
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
                ${iva > 0 ? `<div class="row"><span class="row-label">IVA (16%):</span><span class="row-value">${formatCurrency(iva)}</span></div>` : ''}
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
            <div class="legal">
                <strong>⚠️ IMPORTANTE:</strong> Este documento es una <strong>NOTA DE COMPRA</strong> y <strong>NO tiene validez fiscal</strong>.<br>
                Para efectos fiscales, este comprobante no es un CFDI. Si requieres factura con validez fiscal, por favor contáctanos.
            </div>
            <div style="background:#f0fdf4;border-radius:8px;padding:14px 16px;margin:16px 0;border:1px solid #bbf7d0;">
                <p style="font-size:14px;color:#166534;font-weight:500;margin-bottom:4px;">📧 ¿Necesitas factura con validez fiscal?</p>
                <p style="font-size:13px;color:#4a4a4a;">Escríbenos a <strong>bonu.marketplace@gmail.com</strong> o llama al <strong>322 270 0732</strong> y te enviaremos tu factura CFDI.</p>
            </div>
            <div style="text-align:center;padding:8px 0 4px 0;border-top:1px solid #f3f4f6;margin-top:8px;">
                <p style="font-size:16px;font-weight:600;color:#1f2937;">¡Gracias por confiar en Bonü! ❤️</p>
                <p style="font-size:13px;color:#6b7280;">Tu compra está en proceso. Recibirás actualizaciones por correo.</p>
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
    
    const subject = `📄 Nota de Compra #${orderId} - Bonü Marketplace`;
    
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

/* ========== VARIABLES DE ENTORNO ========== */
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const MERCADO_PAGO_ACCESS_TOKEN = process.env.MERCADO_PAGO_ACCESS_TOKEN;
const BONUPAY_ACCESS_TOKEN = process.env.BONUPAY_ACCESS_TOKEN;
const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET;
const PAYPAL_MODE = process.env.PAYPAL_MODE || 'live';
const CJ_API_KEY = process.env.CJ_API_KEY;
const CJ_API_URL = 'https://developers.cjdropshipping.com/api2.0/v1';
const TVCMALL_API_URL = process.env.TVCMALL_API_URL || 'https://api.tvcmall.com/v1';
const TVCMALL_API_KEY = process.env.TVCMALL_API_KEY;
const TVCMALL_API_SECRET = process.env.TVCMALL_API_SECRET;
const SUNSKY_API_URL = process.env.SUNSKY_API_URL || 'https://api.sunsky-online.com';
const SUNSKY_API_KEY = process.env.SUNSKY_API_KEY;
const SUNSKY_API_SECRET = process.env.SUNSKY_API_SECRET;

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
            statement_descriptor: 'Bonu Marketplace',
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
                identification: {
                    type: 'DNI',
                    number: '12345678'
                }
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
                'X-Idempotency-Key': `${checkoutToken}-${Date.now()}`
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
                identification: {
                    type: 'DNI',
                    number: '12345678'
                }
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
                'X-Idempotency-Key': `${checkoutToken}-${Date.now()}`
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
            precioProveedor: parseFloat(prod.precioProveedor) || precioReal
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
    const iva = (subtotal - descuento) * 0.16;
    const total = Math.round((subtotal - descuento - cashbackUsar + envio + iva) * 100) / 100;
    
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
        const cashbackGanado = data.total * 0.05;
        
        batch.update(userRef, {
            cashbackBalance: admin.firestore.FieldValue.increment(
                -(data.cashbackUsar || 0) + cashbackGanado
            ),
            cashbackHistory: admin.firestore.FieldValue.arrayUnion({
                amount: cashbackGanado,
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

app.get('/api/status', (req, res) => res.json({
    success: true,
    firestore: !!firestore,
    email: emailConfigurado,
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
    paypalMode: PAYPAL_MODE
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
        
        const snapshot = await query.orderBy('fechaAgregado', 'desc').limit(parseInt(limit)).get();
        let productos = [];
        
        snapshot.forEach(doc => productos.push({ id: doc.id, ...doc.data() }));
        
        if (search?.trim()) {
            const s = search.toLowerCase();
            productos = productos.filter(p =>
                p.nombre?.toLowerCase().includes(s) ||
                p.categoria?.toLowerCase().includes(s) ||
                p.descripcion?.toLowerCase().includes(s)
            );
        }
        
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
        
        res.json({ 
            success: true, 
            producto: { id: productDoc.id, ...productDoc.data() } 
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

app.get('/api/cj/product/:sku', async (req, res) => {
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
            rating: 4.5,
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

app.get('/api/tvcmall/product/:sku', async (req, res) => {
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
            stock: product.stock || 100,
            tipo: tipo || 'Ofertas',
            rating: 4.5,
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

app.get('/api/sunsky/product/:sku', async (req, res) => {
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
            stock: product.stock || 100,
            tipo: tipo || 'Ofertas',
            rating: 4.5,
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
app.post('/api/tracking/visita', async (req, res) => {
    const { pagina = '/', origen = 'directo', dispositivo = 'desktop' } = req.body;
    
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
            const method = o.pasarela || 'Desconocido';
            paymentMethods[method] = (paymentMethods[method] || 0) + 1;
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
            const mesKey = `${fecha.getFullYear()}-${String(fecha.getMonth()+1).padStart(2,'0')}`;
            if (!ventasPorMes[mesKey]) ventasPorMes[mesKey] = 0;
            ventasPorMes[mesKey] += o.total || 0;
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
                const totalIva = pedidos.reduce((s, o) => s + ((o.total || 0) * 0.16), 0);
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
    console.log('✅ Bonü Backend v8.0 - PRODUCCIÓN COMPLETA');
    console.log(`📡 Puerto: ${PORT}`);
    console.log(`🌍 Entorno: ${NODE_ENV}`);
    console.log(`🔥 Firestore: ${firestore ? '✅ CONECTADO' : '❌ NO DISPONIBLE'}`);
    console.log(`📧 Email: ${emailConfigurado ? '✅' : '⚠️'}`);
    console.log(`💳 Stripe: ${stripe ? '✅' : '❌'}`);
    console.log(`💳 Mercado Pago: ${MERCADO_PAGO_ACCESS_TOKEN ? '✅' : '❌'}`);
    console.log(`💳 BonuPay: ${BONUPAY_ACCESS_TOKEN ? '✅' : '⚠️ Usando MP'}`);
    console.log(`💳 PayPal: ${PAYPAL_CLIENT_ID ? '✅' : '❌'}`);
    console.log(`📦 CJ: ${CJ_API_KEY ? '✅' : '❌'}`);
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
});

process.on('SIGTERM', () => {
    console.log('🛑 SIGTERM recibido. Cerrando servidor...');
    server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
    console.log('🛑 SIGINT recibido. Cerrando servidor...');
    server.close(() => process.exit(0));
});

module.exports = { app, io, emitNewOrder, emitPaymentFailed, emitLowStock, emitNewVendor };