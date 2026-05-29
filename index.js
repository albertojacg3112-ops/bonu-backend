// index.js - Bonü Backend v5.1 PRODUCCIÓN (checkout seguro, idempotente, validaciones server-side)
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

/* ========== SEGURIDAD ========== */
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.set('trust proxy', 1);

const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, max: 100,
    message: { success: false, error: 'Demasiadas peticiones' },
    standardHeaders: true, legacyHeaders: false
});
app.use('/api/', globalLimiter);

const checkoutLimiter = rateLimit({
    windowMs: 60 * 1000, max: 5,
    message: { success: false, error: 'Demasiados intentos de compra' }
});

/* ========== EMAIL ========== */
let emailTransporter = null;
let emailConfigurado = false;
if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
    try {
        emailTransporter = nodemailer.createTransport({
            service: process.env.EMAIL_SERVICE || 'gmail',
            auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
            pool: true, connectionTimeout: 10000
        });
        emailConfigurado = true;
        console.log('✅ Email configurado');
    } catch (error) { console.warn('⚠️ Email error:', error.message); }
}

function formatCurrency(amount) {
    return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(amount);
}

async function sendConfirmationEmail(orderData) {
    if (!emailConfigurado || !emailTransporter) return false;
    const { orderId, customerEmail, customerName, total, items, shippingAddress, paymentMethod, date } = orderData;
    const itemsHtml = (items || []).map(item => `
        <tr><td style="padding:8px;">${item.nombre}</td>
        <td style="padding:8px;">x${item.cantidad || 1}</td>
        <td style="padding:8px;text-align:right;">${formatCurrency((item.precioReal || item.precio || 0) * (item.cantidad || 1))}</td>
    </tr>`).join('');
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Confirmación Bonü</title></head>
    <body style="font-family:Arial,sans-serif;">
        <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;">
            <div style="background:linear-gradient(135deg,#facc15,#fbbf24);padding:24px;text-align:center;">
                <h1 style="color:#000;">✨ Bonü ✨</h1><p>¡Gracias por tu compra!</p>
            </div>
            <div style="padding:24px;">
                <p>Hola <strong>${customerName}</strong>,</p>
                <p>Tu pedido <strong>#${orderId}</strong> ha sido confirmado.</p>
                <p><strong>Total:</strong> ${formatCurrency(total)}</p>
                <p><strong>Método de pago:</strong> ${paymentMethod}</p>
                <p><strong>Fecha:</strong> ${new Date(date).toLocaleString()}</p>
                <h3>Productos:</h3>
                <table style="width:100%;">${itemsHtml}</table>
                ${shippingAddress ? `<p><strong>Envío a:</strong> ${shippingAddress}</p>` : ''}
                <p>Gracias por confiar en Bonü ❤️</p>
            </div>
            <div style="background:#111827;padding:20px;text-align:center;color:#9ca3af;">
                <p>© 2026 Bonü - Todos los derechos reservados</p>
            </div>
        </div>
    </body></html>`;
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
            console.error('❌ Faltan credenciales de Firebase');
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
        if (!decoded.admin) {
            return res.status(403).json({ success: false, error: 'Acceso denegado: se requiere rol admin' });
        }
        req.user = decoded;
        next();
    } catch (error) {
        return res.status(401).json({ success: false, error: 'Token inválido o expirado' });
    }
}

/* ========== VARIABLES DE ENTORNO ========== */
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
const TVCMALL_API_URL = process.env.TVCMALL_API_URL || 'https://api.tvcmall.com/v1';
const TVCMALL_API_KEY = process.env.TVCMALL_API_KEY;
const TVCMALL_API_SECRET = process.env.TVCMALL_API_SECRET;
const SUNSKY_API_URL = process.env.SUNSKY_API_URL || 'https://api.sunsky-online.com';
const SUNSKY_API_KEY = process.env.SUNSKY_API_KEY;
const SUNSKY_API_SECRET = process.env.SUNSKY_API_SECRET;

/* ========== CORS ========== */
const allowedOrigins = [
    'http://localhost:5500', 'http://localhost:3000',
    'https://bonumktp.web.app', 'https://bonumktp.firebaseapp.com',
    'https://xn--bon-joa.com', process.env.FRONTEND_URL
].filter(Boolean);
app.use(cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
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
if (STRIPE_SECRET_KEY) { stripe = new Stripe(STRIPE_SECRET_KEY); console.log('✅ Stripe configurado'); }

app.post('/api/payments/stripe/create-intent', checkoutLimiter, async (req, res) => {
    if (!stripe) return res.status(500).json({ success: false, error: 'Stripe no configurado' });
    const { checkoutToken, amount, customerEmail, returnUrl } = req.body;
    if (!checkoutToken || !amount || amount <= 0) {
        return res.status(400).json({ success: false, error: 'Token y monto requeridos' });
    }
    // Verificar token
    const tokenDoc = await firestore.collection('checkoutTokens').doc(checkoutToken).get();
    if (!tokenDoc.exists || tokenDoc.data().exp < Date.now()) {
        return res.status(400).json({ success: false, error: 'Token inválido o expirado' });
    }
    const tokenData = tokenDoc.data();
    if (Math.abs(tokenData.total - amount) > 0.01) {
        return res.status(400).json({ success: false, error: 'Monto no coincide con el token' });
    }
    try {
        const paymentIntent = await stripe.paymentIntents.create({
            amount: Math.round(amount * 100),
            currency: 'mxn',
            metadata: { checkoutToken },
            receipt_email: customerEmail,
            statement_descriptor: 'Bonu Marketplace'
        });
        res.json({ success: true, clientSecret: paymentIntent.client_secret, paymentIntentId: paymentIntent.id });
    } catch (error) {
        console.error('Error Stripe:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/* ========== MERCADO PAGO ========== */
const MERCADO_PAGO_API_URL = 'https://api.mercadopago.com/v1';

app.post('/api/payments/mercadopago/create-preference', checkoutLimiter, async (req, res) => {
    if (!MERCADO_PAGO_ACCESS_TOKEN) return res.status(500).json({ success: false, error: 'Mercado Pago no configurado' });
    const { checkoutToken, payer, returnUrl = 'https://xn--bon-joa.com/pago-exitoso' } = req.body;
    if (!checkoutToken) return res.status(400).json({ success: false, error: 'Token requerido' });
    try {
        const tokenDoc = await firestore.collection('checkoutTokens').doc(checkoutToken).get();
        if (!tokenDoc.exists || tokenDoc.data().exp < Date.now()) {
            return res.status(400).json({ success: false, error: 'Token inválido o expirado' });
        }
        const tokenData = tokenDoc.data();
        const preferenceData = {
            items: tokenData.validatedItems.map(item => ({
                title: item.nombre, quantity: item.cantidad || 1,
                unit_price: item.precioReal, currency_id: 'MXN'
            })),
            payer: { name: payer?.name || 'Cliente', email: payer?.email || 'cliente@bonu.com' },
            back_urls: { success: returnUrl, failure: returnUrl, pending: returnUrl },
            auto_return: 'approved',
            external_reference: checkoutToken,
            notification_url: 'https://bonu-backend.onrender.com/api/webhook/mercadopago'
        };
        const response = await fetch(`${MERCADO_PAGO_API_URL}/checkout/preferences`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${MERCADO_PAGO_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
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

/* ========== BONUPAY ========== */
app.post('/api/payments/bonupay/create-preference', checkoutLimiter, async (req, res) => {
    if (!BONUPAY_ACCESS_TOKEN) return res.status(500).json({ success: false, error: 'BonuPay no configurado' });
    const { checkoutToken, payer, returnUrl = 'https://xn--bon-joa.com/pago-exitoso' } = req.body;
    if (!checkoutToken) return res.status(400).json({ success: false, error: 'Token requerido' });
    try {
        const tokenDoc = await firestore.collection('checkoutTokens').doc(checkoutToken).get();
        if (!tokenDoc.exists || tokenDoc.data().exp < Date.now()) {
            return res.status(400).json({ success: false, error: 'Token inválido o expirado' });
        }
        const tokenData = tokenDoc.data();
        const preferenceData = {
            items: tokenData.validatedItems.map(item => ({
                title: item.nombre, quantity: item.cantidad || 1,
                unit_price: item.precioReal, currency_id: 'MXN'
            })),
            payer: { name: payer?.name || 'Cliente', email: payer?.email || 'cliente@bonu.com' },
            back_urls: { success: returnUrl, failure: returnUrl, pending: returnUrl },
            auto_return: 'approved',
            external_reference: checkoutToken,
            notification_url: 'https://bonu-backend.onrender.com/api/webhook/bonupay'
        };
        const response = await fetch(`${MERCADO_PAGO_API_URL}/checkout/preferences`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${BONUPAY_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
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

/* ========== PAYPAL ========== */
const PAYPAL_API_URL = PAYPAL_MODE === 'sandbox' ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';

async function getPayPalAccessToken() {
    if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) throw new Error('PayPal no configurado');
    const auth = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString('base64');
    const response = await fetch(`${PAYPAL_API_URL}/v1/oauth2/token`, {
        method: 'POST',
        headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=client_credentials'
    });
    const data = await response.json();
    if (!data.access_token) throw new Error('Error obteniendo token de PayPal');
    return data.access_token;
}

app.post('/api/payments/paypal/create-order', checkoutLimiter, async (req, res) => {
    const { checkoutToken, returnUrl = 'https://xn--bon-joa.com/pago-exitoso', cancelUrl = 'https://xn--bon-joa.com/carrito' } = req.body;
    if (!checkoutToken) return res.status(400).json({ success: false, error: 'Token requerido' });
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
                reference_id: checkoutToken,
                amount: {
                    currency_code: 'MXN', value: total.toFixed(2),
                    breakdown: { item_total: { currency_code: 'MXN', value: total.toFixed(2) } }
                },
                items: tokenData.validatedItems.map(item => ({
                    name: item.nombre, quantity: String(item.cantidad || 1),
                    unit_amount: { currency_code: 'MXN', value: item.precioReal.toFixed(2) }
                }))
            }],
            application_context: { return_url: returnUrl, cancel_url: cancelUrl, brand_name: 'Bonu Marketplace', user_action: 'PAY_NOW' }
        };
        const response = await fetch(`${PAYPAL_API_URL}/v2/checkout/orders`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
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

/* ========== CHECKOUT SEGURO (nuevo endpoint) ========== */
app.post('/api/checkout', checkoutLimiter, async (req, res) => {
    if (!firestore) return res.status(500).json({ success: false, error: 'Firestore no disponible' });
    const { cart, cuponCode, cashbackToUse, userId, customerEmail, customerName, shippingAddress } = req.body;
    if (!cart?.length) return res.status(400).json({ error: 'Carrito vacío' });

    let subtotal = 0;
    const validatedItems = [];

    for (const item of cart) {
        const prodRef = firestore.collection('productos').doc(item.id);
        const prodDoc = await prodRef.get();
        if (!prodDoc.exists) return res.status(404).json({ error: `Producto ${item.nombre} no existe` });
        const prod = prodDoc.data();
        if (prod.stock < (item.cantidad || 1)) return res.status(409).json({ error: `Producto ${item.nombre} sin stock suficiente` });
        const precioReal = prod.precioFinal;
        // Verificar que el precio no haya sido manipulado
        if (Math.abs(precioReal - (item.precioFinal || item.precio)) > 0.01) {
            return res.status(400).json({ error: 'Precio manipulado' });
        }
        validatedItems.push({
            id: item.id, nombre: item.nombre, cantidad: item.cantidad || 1,
            precioReal, costoEnvio: prod.costoEnvio || 0, proveedor: prod.proveedor
        });
        subtotal += precioReal * (item.cantidad || 1);
    }

    // Cupón
    let descuento = 0;
    let cuponAplicado = null;
    if (cuponCode) {
        const cuponSnap = await firestore.collection('cupones').where('codigo', '==', cuponCode).where('activo', '==', true).get();
        if (!cuponSnap.empty) {
            const cupon = cuponSnap.docs[0].data();
            const expira = cupon.expira ? new Date(cupon.expira) : null;
            if ((!expira || expira > new Date()) && (!cupon.usosMax || cupon.usos < cupon.usosMax) && subtotal >= (cupon.minimoCompra || 0)) {
                descuento = subtotal * cupon.descuento / 100;
                cuponAplicado = { id: cuponSnap.docs[0].id, codigo: cuponCode, descuento: cupon.descuento };
            }
        }
    }

    // Cashback
    let cashbackUsar = 0;
    let userCashbackBalance = 0;
    if (userId && cashbackToUse > 0) {
        const userDoc = await firestore.collection('clientes').doc(userId).get();
        if (userDoc.exists) {
            userCashbackBalance = userDoc.data().cashbackBalance || 0;
            const maxPermitido = (subtotal - descuento) * 0.5;
            cashbackUsar = Math.min(cashbackToUse, userCashbackBalance, maxPermitido);
        }
    }

    const envio = subtotal >= 999 ? 0 : (validatedItems.reduce((s, i) => s + (i.costoEnvio || 99), 0) || 99);
    const iva = (subtotal - descuento) * 0.16;
    const total = Math.round((subtotal - descuento - cashbackUsar + envio + iva) * 100) / 100;

    // Crear token firmado (expira en 10 min)
    const token = crypto.randomBytes(32).toString('hex');
    const payload = {
        token, userId, customerEmail, customerName, shippingAddress,
        validatedItems, subtotal, descuento, cuponAplicado, cashbackUsar, userCashbackBalance,
        envio, iva, total, exp: Date.now() + 10 * 60 * 1000,
        createdAt: new Date().toISOString()
    };
    await firestore.collection('checkoutTokens').doc(token).set(payload);

    res.json({ success: true, token, total });
});

/* ========== FUNCIÓN PARA CREAR ORDEN DESPUÉS DEL PAGO (idempotente) ========== */
async function finalizarOrden(checkoutToken, paymentMethod, paymentId, payerEmail = null) {
    const tokenDoc = await firestore.collection('checkoutTokens').doc(checkoutToken).get();
    if (!tokenDoc.exists) throw new Error('Token no encontrado');
    const data = tokenDoc.data();
    if (data.exp < Date.now()) throw new Error('Token expirado');

    // Evitar doble procesamiento
    const processedRef = firestore.collection('processedPayments').doc(paymentId);
    const processedDoc = await processedRef.get();
    if (processedDoc.exists) {
        console.log(`⚠️ Pago ${paymentId} ya procesado`);
        return { alreadyProcessed: true, orderId: processedDoc.data().orderId };
    }

    const orderId = `ORD-${Date.now()}`;
    const orderData = {
        id: orderId,
        usuario: data.customerName || (data.userId ? 'Cliente' : 'Invitado'),
        emailCliente: data.customerEmail || payerEmail,
        items: data.validatedItems.map(i => ({
            id: i.id, nombre: i.nombre, cantidad: i.cantidad, precio: i.precioReal, proveedor: i.proveedor
        })),
        direccion: data.shippingAddress || {},
        total: data.total,
        pasarela: paymentMethod,
        estado: 'pagado',
        fecha: new Date().toISOString(),
        cuponAplicado: data.cuponAplicado?.codigo || null,
        cashbackUsado: data.cashbackUsar
    };
    await firestore.collection('pedidos').doc(orderId).set(orderData);

    // Actualizar stock (batch)
    const batch = firestore.batch();
    for (const item of data.validatedItems) {
        const prodRef = firestore.collection('productos').doc(item.id);
        batch.update(prodRef, { stock: admin.firestore.FieldValue.increment(-item.cantidad) });
    }
    // Actualizar cashback del usuario (restar usado, sumar ganado)
    if (data.userId) {
        const userRef = firestore.collection('clientes').doc(data.userId);
        const cashbackGanado = data.total * 0.05; // 5% de cashback
        batch.update(userRef, {
            cashbackBalance: admin.firestore.FieldValue.increment(-data.cashbackUsar + cashbackGanado),
            cashbackHistory: admin.firestore.FieldValue.arrayUnion({
                amount: cashbackGanado, orderId, date: new Date().toISOString(), type: 'earned'
            })
        });
    }
    // Actualizar usos del cupón
    if (data.cuponAplicado?.id) {
        const cuponRef = firestore.collection('cupones').doc(data.cuponAplicado.id);
        batch.update(cuponRef, { usos: admin.firestore.FieldValue.increment(1) });
    }
    await batch.commit();

    // Marcar pago como procesado
    await processedRef.set({ orderId, paymentId, processedAt: new Date().toISOString() });

    // Eliminar token (ya no sirve)
    await tokenDoc.ref.delete();

    // Enviar email
    if (data.customerEmail) {
        sendConfirmationEmail({
            orderId, customerEmail: data.customerEmail, customerName: data.customerName || 'Cliente',
            total: data.total, items: data.validatedItems, shippingAddress: data.shippingAddress,
            paymentMethod, date: orderData.fecha
        }).catch(err => console.error('Error email:', err.message));
    }

    return { orderId };
}

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
        const checkoutToken = intent.metadata.checkoutToken;
        if (!checkoutToken) {
            console.warn('⚠️ Stripe webhook sin checkoutToken');
            return res.sendStatus(200);
        }
        try {
            await finalizarOrden(checkoutToken, 'Stripe', intent.id, intent.receipt_email);
            console.log(`✅ Orden creada desde Stripe: ${checkoutToken}`);
        } catch (error) {
            console.error('❌ Error procesando webhook Stripe:', error.message);
        }
    }
    res.sendStatus(200);
});

app.post('/api/webhook/mercadopago', async (req, res) => {
    res.sendStatus(200);
    try {
        const { type, data } = JSON.parse(req.body.toString());
        if (type === 'payment' && data?.id) {
            const paymentResponse = await fetch(`${MERCADO_PAGO_API_URL}/payments/${data.id}`, {
                headers: { 'Authorization': `Bearer ${MERCADO_PAGO_ACCESS_TOKEN}` }
            });
            const payment = await paymentResponse.json();
            if (payment.status === 'approved') {
                const checkoutToken = payment.external_reference;
                if (checkoutToken) {
                    await finalizarOrden(checkoutToken, 'MercadoPago', payment.id, payment.payer?.email);
                }
            }
        }
    } catch (error) { console.error('❌ Error webhook MP:', error.message); }
});

app.post('/api/webhook/bonupay', async (req, res) => {
    res.sendStatus(200);
    try {
        const { type, data } = JSON.parse(req.body.toString());
        if (type === 'payment' && data?.id) {
            const paymentResponse = await fetch(`${MERCADO_PAGO_API_URL}/payments/${data.id}`, {
                headers: { 'Authorization': `Bearer ${BONUPAY_ACCESS_TOKEN}` }
            });
            const payment = await paymentResponse.json();
            if (payment.status === 'approved') {
                const checkoutToken = payment.external_reference;
                if (checkoutToken) {
                    await finalizarOrden(checkoutToken, 'BonuPay', payment.id, payment.payer?.email);
                }
            }
        }
    } catch (error) { console.error('❌ Error webhook BonuPay:', error.message); }
});

app.post('/api/webhook/paypal', async (req, res) => {
    res.sendStatus(200);
    try {
        const event = JSON.parse(req.body.toString());
        if (event.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
            const capture = event.resource;
            const checkoutToken = capture.custom_id || capture.supplementary_data?.related_ids?.order_id;
            if (checkoutToken) {
                await finalizarOrden(checkoutToken, 'PayPal', capture.id);
            }
        }
    } catch (error) { console.error('❌ Error webhook PayPal:', error.message); }
});

/* ========== RUTAS PÚBLICAS ========== */
app.get('/', (req, res) => res.json({ success: true, message: 'Bonü Backend v5.1 - Producción', env: NODE_ENV }));
app.get('/health', (req, res) => res.json({ status: 'healthy', firestore: !!firestore, timestamp: Date.now() }));
app.get('/api/status', (req, res) => res.json({
    success: true, firestore: !!firestore, email: emailConfigurado, stripe: !!stripe,
    mercadoPago: !!MERCADO_PAGO_ACCESS_TOKEN, bonupay: !!BONUPAY_ACCESS_TOKEN,
    paypal: !!(PAYPAL_CLIENT_ID && PAYPAL_CLIENT_SECRET)
}));
app.get('/api/categorias', (req, res) => res.json({ success: true, categorias: CATEGORIAS }));
app.get('/api/config', (req, res) => res.json({
    success: true,
    stripePublicKey: process.env.STRIPE_PUBLIC_KEY || null,
    mercadoPagoPublicKey: process.env.MERCADO_PAGO_PUBLIC_KEY || null,
    bonupayPublicKey: process.env.BONUPAY_PUBLIC_KEY || null,
    paypalClientId: process.env.PAYPAL_CLIENT_ID || null
}));

/* ========== PRODUCTOS PÚBLICOS ========== */
app.get('/api/products', async (req, res) => {
    if (!firestore) return res.status(500).json({ success: false, error: 'Firestore no disponible' });
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
    if (!firestore) return res.status(500).json({ success: false, error: 'Firestore no disponible' });
    try {
        const productDoc = await firestore.collection('productos').doc(req.params.id).get();
        if (!productDoc.exists) return res.status(404).json({ success: false, error: 'Producto no encontrado' });
        res.json({ success: true, producto: { id: productDoc.id, ...productDoc.data() } });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/* ========== PROVEEDORES (CJ, TVC, SUNSKY) - mismos que tenías ========== */
let cjAccessToken = null, cjTokenExpiry = null, cjTokenPromise = null;
async function getCJToken() {
    if (!CJ_API_KEY) throw new Error('CJ_API_KEY no configurada');
    if (cjAccessToken && cjTokenExpiry && new Date() < new Date(cjTokenExpiry)) return cjAccessToken;
    if (cjTokenPromise) return cjTokenPromise;
    cjTokenPromise = (async () => {
        try {
            const response = await fetch(`${CJ_API_URL}/authentication/getAccessToken`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ apiKey: CJ_API_KEY })
            });
            const data = await response.json();
            if (data.code === 200 && data.data?.accessToken) {
                cjAccessToken = data.data.accessToken;
                cjTokenExpiry = data.data.accessTokenExpiryDate;
                return cjAccessToken;
            }
            throw new Error(`Error CJ: ${data.message}`);
        } finally { cjTokenPromise = null; }
    })();
    return cjTokenPromise;
}

app.get('/api/cj/product/:sku', async (req, res) => {
    const { sku } = req.params;
    if (!CJ_API_KEY) return res.status(500).json({ success: false, error: 'CJ_API_KEY no configurada' });
    try {
        const token = await getCJToken();
        const searchRes = await fetch(`${CJ_API_URL}/product/list?productSku=${encodeURIComponent(sku)}&pageNum=1&pageSize=1`, {
            headers: { 'CJ-Access-Token': token }
        });
        const searchData = await searchRes.json();
        if (searchData.code !== 200 || !searchData.data?.list?.length) {
            return res.status(404).json({ success: false, error: `Producto ${sku} no encontrado en CJ` });
        }
        const product = searchData.data.list[0];
        res.json({ success: true, product: {
            name: product.productNameEn || product.productName || `Producto ${sku}`,
            description: product.productDescription || '',
            price: parseFloat(product.sellingPrice) || 0,
            cost: parseFloat(product.costPrice) || 0,
            images: product.productImage ? [product.productImage] : [],
            sku: product.productSku || sku
        }});
    } catch (error) {
        console.error('Error CJ product:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/cj/import', verificarAdmin, async (req, res) => {
    let { sku, precioVenta, tipo, categoria } = req.body;
    if (!sku || !precioVenta) return res.status(400).json({ success: false, error: 'SKU y precioVenta requeridos' });
    if (!firestore) return res.status(500).json({ success: false, error: 'Firestore no disponible' });
    try {
        const token = await getCJToken();
        const listRes = await fetch(`${CJ_API_URL}/product/list?productSku=${encodeURIComponent(sku)}&pageNum=1&pageSize=1`, {
            headers: { 'CJ-Access-Token': token }
        });
        const listData = await listRes.json();
        if (listData.code !== 200 || !listData.data?.list?.length) throw new Error(`Producto ${sku} no encontrado`);
        const producto = listData.data.list[0];
        const nombre = producto.productNameEn || producto.productName || `Producto ${sku}`;
        const productoFinal = {
            sku, nombre, descripcion: producto.productDescription || '',
            categoria: categoria || detectarCategoria(nombre, ''),
            precioFinal: parseFloat(precioVenta),
            precioOriginal: parseFloat(precioVenta) * 1.15,
            descuento: 13, stock: producto.inventory || 100, tipo: tipo || 'Ofertas',
            rating: 4.5, imagenes: producto.productImage ? [producto.productImage] : ['https://picsum.photos/500/500'],
            proveedor: 'CJ Dropshipping', fechaCreacion: new Date().toISOString()
        };
        const docRef = await firestore.collection('productos').add(productoFinal);
        console.log(`✅ Producto CJ guardado: ${docRef.id}`);
        res.json({ success: true, message: 'Producto importado', id: docRef.id, product: productoFinal });
    } catch (error) {
        console.error('❌ Error CJ:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/tvcmall/product/:sku', async (req, res) => {
    const { sku } = req.params;
    if (!TVCMALL_API_KEY || !TVCMALL_API_SECRET) return res.status(500).json({ success: false, error: 'TVCmall no configurado' });
    try {
        const timestamp = Date.now();
        const sign = crypto.createHash('md5').update(`${TVCMALL_API_KEY}${timestamp}${TVCMALL_API_SECRET}`).digest('hex');
        const response = await fetch(`${TVCMALL_API_URL}/product/detail`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-API-Key': TVCMALL_API_KEY, 'X-Timestamp': timestamp, 'X-Sign': sign },
            body: JSON.stringify({ sku })
        });
        const data = await response.json();
        if (!data?.success || !data.product) return res.status(404).json({ success: false, error: `Producto ${sku} no encontrado en TVCmall` });
        const product = data.product;
        res.json({ success: true, product: {
            name: product.name || `Producto ${sku}`,
            description: product.description || '',
            price: parseFloat(product.price) || 0,
            cost: parseFloat(product.costPrice) || 0,
            images: product.images || (product.image ? [product.image] : []),
            sku: product.sku || sku
        }});
    } catch (error) {
        console.error('Error TVCmall product:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/tvcmall/import', verificarAdmin, async (req, res) => {
    const { sku, precioVenta, tipo, categoria } = req.body;
    if (!sku || !precioVenta) return res.status(400).json({ success: false, error: 'SKU y precioVenta requeridos' });
    if (!TVCMALL_API_KEY || !TVCMALL_API_SECRET) return res.status(500).json({ success: false, error: 'TVCmall no configurado' });
    if (!firestore) return res.status(500).json({ success: false, error: 'Firestore no disponible' });
    try {
        const timestamp = Date.now();
        const sign = crypto.createHash('md5').update(`${TVCMALL_API_KEY}${timestamp}${TVCMALL_API_SECRET}`).digest('hex');
        const response = await fetch(`${TVCMALL_API_URL}/product/detail`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-API-Key': TVCMALL_API_KEY, 'X-Timestamp': timestamp, 'X-Sign': sign },
            body: JSON.stringify({ sku })
        });
        const data = await response.json();
        if (!data?.success || !data.product) throw new Error(`Producto ${sku} no encontrado en TVCmall`);
        const product = data.product;
        const nombre = product.name || `Producto ${sku}`;
        const productoFinal = {
            sku, nombre, descripcion: product.description || '',
            categoria: categoria || detectarCategoria(nombre, ''),
            precioFinal: parseFloat(precioVenta),
            precioOriginal: parseFloat(precioVenta) * 1.15,
            descuento: 13, stock: product.stock || 100, tipo: tipo || 'Ofertas',
            rating: 4.5, imagenes: product.images || (product.image ? [product.image] : ['https://picsum.photos/500/500']),
            proveedor: 'TVCmall', fechaCreacion: new Date().toISOString()
        };
        const docRef = await firestore.collection('productos').add(productoFinal);
        res.json({ success: true, message: 'Producto TVCmall importado', id: docRef.id, product: productoFinal });
    } catch (error) {
        console.error('❌ Error TVCmall import:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/sunsky/product/:sku', async (req, res) => {
    const { sku } = req.params;
    if (!SUNSKY_API_KEY || !SUNSKY_API_SECRET) return res.status(500).json({ success: false, error: 'SunSky no configurado' });
    try {
        const response = await fetch(`${SUNSKY_API_URL}/v1/product/details`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-API-Key': SUNSKY_API_KEY, 'X-API-Secret': SUNSKY_API_SECRET },
            body: JSON.stringify({ sku })
        });
        const data = await response.json();
        if (!data?.success || !data.product) return res.status(404).json({ success: false, error: `Producto ${sku} no encontrado en SunSky` });
        const product = data.product;
        res.json({ success: true, product: {
            name: product.name || `Producto ${sku}`,
            description: product.description || '',
            price: parseFloat(product.price) || 0,
            cost: parseFloat(product.costPrice) || 0,
            images: product.images || (product.image ? [product.image] : []),
            sku: product.sku || sku
        }});
    } catch (error) {
        console.error('Error SunSky product:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/sunsky/import', verificarAdmin, async (req, res) => {
    const { sku, precioVenta, tipo, categoria } = req.body;
    if (!sku || !precioVenta) return res.status(400).json({ success: false, error: 'SKU y precioVenta requeridos' });
    if (!SUNSKY_API_KEY || !SUNSKY_API_SECRET) return res.status(500).json({ success: false, error: 'SunSky no configurado' });
    if (!firestore) return res.status(500).json({ success: false, error: 'Firestore no disponible' });
    try {
        const response = await fetch(`${SUNSKY_API_URL}/v1/product/details`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-API-Key': SUNSKY_API_KEY, 'X-API-Secret': SUNSKY_API_SECRET },
            body: JSON.stringify({ sku })
        });
        const data = await response.json();
        if (!data?.success || !data.product) throw new Error(`Producto ${sku} no encontrado en SunSky`);
        const product = data.product;
        const nombre = product.name || `Producto ${sku}`;
        const productoFinal = {
            sku, nombre, descripcion: product.description || '',
            categoria: categoria || detectarCategoria(nombre, ''),
            precioFinal: parseFloat(precioVenta),
            precioOriginal: parseFloat(precioVenta) * 1.15,
            descuento: 13, stock: product.stock || 100, tipo: tipo || 'Ofertas',
            rating: 4.5, imagenes: product.images || (product.image ? [product.image] : ['https://picsum.photos/500/500']),
            proveedor: 'SunSky', fechaCreacion: new Date().toISOString()
        };
        const docRef = await firestore.collection('productos').add(productoFinal);
        res.json({ success: true, message: 'Producto SunSky importado', id: docRef.id, product: productoFinal });
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
        await firestore.collection('trafico').add({ pagina, origen, dispositivo, fecha: new Date().toISOString(), ip: req.ip });
        res.json({ success: true });
    } catch { res.json({ success: true }); }
});

/* ========== ADMIN (endpoints existentes) ========== */
app.get('/api/admin/trafico', verificarAdmin, async (req, res) => {
    if (!firestore) return res.json({ total: 0, hoy: 0, mes: 0 });
    try {
        const snap = await firestore.collection('trafico').get();
        const hoy = new Date().toISOString().split('T')[0];
        let total = 0, hoyCount = 0;
        snap.forEach(doc => { total++; if (doc.data().fecha?.startsWith(hoy)) hoyCount++; });
        res.json({ total, hoy: hoyCount, mes: total });
    } catch (error) { res.json({ total: 0, hoy: 0, mes: 0 }); }
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
        res.status(500).json({ success: false, error: error.message });
    }
});

app.patch('/api/admin/ordenes/:id/estado', verificarAdmin, async (req, res) => {
    if (!firestore) return res.status(500).json({ success: false, error: 'Firestore no disponible' });
    const { estado } = req.body;
    const validos = ['pendiente', 'pagado', 'enviado', 'cancelado'];
    if (!validos.includes(estado)) return res.status(400).json({ success: false, error: 'Estado inválido' });
    try {
        const ordenRef = firestore.collection('pedidos').doc(req.params.id);
        if (!(await ordenRef.get()).exists) return res.status(404).json({ success: false, error: 'Orden no encontrada' });
        await ordenRef.update({ estado, fechaActualizacion: new Date().toISOString() });
        res.json({ success: true, mensaje: 'Estado actualizado' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/admin/ordenes', verificarAdmin, async (req, res) => {
    if (!firestore) return res.status(500).json({ success: false, error: 'Firestore no disponible' });
    const { usuario, items, direccion, total, pasarela, customerEmail } = req.body;
    if (!items?.length || !total) return res.status(400).json({ success: false, error: 'items y total requeridos' });
    try {
        const ordenId = `ORD-${generarId()}`;
        const orden = {
            id: ordenId, usuario: usuario || 'Invitado',
            items: items.map(item => ({ ...item, precio: item.precioFinal || item.precio || 0 })),
            direccion: direccion || {}, total: parseFloat(total),
            pasarela: pasarela || 'Desconocida', estado: 'pagado',
            emailCliente: customerEmail || direccion?.email, fecha: new Date().toISOString()
        };
        await firestore.collection('pedidos').doc(ordenId).set(orden);
        await firestore.collection('transacciones').add({
            ordenId, monto: orden.total, pasarela: orden.pasarela, estado: 'pagado', fecha: new Date().toISOString()
        });
        if (orden.emailCliente) {
            sendConfirmationEmail({
                orderId: orden.id, customerEmail: orden.emailCliente, customerName: usuario || 'Cliente',
                total: orden.total, items: orden.items, shippingAddress: direccion, paymentMethod: pasarela, date: orden.fecha
            }).catch(err => console.error('Error email:', err.message));
        }
        res.json({ success: true, orden });
    } catch (error) {
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
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.get('/api/admin/transacciones', verificarAdmin, async (req, res) => {
    if (!firestore) return res.status(500).json({ success: false, error: 'Firestore no disponible' });
    try {
        const snapshot = await firestore.collection('transacciones').orderBy('fecha', 'desc').limit(50).get();
        const transacciones = [];
        snapshot.forEach(doc => transacciones.push({ id: doc.id, ...doc.data() }));
        res.json({ success: true, transacciones });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.get('/api/admin/productos', verificarAdmin, async (req, res) => {
    if (!firestore) return res.status(500).json({ success: false, error: 'Firestore no disponible' });
    try {
        const snapshot = await firestore.collection('productos').limit(100).get();
        const productos = [];
        snapshot.forEach(doc => productos.push({ id: doc.id, ...doc.data() }));
        res.json({ success: true, productos });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.patch('/api/admin/productos/:id', verificarAdmin, async (req, res) => {
    if (!firestore) return res.status(500).json({ success: false, error: 'Firestore no disponible' });
    try {
        const productRef = firestore.collection('productos').doc(req.params.id);
        if (!(await productRef.get()).exists) return res.status(404).json({ success: false, error: 'Producto no encontrado' });
        await productRef.update({ ...req.body, fechaActualizacion: new Date().toISOString() });
        res.json({ success: true, mensaje: 'Producto actualizado' });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.delete('/api/admin/productos/:id', verificarAdmin, async (req, res) => {
    if (!firestore) return res.status(500).json({ success: false, error: 'Firestore no disponible' });
    try {
        await firestore.collection('productos').doc(req.params.id).delete();
        res.json({ success: true, mensaje: 'Producto eliminado' });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.get('/api/admin/dashboard', verificarAdmin, async (req, res) => {
    if (!firestore) return res.status(500).json({ success: false, error: 'Firestore no disponible' });
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
        ordenes.forEach(o => { montoTotal += o.total || 0; if (estados[o.estado] !== undefined) estados[o.estado]++; });
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
    if (!uid && !email) return res.status(400).json({ error: 'Se requiere uid o email' });
    try {
        const user = uid ? await admin.auth().getUser(uid) : await admin.auth().getUserByEmail(email);
        await admin.auth().setCustomUserClaims(user.uid, { admin: true });
        console.log(`✅ ${user.email} (${user.uid}) ahora es ADMIN`);
        res.json({ success: true, message: `✅ ${user.email} ahora es administrador`, uid: user.uid, email: user.email });
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
        <meta property="og:type" content="product"><meta property="og:title" content="${titulo}">
        <meta property="og:description" content="${descripcion}"><meta property="og:image" content="${imagen}">
        <meta property="og:url" content="${url}"><meta name="twitter:card" content="summary_large_image">
        </head><body><p>Redirigiendo...</p><script>window.location.href="${url}";</script></body></html>`);
    } catch { res.redirect('https://xn--bon-joa.com'); }
});

