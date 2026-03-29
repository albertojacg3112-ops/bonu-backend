// src/server.js - ACTUALIZACIÓN COMPATIBLE CON TU FRONTEND
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(helmet());
app.use(cors({
  origin: [
    'http://localhost:5500', 
    'http://127.0.0.1:5500', 
    'http://localhost:3000',
    'file:///' // Para abrir HTML directamente
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'api-key', 'cj-access-token']
}));
app.use(express.json({ limit: '50mb' }));
app.use(morgan('combined'));

// Servir tu frontend estático (opcional, si quieres usar Express como servidor)
app.use(express.static(path.join(__dirname, '../')));

// Ruta principal - sirve tu index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../index.html'));
});

// ==================== API STATUS ====================
app.get('/api/status', (req, res) => {
  res.json({
    success: true,
    message: 'Bonü Backend activo',
    version: '1.0.0',
    cj_configured: !!process.env.CJ_API_KEY,
    firebase_fallback: true // Tu frontend puede seguir usando Firebase
  });
});

// ==================== CJ DROPSHIPPING - ENDPOINT COMPATIBLE ====================
const CJ_BASE_URL = 'https://developers.cjdropshipping.com/api2.0/v1';

// Endpoint que tu frontend ya está llamando: POST /api/cj/import
app.post('/api/cj/import', async (req, res) => {
  try {
    const { sku, precioVenta, costoCJ, tipo } = req.body;

    // Validación básica
    if (!sku) {
      return res.status(400).json({ 
        success: false, 
        message: 'SKU es requerido',
        field: 'sku' 
      });
    }

    // Verificar credenciales CJ
    const apiKey = process.env.CJ_API_KEY;
    const authHeader = process.env.CJ_BASE64_AUTH; // Tu base64 codificado
    
    if (!apiKey || !authHeader) {
      return res.status(500).json({
        success: false,
        message: 'Credenciales de CJ no configuradas en el servidor'
      });
    }

    // 1. Buscar producto por SKU en CJ
    const searchResponse = await axios.post(`${CJ_BASE_URL}/product/list`, {
      sku: sku,
      page: 1,
      pageSize: 1
    }, {
      headers: {
        'api-key': apiKey,
        'authorization': authHeader,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    });

    if (searchResponse.data?.code !== 0 || !searchResponse.data?.data?.list?.[0]) {
      return res.status(404).json({ 
        success: false, 
        message: 'Producto no encontrado en CJ',
        cj_response: searchResponse.data 
      });
    }

    const product = searchResponse.data.data.list[0];

    // 2. Obtener detalles completos (imágenes, variantes, etc.)
    const detailResponse = await axios.post(`${CJ_BASE_URL}/product/detail`, {
      pid: product.pid || product.id
    }, {
      headers: {
        'api-key': apiKey,
        'authorization': authHeader,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    });

    // 3. Procesar imágenes
    const images = detailResponse.data?.data?.imageList?.map(img => ({
      url: img.url,
      thumbnail: img.thumbnailUrl || img.url,
      order: img.sort || 0
    })) || ['https://via.placeholder.com/300?text=CJ+Product'];

    // 4. Transformar a formato compatible con tu frontend
    const config = {
      'Ofertas': { descuentoMin: 5, descuentoMax: 15 },
      'Promociones': { descuentoMin: 10, descuentoMax: 30 },
      'Especiales': { descuentoMin: 5, descuentoMax: 20 },
      'Top': { descuentoMin: 10, descuentoMax: 25 },
      'Chic': { descuentoMin: 5, descuentoMax: 20 },
      'Galante': { descuentoMin: 5, descuentoMax: 20 },
      'SuperBonü': { descuentoMin: 10, descuentoMax: 30 }
    };
    
    const tipoConfig = config[tipo] || config['Ofertas'];
    const descuento = Math.floor(Math.random() * (tipoConfig.descuentoMax - tipoConfig.descuentoMin + 1)) + tipoConfig.descuentoMin;
    const precioOriginal = Math.round(precioVenta / (1 - descuento / 100));

    const bonuProduct = {
      // Campos que tu frontend espera
      id: Date.now(),
      nombre: product.productName || product.title || `Producto ${sku}`,
      descripcion: product.description || 'Producto importado desde CJ Dropshipping',
      categoria: product.categoryName || product.category || 'General',
      tipo: tipo || 'Ofertas',
      
      // Precios
      precioOriginal: precioOriginal,
      precioFinal: parseFloat(precioVenta),
      costoCJ: parseFloat(costoCJ),
      margen: parseFloat(precioVenta) - parseFloat(costoCJ),
      descuento: descuento,
      
      // Metadatos
      rating: 4, // Puedes calcularlo desde reviews de CJ
      stock: product.stock || product.inventory || 100,
      tallas: product.sizes?.join(', ') || product.sizeInfo || '',
      colores: product.colors?.join(', ') || product.colorInfo || '',
      medidas: product.dimensions || product.size || '',
      
      // Imágenes (array de URLs)
      imagenes: images.map(img => img.url),
      
      // Datos CJ originales (para referencia)
      cjData: {
        pid: product.pid || product.id,
        sku: product.sku,
        cjSku: sku,
        importedAt: new Date().toISOString()
      },
      
      importedFromCJ: true
    };

    // 🎯 Respuesta compatible con tu frontend actual
    res.json({
      success: true,
      message: 'Producto importado exitosamente',
      product: bonuProduct,
      profit: {
        unitario: bonuProduct.margen,
        porcentaje: Math.round((bonuProduct.margen / bonuProduct.costoCJ) * 100)
      }
    });

  } catch (error) {
    console.error('❌ Error en /api/cj/import:', {
      message: error.message,
      code: error.code,
      status: error.response?.status,
      data: error.response?.data
    });

    // Manejo específico de errores CJ
    if (error.response?.data?.code === 1600001) {
      return res.status(401).json({
        success: false,
        message: 'Autenticación CJ fallida. Verifica API Key en .env'
      });
    }
    
    if (error.code === 'ECONNABORTED') {
      return res.status(504).json({
        success: false,
        message: 'Timeout al conectar con CJ Dropshipping'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Error al importar producto de CJ',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Error interno del servidor',
      debug: process.env.NODE_ENV === 'development' ? {
        endpoint: error.config?.url,
        method: error.config?.method
      } : undefined
    });
  }
});

// ==================== ENDPOINTS ADICIONALES (OPCIONALES) ====================

// Búsqueda de productos CJ (para autocomplete en admin)
app.get('/api/cj/search', async (req, res) => {
  try {
    const { keyword, page = 1, pageSize = 10 } = req.query;
    
    if (!keyword) {
      return res.status(400).json({ success: false, message: 'Parámetro "keyword" requerido' });
    }

    const response = await axios.post(`${CJ_BASE_URL}/product/list`, {
      keyword,
      page: parseInt(page),
      pageSize: parseInt(pageSize)
    }, {
      headers: {
        'api-key': process.env.CJ_API_KEY,
        'authorization': process.env.CJ_BASE64_AUTH,
        'Content-Type': 'application/json'
      }
    });

    res.json({
      success: response.data?.code === 0,
      data: response.data?.data?.list || [],
      pagination: {
        page: parseInt(page),
        pageSize: parseInt(pageSize),
        total: response.data?.data?.total || 0
      }
    });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Health check para monitoreo
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage()
  });
});

// Manejo de rutas no encontradas (404)
app.use((req, res) => {
  res.status(404).json({ 
    success: false, 
    message: 'Endpoint no encontrado',
    available: ['/api/status', '/api/cj/import', '/api/cj/search', '/api/health']
  });
});

// Middleware de manejo de errores global
app.use((err, req, res, next) => {
  console.error('Error no manejado:', err);
  res.status(500).json({ 
    success: false, 
    message: 'Error interno del servidor',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`\n🚀 Bonü Backend corriendo en http://localhost:${PORT}`);
  console.log(`🔑 CJ API Key configurada: ${process.env.CJ_API_KEY ? '✅ Sí' : '❌ No'}`);
  console.log(`🌐 CORS permitido para: localhost:5500, localhost:3000, file://`);
  console.log(`📁 Sirviendo frontend desde: ${path.join(__dirname, '../')}`);
});

module.exports = app; // Para testing