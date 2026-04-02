// ✅ bonu-backend/index.js - VERSIÓN PRODUCCIÓN DEFINITIVA
require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3001;

// Configuración CJ DESDE .env (seguro)
const CJ_API_KEY = process.env.CJ_API_KEY;
const CJ_BASE64 = process.env.CJ_BASE64_AUTH;
const CJ_API_URL = "https://developers.cjdropshipping.com/api2.0";

// Validar credenciales al arrancar
if (!CJ_API_KEY || !CJ_BASE64) {
    console.error('❌ ERROR: Faltan credenciales CJ en .env');
    console.error('   CJ_API_KEY y CJ_BASE64_AUTH son obligatorias');
    process.exit(1);
}

// ============ CORS - TOTALMENTE ABIERTO PARA FUNCIONAR CON FIREBASE ============
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Origin', 'Accept', 'X-Requested-With']
}));

// Responder a OPTIONS preflight
app.options('*', cors());

// Middleware adicional para asegurar CORS
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

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
        version: '3.0',
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
        
        // Obtener todas las imágenes detalladas
        const imagenes = await obtenerImagenesDetalladasCJ(productData.pid || productData.id);
        
        // Obtener información adicional del producto
        const productDetail = await obtenerDetallesCompletosCJ(productData.pid || productData.id);
        
        // Estructura COMPLETA para el frontend
        const productResponse = {
            success: true,
            message: 'Producto importado correctamente',
            product: {
                id: productData.pid || productData.id || sku,
                sku: sku,
                nombre: productData.productName || productData.name || `Producto ${sku}`,
                descripcion: productData.description || productData.desc || 'Sin descripción disponible',
                categoria: productData.categoryName || productData.category || 'General',
                precio: parseFloat(precioVenta) || 299,
                precioVenta: parseFloat(precioVenta) || 299,
                costoCJ: parseFloat(costoCJ) || 0,
                stock: productData.stock || 100,
                tallas: obtenerTallasCompletas(productDetail, productData),
                colores: obtenerColoresCompletos(productDetail, productData),
                medidas: productData.dimensions || productData.size || '',
                peso: productData.weight || productDetail?.data?.weight || '',
                tipo: tipo || 'Ofertas',
                imagenes: imagenes,
                video: productDetail?.data?.productVideo || '',
                variantes: productDetail?.data?.skuList || [],
                cjData: {
                    pid: productData.pid || productData.id,
                    sku: sku,
                    rating: productData.rating || productDetail?.data?.rating || 4.5,
                    reviews: productData.reviews || productDetail?.data?.reviews || 0,
                    soldCount: productData.soldCount || productDetail?.data?.soldCount || 0,
                    imagenes: imagenes,
                    url: `https://www.cjdropshipping.com/products/${productData.pid || productData.id}.html`
                }
            }
        };
        
        console.log(`✅ Producto importado: ${productResponse.product.nombre}`);
        console.log(`📸 Imágenes obtenidas: ${imagenes.length}`);
        
        res.json(productResponse);
        
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
    
    try {
        const response = await fetch(`${CJ_API_URL}/product/list`, {
            method: 'POST',
            headers: {
                'api-key': CJ_API_KEY,
                'authorization': CJ_BASE64,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ sku, page: 1, pageSize: 5 })
        });
        
        const data = await response.json();
        console.log(`📡 Respuesta CJ list: código ${data.code}`);
        
        if (data.code === 0 && data.data?.list?.length > 0) {
            // Buscar el producto exacto por SKU
            const exactProduct = data.data.list.find(p => 
                p.sku === sku || 
                p.productSku === sku ||
                p.pid?.toString() === sku
            );
            
            if (exactProduct) {
                return exactProduct;
            }
            
            // Si no encuentra exacto, devolver el primero
            return data.data.list[0];
        }
        
        throw new Error(`Producto con SKU ${sku} no encontrado en CJ`);
        
    } catch (error) {
        console.error('Error en búsqueda CJ:', error.message);
        throw error;
    }
}

// ============ FUNCIÓN: OBTENER DETALLES COMPLETOS DEL PRODUCTO ============
async function obtenerDetallesCompletosCJ(pid) {
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
        console.log(`📡 Respuesta CJ detail: código ${data.code}`);
        
        if (data.code === 0 && data.data) {
            return data;
        }
        
        return null;
        
    } catch (error) {
        console.error('Error obteniendo detalles:', error.message);
        return null;
    }
}

