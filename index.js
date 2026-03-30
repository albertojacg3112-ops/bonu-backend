// ✅ bonu-backend/index.js - Railway Compatible (Strict PORT)
require('dotenv').config();

const express = require('express');
const cors = require('cors');

const app = express();

// ✅ CRUCIAL: Railway DEBE proporcionar PORT. Sin fallback en producción.
const PORT = process.env.PORT;

if (!PORT) {
  console.error('❌ FATAL: PORT environment variable is not set!');
  console.error('💡 Railway should provide this automatically.');
  console.error('🔧 For local dev, run: PORT=3000 node index.js');
  process.exit(1);
}

console.log('=== 🚀 BONÜ BACKEND STARTING ===');
console.log(`📦 PORT from env: "${PORT}"`);
console.log(`🔑 CJ_API_KEY: ${!!process.env.CJ_API_KEY ? 'loaded' : 'MISSING'}`);
console.log(`🌐 NODE_ENV: ${process.env.NODE_ENV || 'not-set'}`);
console.log('=================================');

// CORS
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'] }));
app.use(express.json());

// Logging
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
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (req, res) => {
  console.log('✅ Health check hit');
  res.status(200).json({ status: 'ok', port: PORT });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found', path: req.url });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('❌ Error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ✅ Iniciar servidor - SIN especificar host, Railway lo maneja
const server = app.listen(PORT, () => {
  console.log(`✅ SERVER LISTENING on port ${PORT}`);
  console.log(`🌐 Railway will proxy to this port`);
});

// ✅ Mantener proceso vivo
process.stdin.resume();

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM - Closing...');
  server.close(() => {
    console.log('✅ Closed');
    process.exit(0);
  });
});