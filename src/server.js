// ✅ bonu-backend/index.js - Punto de entrada para Railway
// Railway ejecuta: node index.js

const http = require('http');

// Railway asigna el puerto mediante process.env.PORT
const PORT = process.env.PORT || 8080;
const HOST = '0.0.0.0';

console.log(`🚀 Bonü Backend iniciando en puerto ${PORT}...`);

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
    message: 'Bonü Backend - Railway OK 🎉',
    port: PORT,
    url: req.url,
    timestamp: new Date().toISOString()
  }));
});

// ✅ Escuchar en 0.0.0.0 para que Railway pueda conectar
server.listen(PORT, HOST, () => {
  console.log(`✅ Servidor escuchando en ${HOST}:${PORT}`);
  console.log(`🌐 URL pública: https://blissful-respect-production-99ff.up.railway.app`);
});

// ✅ Manejar cierre limpio
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM recibido, cerrando...');
  server.close(() => {
    console.log('✅ Servidor cerrado');
    process.exit(0);
  });
});

// ✅ Prevenir errores no capturados
process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('❌ Unhandled Rejection:', reason);
});