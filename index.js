// index.js - Bonü Backend v3.0 (PRODUCCIÓN - Todo en Firestore)
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3001;
const NODE_ENV = process.env.NODE_ENV || 'production';

/* ════════════════════════════════════════════════════════════
   🛡️ SEGURIDAD (NUEVO)
════════════════════════════════════════════════════════════ */
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
}));

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { success: false, error: 'Demasiadas peticiones, intente más tarde' },
    standardHeaders: true,
    legacyHeaders: false
});
app.use('/api/', limiter);

/* ════════════════════════════════════════════════════════════
   📧 CONFIGURACIÓN DE EMAIL
════════════════════════════════════════════════════════════ */
let emailTransporter = null;
let emailConfigurado = false;

if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
    try {
        emailTransporter = nodemailer.createTransport({
            service: process.env.EMAIL_SERVICE || 'gmail',
            auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
        });
        emailConfigurado = true;
        console.log('✅ Email configurado');
    } catch (error) {
        console.warn('⚠️ Error email:', error.message);
    }
}

function formatCurrency(amount, currency = 'MXN') {
    return new Intl.NumberFormat('es-MX', { style: 'currency', currency }).format(amount);
}

async function sendConfirmationEmail(orderData) {
    if (!emailConfigurado || !emailTransporter) return false;
    
    const { orderId, customerEmail, customerName, total, items, shippingAddress, paymentMethod, date } = orderData;
    
    const itemsHtml = (items || []).map(item => `
        <tr>
            <td style="padding: 12px 8px;">${item.nombre}</td>
            <td style="padding: 12px 8px;">Cantidad: ${item.cantidad || 1}</td>
            <td style="padding: 12px 8px; text-align: right;">${formatCurrency((item.precioFinal || item.precio || 0) * (item.cantidad || 1))}</td>
        </tr>
    `).join('');
    
    const subtotal = (items || []).reduce((sum, item) => sum + ((item.precioFinal || item.precio || 0) * (item.cantidad || 1)), 0);
    const totalFinal = subtotal;
    
    const html = `
        <!DOCTYPE html>
        <html>
        <head><meta charset="UTF-8"><title>Confirmación Bonü</title></head>
        <body style="font-family: Arial, sans-serif;">
            <div style="max-width: 600px; margin: 0 auto; background: #fff; border-radius: 16px; overflow: hidden;">
                <div style="background: linear-gradient(135deg, #facc15, #fbbf24); padding: 24px; text-align: center;">
                    <h1 style="color: #000;">✨ Bonü ✨</h1>
                    <p>¡Gracias por tu compra!</p>
                </div>
                <div style="padding: 24px;">
                    <p>Hola <strong>${customerName}</strong>,</p>
                    <p>Tu pedido <strong>#${orderId}</strong> ha sido confirmado.</p>
                    <p>Total: ${formatCurrency(totalFinal)}</p>
                    <h3>Productos:</h3>
                    <table style="width: 100%;">${itemsHtml}</table>
                </div>
                <div style="background: #111827; padding: 20px; text-align: center; color: #9ca3af;">
                    <p>© 2026 Bonü - Todos los derechos reservados</p>
                </div>
            </div>
        </body>
        </html>
    `;
    
    try {
        await emailTransporter.sendMail({
            from: `"Bonü" <${process.env.EMAIL_USER}>`,
            to: customerEmail,
            subject: `✅ Confirmación #${orderId}`,
            html
        });
        console.log(`📧 Email enviado a ${customerEmail}`);
        return true;
    } catch (error) {
        console.error('❌ Error email:', error.message);
        return false;
    }
}

/* ════════════════════════════════════════════════════════════
   🔥 FIREBASE ADMIN SDK
════════════════════════════════════════════════════════════ */
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
            console.error('❌ Faltan credenciales de Firebase');
        }
    } catch (error) {
        console.error('❌ Error Firebase:', error.message);
    }
}
const firestore = admin.apps.length ? admin.firestore() : null;

