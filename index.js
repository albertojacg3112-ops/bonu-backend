// ✅ bonu-backend/index.js - Render Compatible
require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT;

if (!PORT) {
  console.error('❌ PORT not set');
  process.exit(1);
}

const KEEP_ALIVE = 65000;
const HEADERS_TIMEOUT = 66000;

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'] }));
app.use(express.json());

// ✅ Health check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy', port: PORT, time: Date.now() });
});

// ✅ Root endpoint
app.get('/', (req, res) => {
  res.json({ success: true, message: 'Bonü Backend OK 🎉', port: PORT });
});

// ✅ NUEVA: Ruta /api/status
app.get('/api/status', (req, res) => {
  res.json({ success: true, message: 'Backend activo' });
});

// ✅ NUEVA: Ruta para importar productos CJ (placeholder)
app.all('/api/cj/import', (req, res) => {
  res.json({ success: true, message: 'Producto importado (modo prueba)' });
});

// Catch-all 404
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Iniciar servidor
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Listening on 0.0.0.0:${PORT}`);
});

server.keepAliveTimeout = KEEP_ALIVE;
server.headersTimeout = HEADERS_TIMEOUT;

// Heartbeat
setInterval(() => {
  console.log(`💓 Heartbeat - port ${PORT}`);
}, 30000);

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 Closing...');
  server.close(() => process.exit(0));
});

// v2 - force redeploy