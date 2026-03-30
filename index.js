// ✅ bonu-backend/index.js - Railway Final Fix
require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT;

if (!PORT) {
  console.error('❌ PORT not set');
  process.exit(1);
}

// ✅ Timeouts para evitar que Railway cierre la conexión prematuramente
const KEEP_ALIVE = 65000;
const HEADERS_TIMEOUT = 66000;

// CORS + JSON
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'] }));
app.use(express.json());

// ✅ Health check endpoint (Railway lo usa para verificar que está vivo)
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy', port: PORT, time: Date.now() });
});

// ✅ Root endpoint
app.get('/', (req, res) => {
  res.json({ success: true, message: 'Bonü Backend OK 🎉', port: PORT });
});

// Catch-all
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ✅ Iniciar servidor con 0.0.0.0
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Listening on 0.0.0.0:${PORT}`);
});

// ✅ Configurar timeouts (CRUCIAL para Railway)
server.keepAliveTimeout = KEEP_ALIVE;
server.headersTimeout = HEADERS_TIMEOUT;

// ✅ Mantener proceso vivo indefinidamente
setInterval(() => {
  // Heartbeat para evitar que el contenedor se duerma
  console.log(`💓 Heartbeat - port ${PORT}`);
}, 30000);

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 Closing...');
  server.close(() => process.exit(0));
});