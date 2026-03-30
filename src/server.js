// ✅ dotenv debe ir PRIMERO, antes de cualquier otro require
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const axios = require('axios');

const app = express();

// ✅ Puerto: Railway asigna process.env.PORT automáticamente
const PORT = process.env.PORT || 5000;

// ✅ Middlewares
app.use(cors({
  origin: '*',  // Permitir conexiones desde cualquier origen (Firebase, localhost, etc.)
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(helmet());
app.use(morgan('dev'));
app.use(express.json());

// ✅ Rutas de prueba (para verificar que el backend está activo)
app.get('/', (req, res) => {
  res.json({ 
    success: true, 
    message: 'Bonü Backend activo',
    timestamp: new Date().toISOString(),
    env_loaded: !!process.env.CJ_API_KEY  // true si CJ_API_KEY está cargada
  });
});

app.get('/api/status', (req, res) => {
  res.json({ 
    success: true, 
    message: 'Bonü Backend activo',
    timestamp: new Date().toISOString(),
    env_loaded: !!process.env.CJ_API_KEY
  });
});

// ✅ Ruta de prueba para CJ API (verifica credenciales)
app.get('/api/cj/test', (req, res) => {
  const apiKey = process.env.CJ_API_KEY;
  const base64Auth = process.env.CJ_BASE64_AUTH;
  
  if (!apiKey || !base64Auth) {
    return res.status(500).json({ 
      success: false, 
      message: 'Faltan variables de entorno CJ_API_KEY o CJ_BASE64_AUTH' 
    });
  }
  
  res.json({ 
    success: true, 
    message: 'Credenciales CJ cargadas correctamente',
    api_key_preview: apiKey.substring(0, 10) + '...'  // Solo muestra primeros 10 caracteres por seguridad
  });
});

// ✅ Ruta para importar productos de CJ (placeholder - aquí iría tu lógica real)
app.post('/api/cj/import', async (req, res) => {
  try {
    const { productId, productUrl } = req.body;
    
    if (!productId && !productUrl) {
      return res.status(400).json({ 
        success: false, 
        message: 'Debes proporcionar productId o productUrl' 
      });
    }
    
    // Aquí iría la llamada real a la API de CJ Dropshipping
    // Por ahora, respondemos con éxito para pruebas
    res.json({ 
      success: true, 
      message: 'Producto importado exitosamente (modo prueba)',
      data: { productId, productUrl }
    });
    
  } catch (error) {
    console.error('Error importando producto CJ:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error al importar producto',
      error: error.message 
    });
  }
});

// ✅ Manejo de rutas no encontradas (404)
app.use((req, res) => {
  res.status(404).json({ 
    success: false, 
    message: 'Ruta no encontrada',
    available_routes: ['/', '/api/status', '/api/cj/test', '/api/cj/import']
  });
});

// ✅ Manejo de errores global
app.use((err, req, res, next) => {
  console.error('Error global:', err);
  res.status(500).json({ 
    success: false, 
    message: 'Error interno del servidor',
    error: process.env.NODE_ENV === 'production' ? 'Something went wrong' : err.message 
  });
});

// ✅ Iniciar servidor - ESCUCHANDO EN 0.0.0.0 para Railway
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Bonü Backend corriendo en puerto ${PORT}`);
  console.log(`🔑 CJ_API_KEY cargada: ${!!process.env.CJ_API_KEY}`);
  console.log(`🔑 CJ_BASE64_AUTH cargada: ${!!process.env.CJ_BASE64_AUTH}`);
  console.log(`🌐 URL pública: https://blissful-respect-production-99ff.up.railway.app`);
});

// ✅ Manejar cierre limpio del servidor
process.on('SIGTERM', () => {
  console.log('🛑 Recibido SIGTERM, cerrando servidor...');
  server.close(() => {
    console.log('✅ Servidor cerrado');
    process.exit(0);
  });
});