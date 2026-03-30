// ✅ bonu-backend/index.js - Express 4.x + Railway Compatible
require('dotenv').config();

const express = require('express');
const cors = require('cors');

const app = express();

// ✅ IMPORTANTE: Usar process.env.PORT sin valor por defecto en Railway
const PORT = process.env.PORT;

// CORS para permitir conexiones desde Firebase y otros orígenes
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'] }));
app.use(express.json());

// Logging
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// ✅ Rutas esenciales
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Bonü Backend OK',
    port: PORT,
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.get('/api/status', (req, res) => {
  res.json({ success: true, message: 'Backend activo' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found', path: req.url });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ✅ Iniciar servidor - SIN especificar host, Railway lo maneja
app.listen(PORT, () => {
  console.log(`🚀 Server ready on port ${PORT}`);
});

// ✅ Mantener el proceso vivo (evita que Node.js termine)
process.stdin.resume();