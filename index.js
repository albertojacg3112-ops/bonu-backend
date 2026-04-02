// ✅ bonu-backend/index.js - VERSIÓN FINAL FUNCIONANDO
require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3001;

// Configuración CJ
const CJ_API_KEY = process.env.CJ_API_KEY;
const CJ_BASE64 = process.env.CJ_BASE64_AUTH;
const CJ_API_URL = "https://developers.cjdropshipping.com/api2.0";

// Validación
if (!CJ_API_KEY || !CJ_BASE64) {
    console.error('❌ ERROR: Faltan credenciales CJ');
    process.exit(1);
}

// CORS - Totalmente abierto
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Log de todas las peticiones
app.use((req, res, next) => {
    console.log(`📡 ${req.method} ${req.url}`);
    next();
});

// ============ ENDPOINTS ============
app.get('/health', (req, res) => {
    res.json({ status: 'healthy', port: PORT, time: Date.now() });
});

app.get('/', (req, res) => {
    res.json({ success: true, message: 'Bonü Backend Activo', port: PORT });
});

app.get('/api/status', (req, res) => {
    res.json({ success: true, cjConfigured: !!CJ_API_KEY });
});

// ENDPOINT PRINCIPAL - POST
app.post('/api/cj/import', async (req, res) => {
    console.log('🔥 POST /api/cj/import recibido');
    console.log('📦 Body:', req.body);
    
    const { sku, precioVenta, costoCJ, tipo } = req.body;
    
    if (!sku) {
        console.log('❌ SKU faltante');
        return res.status(400).json({ success: false, error: 'SKU requerido' });
    }
    
    try {
        console.log(`🔍 Buscando SKU: ${sku}`);
        
        // Buscar en CJ
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
        console.log(`📡 CJ Response: code=${data.code}`);
        
        if (data.code !== 0 || !data.data?.list?.length) {
            throw new Error(`Producto ${sku} no encontrado`);
        }
        
        const productData = data.data.list[0];
        console.log(`✅ Producto encontrado: ${productData.productName}`);
        
        // Obtener imágenes
        let imagenes = [];
        try {
            const detailRes = await fetch(`${CJ_API_URL}/product/detail`, {
                method: 'POST',
                headers: {
                    'api-key': CJ_API_KEY,
                    'authorization': CJ_BASE64,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ pid: productData.pid || productData.id })
            });
            const detailData = await detailRes.json();
            if (detailData.code === 0 && detailData.data?.productImageList?.length) {
                imagenes = detailData.data.productImageList.map(img => img.imageUrl);
            }
        } catch (e) {
            console.log('⚠️ Error obteniendo imágenes:', e.message);
        }
        
        if (imagenes.length === 0) {
            imagenes = ['https://via.placeholder.com/500?text=CJ+Producto'];
        }
        
        // Respuesta
        res.json({
            success: true,
            message: 'Producto importado correctamente',
            product: {
                id: productData.pid || productData.id || sku,
                sku: sku,
                nombre: productData.productName || `Producto ${sku}`,
                descripcion: productData.description || 'Sin descripción',
                categoria: productData.categoryName || 'General',
                precio: parseFloat(precioVenta) || 299,
                precioVenta: parseFloat(precioVenta) || 299,
                costoCJ: parseFloat(costoCJ) || 0,
                stock: productData.stock || 100,
                tallas: productData.sizes?.join(', ') || '',
                colores: productData.colors?.join(', ') || '',
                medidas: productData.dimensions || '',
                tipo: tipo || 'Ofertas',
                imagenes: imagenes,
                cjData: {
                    pid: productData.pid || productData.id,
                    sku: sku,
                    imagenes: imagenes
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Endpoint de prueba GET
app.get('/api/cj/test', (req, res) => {
    res.json({ success: true, message: 'Endpoint de prueba funcionando' });
});

// 404
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint no encontrado' });
});

// Iniciar servidor
app.listen(PORT, '0.0.0.0', () => {
    console.log('='.repeat(50));
    console.log(`✅ Bonü Backend ACTIVO`);
    console.log(`📡 Puerto: ${PORT}`);
    console.log(`🔐 CJ API: ${CJ_API_KEY ? 'CONFIGURADA' : 'FALTA'}`);
    console.log('='.repeat(50));
});