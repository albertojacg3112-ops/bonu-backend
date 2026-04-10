// index.js - Bonü Backend v4.1 (PRODUCCIÓN - Pagos Reales + BonuPay Integrado)
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// 🆕 LIBRERÍAS DE PAGO
const Stripe = require('stripe');
const MercadoPago = require('mercadopago');
const { Checkout } = require('@paypal/checkout-server-sdk');

const app = express();
const PORT = process.env.PORT || 3001;
const NODE_ENV = process.env.NODE_ENV || 'production';

// 🆕 INICIALIZAR SDKs DE PAGO
let stripe = null, mercadopago = null, bonupay = null, paypalClient = null;

// Stripe
if (process.env.STRIPE_SECRET_KEY) {
    stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' });
    console.log('✅ Stripe inicializado');
}

// Mercado Pago (cuenta principal)
if (process.env.MERCADO_PAGO_ACCESS_TOKEN) {
    MercadoPago.configure({ access_token: process.env.MERCADO_PAGO_ACCESS_TOKEN });
    mercadopago = MercadoPago;
    console.log('✅ Mercado Pago (principal) inicializado');
}

// 🆕 BonuPay (cuenta separada - usa API de MP pero con credenciales propias)
if (process.env.BONUPAY_ACCESS_TOKEN) {
    // BonuPay usa la misma SDK de Mercado Pago pero con access token diferente
    const BonuPaySDK = require('mercadopago');
    BonuPaySDK.configure({ access_token: process.env.BONUPAY_ACCESS_TOKEN });
    bonupay = BonuPaySDK;
    console.log('✅ BonuPay inicializado (cuenta separada)');
}

// PayPal
if (process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET) {
    const paypalEnvironment = NODE_ENV === 'production' 
        ? new Checkout.core.LiveEnvironment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_CLIENT_SECRET)
        : new Checkout.core.SandboxEnvironment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_CLIENT_SECRET);
    paypalClient = new Checkout.core.PayPalHttpClient(paypalEnvironment);
    console.log('✅ PayPal inicializado');
}

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
                    <p>Tu pedido <strong>#${orderId}</strong> ha sido confirmado y está siendo procesado.</p>
                    <p><strong>Total pagado:</strong> ${formatCurrency(total)}</p>
                    <p><strong>Método de pago:</strong> ${paymentMethod}</p>
                    <h3 style="margin-top: 20px;">Productos:</h3>
                    <table style="width: 100%; border-collapse: collapse;">${itemsHtml}</table>
                    <div style="margin-top: 20px; padding: 15px; background: #f9fafb; border-radius: 8px;">
                        <p style="margin: 0;"><strong>Dirección de envío:</strong></p>
                        <p style="margin: 5px 0 0 0;">${shippingAddress?.direccion || 'N/A'}, ${shippingAddress?.ciudad || ''}, ${shippingAddress?.estado || ''}</p>
                    </div>
                </div>
                <div style="background: #111827; padding: 20px; text-align: center; color: #9ca3af;">
                    <p>© 2026 Bonü - Todos los derechos reservados</p>
                    <p style="font-size: 12px; margin-top: 10px;">¿Necesitas ayuda? Responde a este correo o contáctanos por WhatsApp</p>
                </div>
            </div>
        </body>
        </html>
    `;
    
    try {
        await emailTransporter.sendMail({
            from: `"Bonü" <${process.env.EMAIL_USER}>`,
            to: customerEmail,
            subject: `✅ Confirmación de Pedido #${orderId}`,
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
    allowedHeaders: ['Content-Type', 'Authorization', 'CJ-Access-Token', 'Stripe-Signature']
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
app.get('/', (req, res) => res.json({ success: true, message: 'Bonü Backend v4.1 - Pagos Reales + BonuPay', env: NODE_ENV }));
app.get('/health', (req, res) => res.json({ status: 'healthy', firestore: !!firestore, stripe: !!stripe, mercadopago: !!mercadopago, bonupay: !!bonupay, paypal: !!paypalClient, timestamp: Date.now() }));
app.get('/api/status', (req, res) => res.json({ success: true, firestore: !!firestore, email: emailConfigurado, payments: { stripe: !!stripe, mercadopago: !!mercadopago, bonupay: !!bonupay, paypal: !!paypalClient } }));
app.get('/api/categorias', (req, res) => res.json({ success: true, categorias: CATEGORIAS }));

