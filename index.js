// ✅ bonu-backend/index.js - VERSIÓN PRODUCCIÓN FINAL
require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3001;

// Configuración CJ
const CJ_API_KEY = process.env.CJ_API_KEY || "CJ5275460@api@99b7fedd9f9848399316d534df3ee8ca";
const CJ_BASE64 = process.env.CJ_BASE64_AUTH || "Ym9udS5tYXJrZXRwbGFjZUBnbWFpbC5jb206Q0o1Mjc1NDYwQGFwaUA5OWI3ZmVkZDlmOTg0ODM5OTMxNmQ1MzRkZjNlZThjYQ==";
const CJ_API_URL = "https://developers.cjdropshipping.com/api2.0";

app.use(cors());
app.use(express.json());

// ============ ENDPOINTS DE SALUD ============
app.get('/health', (req, res) => {
    res.json({ status: 'healthy', port: PORT, time: Date.now() });
});

app.get('/', (req, res) => {
    res.json({ success: true, message: 'Bonü Backend Activo - Producción', port: PORT });
});

app.get('/api/status', (req, res) => {
    res.json({ success: true, cjConfigured: true });
});

app.get('/api/cj/test', (req, res) => {
    res.json({ success: true, message: 'Endpoint CJ funcionando' });
});

// ============ NUEVO ENDPOINT: OBTENER TODOS SUS PRODUCTOS ============
app.get('/api/cj/mis-productos', async (req, res) => {
    console.log('📦 Obteniendo lista de productos de CJ...');
    
    try {
        const response = await fetch(`${CJ_API_URL}/product/listed`, {
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
        
        if (data.code === 0 && data.data?.list) {
            const productos = data.data.list.map(p => ({
                pid: p.pid,
                sku: p.sku,
                nombre: p.productName,
                precio: p.price,
                imagenes: p.imageList?.map(img => img.imageUrl) || []
            }));
            
            res.json({ success: true, total: productos.length, productos });
        } else {
            throw new Error(data.msg || 'Error al obtener productos');
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
    
    if (!sku) {
        return res.status(400).json({ success: false, error: 'SKU requerido' });
    }
    
    try {
        // PASO 1: Buscar el producto por SKU en la lista del usuario
        const listResponse = await fetch(`${CJ_API_URL}/product/listed`, {
            method: 'POST',
            headers: {
                'api-key': CJ_API_KEY,
                'authorization': CJ_BASE64,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ page: 1, pageSize: 200 })
        });
        
        const listData = await listResponse.json();
        
        if (listData.code !== 0 || !listData.data?.list) {
            throw new Error('No se pudo obtener la lista de productos');
        }
        
        // Buscar el producto por SKU
        const productoEncontrado = listData.data.list.find(p => p.sku === sku);
        
        if (!productoEncontrado) {
            throw new Error(`Producto con SKU ${sku} no encontrado en su lista de CJ`);
        }
        
        const pid = productoEncontrado.pid;
        console.log(`✅ Producto encontrado. PID: ${pid}`);
        
        // PASO 2: Obtener detalles completos del producto
        const detailResponse = await fetch(`${CJ_API_URL}/product/detail`, {
            method: 'POST',
            headers: {
                'api-key': CJ_API_KEY,
                'authorization': CJ_BASE64,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ pid })
        });
        
        const detailData = await detailResponse.json();
        
        let imagenes = [];
        if (detailData.code === 0 && detailData.data) {
            if (detailData.data.productImageList) {
                imagenes = detailData.data.productImageList.map(img => img.imageUrl || img.url);
            } else if (detailData.data.imageList) {
                imagenes = detailData.data.imageList.map(img => img.imageUrl || img.url);
            }
        }
        
        if (imagenes.length === 0 && productoEncontrado.imageList) {
            imagenes = productoEncontrado.imageList.map(img => img.imageUrl || img.url);
        }
        
        if (imagenes.length === 0) {
            imagenes = ['https://picsum.photos/500/500?random=1'];
        }
        
        // Respuesta exitosa
        res.json({
            success: true,
            message: 'Producto importado correctamente',
            product: {
                id: pid,
                sku: sku,
                nombre: productoEncontrado.productName || `Producto ${sku}`,
                descripcion: productoEncontrado.description || detailData.data?.description || 'Sin descripción',
                categoria: productoEncontrado.categoryName || detailData.data?.categoryName || 'General',
                precio: parseFloat(precioVenta) || 299,
                precioVenta: parseFloat(precioVenta) || 299,
                costoCJ: parseFloat(costoCJ) || 0,
                stock: productoEncontrado.stock || 100,
                tallas: productoEncontrado.sizes?.join(', ') || '',
                colores: productoEncontrado.colors?.join(', ') || '',
                medidas: productoEncontrado.dimensions || '',
                tipo: tipo || 'Ofertas',
                imagenes: imagenes
            }
        });
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 404
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint no encontrado' });
});

// Iniciar servidor
app.listen(PORT, '0.0.0.0', () => {
    console.log('==================================================');
    console.log('✅ Bonü Backend LISTO PARA PRODUCCIÓN');
    console.log(`📡 Puerto: ${PORT}`);
    console.log(`🔐 CJ API: CONFIGURADA`);
    console.log(`🌐 URL: https://bonu-backend.onrender.com`);
    console.log('==================================================');
});