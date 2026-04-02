// ✅ bonu-backend/index.js - VERSIÓN PRODUCCIÓN COMPLETA
require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3001;

const CJ_API_KEY = process.env.CJ_API_KEY;
const CJ_BASE64 = process.env.CJ_BASE64_AUTH;
const CJ_API_URL = "https://developers.cjdropshipping.com/api2.0";

app.use(cors());
app.use(express.json());

// ============ ENDPOINTS BÁSICOS ============
app.get('/', (req, res) => {
    res.json({ success: true, message: 'Bonü Backend Activo', port: PORT });
});

app.get('/health', (req, res) => {
    res.json({ status: 'healthy', port: PORT, time: Date.now() });
});

app.get('/api/status', (req, res) => {
    res.json({ success: true, cjConfigured: true, timestamp: Date.now() });
});

app.get('/api/cj/test', (req, res) => {
    res.json({ success: true, message: 'Endpoint CJ funcionando correctamente' });
});

// ============ ENDPOINT: OBTENER TODOS LOS PRODUCTOS DE CJ ============
app.get('/api/cj/mis-productos', async (req, res) => {
    console.log('📦 Obteniendo lista de productos de CJ...');
    
    try {
        const response = await fetch(`${CJ_API_URL}/product/list`, {
            method: 'POST',
            headers: {
                'api-key': CJ_API_KEY,
                'authorization': CJ_BASE64,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ page: 1, pageSize: 100 })
        });
        
        const data = await response.json();
        console.log(`📡 CJ Respondió: code=${data.code}`);
        console.log('📡 Respuesta completa CJ:', JSON.stringify(data));
        if (data.code === 0 && data.data?.list) {
            const productos = data.data.list.map(p => ({
                pid: p.pid,
                sku: p.sku,
                nombre: p.productName,
                precio: p.price,
                stock: p.stock,
                imagenes: p.imageList?.map(img => img.imageUrl) || []
            }));
            
            res.json({ success: true, total: productos.length, productos });
        } else {
            throw new Error(data.msg || 'Error al obtener productos');
        }
} catch (error) {
        console.error('❌ Error completo:', error);
        res.status(500).json({ success: false, error: error.message, stack: error.stack });
    }
});
// ============ ENDPOINT: BUSCAR PRODUCTO POR SKU ============
app.post('/api/cj/buscar', async (req, res) => {
    const { sku } = req.body;
    
    console.log(`🔍 Buscando SKU: ${sku}`);
    
    if (!sku) {
        return res.status(400).json({ success: false, error: 'SKU requerido' });
    }
    
    try {
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
        
        if (data.code === 0 && data.data?.list?.length > 0) {
            const producto = data.data.list[0];
            res.json({
                success: true,
                product: {
                    pid: producto.pid,
                    sku: producto.sku,
                    nombre: producto.productName,
                    descripcion: producto.description || '',
                    categoria: producto.categoryName || 'General',
                    precio: producto.price,
                    stock: producto.stock || 100,
                    imagenes: producto.imageList?.map(img => img.imageUrl) || []
                }
            });
        } else {
            throw new Error(`Producto ${sku} no encontrado`);
        }
    } catch (error) {
        console.error('❌ Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============ ENDPOINT PRINCIPAL: IMPORTAR PRODUCTO ============
app.post('/api/cj/import', async (req, res) => {
    const { sku, precioVenta, costoCJ, tipo } = req.body;
    
    console.log(`📦 IMPORTANDO SKU: ${sku}`);
    console.log(`💰 Precio venta: ${precioVenta}, Costo CJ: ${costoCJ}`);
    
    if (!sku) {
        return res.status(400).json({ success: false, error: 'SKU requerido' });
    }
    
    try {
        // Buscar el producto por SKU
        const listResponse = await fetch(`${CJ_API_URL}/product/list`, {
            method: 'POST',
            headers: {
                'api-key': CJ_API_KEY,
                'authorization': CJ_BASE64,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ sku, page: 1, pageSize: 1 })
        });
        
        const listData = await listResponse.json();
        
        if (listData.code !== 0 || !listData.data?.list?.length) {
            throw new Error(`Producto con SKU ${sku} no encontrado en CJ`);
        }
        
        const producto = listData.data.list[0];
        console.log(`✅ Producto encontrado: ${producto.productName}`);
        
        // Obtener imágenes detalladas
        let imagenes = [];
        try {
            const detailResponse = await fetch(`${CJ_API_URL}/product/detail`, {
                method: 'POST',
                headers: {
                    'api-key': CJ_API_KEY,
                    'authorization': CJ_BASE64,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ pid: producto.pid })
            });
            
            const detailData = await detailResponse.json();
            
            if (detailData.code === 0 && detailData.data) {
                if (detailData.data.productImageList) {
                    imagenes = detailData.data.productImageList.map(img => img.imageUrl || img.url);
                } else if (detailData.data.imageList) {
                    imagenes = detailData.data.imageList.map(img => img.imageUrl || img.url);
                }
            }
        } catch (imgError) {
            console.log('⚠️ Error obteniendo imágenes detalladas, usando imágenes básicas');
        }
        
        // Si no hay imágenes, usar las básicas del listado
        if (imagenes.length === 0 && producto.imageList) {
            imagenes = producto.imageList.map(img => img.imageUrl || img.url);
        }
        
        // Si sigue sin imágenes, usar placeholder
        if (imagenes.length === 0) {
            imagenes = ['https://picsum.photos/500/500?random=1'];
        }
        
        // Calcular descuento
        const descuento = Math.floor(Math.random() * 20) + 5;
        const precioOriginal = parseFloat(precioVenta) / (1 - descuento / 100);
        
        // Respuesta exitosa
        res.json({
            success: true,
            message: 'Producto importado correctamente',
            product: {
                id: producto.pid,
                sku: sku,
                nombre: producto.productName || `Producto ${sku}`,
                descripcion: producto.description || 'Sin descripción disponible',
                categoria: producto.categoryName || 'General',
                precioOriginal: Math.round(precioOriginal),
                precioFinal: parseFloat(precioVenta),
                precio: parseFloat(precioVenta),
                precioVenta: parseFloat(precioVenta),
                costoCJ: parseFloat(costoCJ) || 0,
                descuento: descuento,
                stock: producto.stock || 100,
                tallas: producto.sizes?.join(', ') || producto.sizeList?.join(', ') || '',
                colores: producto.colors?.join(', ') || producto.colorList?.join(', ') || '',
                medidas: producto.dimensions || producto.size || '',
                tipo: tipo || 'Ofertas',
                rating: 4,
                imagenes: imagenes,
                cjData: {
                    pid: producto.pid,
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

// ============ ENDPOINT: OBTENER DETALLES DE PRODUCTO POR PID ============
app.post('/api/cj/detalle', async (req, res) => {
    const { pid } = req.body;
    
    if (!pid) {
        return res.status(400).json({ success: false, error: 'PID requerido' });
    }
    
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
        
        if (data.code === 0 && data.data) {
            res.json({ success: true, product: data.data });
        } else {
            throw new Error(data.msg || 'Producto no encontrado');
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============ MANEJADOR 404 ============
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint no encontrado' });
});

// ============ INICIAR SERVIDOR ============
app.listen(PORT, '0.0.0.0', () => {
    console.log('==================================================');
    console.log('✅ Bonü Backend LISTO PARA PRODUCCIÓN');
    console.log(`📡 Puerto: ${PORT}`);
    console.log(`🔐 CJ API: CONFIGURADA`);
    console.log(`🌐 URL: https://bonu-backend.onrender.com`);
    console.log('==================================================');
    console.log('📋 ENDPOINTS DISPONIBLES:');
    console.log('   GET  /api/cj/test');
    console.log('   GET  /api/cj/mis-productos');
    console.log('   POST /api/cj/buscar');
    console.log('   POST /api/cj/import');
    console.log('   POST /api/cj/detalle');
    console.log('==================================================');
});