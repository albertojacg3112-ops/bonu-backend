// ✅ bonu-backend/index.js - VERSIÓN PRODUCCIÓN CON .env
require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3001;

// Configuración CJ DESDE .env (seguro)
const CJ_API_KEY = process.env.CJ_API_KEY;
const CJ_BASE64 = process.env.CJ_BASE64_AUTH;  // ← usa su variable
const CJ_API_URL = "https://developers.cjdropshipping.com/api2.0";

// Validar credenciales al arrancar
if (!CJ_API_KEY || !CJ_BASE64) {
    console.error('❌ ERROR: Faltan credenciales CJ en .env');
    console.error('   CJ_API_KEY y CJ_BASE64_AUTH son obligatorias');
    process.exit(1);
}

// Configuración CORS desde .env
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5500,http://127.0.0.1:5500,http://localhost:3000').split(',');

app.use(cors({
    origin: function (origin, callback) {
        // Permitir sin origen (postman, etc) o si está en lista
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error(`Origen ${origin} no permitido por CORS`));
        }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true
}));

app.use(express.json({ limit: '10mb' }));

// ============ ENDPOINTS BÁSICOS ============
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'healthy', 
        port: PORT, 
        env: process.env.NODE_ENV,
        time: Date.now() 
    });
});

app.get('/', (req, res) => {
    res.json({ 
        success: true, 
        message: 'Bonü Backend Activo 🚀', 
        version: '2.0',
        env: process.env.NODE_ENV,
        port: PORT 
    });
});

app.get('/api/status', (req, res) => {
    res.json({ 
        success: true, 
        message: 'Backend operativo', 
        timestamp: Date.now(),
        cjConfigured: !!CJ_API_KEY
    });
});

// ============ ENDPOINT PRINCIPAL - IMPORTAR PRODUCTOS ============
app.post('/api/cj/import', async (req, res) => {
    const { sku, precioVenta, costoCJ, tipo } = req.body;
    
    console.log(`📦 [IMPORT] SKU: ${sku} | Precio: $${precioVenta}`);
    
    if (!sku) {
        return res.status(400).json({ success: false, error: 'SKU requerido' });
    }
    
    try {
        // Buscar producto en CJ
        const productData = await buscarProductoEnCJ(sku);
        
        if (!productData) {
            return res.status(404).json({ success: false, error: 'Producto no encontrado en CJ' });
        }
        
        // Obtener imágenes detalladas
        const imagenes = await obtenerImagenesDetalladasCJ(productData.pid || productData.id);
        
        // Estructura completa para el frontend
        const productResponse = {
            id: productData.pid || productData.id || sku,
            nombre: productData.productName || productData.name || `Producto ${sku}`,
            descripcion: productData.description || productData.desc || 'Sin descripción disponible',
            categoria: productData.categoryName || productData.category || 'General',
            precio: parseFloat(precioVenta) || 299,
            precioVenta: parseFloat(precioVenta) || 299,
            costoCJ: parseFloat(costoCJ) || 0,
            stock: productData.stock || 100,
            tallas: productData.sizes?.join(', ') || productData.sizeList?.join(', ') || 'Única',
            colores: productData.colors?.join(', ') || productData.colorList?.join(', ') || 'Único',
            medidas: productData.dimensions || productData.size || '',
            tipo: tipo || 'Ofertas',
            imagenes: imagenes,
            cjData: {
                imagenes: imagenes,
                rating: productData.rating || 4.5,
                reviews: productData.reviews || 0,
                sku: sku,
                pid: productData.pid || productData.id
            }
        };
        
        console.log(`✅ Producto importado: ${productResponse.nombre}`);
        
        res.json({
            success: true,
            message: 'Producto importado correctamente',
            product: productResponse
        });
        
    } catch (error) {
        console.error('❌ Error importando:', error.message);
        res.status(500).json({ 
            success: false, 
            error: error.message
        });
    }
});

