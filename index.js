// ✅ bonu-backend/index.js - Express + Railway Compatible
// Railway ejecuta: node index.js

require('dotenv').config();

const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 8080;

// ✅ CORS: Permitir todas las conexiones (Firebase, localhost, etc.)
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// ✅ JSON parser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ✅ Logging simple
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// ✅ Ruta raíz - Health check para Railway
app.get('/', (req, res) => {
  console.log('✅ Request a / recibido');
  res.status(200).json({
    success: true,
    message: 'Bonü Backend - Railway OK 🎉',
    port: PORT,
    env: {
      CJ_API_KEY: !!process.env.CJ_API_KEY,
      NODE_ENV: process.env.NODE_ENV || 'development'
    },
    timestamp: new Date().toISOString()
  });
});

// ✅ Health check endpoint (requerido por algunos proxies)
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime() });
});

// ✅ API status
app.get('/api/status', (req, res) => {
  res.json({
    success: true,
    message: 'Bonü Backend activo',
    timestamp: new Date().toISOString()
  });
});

// ✅ Catch-all para rutas no encontradas (404 JSON, no HTML)
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Ruta no encontrada',
    path: req.url
  });
});

// ✅ Manejo de errores global
app.use((err, req, res, next) => {
  console.error('❌ Error:', err.message);
  res.status(500).json({
    success: false,
    message: 'Error interno del servidor'
  });
});

// ✅ Iniciar servidor - CRUCIAL: 0.0.0.0 para Railway
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Bonü Backend corriendo en ${PORT}`);
  console.log(`✅ Health check: https://blissful-respect-production-99ff.up.railway.app/health`);
});

// ✅ Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM - Cerrando servidor...');
  server.close(() => {
    console.log('✅ Servidor cerrado');
    process.exit(0);
  });
});

// ✅ Prevenir crash por errores no manejados
process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('❌ Unhandled Rejection:', reason);
});