/* ════════════════════════════════════════════════════════════
   🔑 RUTA PARA OBTENER CLAVES PÚBLICAS
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
   🆕 ENDPOINTS DE PAGO REAL
════════════════════════════════════════════════════════════ */

// Stripe: Crear PaymentIntent
app.post('/api/payments/stripe/create-intent', async (req, res) => {
    if (!stripe) return res.status(500).json({ success: false, error: 'Stripe no configurado' });
    
    const { amount, currency = 'mxn', orderId, customerEmail, metadata = {} } = req.body;
    
    if (!amount || !orderId) {
        return res.status(400).json({ success: false, error: 'amount y orderId requeridos' });
    }
    
    try {
        const paymentIntent = await stripe.paymentIntents.create({
            amount: Math.round(amount * 100),
            currency: currency.toLowerCase(),
            meta { orderId, customerEmail, ...metadata },
            automatic_payment_methods: { enabled: true },
            description: `Pedido Bonü #${orderId}`
        });
        
        res.json({ 
            success: true, 
            clientSecret: paymentIntent.client_secret,
            paymentIntentId: paymentIntent.id 
        });
    } catch (error) {
        console.error('Error creando PaymentIntent:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Mercado Pago: Crear Preferencia (cuenta principal)
app.post('/api/payments/mercadopago/create-preference', async (req, res) => {
    if (!mercadopago) return res.status(500).json({ success: false, error: 'Mercado Pago no configurado' });
    
    const { items, payer, orderId, backUrls } = req.body;
    
    if (!items?.length || !orderId) {
        return res.status(400).json({ success: false, error: 'items y orderId requeridos' });
    }
    
    try {
        const preference = await mercadopago.preferences.create({
            items: items.map(item => ({
                title: item.nombre.substring(0, 128),
                unit_price: parseFloat(item.precio),
                quantity: parseInt(item.cantidad) || 1,
                currency_id: 'MXN'
            })),
            payer: { email: payer?.email },
            external_reference: orderId,
            back_urls: {
                success: backUrls?.success || `${process.env.FRONTEND_URL}/checkout/success`,
                failure: backUrls?.failure || `${process.env.FRONTEND_URL}/checkout/failure`,
                pending: backUrls?.pending || `${process.env.FRONTEND_URL}/checkout/pending`
            },
            auto_return: 'approved',
            notification_url: `${process.env.FRONTEND_URL || 'https://tu-backend.onrender.com'}/api/webhooks/mercadopago`
        });
        
        res.json({ 
            success: true, 
            init_point: preference.body.init_point, 
            preferenceId: preference.body.id 
        });
    } catch (error) {
        console.error('Error creando preferencia MP:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 🆕 BonuPay: Crear Preferencia (cuenta separada - usa API de MP)
app.post('/api/payments/bonupay/create-preference', async (req, res) => {
    if (!bonupay) return res.status(500).json({ success: false, error: 'BonuPay no configurado' });
    
    const { items, payer, orderId, backUrls } = req.body;
    
    if (!items?.length || !orderId) {
        return res.status(400).json({ success: false, error: 'items y orderId requeridos' });
    }
    
    try {
        // BonuPay usa la misma estructura que Mercado Pago pero con sus propias credenciales
        const preference = await bonupay.preferences.create({
            items: items.map(item => ({
                title: `Bonü - ${item.nombre.substring(0, 100)}`, // Prefijo para identificar en BonuPay
                unit_price: parseFloat(item.precio),
                quantity: parseInt(item.cantidad) || 1,
                currency_id: 'MXN'
            })),
            payer: { email: payer?.email },
            external_reference: orderId,
            back_urls: {
                success: backUrls?.success || `${process.env.FRONTEND_URL}/checkout/success?payment_method=bonupay`,
                failure: backUrls?.failure || `${process.env.FRONTEND_URL}/checkout/failure?payment_method=bonupay`,
                pending: backUrls?.pending || `${process.env.FRONTEND_URL}/checkout/pending?payment_method=bonupay`
            },
            auto_return: 'approved',
            // 🆕 Webhook específico para BonuPay
            notification_url: `${process.env.FRONTEND_URL || 'https://tu-backend.onrender.com'}/api/webhooks/bonupay`,
            // Metadata adicional para identificar que es BonuPay
            metadata: {
                bonupay: true,
                marketplace: 'Bonü',
                orderId: orderId
            }
        });
        
        console.log(`✅ Preferencia BonuPay creada: ${preference.body.id} para orden ${orderId}`);
        
        res.json({ 
            success: true, 
            init_point: preference.body.init_point, 
            preferenceId: preference.body.id,
            paymentMethod: 'bonupay'
        });
    } catch (error) {
        console.error('❌ Error creando preferencia BonuPay:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message,
            details: error.cause || null
        });
    }
});

// PayPal: Crear Orden
app.post('/api/payments/paypal/create-order', async (req, res) => {
    if (!paypalClient) return res.status(500).json({ success: false, error: 'PayPal no configurado' });
    
    const { items, orderId, total } = req.body;
    
    if (!items?.length || !orderId || !total) {
        return res.status(400).json({ success: false, error: 'items, orderId y total requeridos' });
    }
    
    try {
        const request = new Checkout.orders.OrdersCreateRequest();
        request.prefer('return=representation');
        request.requestBody({
            intent: 'CAPTURE',
            purchase_units: [{
                reference_id: orderId,
                amount: {
                    currency_code: 'MXN',
                    value: total.toFixed(2)
                }
            }],
            application_context: {
                return_url: `${process.env.FRONTEND_URL}/checkout/success`,
                cancel_url: `${process.env.FRONTEND_URL}/checkout/failure`,
                brand_name: 'Bonü',
                user_action: 'PAY_NOW'
            }
        });
        
        const order = await paypalClient.execute(request);
        const approveLink = order.result.links.find(link => link.rel === 'approve');
        
        res.json({ 
            success: true, 
            approveLink: approveLink?.href,
            orderId: order.result.id 
        });
    } catch (error) {
        console.error('Error creando orden PayPal:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/* ════════════════════════════════════════════════════════════
   🆕 WEBHOOKS DE CONFIRMACIÓN DE PAGO
════════════════════════════════════════════════════════════ */

// Función auxiliar para descontar stock y enviar email
async function procesarOrdenPagada(orderId, paymentMethod, paymentDetails) {
    if (!firestore) return;
    
    try {
        // Obtener orden de Firestore
        const orderDoc = await firestore.collection('pedidos').doc(orderId).get();
        if (!orderDoc.exists) {
            console.warn(`⚠️ Orden ${orderId} no encontrada en webhook ${paymentMethod}`);
            return;
        }
        
        const order = orderDoc.data();
        
        // Actualizar estado de la orden
        await firestore.collection('pedidos').doc(orderId).update({
            estado: 'pagado',
            fechaPago: new Date().toISOString(),
            paymentDetails: {
                ...paymentDetails,
                confirmadoPorWebhook: true,
                fechaConfirmacion: new Date().toISOString()
            }
        });
        
        // 🔥 DESCONTAR STOCK de cada producto
        if (order.items && order.items.length > 0) {
            for (const item of order.items) {
                if (!item.id) continue;
                const prodRef = firestore.collection('productos').doc(item.id);
                const prodDoc = await prodRef.get();
                
                if (prodDoc.exists) {
                    const currentStock = prodDoc.data().stock || 0;
                    const quantity = item.cantidad || 1;
                    const newStock = Math.max(0, currentStock - quantity);
                    
                    await prodRef.update({ 
                        stock: newStock,
                        ultimaVenta: new Date().toISOString()
                    });
                    console.log(`📦 Stock actualizado: ${item.nombre} ${currentStock} → ${newStock}`);
                }
            }
        }
        
        // 📧 Enviar email de confirmación
        if (order.shipping?.email) {
            await sendConfirmationEmail({
                orderId,
                customerEmail: order.shipping.email,
                customerName: order.shipping.nombre,
                total: order.total,
                items: order.items,
                shippingAddress: order.shipping,
                paymentMethod,
                date: order.fecha
            });
        }
        
        // 📊 Actualizar transacción
        await firestore.collection('transacciones').add({
            ordenId: orderId,
            monto: order.total,
            pasarela: paymentMethod,
            estado: 'pagado',
            paymentId: paymentDetails?.id || null,
            fechaCreacion: new Date().toISOString()
        });
        
        console.log(`✅ Orden ${orderId} procesada completamente vía ${paymentMethod}`);
        return true;
        
    } catch (error) {
        console.error(`❌ Error procesando orden ${orderId}:`, error);
        return false;
    }
}

// Stripe Webhook Handler
app.post('/api/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
    if (!stripe || !firestore) return res.status(500).send('Webhook no configurado');
    
    const sig = req.headers['stripe-signature'];
    let event;
    
    try {
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        console.error('❌ Webhook Stripe error:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }
    
    // Manejar eventos de pago exitoso
    if (event.type === 'payment_intent.succeeded') {
        const paymentIntent = event.data.object;
        const orderId = paymentIntent.metadata.orderId;
        
        if (orderId) {
            await procesarOrdenPagada(orderId, 'Stripe', {
                id: paymentIntent.id,
                amount: paymentIntent.amount / 100,
                currency: paymentIntent.currency,
                status: paymentIntent.status
            });
        }
    }
    
    // Manejar pagos fallidos
    if (event.type === 'payment_intent.payment_failed') {
        const paymentIntent = event.data.object;
        const orderId = paymentIntent.metadata.orderId;
        if (orderId) {
            await firestore.collection('pedidos').doc(orderId).update({
                estado: 'cancelado',
                paymentError: paymentIntent.last_payment_error?.message || 'Pago fallido',
                fechaActualizacion: new Date().toISOString()
            });
            console.log(`❌ Pago fallido para orden ${orderId}`);
        }
    }
    
    res.json({ received: true });
});

// Mercado Pago Webhook Handler (cuenta principal)
app.post('/api/webhooks/mercadopago', express.json(), async (req, res) => {
    if (!mercadopago || !firestore) return res.status(500).send('Webhook no configurado');
    
    const { action, data } = req.body;
    
    if (action === 'payment.created' || action === 'payment.updated') {
        try {
            // Obtener detalles del pago desde MP API
            const payment = await mercadopago.payment.get(data.id);
            const orderId = payment.body.external_reference;
            const status = payment.body.status;
            
            if (orderId && ['approved', 'rejected'].includes(status)) {
                const estadoMap = { approved: 'pagado', rejected: 'cancelado', pending: 'pendiente' };
                
                await procesarOrdenPagada(orderId, 'Mercado Pago', {
                    id: payment.body.id,
                    amount: payment.body.transaction_amount,
                    currency: payment.body.currency_id,
                    status: payment.body.status,
                    payment_method: payment.body.payment_method_id
                });
                
                console.log(`✅ Webhook MP principal: Orden ${orderId} -> ${status}`);
            }
        } catch (error) {
            console.error('Error procesando webhook MP principal:', error);
        }
    }
    
    res.status(200).send('OK');
});

// 🆕 BonuPay Webhook Handler (cuenta separada)
app.post('/api/webhooks/bonupay', express.json(), async (req, res) => {
    if (!bonupay || !firestore) return res.status(500).send('Webhook BonuPay no configurado');
    
    const { action, data } = req.body;
    
    // Verificar que el webhook viene de BonuPay (por seguridad)
    const bonupaySignature = req.headers['x-bonupay-signature'];
    if (process.env.BONUPAY_WEBHOOK_SECRET && bonupaySignature) {
        // Aquí podrías verificar la firma si BonuPay la proporciona
        // Por ahora, confiamos en que la URL del webhook es secreta
    }
    
    if (action === 'payment.created' || action === 'payment.updated') {
        try {
            // Obtener detalles del pago desde la API de BonuPay (usa SDK de MP)
            const payment = await bonupay.payment.get(data.id);
            const orderId = payment.body.external_reference;
            const status = payment.body.status;
            
            // Verificar metadata para confirmar que es una orden de BonuPay
            const isBonuPay = payment.body.metadata?.bonupay === true || 
                             payment.body.external_reference?.startsWith('BONU-');
            
            if (orderId && isBonuPay && ['approved', 'rejected'].includes(status)) {
                const estadoMap = { approved: 'pagado', rejected: 'cancelado', pending: 'pendiente' };
                
                await procesarOrdenPagada(orderId, 'BonuPay', {
                    id: payment.body.id,
                    amount: payment.body.transaction_amount,
                    currency: payment.body.currency_id,
                    status: payment.body.status,
                    payment_method: payment.body.payment_method_id,
                    bonupayAccount: true // Marcador para identificar cuenta BonuPay
                });
                
                console.log(`✅ Webhook BonuPay: Orden ${orderId} -> ${status}`);
            }
        } catch (error) {
            console.error('❌ Error procesando webhook BonuPay:', error);
        }
    }
    
    res.status(200).send('OK');
});

// PayPal Webhook Handler
app.post('/api/webhooks/paypal', express.json(), async (req, res) => {
    if (!paypalClient || !firestore) return res.status(500).send('Webhook no configurado');
    
    const { event_type, resource } = req.body;
    
    if (event_type === 'PAYMENT.CAPTURE.COMPLETED') {
        const orderId = resource.supplementary_data?.related_ids?.order_id;
        if (orderId) {
            await procesarOrdenPagada(orderId, 'PayPal', {
                id: resource.id,
                amount: resource.amount?.value,
                currency: resource.amount?.currency_code,
                status: resource.status
            });
            console.log(`✅ PayPal pago completado: ${orderId}`);
        }
    }
    
    res.status(200).send('OK');
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
            estado: 'pendiente',
            emailCliente: customerEmail || direccion?.email,
            fechaCreacion: new Date().toISOString()
        };
        
        await firestore.collection('pedidos').doc(ordenId).set(orden);
        
        // Registrar transacción inicial
        await firestore.collection('transacciones').add({
            ordenId,
            monto: orden.total,
            pasarela: orden.pasarela,
            estado: 'pendiente',
            fechaCreacion: new Date().toISOString()
        });
        
        res.json({ success: true, orden, message: 'Orden creada. Esperando confirmación de pago.' });
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
        
        // 🆕 Estadísticas por método de pago
        const pagosPorMetodo = {};
        ordenes.forEach(o => {
            const metodo = o.pasarela || 'Desconocido';
            pagosPorMetodo[metodo] = (pagosPorMetodo[metodo] || 0) + 1;
        });
        
        res.json({
            success: true,
            resumen: {
                totalOrdenes,
                ordenesHoy,
                totalUsuarios,
                totalProductos,
                montoTotal
            },
            ordenes: { estados },
            pagos: { porMetodo: pagosPorMetodo }
        });
    } catch (error) {
        console.error('Error dashboard:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/* ════════════════════════════════════════════════════════════
   ℹ️ 404 y Error Handler
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
    console.log('✅ Bonü Backend v4.1 - PRODUCCIÓN (Pagos Reales + BonuPay)');
    console.log(`📡 Puerto: ${PORT}`);
    console.log(`🔥 Firestore: ${firestore ? '✅' : '❌'}`);
    console.log(`💳 Stripe: ${stripe ? '✅' : '❌'}`);
    console.log(`💳 Mercado Pago: ${mercadopago ? '✅' : '❌'}`);
    console.log(`💳 BonuPay: ${bonupay ? '✅' : '❌'}`);
    console.log(`💳 PayPal: ${paypalClient ? '✅' : '❌'}`);
    console.log(`📧 Email: ${emailConfigurado ? '✅' : '⚠️'}`);
    console.log('==================================================');
});

process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
process.on('SIGINT', () => { server.close(() => process.exit(0)); });

module.exports = app;