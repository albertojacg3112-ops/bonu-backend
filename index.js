// ✅ bonu-backend/index.js - Railway Compatible (0.0.0.0 + Strict PORT)
require('dotenv').config();

const express = require('express');
const cors = require('cors');

const app = express();

// ✅ Railway proporciona PORT, sin fallback en producción
const PORT = process.env.PORT;

if (!PORT) {
  console.error('❌ FATAL: PORT environment variable is not set!');
  process.exit(1);
}

console.log('=== 🚀 BONÜ BACKEND STARTING ===');
console.log(`📦 PORT: "${PORT}"`);
console.log(`🔑 CJ_API_KEY: ${!!process.env.CJ_API_KEY ? 'loaded' : 'MISSING'}`);
console.log('=================================');

// CORS + JSON
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'] }));
app.use(express.json());

// Logging
app.use((req, res, next) => {
  console.log(`📥 ${req.method} ${req.url}`);
  next();
});

// ✅ Rutas esenciales
app.get('/', (req, res) => {
  console.log('✅ Root hit');
  res.json({ success: true, message: 'Bonü Backend OK 🎉', port: PORT });
});

app.get('/health', (req, res) => {
  console.log('✅ Health hit');
  res.status(200).json({ status: 'ok', port: PORT });
});

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Not found', path: req.url });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('❌ Error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ✅ CRUCIAL: Escuchar en 0.0.0.0 para que Railway pueda conectar
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ SERVER LISTENING on 0.0.0.0:${PORT}`);
});

// Mantener proceso vivo
process.stdin.resume();

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 Closing...');
  server.close(() => process.exit(0));
});