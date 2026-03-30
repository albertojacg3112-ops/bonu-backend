// ✅ Servidor compatible con Railway
const http = require('http');

// Railway asigna el puerto mediante process.env.PORT
const PORT = process.env.PORT || 8080;
const HOST = '0.0.0.0';

const server = http.createServer((req, res) => {
  // Log para depuración
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  
  // Responder a cualquier ruta con JSON
  res.writeHead(200, { 
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  });
  
  res.end(JSON.stringify({ 
    success: true, 
    message: 'Bonü Backend - Railway OK',
    port: PORT,
    url: req.url
  }));
});

// ✅ Escuchar en 0.0.0.0 para que Railway pueda conectar
server.listen(PORT, HOST, () => {
  console.log(`✅ Servidor escuchando en ${HOST}:${PORT}`);
  console.log(`🌐 Railway URL: https://blissful-respect-production-99ff.up.railway.app`);
});

// ✅ Mantener el proceso vivo y manejar errores
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM recibido');
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT recibido');
  server.close(() => process.exit(0));
});

// ✅ Prevenir que el proceso termine por errores no capturados
process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('❌ Unhandled Rejection:', reason);
});

// ✅ Mantener el proceso activo (evita que Node.js termine)
setInterval(() => {
  // Solo para mantener el event loop activo
}, 30000);