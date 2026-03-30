// ✅ bonu-backend/index.js - Railway Compatible (Puerto + Debug)
require('dotenv').config({ debug: true });

const express = require('express');
const cors = require('cors');

const app = express();

// ✅ CRUCIAL: Railway asigna PORT, usamos fallback solo para desarrollo local
const PORT = process.env.PORT || 3000;

console.log('=== 🚀 BONÜ BACKEND STARTING ===');
console.log(`📦 process.env.PORT: "${process.env.PORT}"`);
console.log(`🔧 PORT variable: ${PORT}`);
console.log(`🔑 CJ_API_KEY loaded: ${!!process.env.CJ_API_KEY}`);
console.log(`🌐 NODE_ENV: ${process.env.NODE_ENV || 'not-set'}`);
console.log('=================================');

// CORS
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'] }));
app.use(express.json());

// Logging middleware
app.use((req, res, next) => {
  console.log(`📥 [${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// ✅ Rutas esenciales
app.get('/', (req, res) => {
  console.log('✅ Root route hit');
  res.json({
    success: true,
    message: 'Bonü Backend OK 🎉',
    port: PORT,
    env_port: process.env.PORT,
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (req, res) => {
  console.log('✅ Health check hit');
  res.status(200).json({ status: 'ok', port: PORT });
});

app.get('/api/status', (req, res) => {
  res.json({ success: true, message: 'Backend activo' });
});

// 404 handler
app.use((req, res) => {
  console.log(`⚠️ 404: ${req.url}`);
  res.status(404).json({ error: 'Not found', path: req.url });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('❌ Error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ✅ Iniciar servidor - ESCUCHANDO EN 0.0.0.0 para Railway
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ SERVER LISTENING on 0.0.0.0:${PORT}`);
  console.log(`🌐 Expected URL: https://<project>.up.railway.app`);
});

// ✅ Mantener proceso vivo + manejo de errores
process.stdin.resume();

process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM - Closing server...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err);
});