// ============ FUNCIÓN: OBTENER IMÁGENES DETALLADAS ============
async function obtenerImagenesDetalladasCJ(pid) {
    try {
        const detail = await obtenerDetallesCompletosCJ(pid);
        
        if (detail && detail.data) {
            // Intentar diferentes formatos de imágenes
            const imagenes = [];
            
            // Formato 1: productImageList
            if (detail.data.productImageList?.length) {
                detail.data.productImageList.forEach(img => {
                    if (img.imageUrl) imagenes.push(img.imageUrl);
                });
            }
            
            // Formato 2: imageList
            if (detail.data.imageList?.length) {
                detail.data.imageList.forEach(img => {
                    if (img.url) imagenes.push(img.url);
                });
            }
            
            // Formato 3: images
            if (detail.data.images?.length) {
                imagenes.push(...detail.data.images);
            }
            
            // Formato 4: mainImage + subImages
            if (detail.data.mainImage) {
                imagenes.unshift(detail.data.mainImage);
            }
            
            if (detail.data.subImages?.length) {
                imagenes.push(...detail.data.subImages);
            }
            
            // Limpiar duplicados y URLs vacías
            const imagenesUnicas = [...new Set(imagenes.filter(img => img && img.startsWith('http')))];
            
            if (imagenesUnicas.length > 0) {
                console.log(`📸 Encontradas ${imagenesUnicas.length} imágenes`);
                return imagenesUnicas;
            }
        }
        
        // Imagen por defecto si no hay
        console.log('⚠️ No se encontraron imágenes, usando placeholder');
        return ['https://via.placeholder.com/800x800?text=Bonu+Producto'];
        
    } catch (error) {
        console.error('Error obteniendo imágenes:', error.message);
        return ['https://via.placeholder.com/800x800?text=Bonu+Producto'];
    }
}

// ============ FUNCIÓN: OBTENER TALLAS COMPLETAS ============
function obtenerTallasCompletas(detail, productData) {
    try {
        // Intentar obtener tallas de diferentes fuentes
        if (detail?.data?.sizeList?.length) {
            return detail.data.sizeList.join(', ');
        }
        if (detail?.data?.sizes?.length) {
            return detail.data.sizes.join(', ');
        }
        if (productData?.sizeList?.length) {
            return productData.sizeList.join(', ');
        }
        if (productData?.sizes?.length) {
            return productData.sizes.join(', ');
        }
        if (detail?.data?.skuList?.length) {
            const tallasUnicas = [...new Set(detail.data.skuList.map(sku => sku.size).filter(s => s))];
            if (tallasUnicas.length) return tallasUnicas.join(', ');
        }
        return 'Única';
    } catch (e) {
        return 'Única';
    }
}

// ============ FUNCIÓN: OBTENER COLORES COMPLETOS ============
function obtenerColoresCompletos(detail, productData) {
    try {
        // Intentar obtener colores de diferentes fuentes
        if (detail?.data?.colorList?.length) {
            return detail.data.colorList.join(', ');
        }
        if (detail?.data?.colors?.length) {
            return detail.data.colors.join(', ');
        }
        if (productData?.colorList?.length) {
            return productData.colorList.join(', ');
        }
        if (productData?.colors?.length) {
            return productData.colors.join(', ');
        }
        if (detail?.data?.skuList?.length) {
            const coloresUnicos = [...new Set(detail.data.skuList.map(sku => sku.color).filter(c => c))];
            if (coloresUnicos.length) return coloresUnicos.join(', ');
        }
        return 'Único';
    } catch (e) {
        return 'Único';
    }
}

// ============ ENDPOINT DE PRUEBA ============
app.post('/api/cj/test', async (req, res) => {
    const { sku } = req.body;
    try {
        const product = await buscarProductoEnCJ(sku);
        const detail = await obtenerDetallesCompletosCJ(product.pid || product.id);
        res.json({ 
            success: true, 
            product: product,
            detail: detail?.data
        });
    } catch (error) {
        res.status(404).json({ success: false, error: error.message });
    }
});

// ============ ENDPOINT PARA OBTENER PRODUCTO POR PID ============
app.post('/api/cj/detail', async (req, res) => {
    const { pid } = req.body;
    try {
        const detail = await obtenerDetallesCompletosCJ(pid);
        res.json({ success: true, detail: detail?.data });
    } catch (error) {
        res.status(404).json({ success: false, error: error.message });
    }
});

// ============ ENDPOINT PARA VERIFICAR CREDENCIALES ============
app.get('/api/debug/cj-config', (req, res) => {
    res.json({
        hasApiKey: !!CJ_API_KEY,
        hasBase64: !!CJ_BASE64,
        apiKeyPrefix: CJ_API_KEY ? CJ_API_KEY.substring(0, 10) + '...' : null,
        env: process.env.NODE_ENV
    });
});

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
    console.log(`✅ Bonü Backend v3.0 ACTIVO`);
    console.log(`📡 Puerto: ${PORT}`);
    console.log(`🌍 Entorno: ${process.env.NODE_ENV || 'production'}`);
    console.log(`🔐 CJ API: ${CJ_API_KEY ? '✅ CONFIGURADA' : '❌ FALTA'}`);
    console.log(`🎨 CORS: TOTALMENTE ABIERTO`);
    console.log('='.repeat(50));
});

// Configuración para mantener vivo en Render
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;

// Heartbeat cada 30 segundos
setInterval(() => {
    console.log(`💓 Heartbeat - ${new Date().toISOString()}`);
}, 30000);

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