// ============ FUNCIÓN: BUSCAR PRODUCTO POR SKU ============
async function buscarProductoEnCJ(sku) {
    console.log(`🔍 Buscando SKU: ${sku}`);
    
    const response = await fetch(`${CJ_API_URL}/product/list`, {
        method: 'POST',
        headers: {
            'api-key': CJ_API_KEY,
            'authorization': CJ_BASE64,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ sku, page: 1, pageSize: 1 })
    });
    
    const data = await response.json();
    console.log(`📡 Respuesta CJ: código ${data.code}`);
    
    if (data.code === 0 && data.data?.list?.length > 0) {
        return data.data.list[0];
    }
    
    throw new Error(`Producto con SKU ${sku} no encontrado en CJ`);
}

// ============ FUNCIÓN: OBTENER IMÁGENES DETALLADAS ============
async function obtenerImagenesDetalladasCJ(pid) {
    try {
        const response = await fetch(`${CJ_API_URL}/product/detail`, {
            method: 'POST',
            headers: {
                'api-key': CJ_API_KEY,
                'authorization': CJ_BASE64,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ pid })
        });
        
        const data = await response.json();
        
        // Formato correcto de imágenes
        if (data.code === 0 && data.data?.productImageList?.length) {
            return data.data.productImageList.map(img => img.imageUrl);
        }
        
        // Fallback alternativo
        if (data.data?.imageList?.length) {
            return data.data.imageList.map(img => img.url);
        }
        
        // Imagen por defecto
        return ['https://via.placeholder.com/500?text=CJ+Producto'];
        
    } catch (error) {
        console.error('Error obteniendo imágenes:', error.message);
        return ['https://via.placeholder.com/500?text=Error+Imagen'];
    }
}

// ============ ENDPOINT DE PRUEBA ============
app.post('/api/cj/test', async (req, res) => {
    const { sku } = req.body;
    try {
        const product = await buscarProductoEnCJ(sku);
        res.json({ success: true, product });
    } catch (error) {
        res.status(404).json({ success: false, error: error.message });
    }
});

// ============ ENDPOINT PARA VERIFICAR CREDENCIALES (SOLO DEV) ============
if (process.env.NODE_ENV === 'development') {
    app.get('/api/debug/cj-config', (req, res) => {
        res.json({
            hasApiKey: !!CJ_API_KEY,
            hasBase64: !!CJ_BASE64,
            apiKeyPrefix: CJ_API_KEY ? CJ_API_KEY.substring(0, 10) + '...' : null,
            env: process.env.NODE_ENV
        });
    });
}

// ============ MANEJADOR 404 ============
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint no encontrado' });
});

// ============ MANEJADOR DE ERRORES GLOBAL ============
app.use((err, req, res, next) => {
    console.error('❌ Error no capturado:', err);
    res.status(500).json({ 
        success: false, 
        error: 'Error interno del servidor',
        message: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

// ============ INICIAR SERVIDOR ============
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log('='.repeat(50));
    console.log(`✅ Bonü Backend v2.0 ACTIVO`);
    console.log(`📡 Puerto: ${PORT}`);
    console.log(`🌍 Entorno: ${process.env.NODE_ENV || 'production'}`);
    console.log(`🔐 CJ API: ${CJ_API_KEY ? '✅ CONFIGURADA' : '❌ FALTA'}`);
    console.log(`🎨 CORS Orígenes: ${allowedOrigins.length} permitidos`);
    console.log('='.repeat(50));
});

// Configuración para mantener vivo en Render
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;

// Heartbeat cada 30 segundos (solo en producción)
if (process.env.NODE_ENV === 'production') {
    setInterval(() => {
        console.log(`💓 Heartbeat - ${new Date().toISOString()}`);
    }, 30000);
}

// Manejo de cierre graceful
process.on('SIGTERM', () => {
    console.log('🛑 Recibida señal SIGTERM, cerrando servidor...');
    server.close(() => {
        console.log('✅ Servidor cerrado correctamente');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('🛑 Recibida señal SIGINT, cerrando servidor...');
    server.close(() => {
        console.log('✅ Servidor cerrado correctamente');
        process.exit(0);
    });
});