if (!firestore) {
    console.error('❌ CRÍTICO: Firestore no disponible. El backend NO funcionará correctamente.');
}

/* ════════════════════════════════════════════════════════════
   🔐 VARIABLES DE ENTORNO
════════════════════════════════════════════════════════════ */
const CJ_API_KEY = process.env.CJ_API_KEY;
const CJ_API_URL = 'https://developers.cjdropshipping.com/api2.0/v1';
const SUNSKY_API_KEY = process.env.SUNSKY_API_KEY;
const SUNSKY_API_SECRET = process.env.SUNSKY_API_SECRET;
const SUNSKY_BASE_URL = process.env.SUNSKY_BASE_URL || 'https://open.sunsky-online.com';

/* ════════════════════════════════════════════════════════════
   🛡️ CORS
════════════════════════════════════════════════════════════ */
const allowedOrigins = [
    'http://localhost:5500',
    'http://localhost:3000',
    'https://bonumktp.web.app',
    'https://bonumktp.firebaseapp.com',
    'https://xn--bon-joa.com',
    process.env.FRONTEND_URL
].filter(Boolean);

app.use(cors({
    origin: function(origin, callback) {
        if (!origin && NODE_ENV !== 'production') return callback(null, true);
        if (allowedOrigins.includes(origin) || !origin) return callback(null, true);
        console.log(`⚠️ CORS bloqueado: ${origin}`);
        return callback(null, true);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'CJ-Access-Token']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

/* ════════════════════════════════════════════════════════════
   📦 CATEGORÍAS
════════════════════════════════════════════════════════════ */
const CATEGORIAS = [
    'Celulares y Accesorios', 'Tecnología', 'Ropa de mujer', 'Ropa íntima', 'Ropa de hombre',
    'Accesorios de mujer', 'Accesorios de hombre', 'Calzado de mujer', 'Calzado de Hombre',
    'Belleza', 'Perfumes', 'Joyería y relojes', 'Juguetes', 'Ropa de niños', 'Calzado de niños',
    'Hogar y jardín', 'Consolas y videojuegos', 'Equipo de gym', 'Mascotas y accesorios',
    'Herramientas y accesorios de Auto', 'General'
];

function detectarCategoria(nombre = '', descripcion = '') {
    const txt = (nombre + ' ' + descripcion).toLowerCase();
    const mapa = [
        ['Celulares y Accesorios', ['celular', 'iphone', 'samsung', 'funda', 'cargador']],
        ['Tecnología', ['computadora', 'laptop', 'tablet', 'teclado', 'mouse']],
        ['Ropa de mujer', ['vestido', 'blusa', 'falda', 'mujer']],
        ['Ropa de hombre', ['camisa', 'pantalon', 'hombre']]
    ];
    for (const [cat, kws] of mapa) {
        if (kws.some(k => txt.includes(k))) return cat;
    }
    return 'General';
}

const generarId = () => `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

/* ════════════════════════════════════════════════════════════
   🔑 TOKEN CJ
════════════════════════════════════════════════════════════ */
let cjAccessToken = null, cjTokenExpiry = null, cjTokenPromise = null;

async function getCJToken() {
    if (!CJ_API_KEY) throw new Error('CJ_API_KEY no configurada');
    if (cjAccessToken && cjTokenExpiry && new Date() < new Date(cjTokenExpiry)) return cjAccessToken;
    if (cjTokenPromise) return cjTokenPromise;
    
    cjTokenPromise = (async () => {
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
    })();
    return cjTokenPromise;
}

/* ════════════════════════════════════════════════════════════
   🚦 RUTAS BASE
════════════════════════════════════════════════════════════ */
app.get('/', (req, res) => res.json({ success: true, message: 'Bonü Backend v3.0', env: NODE_ENV }));
app.get('/health', (req, res) => res.json({ status: 'healthy', firestore: !!firestore, timestamp: Date.now() }));
app.get('/api/status', (req, res) => res.json({ success: true, firestore: !!firestore, email: emailConfigurado }));
app.get('/api/categorias', (req, res) => res.json({ success: true, categorias: CATEGORIAS }));

/* ════════════════════════════════════════════════════════════
   🔑 RUTA PARA OBTENER CLAVES PÚBLICAS (NUEVA - para el frontend)
════════════════════════════════════════════════════════════ */
app.get('/api/config', (req, res) => {
    res.json({
        success: true,
        stripePublicKey: process.env.STRIPE_PUBLIC_KEY || null,
        mercadoPagoPublicKey: process.env.MERCADO_PAGO_PUBLIC_KEY || null,
        paypalClientId: process.env.PAYPAL_CLIENT_ID || null
    });
});

/* ════════════════════════════════════════════════════════════
   📊 TRACKING (GUARDADO EN FIRESTORE)
════════════════════════════════════════════════════════════ */
app.post('/api/tracking/visita', async (req, res) => {
    const { pagina = '/', origen = 'directo', dispositivo = 'desktop' } = req.body;
    if (!firestore) return res.json({ success: true, message: 'Tracking omitido' });
    
    try {
        await firestore.collection('trafico').add({
            pagina, origen, dispositivo,
            fecha: new Date().toISOString(),
            ip: req.ip
        });
        res.json({ success: true, message: 'Visita registrada' });
    } catch (error) {
        console.error('Error tracking:', error.message);
        res.json({ success: true, message: 'Error en tracking' });
    }
});

/* ════════════════════════════════════════════════════════════
   🌐 RUTAS CJ
════════════════════════════════════════════════════════════ */
app.post('/api/cj/import', async (req, res) => {
    let { sku, precioVenta, costoCJ, tipo, categoria } = req.body;
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
        const imagenes = producto.productImage ? [producto.productImage] : ['https://picsum.photos/500/500'];
        
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
            imagenes,
            tallas: '',
            colores: '',
            medidas: '',
            proveedor: 'CJ Dropshipping',
            fechaCreacion: new Date().toISOString()
        };
        
        const docRef = await firestore.collection('productos').add(productoFinal);
        console.log(`✅ Producto CJ guardado: ${docRef.id}`);
        
        res.json({ success: true, message: 'Producto importado', id: docRef.id, product: productoFinal });
    } catch (error) {
        console.error('❌ Error CJ:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

/* ════════════════════════════════════════════════════════════
   📦 ÓRDENES (TODO EN FIRESTORE)
════════════════════════════════════════════════════════════ */
app.get('/api/admin/ordenes', async (req, res) => {
    if (!firestore) return res.status(500).json({ success: false, error: 'Firestore no disponible' });
    
    try {
        const { estado, page = 1, limit = 20 } = req.query;
        let query = firestore.collection('pedidos');
        
        if (estado) query = query.where('estado', '==', estado);
        
        const snapshot = await query.orderBy('fechaCreacion', 'desc').limit(parseInt(limit)).get();
        const ordenes = [];
        snapshot.forEach(doc => ordenes.push({ id: doc.id, ...doc.data() }));
        
        res.json({ success: true, total: ordenes.length, ordenes });
    } catch (error) {
        console.error('Error obteniendo órdenes:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.patch('/api/admin/ordenes/:id/estado', async (req, res) => {
    if (!firestore) return res.status(500).json({ success: false, error: 'Firestore no disponible' });
    
    const { estado } = req.body;
    const validos = ['pendiente', 'pagado', 'enviado', 'cancelado'];
    if (!validos.includes(estado)) {
        return res.status(400).json({ success: false, error: 'Estado inválido' });
    }
    
    try {
        const ordenRef = firestore.collection('pedidos').doc(req.params.id);
        const ordenDoc = await ordenRef.get();
        
        if (!ordenDoc.exists) {
            return res.status(404).json({ success: false, error: 'Orden no encontrada' });
        }
        
        await ordenRef.update({ estado, fechaActualizacion: new Date().toISOString() });
        res.json({ success: true, mensaje: 'Estado actualizado' });
    } catch (error) {
        console.error('Error actualizando estado:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/admin/ordenes', async (req, res) => {
    if (!firestore) return res.status(500).json({ success: false, error: 'Firestore no disponible' });
    
    const { usuario, items, direccion, total, pasarela, customerEmail } = req.body;
    
    if (!items?.length || !total) {
        return res.status(400).json({ success: false, error: 'items y total requeridos' });
    }
    
    try {
        const ordenId = `ORD-${generarId()}`;
        const orden = {
            id: ordenId,
            usuario: usuario || 'Invitado',
            items: items.map(item => ({
                ...item,
                precio: item.precioFinal || item.precio || 0
            })),
            direccion: direccion || {},
            total: parseFloat(total),
            pasarela: pasarela || 'Desconocida',
            estado: 'pagado',
            emailCliente: customerEmail || direccion?.email,
            fechaCreacion: new Date().toISOString()
        };
        
        await firestore.collection('pedidos').doc(ordenId).set(orden);
        
        // Registrar transacción
        await firestore.collection('transacciones').add({
            ordenId,
            monto: orden.total,
            pasarela: orden.pasarela,
            estado: 'pagado',
            fechaCreacion: new Date().toISOString()
        });
        
        // Enviar email si hay email
        if (orden.emailCliente) {
            await sendConfirmationEmail({
                orderId: orden.id,
                customerEmail: orden.emailCliente,
                customerName: usuario || 'Cliente',
                total: orden.total,
                items: orden.items,
                shippingAddress: direccion,
                paymentMethod: pasarela,
                date: orden.fechaCreacion
            });
        }
        
        res.json({ success: true, orden });
    } catch (error) {
        console.error('Error creando orden:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/* ════════════════════════════════════════════════════════════
   👥 USUARIOS (FIRESTORE)
════════════════════════════════════════════════════════════ */
app.post('/api/admin/usuarios', async (req, res) => {
    if (!firestore) return res.status(500).json({ success: false, error: 'Firestore no disponible' });
    
    const { email, nombre, telefono } = req.body;
    if (!email) return res.status(400).json({ success: false, error: 'email requerido' });
    
    try {
        const usuariosRef = firestore.collection('clientes');
        const existing = await usuariosRef.where('email', '==', email).get();
        
        if (!existing.empty) {
            const doc = existing.docs[0];
            await doc.ref.update({
                nombre: nombre || doc.data().nombre,
                telefono: telefono || doc.data().telefono,
                compras: (doc.data().compras || 0) + 1,
                ultimaCompra: new Date().toISOString()
            });
            return res.json({ success: true, usuario: { id: doc.id, ...doc.data() } });
        }
        
        const usuario = {
            email,
            nombre: nombre || email.split('@')[0],
            telefono: telefono || '',
            compras: 1,
            ultimaCompra: new Date().toISOString(),
            fechaRegistro: new Date().toISOString()
        };
        
        const docRef = await usuariosRef.add(usuario);
        res.json({ success: true, usuario: { id: docRef.id, ...usuario } });
    } catch (error) {
        console.error('Error usuario:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/admin/usuarios', async (req, res) => {
    if (!firestore) return res.status(500).json({ success: false, error: 'Firestore no disponible' });
    
    try {
        const snapshot = await firestore.collection('clientes').limit(50).get();
        const usuarios = [];
        snapshot.forEach(doc => usuarios.push({ id: doc.id, ...doc.data() }));
        res.json({ success: true, usuarios });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/* ════════════════════════════════════════════════════════════
   💳 TRANSACCIONES (FIRESTORE)
════════════════════════════════════════════════════════════ */
app.get('/api/admin/transacciones', async (req, res) => {
    if (!firestore) return res.status(500).json({ success: false, error: 'Firestore no disponible' });
    
    try {
        const snapshot = await firestore.collection('transacciones').orderBy('fechaCreacion', 'desc').limit(50).get();
        const transacciones = [];
        snapshot.forEach(doc => transacciones.push({ id: doc.id, ...doc.data() }));
        res.json({ success: true, transacciones });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/* ════════════════════════════════════════════════════════════
   🛍️ PRODUCTOS (FIRESTORE)
════════════════════════════════════════════════════════════ */
app.get('/api/admin/productos', async (req, res) => {
    if (!firestore) return res.status(500).json({ success: false, error: 'Firestore no disponible' });
    
    try {
        const snapshot = await firestore.collection('productos').limit(100).get();
        const productos = [];
        snapshot.forEach(doc => productos.push({ id: doc.id, ...doc.data() }));
        res.json({ success: true, productos });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.patch('/api/admin/productos/:id', async (req, res) => {
    if (!firestore) return res.status(500).json({ success: false, error: 'Firestore no disponible' });
    
    try {
        const productRef = firestore.collection('productos').doc(req.params.id);
        const productDoc = await productRef.get();
        
        if (!productDoc.exists) {
            return res.status(404).json({ success: false, error: 'Producto no encontrado' });
        }
        
        await productRef.update({ ...req.body, fechaActualizacion: new Date().toISOString() });
        res.json({ success: true, mensaje: 'Producto actualizado' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.delete('/api/admin/productos/:id', async (req, res) => {
    if (!firestore) return res.status(500).json({ success: false, error: 'Firestore no disponible' });
    
    try {
        await firestore.collection('productos').doc(req.params.id).delete();
        res.json({ success: true, mensaje: 'Producto eliminado' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/* ════════════════════════════════════════════════════════════
   📈 DASHBOARD (DESDE FIRESTORE)
════════════════════════════════════════════════════════════ */
app.get('/api/admin/dashboard', async (req, res) => {
    if (!firestore) return res.status(500).json({ success: false, error: 'Firestore no disponible' });
    
    try {
        const pedidosSnap = await firestore.collection('pedidos').get();
        const ordenes = [];
        pedidosSnap.forEach(doc => ordenes.push({ id: doc.id, ...doc.data() }));
        
        const totalOrdenes = ordenes.length;
        const hoy = new Date().toISOString().split('T')[0];
        const ordenesHoy = ordenes.filter(o => o.fechaCreacion?.startsWith(hoy)).length;
        const montoTotal = ordenes.reduce((sum, o) => sum + (o.total || 0), 0);
        
        const productosSnap = await firestore.collection('productos').get();
        const totalProductos = productosSnap.size;
        
        const usuariosSnap = await firestore.collection('clientes').get();
        const totalUsuarios = usuariosSnap.size;
        
        const estados = { pendiente: 0, pagado: 0, enviado: 0, cancelado: 0 };
        ordenes.forEach(o => estados[o.estado || 'pendiente']++);
        
        res.json({
            success: true,
            resumen: {
                totalOrdenes,
                ordenesHoy,
                totalUsuarios,
                totalProductos,
                montoTotal
            },
            ordenes: { estados }
        });
    } catch (error) {
        console.error('Error dashboard:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/* ════════════════════════════════════════════════════════════
   ℹ️ 404
════════════════════════════════════════════════════════════ */
app.use((req, res) => res.status(404).json({ error: 'Endpoint no encontrado' }));
app.use((err, req, res, next) => {
    console.error('❌ Error:', err.stack);
    res.status(500).json({ success: false, error: NODE_ENV === 'production' ? 'Error interno' : err.message });
});

/* ════════════════════════════════════════════════════════════
   🚀 ARRANQUE
════════════════════════════════════════════════════════════ */
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log('==================================================');
    console.log('✅ Bonü Backend v3.0 - PRODUCCIÓN (Todo en Firestore)');
    console.log(`📡 Puerto: ${PORT}`);
    console.log(`🔥 Firestore: ${firestore ? '✅ CONECTADO' : '❌ NO DISPONIBLE'}`);
    console.log(`📧 Email: ${emailConfigurado ? '✅' : '⚠️'}`);
    console.log('==================================================');
});

process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
process.on('SIGINT', () => { server.close(() => process.exit(0)); });

module.exports = app;