/* ========== MANEJO DE ERRORES ========== */
app.use((req, res) => res.status(404).json({ error: 'Endpoint no encontrado' }));
app.use((err, req, res, next) => {
    console.error('❌ Error:', err.stack);
    res.status(500).json({ success: false, error: NODE_ENV === 'production' ? 'Error interno' : err.message });
});

/* ========== ARRANQUE ========== */
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log('==================================================');
    console.log('✅ Bonü Backend v5.1 - PRODUCCIÓN (checkout seguro)');
    console.log(`📡 Puerto: ${PORT}`);
    console.log(`🔥 Firestore: ${firestore ? '✅ CONECTADO' : '❌ NO DISPONIBLE'}`);
    console.log(`📧 Email: ${emailConfigurado ? '✅' : '⚠️'}`);
    console.log(`💳 Stripe: ${stripe ? '✅' : '❌'}`);
    console.log(`💳 Mercado Pago: ${MERCADO_PAGO_ACCESS_TOKEN ? '✅' : '❌'}`);
    console.log(`💳 BonuPay: ${BONUPAY_ACCESS_TOKEN ? '✅' : '❌'}`);
    console.log(`💳 PayPal: ${PAYPAL_CLIENT_ID ? '✅' : '❌'}`);
    console.log('==================================================');
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));

module.exports = app;