// ✅ Este archivo es el punto de entrada para Railway
// Railway ejecuta: node index.js
// Este archivo carga el servidor real en src/server.js

console.log('🚀 Iniciando desde index.js...');

// Cargar el servidor real
const server = require('./src/server.js');

// Exportar para compatibilidad con módulos
module.exports = server;