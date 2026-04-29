// index.js - Bonü Backend v4.1 PRODUCCIÓN
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

// Configurar trust proxy para Render (evita error de rate-limit)
app.set('trust proxy', 1);
// Rate limiter general
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { success: false, error: 'Demasiadas peticiones, intente más tarde' },
    standardHeaders: true,
    legacyHeaders: false
});
app.use('/api/', limiter);

// Rate limiter estricto para pagos
const paymentLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { success: false, error: 'Demasiados intentos de pago, intente más tarde' },
    standardHeaders: true,
    legacyHeaders: false
});

/* ════════════════════════════════════════════════════════════
   📧 CONFIGURACIÓN DE EMAIL
════════════════════════════════════════════════════════════ */
let emailTransporter = null;
let emailConfigurado = false;

if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
    try {
        emailTransporter = nodemailer.createTransport({
            service: process.env.EMAIL_SERVICE || 'gmail',
            auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
            pool: true,
            connectionTimeout: 10000,
            greetingTimeout: 5000,
            socketTimeout: 10000
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

    const { orderId, customerEmail, customerName, total, items } = orderData;

    const itemsHtml = (items || []).map(item => `
        <tr>
            <td style="padding: 12px 8px;">${item.nombre}</td>
            <td style="padding: 12px 8px;">Cantidad: ${item.cantidad || 1}</td>
            <td style="padding: 12px 8px; text-align: right;">${formatCurrency((item.precioFinal || item.precio || 0) * (item.cantidad || 1))}</td>
        </tr>
    `).join('');

    const subtotal = (items || []).reduce((sum, item) => sum + ((item.precioFinal || item.precio || 0) * (item.cantidad || 1)), 0);

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
                    <p>Total: ${formatCurrency(subtotal)}</p>
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
        await Promise.race([
            emailTransporter.sendMail({
                from: `"Bonü" <${process.env.EMAIL_USER}>`,
                to: customerEmail,
                subject: `✅ Confirmación #${orderId}`,
                html
            }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Email timeout')), 15000))
        ]);
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
   🔐 MIDDLEWARE DE AUTENTICACIÓN FIREBASE
════════════════════════════════════════════════════════════ */
async function verificarAdmin(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, error: 'No autorizado: token requerido' });
    }

    const idToken = authHeader.split('Bearer ')[1];

    try {
        const decoded = await admin.auth().verifyIdToken(idToken);

        if (!decoded.admin) {
            return res.status(403).json({ success: false, error: 'Acceso denegado: se requiere rol admin' });
        }

        req.user = decoded;
        next();
    } catch (error) {
        console.warn('⚠️ Token inválido:', error.message);
        return res.status(401).json({ success: false, error: 'Token inválido o expirado' });
    }
}

/* ════════════════════════════════════════════════════════════
   🔐 VARIABLES DE ENTORNO
════════════════════════════════════════════════════════════ */
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const MERCADO_PAGO_ACCESS_TOKEN = process.env.MERCADO_PAGO_ACCESS_TOKEN;
const MERCADO_PAGO_WEBHOOK_SECRET = process.env.MERCADO_PAGO_WEBHOOK_SECRET;
const BONUPAY_ACCESS_TOKEN = process.env.BONUPAY_ACCESS_TOKEN;
const BONUPAY_WEBHOOK_SECRET = process.env.BONUPAY_WEBHOOK_SECRET;
const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET;
const PAYPAL_MODE = process.env.PAYPAL_MODE || 'live';
const PAYPAL_WEBHOOK_ID = process.env.PAYPAL_WEBHOOK_ID;
const CJ_API_KEY = process.env.CJ_API_KEY;
const CJ_API_URL = 'https://developers.cjdropshipping.com/api2.0/v1';

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

app.use('/api/webhook/stripe', express.raw({ type: 'application/json' }));
app.use('/api/webhook/mercadopago', express.raw({ type: 'application/json' }));
app.use('/api/webhook/bonupay', express.raw({ type: 'application/json' }));
app.use('/api/webhook/paypal', express.raw({ type: 'application/json' }));

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
   💳 STRIPE
════════════════════════════════════════════════════════════ */
const Stripe = require('stripe');
let stripe = null;
if (STRIPE_SECRET_KEY) {
    stripe = new Stripe(STRIPE_SECRET_KEY);
    console.log('✅ Stripe configurado');
}

app.post('/api/payments/stripe/create-intent', paymentLimiter, async (req, res) => {
    if (!stripe) return res.status(500).json({ success: false, error: 'Stripe no configurado' });

    const { amount, currency = 'mxn', orderId, customerEmail } = req.body;

    if (!amount || amount <= 0) {
        return res.status(400).json({ success: false, error: 'Monto inválido' });
    }

    try {
        const paymentIntent = await stripe.paymentIntents.create({
            amount: Math.round(amount * 100),
            currency: currency.toLowerCase(),
            metadata: { orderId, customerEmail },
            receipt_email: customerEmail,
            statement_descriptor: 'Bonu Marketplace'
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
   💳 MERCADO PAGO
════════════════════════════════════════════════════════════ */
const MERCADO_PAGO_API_URL = 'https://api.mercadopago.com/v1';

app.post('/api/payments/mercadopago/create-preference', paymentLimiter, async (req, res) => {
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
            res.json({ success: true, preferenceId: data.id, init_point: data.init_point });
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
   💳 BONUPAY
════════════════════════════════════════════════════════════ */
app.post('/api/payments/bonupay/create-preference', paymentLimiter, async (req, res) => {
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
            res.json({ success: true, preferenceId: data.id, init_point: data.init_point });
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
   💳 PAYPAL
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
    if (!data.access_token) throw new Error('Error obteniendo token de PayPal');
    return data.access_token;
}

app.post('/api/payments/paypal/create-order', paymentLimiter, async (req, res) => {
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
                        item_total: { currency_code: 'MXN', value: total.toFixed(2) }
                    }
                },
                items: items.map(item => ({
                    name: item.nombre,
                    quantity: String(item.cantidad || 1),
                    unit_amount: { currency_code: 'MXN', value: item.precio.toFixed(2) }
                }))
            }],
            application_context: {
                return_url: returnUrl,
                cancel_url: cancelUrl,
                brand_name: 'Bonu Marketplace',
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
            res.json({ success: true, orderId: data.id, approveLink });
        } else {
            console.error('Error PayPal:', data);
            res.status(500).json({ success: false, error: data.message || 'Error al crear orden' });
        }
    } catch (error) {
        console.error('Error PayPal:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/payments/paypal/capture-order', paymentLimiter, async (req, res) => {
    const { orderId } = req.body;
    if (!orderId) return res.status(400).json({ success: false, error: 'OrderId requerido' });

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
   📡 WEBHOOKS
════════════════════════════════════════════════════════════ */

function verificarFirmaMP(req, secret) {
    try {
        const xSignature = req.headers['x-signature'];
        const xRequestId = req.headers['x-request-id'];

        if (!xSignature || !xRequestId || !secret) return false;

        const parts = xSignature.split(',');
        const ts = parts.find(p => p.startsWith('ts='))?.split('=')[1];
        const v1 = parts.find(p => p.startsWith('v1='))?.split('=')[1];

        if (!ts || !v1) return false;

        const body = JSON.parse(req.body.toString());
        const dataId = body?.data?.id;

        if (!dataId) return false;

        const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
        const expected = crypto.createHmac('sha256', secret).update(manifest).digest('hex');

        return crypto.timingSafeEqual(Buffer.from(v1), Buffer.from(expected));
    } catch {
        return false;
    }
}

async function verificarFirmaPayPal(req) {
    if (!PAYPAL_WEBHOOK_ID || !PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) return false;

    try {
        const accessToken = await getPayPalAccessToken();

        const verificationBody = {
            auth_algo: req.headers['paypal-auth-algo'],
            cert_url: req.headers['paypal-cert-url'],
            transmission_id: req.headers['paypal-transmission-id'],
            transmission_sig: req.headers['paypal-transmission-sig'],
            transmission_time: req.headers['paypal-transmission-time'],
            webhook_id: PAYPAL_WEBHOOK_ID,
            webhook_event: JSON.parse(req.body.toString())
        };

        const response = await fetch(`${PAYPAL_API_URL}/v1/notifications/verify-webhook-signature`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(verificationBody)
        });

        const result = await response.json();
        return result.verification_status === 'SUCCESS';
    } catch (error) {
        console.error('❌ Error verificando firma PayPal:', error.message);
        return false;
    }
}

app.post('/api/webhook/stripe', async (req, res) => {
    if (!stripe || !STRIPE_WEBHOOK_SECRET) {
        console.warn('⚠️ Webhook Stripe recibido pero Stripe no está configurado');
        return res.sendStatus(200);
    }

    const sig = req.headers['stripe-signature'];
    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        console.error('❌ Firma Stripe inválida:', err.message);
        return res.status(400).json({ error: `Webhook Error: ${err.message}` });
    }

    try {
        if (event.type === 'payment_intent.succeeded') {
            const intent = event.data.object;
            const orderId = intent.metadata?.orderId || `ORD-${Date.now()}`;

            if (firestore) {
                await firestore.collection('pedidos').doc(orderId).set({
                    id: orderId,
                    total: intent.amount / 100,
                    estado: 'pagado',
                    paymentMethod: 'Stripe',
                    paymentId: intent.id,
                    fecha: new Date().toISOString()
                }, { merge: true });
            }

            console.log(`✅ Pago Stripe confirmado: ${intent.id}`);
        }

        if (event.type === 'payment_intent.payment_failed') {
            const intent = event.data.object;
            console.warn(`⚠️ Pago Stripe fallido: ${intent.id}`);
        }
    } catch (error) {
        console.error('❌ Error procesando evento Stripe:', error.message);
    }

    res.sendStatus(200);
});

app.post('/api/webhook/mercadopago', async (req, res) => {
    res.sendStatus(200);

    if (MERCADO_PAGO_WEBHOOK_SECRET) {
        const esValido = verificarFirmaMP(req, MERCADO_PAGO_WEBHOOK_SECRET);
        if (!esValido) {
            console.warn('❌ Firma Mercado Pago inválida - webhook ignorado');
            return;
        }
    } else {
        console.warn('⚠️ MERCADO_PAGO_WEBHOOK_SECRET no configurado, omitiendo verificación');
    }

    try {
        const { type, data } = JSON.parse(req.body.toString());
        console.log('Webhook MP recibido:', type, data);

        if (type === 'payment' && data?.id) {
            const paymentResponse = await fetch(`${MERCADO_PAGO_API_URL}/payments/${data.id}`, {
                headers: { 'Authorization': `Bearer ${MERCADO_PAGO_ACCESS_TOKEN}` }
            });
            const payment = await paymentResponse.json();

            if (payment.status === 'approved' && firestore) {
                const orderId = payment.external_reference || `ORD-${Date.now()}`;
                await firestore.collection('pedidos').doc(orderId).set({
                    id: orderId,
                    total: payment.transaction_amount,
                    estado: 'pagado',
                    paymentMethod: 'Mercado Pago',
                    paymentId: payment.id,
                    fecha: new Date().toISOString()
                }, { merge: true });
                console.log(`✅ Pago MP aprobado: ${payment.id}`);
            }
        }
    } catch (error) {
        console.error('❌ Error procesando webhook MP:', error.message);
    }
});

app.post('/api/webhook/bonupay', async (req, res) => {
    res.sendStatus(200);

    if (BONUPAY_WEBHOOK_SECRET) {
        const esValido = verificarFirmaMP(req, BONUPAY_WEBHOOK_SECRET);
        if (!esValido) {
            console.warn('❌ Firma BonuPay inválida - webhook ignorado');
            return;
        }
    } else {
        console.warn('⚠️ BONUPAY_WEBHOOK_SECRET no configurado, omitiendo verificación');
    }

    try {
        const { type, data } = JSON.parse(req.body.toString());
        console.log('Webhook BonuPay recibido:', type, data);

        if (type === 'payment' && data?.id) {
            const paymentResponse = await fetch(`${MERCADO_PAGO_API_URL}/payments/${data.id}`, {
                headers: { 'Authorization': `Bearer ${BONUPAY_ACCESS_TOKEN}` }
            });
            const payment = await paymentResponse.json();

            if (payment.status === 'approved' && firestore) {
                const orderId = payment.external_reference || `ORD-${Date.now()}`;
                await firestore.collection('pedidos').doc(orderId).set({
                    id: orderId,
                    total: payment.transaction_amount,
                    estado: 'pagado',
                    paymentMethod: 'BonuPay',
                    paymentId: payment.id,
                    fecha: new Date().toISOString()
                }, { merge: true });
                console.log(`✅ Pago BonuPay aprobado: ${payment.id}`);
            }
        }
    } catch (error) {
        console.error('❌ Error procesando webhook BonuPay:', error.message);
    }
});

app.post('/api/webhook/paypal', async (req, res) => {
    res.sendStatus(200);

    if (PAYPAL_WEBHOOK_ID) {
        const esValido = await verificarFirmaPayPal(req);
        if (!esValido) {
            console.warn('❌ Firma PayPal inválida - webhook ignorado');
            return;
        }
    } else {
        console.warn('⚠️ PAYPAL_WEBHOOK_ID no configurado, omitiendo verificación');
    }

    try {
        const event = JSON.parse(req.body.toString());
        console.log('Webhook PayPal recibido:', event.event_type);

        if (event.event_type === 'PAYMENT.CAPTURE.COMPLETED' && firestore) {
            const capture = event.resource;
            const orderId = capture.supplementary_data?.related_ids?.order_id || `ORD-${Date.now()}`;

            await firestore.collection('pedidos').doc(orderId).set({
                id: orderId,
                total: parseFloat(capture.amount?.value || 0),
                estado: 'pagado',
                paymentMethod: 'PayPal',
                paymentId: capture.id,
                fecha: new Date().toISOString()
            }, { merge: true });

            console.log(`✅ Pago PayPal confirmado: ${capture.id}`);
        }
    } catch (error) {
        console.error('❌ Error procesando webhook PayPal:', error.message);
    }
});

/* ════════════════════════════════════════════════════════════
   🚦 RUTAS BASE (públicas)
════════════════════════════════════════════════════════════ */
app.get('/', (req, res) => res.json({ success: true, message: 'Bonü Backend v4.1 - Producción', env: NODE_ENV }));
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
   📊 TRACKING
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
   🌐 CJ DROPSHIPPING
════════════════════════════════════════════════════════════ */
let cjAccessToken = null;
let cjTokenExpiry = null;
let cjTokenPromise = null;

async function getCJToken() {
    if (!CJ_API_KEY) throw new Error('CJ_API_KEY no configurada');
    if (cjAccessToken && cjTokenExpiry && new Date() < new Date(cjTokenExpiry)) return cjAccessToken;
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
   ☀️ SUNSKY
════════════════════════════════════════════════════════════ */
app.post('/api/sunsky/import', verificarAdmin, async (req, res) => {
    const { sku, precioVenta, tipo, categoria } = req.body;
    
    if (!sku || !precioVenta) {
        return res.status(400).json({ success: false, error: 'SKU y precioVenta requeridos' });
    }
    
    if (!firestore) {
        return res.status(500).json({ success: false, error: 'Firestore no disponible' });
    }

    try {
        const sunskyBaseUrl = process.env.SUNSKY_BASE_URL || 'https://api.sunsky-online.com';
        const apiKey = process.env.SUNSKY_API_KEY;
        const apiSecret = process.env.SUNSKY_API_SECRET;
        
        if (!apiKey || !apiSecret) {
            throw new Error('SUNSKY_API_KEY o SUNSKY_API_SECRET no configuradas');
        }
        
        const response = await fetch(`${sunskyBaseUrl}/v1/product/details`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': apiKey,
                'X-API-Secret': apiSecret
            },
            body: JSON.stringify({ sku: sku })
        });
        
        const data = await response.json();
        
        if (!data || !data.success) {
            throw new Error(`Producto ${sku} no encontrado en SunSky`);
        }
        
        const producto = data.product || data.data || {};
        const nombre = producto.name || producto.productName || `Producto SunSky ${sku}`;
        const imagenes = producto.images || (producto.image ? [producto.image] : [`https://picsum.photos/seed/${sku}/500/500`]);
        const descripcion = producto.description || producto.desc || '';
        const stockDisponible = producto.stock || producto.inventory || 100;
        
        const productoFinal = {
            sku: sku,
            nombre: nombre,
            descripcion: descripcion,
            categoria: categoria || detectarCategoria(nombre, descripcion),
            precioFinal: parseFloat(precioVenta),
            precioOriginal: parseFloat(precioVenta) * 1.15,
            descuento: 13,
            stock: stockDisponible,
            tipo: tipo || 'Ofertas',
            rating: 4.5,
            imagenes: imagenes,
            proveedor: 'SunSky',
            skuOriginal: sku,
            fechaCreacion: new Date().toISOString(),
            fechaAgregado: new Date().toISOString()
        };

        const docRef = await firestore.collection('productos').add(productoFinal);
        console.log(`✅ Producto SunSky guardado: ${docRef.id} - SKU: ${sku}`);
        
        res.json({ 
            success: true, 
            message: 'Producto importado desde SunSky exitosamente',
            id: docRef.id, 
            product: productoFinal 
        });
    } catch (error) {
        console.error('❌ Error SunSky:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

/* ════════════════════════════════════════════════════════════
   📦 ÓRDENES
════════════════════════════════════════════════════════════ */
app.get('/api/admin/trafico', verificarAdmin, async (req, res) => {
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

app.get('/api/admin/ordenes', verificarAdmin, async (req, res) => {
    if (!firestore) return res.status(500).json({ success: false, error: 'Firestore no disponible' });

    try {
        const { estado, limit = 20 } = req.query;
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

app.patch('/api/admin/ordenes/:id/estado', verificarAdmin, async (req, res) => {
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
            }).catch(err => console.error('Error email background:', err.message));
        }

        res.json({ success: true, orden });
    } catch (error) {
        console.error('Error creando orden:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/* ════════════════════════════════════════════════════════════
   👥 USUARIOS
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

app.get('/api/admin/usuarios', verificarAdmin, async (req, res) => {
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
   💳 TRANSACCIONES
════════════════════════════════════════════════════════════ */
app.get('/api/admin/transacciones', verificarAdmin, async (req, res) => {
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
   🛍️ PRODUCTOS
════════════════════════════════════════════════════════════ */
app.get('/api/admin/productos', verificarAdmin, async (req, res) => {
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

app.patch('/api/admin/productos/:id', verificarAdmin, async (req, res) => {
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

app.delete('/api/admin/productos/:id', verificarAdmin, async (req, res) => {
    if (!firestore) return res.status(500).json({ success: false, error: 'Firestore no disponible' });

    try {
        await firestore.collection('productos').doc(req.params.id).delete();
        res.json({ success: true, mensaje: 'Producto eliminado' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/* ════════════════════════════════════════════════════════════
   📈 DASHBOARD
════════════════════════════════════════════════════════════ */
app.get('/api/admin/dashboard', verificarAdmin, async (req, res) => {
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
        ordenes.forEach(o => { if (estados[o.estado] !== undefined) estados[o.estado]++; });

        res.json({
            success: true,
            resumen: { totalOrdenes, ordenesHoy, totalUsuarios, totalProductos, montoTotal },
            ordenes: { estados }
        });
    } catch (error) {
        console.error('Error dashboard:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/* ════════════════════════════════════════════════════════════
   👑 ENDPOINT TEMPORAL PARA ASIGNAR ADMIN
   ⚠️ ELIMINAR DESPUÉS DE USAR
════════════════════════════════════════════════════════════ */
app.post('/api/admin/set-role', async (req, res) => {
    const { uid, email } = req.body;
    
    if (!uid && !email) {
        return res.status(400).json({ error: 'Se requiere uid o email' });
    }
    
    try {
        let user;
        if (uid) {
            user = await admin.auth().getUser(uid);
        } else {
            user = await admin.auth().getUserByEmail(email);
        }
        
        await admin.auth().setCustomUserClaims(user.uid, { admin: true });
        
        console.log(`✅ Usuario ${user.email} (UID: ${user.uid}) ahora es ADMINISTRADOR`);
        
        res.json({ 
            success: true, 
            message: `✅ Usuario ${user.email} ahora es administrador`,
            uid: user.uid,
            email: user.email
        });
    } catch (error) {
        console.error('Error asignando admin:', error.message);
        res.status(500).json({ error: error.message });
    }
});

/* ════════════════════════════════════════════════════════════
   ℹ️ ERRORES
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
    console.log('✅ Bonü Backend v4.1 - PRODUCCIÓN');
    console.log(`📡 Puerto: ${PORT}`);
    console.log(`🔥 Firestore: ${firestore ? '✅ CONECTADO' : '❌ NO DISPONIBLE'}`);
    console.log(`📧 Email: ${emailConfigurado ? '✅' : '⚠️'}`);
    console.log(`💳 Stripe: ${stripe ? '✅' : '❌'}`);
    console.log(`🔐 Stripe Webhook Secret: ${STRIPE_WEBHOOK_SECRET ? '✅' : '⚠️ sin verificación'}`);
    console.log(`💳 Mercado Pago: ${MERCADO_PAGO_ACCESS_TOKEN ? '✅' : '❌'}`);
    console.log(`🔐 MP Webhook Secret: ${MERCADO_PAGO_WEBHOOK_SECRET ? '✅' : '⚠️ sin verificación'}`);
    console.log(`💳 BonuPay: ${BONUPAY_ACCESS_TOKEN ? '✅' : '❌'}`);
    console.log(`🔐 BonuPay Webhook Secret: ${BONUPAY_WEBHOOK_SECRET ? '✅' : '⚠️ sin verificación'}`);
    console.log(`💳 PayPal: ${PAYPAL_CLIENT_ID ? '✅' : '❌'}`);
    console.log(`🔐 PayPal Webhook ID: ${PAYPAL_WEBHOOK_ID ? '✅' : '⚠️ sin verificación'}`);
    console.log('==================================================');
});

process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
process.on('SIGINT', () => { server.close(() => process.exit(0)); });

module.exports = app;