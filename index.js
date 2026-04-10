// index.js - Bonü Backend v4.0 PRODUCCIÓN (Pagos reales con Stripe, Mercado Pago, BonuPay, PayPal)
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
   🛡️ SEGURIDAD
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
    console.error('❌ CRÍTICO: Firestore no disponible');
}

/* ════════════════════════════════════════════════════════════
   🔐 VARIABLES DE ENTORNO (CLAVES DE PRODUCCIÓN)
════════════════════════════════════════════════════════════ */
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const MERCADO_PAGO_ACCESS_TOKEN = process.env.MERCADO_PAGO_ACCESS_TOKEN;
const BONUPAY_ACCESS_TOKEN = process.env.BONUPAY_ACCESS_TOKEN;
const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET;
const PAYPAL_MODE = process.env.PAYPAL_MODE || 'live'; // live o sandbox

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
   💳 PAGOS CON STRIPE (PRODUCCIÓN REAL)
════════════════════════════════════════════════════════════ */
const Stripe = require('stripe');
let stripe = null;
if (STRIPE_SECRET_KEY) {
    stripe = new Stripe(STRIPE_SECRET_KEY);
    console.log('✅ Stripe configurado');
}

app.post('/api/payments/stripe/create-intent', async (req, res) => {
    if (!stripe) return res.status(500).json({ success: false, error: 'Stripe no configurado' });
    
    const { amount, currency = 'mxn', orderId, customerEmail } = req.body;
    
    if (!amount || amount <= 0) {
        return res.status(400).json({ success: false, error: 'Monto inválido' });
    }
    
    try {
        const paymentIntent = await stripe.paymentIntents.create({
            amount: Math.round(amount * 100), // Stripe usa centavos
            currency: currency.toLowerCase(),
            metadata: { orderId, customerEmail },
            receipt_email: customerEmail,
            statement_descriptor: 'Bonü Marketplace'
        });
        
        res.json({
            success: true,
            clientSecret: paymentIntent.client_secret,
            paymentIntentId: paymentIntent.id
        });
    } catch (error) {
        console.error('Error Stripe:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/* ════════════════════════════════════════════════════════════
   💳 PAGOS CON MERCADO PAGO (PRODUCCIÓN REAL)
════════════════════════════════════════════════════════════ */
const MERCADO_PAGO_API_URL = 'https://api.mercadopago.com/v1';

app.post('/api/payments/mercadopago/create-preference', async (req, res) => {
    if (!MERCADO_PAGO_ACCESS_TOKEN) {
        return res.status(500).json({ success: false, error: 'Mercado Pago no configurado' });
    }
    
    const { items, payer, orderId, returnUrl = 'https://xn--bon-joa.com/pago-exitoso' } = req.body;
    
    if (!items || !items.length) {
        return res.status(400).json({ success: false, error: 'Items requeridos' });
    }
    
    try {
        const preferenceData = {
            items: items.map(item => ({
                title: item.nombre,
                quantity: item.cantidad || 1,
                unit_price: parseFloat(item.precio),
                currency_id: 'MXN'
            })),
            payer: {
                name: payer?.name || 'Cliente',
                email: payer?.email || 'cliente@bonu.com'
            },
            back_urls: {
                success: returnUrl,
                failure: returnUrl,
                pending: returnUrl
            },
            auto_return: 'approved',
            external_reference: orderId,
            notification_url: 'https://bonu-backend.onrender.com/api/webhook/mercadopago'
        };
        
        const response = await fetch(`${MERCADO_PAGO_API_URL}/checkout/preferences`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${MERCADO_PAGO_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(preferenceData)
        });
        
        const data = await response.json();
        
        if (data.id) {
            res.json({
                success: true,
                preferenceId: data.id,
                init_point: data.init_point
            });
        } else {
            console.error('Error MP:', data);
            res.status(500).json({ success: false, error: data.message || 'Error al crear preferencia' });
        }
    } catch (error) {
        console.error('Error Mercado Pago:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/* ════════════════════════════════════════════════════════════
   💳 PAGOS CON BONUPAY (Misma infraestructura que Mercado Pago)
════════════════════════════════════════════════════════════ */
app.post('/api/payments/bonupay/create-preference', async (req, res) => {
    if (!BONUPAY_ACCESS_TOKEN) {
        return res.status(500).json({ success: false, error: 'BonuPay no configurado' });
    }
    
    const { items, payer, orderId, returnUrl = 'https://xn--bon-joa.com/pago-exitoso' } = req.body;
    
    if (!items || !items.length) {
        return res.status(400).json({ success: false, error: 'Items requeridos' });
    }
    
    try {
        const preferenceData = {
            items: items.map(item => ({
                title: item.nombre,
                quantity: item.cantidad || 1,
                unit_price: parseFloat(item.precio),
                currency_id: 'MXN'
            })),
            payer: {
                name: payer?.name || 'Cliente',
                email: payer?.email || 'cliente@bonu.com'
            },
            back_urls: {
                success: returnUrl,
                failure: returnUrl,
                pending: returnUrl
            },
            auto_return: 'approved',
            external_reference: orderId,
            notification_url: 'https://bonu-backend.onrender.com/api/webhook/bonupay'
        };
        
        const response = await fetch(`${MERCADO_PAGO_API_URL}/checkout/preferences`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${BONUPAY_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(preferenceData)
        });
        
        const data = await response.json();
        
        if (data.id) {
            res.json({
                success: true,
                preferenceId: data.id,
                init_point: data.init_point
            });
        } else {
            console.error('Error BonuPay:', data);
            res.status(500).json({ success: false, error: data.message || 'Error al crear preferencia' });
        }
    } catch (error) {
        console.error('Error BonuPay:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/* ════════════════════════════════════════════════════════════
   💳 PAGOS CON PAYPAL (PRODUCCIÓN REAL)
════════════════════════════════════════════════════════════ */
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

app.post('/api/payments/paypal/create-order', async (req, res) => {
    const { items, orderId, total, returnUrl = 'https://xn--bon-joa.com/pago-exitoso', cancelUrl = 'https://xn--bon-joa.com/carrito' } = req.body;
    
    if (!items || !items.length || !total) {
        return res.status(400).json({ success: false, error: 'Items y total requeridos' });
    }
    
    try {
        const accessToken = await getPayPalAccessToken();
        
        const orderData = {
            intent: 'CAPTURE',
            purchase_units: [{
                reference_id: orderId,
                amount: {
                    currency_code: 'MXN',
                    value: total.toFixed(2),
                    breakdown: {
                        item_total: {
                            currency_code: 'MXN',
                            value: total.toFixed(2)
                        }
                    }
                },
                items: items.map(item => ({
                    name: item.nombre,
                    quantity: item.cantidad || 1,
                    unit_amount: {
                        currency_code: 'MXN',
                        value: item.precio.toFixed(2)
                    }
                }))
            }],
            application_context: {
                return_url: returnUrl,
                cancel_url: cancelUrl,
                brand_name: 'Bonü Marketplace',
                user_action: 'PAY_NOW'
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
        
        const approveLink = data.links?.find(link => link.rel === 'approve')?.href;
        
        if (approveLink) {
            res.json({
                success: true,
                orderId: data.id,
                approveLink: approveLink
            });
        } else {
            console.error('Error PayPal:', data);
            res.status(500).json({ success: false, error: data.message || 'Error al crear orden' });
        }
    } catch (error) {
        console.error('Error PayPal:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/payments/paypal/capture-order', async (req, res) => {
    const { orderId } = req.body;
    
    if (!orderId) {
        return res.status(400).json({ success: false, error: 'OrderId requerido' });
    }
    
    try {
        const accessToken = await getPayPalAccessToken();
        
        const response = await fetch(`${PAYPAL_API_URL}/v2/checkout/orders/${orderId}/capture`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });
        
        const data = await response.json();
        
        if (data.status === 'COMPLETED') {
            res.json({ success: true, capture: data });
        } else {
            res.status(500).json({ success: false, error: 'Captura no completada' });
        }
    } catch (error) {
        console.error('Error PayPal capture:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/* ════════════════════════════════════════════════════════════
   📡 WEBHOOKS PARA NOTIFICACIONES DE PAGO
════════════════════════════════════════════════════════════ */
app.post('/api/webhook/mercadopago', async (req, res) => {
    const { type, data } = req.body;
    
    console.log('Webhook MP recibido:', type, data);
    
    if (type === 'payment') {
        try {
            const paymentResponse = await fetch(`${MERCADO_PAGO_API_URL}/payments/${data.id}`, {
                headers: { 'Authorization': `Bearer ${MERCADO_PAGO_ACCESS_TOKEN}` }
            });
            const payment = await paymentResponse.json();
            
            if (payment.status === 'approved') {
                const orderId = payment.external_reference || `ORD-${Date.now()}`;
                
                const orden = {
                    id: orderId,
                    total: payment.transaction_amount,
                    estado: 'pagado',
                    paymentMethod: 'Mercado Pago',
                    paymentId: payment.id,
                    fecha: new Date().toISOString()
                };
                
                await firestore.collection('pedidos').doc(orderId).set(orden, { merge: true });
                console.log(`✅ Pago MP aprobado: ${payment.id}`);
            }
        } catch (error) {
            console.error('Error webhook MP:', error);
        }
    }
    
    res.sendStatus(200);
});

app.post('/api/webhook/bonupay', async (req, res) => {
    const { type, data } = req.body;
    
    console.log('Webhook BonuPay recibido:', type, data);
    
    if (type === 'payment') {
        try {
            const paymentResponse = await fetch(`${MERCADO_PAGO_API_URL}/payments/${data.id}`, {
                headers: { 'Authorization': `Bearer ${BONUPAY_ACCESS_TOKEN}` }
            });
            const payment = await paymentResponse.json();
            
            if (payment.status === 'approved') {
                const orderId = payment.external_reference || `ORD-${Date.now()}`;
                
                const orden = {
                    id: orderId,
                    total: payment.transaction_amount,
                    estado: 'pagado',
                    paymentMethod: 'BonuPay',
                    paymentId: payment.id,
                    fecha: new Date().toISOString()
                };
                
                await firestore.collection('pedidos').doc(orderId).set(orden, { merge: true });
                console.log(`✅ Pago BonuPay aprobado: ${payment.id}`);
            }
        } catch (error) {
            console.error('Error webhook BonuPay:', error);
        }
    }
    
    res.sendStatus(200);
});

/* ════════════════════════════════════════════════════════════
   🚦 RUTAS BASE
════════════════════════════════════════════════════════════ */
app.get('/', (req, res) => res.json({ success: true, message: 'Bonü Backend v4.0 - Pagos Reales', env: NODE_ENV }));
app.get('/health', (req, res) => res.json({ status: 'healthy', firestore: !!firestore, timestamp: Date.now() }));
app.get('/api/status', (req, res) => res.json({ 
    success: true, 
    firestore: !!firestore, 
    email: emailConfigurado,
    stripe: !!stripe,
    mercadoPago: !!MERCADO_PAGO_ACCESS_TOKEN,
    bonupay: !!BONUPAY_ACCESS_TOKEN,
    paypal: !!(PAYPAL_CLIENT_ID && PAYPAL_CLIENT_SECRET)
}));
app.get('/api/categorias', (req, res) => res.json({ success: true, categorias: CATEGORIAS }));

/* ════════════════════════════════════════════════════════════
   🔑 RUTA PARA OBTENER CLAVES PÚBLICAS (para el frontend)
════════════════════════════════════════════════════════════ */
app.get('/api/config', (req, res) => {
    res.json({
        success: true,
        stripePublicKey: process.env.STRIPE_PUBLIC_KEY || null,
        mercadoPagoPublicKey: process.env.MERCADO_PAGO_PUBLIC_KEY || null,
        bonupayPublicKey: process.env.BONUPAY_PUBLIC_KEY || null,
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

app.get('/api/admin/trafico', async (req, res) => {
    if (!firestore) return res.json({ total: 0, hoy: 0, mes: 0 });
    
    try {
        const snap = await firestore.collection('trafico').get();
        const hoy = new Date().toISOString().split('T')[0];
        let total = 0, hoyCount = 0;
        
        snap.forEach(doc => {
            total++;
            const fecha = doc.data().fecha?.split('T')[0];
            if (fecha === hoy) hoyCount++;
        });
        
        res.json({ total, hoy: hoyCount, mes: total });
    } catch (error) {
        res.json({ total: 0, hoy: 0, mes: 0 });
    }
});

/* ════════════════════════════════════════════════════════════
   🌐 RUTAS CJ DROPSHIPPING
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

app.post('/api/cj/import', async (req, res) => {
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
   📦 ÓRDENES (GUARDADO EN FIRESTORE)
════════════════════════════════════════════════════════════ */
app.get('/api/admin/ordenes', async (req, res) => {
    if (!firestore) return res.status(500).json({ success: false, error: 'Firestore no disponible' });
    
    try {
        const { estado, page = 1, limit = 20 } = req.query;
        let query = firestore.collection('pedidos');
        
        if (estado) query = query.where('estado', '==', estado);
        
        const snapshot = await query.orderBy('fecha', 'desc').limit(parseInt(limit)).get();
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
            fecha: new Date().toISOString()
        };
        
        await firestore.collection('pedidos').doc(ordenId).set(orden);
        
        // Registrar transacción
        await firestore.collection('transacciones').add({
            ordenId,
            monto: orden.total,
            pasarela: orden.pasarela,
            estado: 'pagado',
            fecha: new Date().toISOString()
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
                date: orden.fecha
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
        const snapshot = await firestore.collection('transacciones').orderBy('fecha', 'desc').limit(50).get();
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
        const ordenesHoy = ordenes.filter(o => o.fecha?.startsWith(hoy)).length;
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
    console.log('✅ Bonü Backend v4.0 - PAGOS REALES (PRODUCCIÓN)');
    console.log(`📡 Puerto: ${PORT}`);
    console.log(`🔥 Firestore: ${firestore ? '✅ CONECTADO' : '❌ NO DISPONIBLE'}`);
    console.log(`📧 Email: ${emailConfigurado ? '✅' : '⚠️'}`);
    console.log(`💳 Stripe: ${stripe ? '✅' : '❌'}`);
    console.log(`💳 Mercado Pago: ${MERCADO_PAGO_ACCESS_TOKEN ? '✅' : '❌'}`);
    console.log(`💳 BonuPay: ${BONUPAY_ACCESS_TOKEN ? '✅' : '❌'}`);
    console.log(`💳 PayPal: ${PAYPAL_CLIENT_ID ? '✅' : '❌'}`);
    console.log('==================================================');
});

process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
process.on('SIGINT', () => { server.close(() => process.exit(0)); });

module.exports = app;