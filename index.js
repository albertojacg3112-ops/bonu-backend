// ✅ bonu-backend/index.js - Versión CORREGIDA
require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3001;

// Configuración CJ
const CJ_API_KEY = process.env.CJ_API_KEY || "CJ5275460@api@99b7fedd9f9848399316d534df3ee8ca";
const CJ_BASE64 = process.env.CJ_BASE64 || "Ym9udS5tYXJrZXRwbGFjZUBnbWFpbC5jb206Q0o1Mjc1NDYwQGFwaUA5OWI3ZmVkZDlmOTg0ODM5OTMxNmQ1MzRkZjNlZThjYQ==";
const CJ_API_URL = "https://developers.cjdropshipping.com/api2.0";

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'] }));
app.use(express.json({ limit: '10mb' }));

// Health check
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'healthy', port: PORT, time: Date.now() });
});

app.get('/', (req, res) => {
    res.json({ success: true, message: 'Bonü Backend OK 🎉', port: PORT });
});

app.get('/api/status', (req, res) => {
    res.json({ success: true, message: 'Backend activo', timestamp: Date.now() });
});

// ✅ ENDPOINT CORREGIDO - /api/cj/import
app.post('/api/cj/import', async (req, res) => {
    const { sku, precioVenta, costoCJ, tipo } = req.body;
    
    console.log(`📦 Importando CJ SKU: ${sku}`);
    
    if (!sku) {
        return res.status(400).json({ success: false, error: 'SKU requerido' });
    }
    
    try {
        // 1. Buscar producto en CJ
        const productData = await buscarProductoEnCJ(sku);
        
        if (!productData) {
            return res.status(404).json({ success: false, error: 'Producto no encontrado en CJ' });
        }
        
        // 2. Obtener imágenes
        const imagenes = await obtenerImagenesDetalladasCJ(productData.pid || productData.id);
        
        // 3. Respuesta con estructura que espera el frontend
        res.json({
            success: true,
            message: 'Producto importado correctamente',
            product: {
                id: productData.pid || productData.id || sku,
                nombre: productData.productName || productData.name || `Producto ${sku}`,
                descripcion: productData.description || productData.desc || 'Sin descripción',
                categoria: productData.categoryName || productData.category || 'General',
                precio: precioVenta || 299,
                precioVenta: precioVenta || 299,
                costoCJ: costoCJ || 0,
                stock: productData.stock || 100,
                tallas: productData.sizes?.join(', ') || productData.sizeList?.join(', ') || '',
                colores: productData.colors?.join(', ') || productData.colorList?.join(', ') || '',
                medidas: productData.dimensions || productData.size || '',
                tipo: tipo || 'Ofertas',
                cjData: {
                    imagenes: imagenes,
                    rating: productData.rating || 4.5,
                    reviews: productData.reviews || 0,
                    sku: sku
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Error importando CJ:', error.message);
        res.status(500).json({ 
            success: false, 
            error: error.message
        });
    }
});

// Función para buscar producto por SKU
async function buscarProductoEnCJ(sku) {
    console.log(`🔍 Buscando en CJ API: ${sku}`);
    
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
    console.log(`📡 Respuesta CJ: code=${data.code}`);
    
    if (data.code === 0 && data.data?.list?.length) {
        return data.data.list[0];
    }
    
    throw new Error(`Producto con SKU ${sku} no encontrado`);
}

// Función para obtener imágenes detalladas
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
        
        // ✅ CORRECCIÓN: productImageList con imageUrl
        if (data.code === 0 && data.data?.productImageList?.length) {
            return data.data.productImageList.map(img => img.imageUrl);
        }
        
        // Fallback
        if (data.data?.imageList?.length) {
            return data.data.imageList.map(img => img.url);
        }
        
        return ['https://via.placeholder.com/300?text=CJ+Product'];
        
    } catch (error) {
        console.error('Error obteniendo imágenes:', error.message);
        return ['https://via.placeholder.com/300?text=CJ+Error'];
    }
}

// Endpoint adicional para testear SKU
app.post('/api/cj/test', async (req, res) => {
    const { sku } = req.body;
    try {
        const product = await buscarProductoEnCJ(sku);
        res.json({ success: true, product });
    } catch (error) {
        res.status(404).json({ success: false, error: error.message });
    }
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Iniciar servidor
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Bonü Backend listening on port ${PORT}`);
    console.log(`✅ CJ API Ready`);
});

server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;

// Heartbeat
setInterval(() => {
    console.log(`💓 Heartbeat - ${new Date().toISOString()}`);
}, 30000);

process.on('SIGTERM', () => {
    console.log('🛑 Shutting down...');
    server.close(() => process.exit(0));
});