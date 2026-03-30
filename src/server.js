// ✅ Servidor mínimo de prueba para Railway
const http = require('http');

const PORT = process.env.PORT || 8080;

const server = http.createServer((req, res) => {
  console.log(`📩 Request: ${req.method} ${req.url}`);
  
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ 
    success: true, 
    message: 'Bonü Backend - Servidor mínimo funcionando',
    url: req.url,
    timestamp: new Date().toISOString()
  }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor mínimo corriendo en puerto ${PORT}`);
  console.log(`🌐 URL: https://blissful-respect-production-99ff.up.railway.app`);
});

// ✅ Manejar errores no capturados
process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});