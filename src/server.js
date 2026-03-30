require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const app = express();
const PORT = process.env.PORT || 5000;

// Middlewares
app.use(cors());
app.use(helmet());
app.use(morgan('dev'));
app.use(express.json());

// ✅ Rutas de prueba (IMPORTANTE para Railway)
app.get('/', (req, res) => {
  res.json({ 
    success: true, 
    message: 'Bonü Backend activo',
    timestamp: new Date().toISOString()
  });
});

app.get('/api/status', (req, res) => {
  res.json({ 
    success: true, 
    message: 'Bonü Backend activo',
    timestamp: new Date().toISOString()
  });
});

// ✅ Iniciar servidor
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Bonü Backend corriendo en puerto ${PORT}`);
});