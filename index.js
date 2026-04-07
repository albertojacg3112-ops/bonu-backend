// index.js - Bonü Backend v2.1 (Production Minimal)
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3001;
const NODE_ENV = process.env.NODE_ENV || 'production';

/* ════════════════════════════════════════════════════════════
   🔐 VARIABLES DE ENTORNO (Configurar en Render Dashboard)
════════════════════════════════════════════════════════════ */
const CJ_API_KEY = process.env.CJ_API_KEY;
const CJ_API_URL = 'https://developers.cjdropshipping.com/api2.0/v1';
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'bonu-admin-2024';
const SUNSKY_API_KEY = process.env.SUNSKY_API_KEY;
const SUNSKY_API_SECRET = process.env.SUNSKY_API_SECRET;
const SUNSKY_BASE_URL = process.env.SUNSKY_BASE_URL || 'https://www.sunsky-online.com/api';

/* ════════════════════════════════════════════════════════════
   🛡️ MIDDLEWARE
════════════════════════════════════════════════════════════ */
app.use(cors({
  origin: process.env.FRONTEND_URL?.split(',') || ['http://localhost:5500', 'https://bonumktp.web.app', 'https://bonumktp.firebaseapp.com'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'CJ-Access-Token']
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

/* ════════════════════════════════════════════════════════════
   🗄️ BASE DE DATOS EN MEMORIA (Demo)
   ⚠️ Para producción real: migrar a MongoDB/Supabase/Firebase Admin
════════════════════════════════════════════════════════════ */
let DB = {
  ordenes: [],
  usuarios: [],
  transacciones: [],
  productos: [],
  afiliados: [],
  trafico: [],
  contadorVisitas: 0
};

/* ════════════════════════════════════════════════════════════
   📦 CATEGORÍAS DISPONIBLES
════════════════════════════════════════════════════════════ */
const CATEGORIAS = [
  'Celulares y Accesorios','Tecnología','Ropa de mujer','Ropa íntima','Ropa de hombre',
  'Accesorios de mujer','Accesorios de hombre','Calzado de mujer','Calzado de Hombre',
  'Belleza','Perfumes','Joyería y relojes','Juguetes','Ropa de niños','Calzado de niños',
  'Hogar y jardín','Consolas y videojuegos','Equipo de gym','Mascotas y accesorios',
  'Herramientas y accesorios de Auto','General'
];

/* ════════════════════════════════════════════════════════════
   🔧 UTILIDADES
════════════════════════════════════════════════════════════ */
function detectarCategoria(nombre = '', descripcion = '', categoriaRaw = '') {
  const txt = (nombre + ' ' + descripcion + ' ' + categoriaRaw).toLowerCase();
  const mapa = [
    ['Celulares y Accesorios',['celular','movil','iphone','samsung','xiaomi','funda','cargador','cable','smartphone','earphone','earbuds','audifonos']],
    ['Tecnología',['computadora','laptop','tablet','teclado','mouse','monitor','drone','camara','smartwatch','bluetooth','wifi','router','usb','hdmi']],
    ['Ropa de mujer',['vestido','blusa','falda','leggings','women','femenino','mujer','dress','skirt']],
    ['Ropa íntima',['lencería','bragas','bra','boxer','ropa interior','intimo','panty']],
    ['Ropa de hombre',['camisa','pantalon','saco','corbata','traje','men','hombre','shirt','jacket']],
    ['Accesorios de mujer',['bolso','cartera','collar','aretes','pulsera','diadema']],
    ['Accesorios de hombre',['cinturón','billetera','reloj hombre','gorra','guantes']],
    ['Calzado de mujer',['tacón','stiletto','ballerina','sandalia mujer','zapato mujer']],
    ['Calzado de Hombre',['zapato hombre','tenis hombre','bota hombre','loafer']],
    ['Belleza',['maquillaje','cosmetico','crema','labial','skincare','facial','serum']],
    ['Perfumes',['perfume','colonia','fragancia','eau de']],
    ['Joyería y relojes',['reloj','pulsera','collar','anillo','aretes','watch','joya']],
    ['Juguetes',['juguete','toy','muñeca','peluche','lego','robot','armable']],
    ['Ropa de niños',['niño','niña','kids','children','bebe','baby','infantil']],
    ['Calzado de niños',['zapato niño','tenis niño','baby shoes','calzado infantil']],
    ['Hogar y jardín',['hogar','cocina','jardin','lampara','decoracion','mueble','cortina']],
    ['Consolas y videojuegos',['playstation','xbox','nintendo','switch','videojuego','game','consola','ps4','ps5']],
    ['Equipo de gym',['gym','pesas','mancuerna','fitness','yoga','ejercicio','banda','mat']],
    ['Mascotas y accesorios',['perro','gato','mascota','pet','correa','comedero','rascador']],
    ['Herramientas y accesorios de Auto',['herramienta','auto','coche','llanta','aceite','bateria','faro']]
  ];
  for (const [cat, kws] of mapa) { if (kws.some(k => txt.includes(k))) return cat; }
  return 'General';
}

function parsearVariantesCJ(variantList = []) {
  const tallas = new Set(), colores = new Set(), medidas = [];
  for (const v of variantList) {
    const props = v.variantNameEn || v.variantName || '';
    if (typeof props === 'string') {
      const partes = props.split(';');
      for (const p of partes) {
        const [key, val] = p.split(':').map(s => s?.trim());
        if (!val) continue;
        const k = (key || '').toLowerCase();
        if (k.includes('size') || k.includes('talla')) tallas.add(val);
        else if (k.includes('color')) colores.add(val);
      }
    }
    if (v.variantLength || v.variantWidth || v.variantHeight) {
      medidas.push(`${v.variantLength||0}×${v.variantWidth||0}×${v.variantHeight||0} cm`);
    }
  }
  return { tallas: [...tallas].join(', '), colores: [...colores].join(', '), medidas: [...new Set(medidas)].join(' | ') };
}

const generarId = () => `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

/* ════════════════════════════════════════════════════════════
   🌐 PROVEEDORES
════════════════════════════════════════════════════════════ */
const PROVIDERS = {
  cj: {
    id: 'cj', name: 'CJ Dropshipping', color: '#7c3aed', type: 'api', hasApi: true,
    description: 'Millones de productos globales', categories: [],
    fetchProduct: async (sku) => {
      if (!CJ_API_KEY) throw new Error('CJ_API_KEY no configurada en Render');
      const token = await getCJToken();
      const listRes = await fetch(`${CJ_API_URL}/product/list?productSku=${encodeURIComponent(sku)}&pageNum=1&pageSize=1`, {
        method: 'GET', headers: { 'CJ-Access-Token': token, 'Content-Type': 'application/json' }
      });
      const listData = await listRes.json();
      if (listData.code !== 200 || !listData.data?.list?.length) throw new Error(`Producto ${sku} no encontrado en CJ`);
      const p = listData.data.list[0];
      let imagenes = p.productImage ? [p.productImage] : [], descripcion = p.productNameEn || p.productName || '';
      let tallas = '', colores = '', medidas = '', rating = parseFloat(p.productRating || 4.5), totalReviews = parseInt(p.reviewsCount || 0, 10);
      try {
        const detRes = await fetch(`${CJ_API_URL}/product/query?pid=${p.pid}`, {
          method: 'GET', headers: { 'CJ-Access-Token': token, 'Content-Type': 'application/json' }
        });
        const detData = await detRes.json();
        if (detData.code === 200 && detData.data) {
          const d = detData.data;
          if (d.productImageSet) imagenes = d.productImageSet.split(',').map(s => s.trim()).filter(Boolean);
          if (d.productDescription || d.description) descripcion = d.productDescription || d.description;
          if (d.reviewsRating) rating = parseFloat(d.reviewsRating);
          if (d.reviewsCount) totalReviews = parseInt(d.reviewsCount, 10);
          if (d.variants?.length) { const parsed = parsearVariantesCJ(d.variants); tallas = parsed.tallas; colores = parsed.colores; medidas = parsed.medidas; }
        }
      } catch (e) { console.warn('⚠️ Error detalle CJ:', e.message); }
      if (!imagenes.length) imagenes = ['https://picsum.photos/500/500?random=1'];
      const nombre = p.productNameEn || p.productName || `Producto ${sku}`;
      return { sku, nombre, descripcion, imagenes, stock: p.inventory || 100, tallas, colores, medidas, rating, totalReviews, categoria: detectarCategoria(nombre, descripcion, p.categoryName || ''), proveedor: 'CJ Dropshipping', modoHybrid: false, cjPid: p.pid };
    }
  },
  sunsky: {
    id: 'sunsky', name: 'SunSky', color: '#f97316', type: 'api', hasApi: true,
    description: 'Electrónica y gadgets', categories: ['Tecnología','Celulares y Accesorios'],
    fetchProduct: async (sku) => {
      if (!SUNSKY_API_KEY || !SUNSKY_API_SECRET) return { sku, nombre:'', descripcion:'', imagenes:[], stock:100, tallas:'', colores:'', medidas:'', rating:0, totalReviews:0, categoria:'Tecnología', proveedor:'SunSky', modoHybrid:true };
      const timestamp = Math.floor(Date.now() / 1000);
      const sign = crypto.createHmac('sha256', SUNSKY_API_SECRET).update(`${SUNSKY_API_KEY}${timestamp}${sku}`).digest('hex');
      const res = await fetch(`${SUNSKY_BASE_URL}/product/detail?api_key=${SUNSKY_API_KEY}&timestamp=${timestamp}&sign=${sign}&sku=${sku}`);
      const d = await res.json();
      if (!d || d.error) throw new Error(d?.message || 'Producto no encontrado en SunSky');
      const nombre = d.name || d.title || `Producto ${sku}`;
      return { sku, nombre, descripcion: d.description || nombre, imagenes: (d.images || []).map(i => i.url || i).filter(Boolean), stock: Number(d.stock || 100), tallas: (d.sizes || []).join(', '), colores: (d.colors || []).join(', '), medidas: d.dimensions || '', rating: parseFloat(d.rating || 4.5), totalReviews: parseInt(d.reviews_count || 0, 10), categoria: detectarCategoria(nombre, d.description || '', d.category || ''), proveedor: 'SunSky', modoHybrid: false };
    }
  },
  // Proveedores hybrid (sin API pública - modo manual)
  tvccmall: { id: 'tvccmall', name: 'TVCmall', color: '#0ea5e9', type: 'hybrid', hasApi: false, description: 'Accesorios móviles', categories: ['Celulares y Accesorios','Tecnología'], fetchProduct: async (sku) => ({ sku, nombre:'', descripcion:'', imagenes:[], stock:200, tallas:'', colores:'', medidas:'', rating:0, totalReviews:0, categoria:'Celulares y Accesorios', proveedor:'TVCmall', modoHybrid:true }) },
  apparelcn: { id: 'apparelcn', name: 'ApparelCN', color: '#ec4899', type: 'hybrid', hasApi: false, description: 'Ropa mayorista', categories: ['Ropa de mujer','Ropa de hombre'], fetchProduct: async (sku) => ({ sku, nombre:'', descripcion:'', imagenes:[], stock:100, tallas:'S,M,L,XL', colores:'', medidas:'', rating:0, totalReviews:0, categoria:'Ropa de mujer', proveedor:'ApparelCN', modoHybrid:true }) }
};

/* ════════════════════════════════════════════════════════════
   🔑 TOKEN CJ (caché con refresh automático)
════════════════════════════════════════════════════════════ */
let cjAccessToken = null, cjTokenExpiry = null, cjTokenPromise = null;

async function getCJToken() {
  if (cjAccessToken && cjTokenExpiry && new Date() < new Date(cjTokenExpiry)) return cjAccessToken;
  if (cjTokenPromise) return cjTokenPromise;
  console.log('🔐 Obteniendo token CJ...');
  cjTokenPromise = (async () => {
    try {
      const response = await fetch(`${CJ_API_URL}/authentication/getAccessToken`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey: CJ_API_KEY })
      });
      const data = await response.json();
      if (data.code === 200 && data.data?.accessToken) {
        cjAccessToken = data.data.accessToken;
        cjTokenExpiry = data.data.accessTokenExpiryDate;
        console.log('✅ Token CJ obtenido');
        return cjAccessToken;
      }
      throw new Error(`Error CJ: ${data.message}`);
    } finally { cjTokenPromise = null; }
  })();
  return cjTokenPromise;
}

/* ════════════════════════════════════════════════════════════
   🚦 RUTAS BASE
════════════════════════════════════════════════════════════ */
app.get('/', (req, res) => res.json({ success: true, message: 'Bonü Backend Activo', port: PORT, version: '2.1.0', env: NODE_ENV }));
app.get('/health', (req, res) => res.json({ status: 'healthy', port: PORT, time: Date.now(), uptime: process.uptime() }));
app.get('/api/status', (req, res) => res.json({ success: true, cjConfigured: !!CJ_API_KEY, timestamp: Date.now() }));
app.get('/api/categorias', (req, res) => res.json({ success: true, categorias: CATEGORIAS }));

/* ════════════════════════════════════════════════════════════
   🌐 RUTAS CJ DROPSHIPPING
════════════════════════════════════════════════════════════ */
app.get('/api/cj/test', (req, res) => res.json({ success: true, message: 'CJ endpoint OK' }));

app.post('/api/cj/buscar', async (req, res) => {
  const { sku } = req.body;
  if (!sku) return res.status(400).json({ success: false, error: 'SKU requerido' });
  try {
    const token = await getCJToken();
    const response = await fetch(`${CJ_API_URL}/product/list?productSku=${encodeURIComponent(sku)}&pageNum=1&pageSize=1`, { method: 'GET', headers: { 'CJ-Access-Token': token } });
    const data = await response.json();
    if (data.code === 200 && data.data?.list?.length > 0) {
      const p = data.data.list[0];
      res.json({ success: true, product: { pid: p.pid, sku: p.sku, nombre: p.productName, precio: p.sellPrice, stock: p.inventory || 100, imagenes: p.productImage ? [p.productImage] : [] } });
    } else throw new Error(`Producto ${sku} no encontrado`);
  } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.post('/api/cj/import', async (req, res) => {
  let { sku, precioVenta, costoCJ, tipo, categoria } = req.body;
  if (!sku) return res.status(400).json({ success: false, error: 'SKU requerido' });
  sku = sku.split('-')[0];
  console.log(`📦 IMPORTANDO: ${sku}`);
  try {
    const token = await getCJToken();
    const listRes = await fetch(`${CJ_API_URL}/product/list?productSku=${encodeURIComponent(sku)}&pageNum=1&pageSize=1`, { method: 'GET', headers: { 'CJ-Access-Token': token } });
    const listData = await listRes.json();
    if (listData.code !== 200 || !listData.data?.list?.length) throw new Error(`Producto ${sku} no encontrado`);
    const producto = listData.data.list[0];
    let imagenes = producto.productImage ? [producto.productImage] : [], descripcion = producto.productNameEn || producto.productName || '';
    let tallas = '', colores = '', medidas = '', rating = parseFloat(producto.productRating || 4.5), totalReviews = parseInt(producto.reviewsCount || 0, 10);
    try {
      const detRes = await fetch(`${CJ_API_URL}/product/query?pid=${producto.pid}`, { method: 'GET', headers: { 'CJ-Access-Token': token } });
      const detData = await detRes.json();
      if (detData.code === 200 && detData.data) {
        const d = detData.data;
        if (d.productImageSet) imagenes = d.productImageSet.split(',').map(s => s.trim()).filter(Boolean);
        if (d.productDescription || d.description) descripcion = d.productDescription || d.description;
        if (d.reviewsRating) rating = parseFloat(d.reviewsRating);
        if (d.reviewsCount) totalReviews = parseInt(d.reviewsCount, 10);
        if (d.variants?.length) { const parsed = parsearVariantesCJ(d.variants); tallas = parsed.tallas; colores = parsed.colores; medidas = parsed.medidas; }
      }
    } catch (e) { console.warn('⚠️ Error detalle CJ:', e.message); }
    if (!imagenes.length) imagenes = ['https://picsum.photos/500/500?random=1'];
    const descuento = Math.floor(Math.random() * 20) + 5;
    const precioOriginal = parseFloat(precioVenta) / (1 - descuento / 100);
    const nombre = producto.productNameEn || producto.productName || `Producto ${sku}`;
    const categoriaFinal = categoria && CATEGORIAS.includes(categoria) ? categoria : detectarCategoria(nombre, descripcion, producto.categoryName || '');
    const productoFinal = {
      id: producto.pid, sku, nombre, descripcion, categoria: categoriaFinal,
      precioOriginal: Math.round(precioOriginal), precioFinal: parseFloat(precioVenta),
      costoCJ: parseFloat(costoCJ) || 0, descuento, stock: producto.inventory || 100, tipo: tipo || 'Ofertas',
      rating, totalReviews, imagenes, tallas, colores, medidas,
      proveedor: 'CJ Dropshipping', cjData: { pid: producto.pid, sku },
      fechaCreacion: new Date().toISOString()
    };
    DB.productos.push(productoFinal);
    res.json({ success: true, message: 'Producto importado', product: productoFinal });
  } catch (error) { console.error('❌ Error:', error.message); res.status(500).json({ success: false, error: error.message }); }
});

/* ════════════════════════════════════════════════════════════
   🌍 MULTI-PROVEEDOR
════════════════════════════════════════════════════════════ */
app.get('/api/providers/list', (req, res) => {
  const list = Object.values(PROVIDERS).map(p => ({ id: p.id, name: p.name, color: p.color, type: p.type, hasApi: p.hasApi, description: p.description, categories: p.categories }));
  res.json({ success: true, providers: list });
});

app.post('/api/providers/fetch-product', async (req, res) => {
  const { providerId, sku, categoria } = req.body;
  if (!providerId || !sku) return res.status(400).json({ success: false, error: 'providerId y sku requeridos' });
  const provider = PROVIDERS[providerId];
  if (!provider) return res.status(404).json({ success: false, error: `Proveedor "${providerId}" no encontrado` });
  try {
    const product = await provider.fetchProduct(sku.trim());
    if (categoria && CATEGORIAS.includes(categoria)) product.categoria = categoria;
    res.json({ success: true, product, provider: { id: provider.id, name: provider.name } });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/providers/order', async (req, res) => {
  const { pedidoId, proveedorId, items, direccion } = req.body;
  if (!pedidoId || !proveedorId || !items?.length) return res.status(400).json({ success: false, error: 'Faltan datos' });
  const provider = PROVIDERS[proveedorId];
  if (!provider) return res.status(404).json({ success: false, error: `Proveedor "${proveedorId}" no encontrado` });
  console.log(`📦 [${provider.name}] Pedido: ${pedidoId}`);
  if (proveedorId === 'cj') {
    try {
      const token = await getCJToken();
      const orderPayload = {
        orderNumber: pedidoId, shippingZip: direccion?.cp || '', shippingCountry: direccion?.pais || 'MX',
        shippingAddress: direccion?.direccion || '', shippingCustomerName: direccion?.nombre || '',
        shippingPhone: direccion?.telefono || '', houseNumber: '',
        products: items.map(item => ({ vid: item.cjVid || item.sku, quantity: item.cantidad || 1 }))
      };
      const orderRes = await fetch(`${CJ_API_URL}/shopping/order/createOrderV2`, {
        method: 'POST', headers: { 'CJ-Access-Token': token, 'Content-Type': 'application/json' }, body: JSON.stringify(orderPayload)
      });
      const orderData = await orderRes.json();
      if (orderData.code === 200) {
        DB.ordenes.push({ id: pedidoId, proveedorOrdenId: orderData.data?.orderId, proveedor: 'CJ Dropshipping', items, direccion, estado: 'pagado', fechaCreacion: new Date().toISOString(), total: items.reduce((s, i) => s + (i.precio * (i.cantidad || 1)), 0), pasarela: 'CJ Auto' });
        return res.json({ success: true, proveedorOrdenId: orderData.data?.orderId, proveedor: 'CJ Dropshipping' });
      }
    } catch (cjErr) { console.error('❌ Error pedido CJ:', cjErr.message); }
  }
  DB.ordenes.push({ id: pedidoId, proveedor: provider.name, items, direccion, estado: 'pendiente', manual: true, fechaCreacion: new Date().toISOString(), total: items.reduce((s, i) => s + (i.precio * (i.cantidad || 1)), 0), pasarela: 'Manual' });
  res.json({ success: true, manual: true, proveedor: provider.name, pedidoId });
});

/* ════════════════════════════════════════════════════════════
   📦 ÓRDENES
════════════════════════════════════════════════════════════ */
app.get('/api/admin/ordenes', (req, res) => {
  const { estado, page = 1, limit = 20 } = req.query;
  let ordenes = [...DB.ordenes];
  if (estado) ordenes = ordenes.filter(o => o.estado === estado);
  ordenes.sort((a, b) => new Date(b.fechaCreacion) - new Date(a.fechaCreacion));
  const total = ordenes.length, inicio = (page - 1) * limit;
  res.json({ success: true, total, page: Number(page), limit: Number(limit), ordenes: ordenes.slice(inicio, inicio + Number(limit)) });
});

app.patch('/api/admin/ordenes/:id/estado', (req, res) => {
  const { estado } = req.body;
  const validos = ['pendiente','pagado','enviado','cancelado'];
  if (!validos.includes(estado)) return res.status(400).json({ success: false, error: 'Estado inválido' });
  const idx = DB.ordenes.findIndex(o => o.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, error: 'Orden no encontrada' });
  DB.ordenes[idx].estado = estado;
  DB.ordenes[idx].fechaActualizacion = new Date().toISOString();
  res.json({ success: true, orden: DB.ordenes[idx] });
});

app.post('/api/admin/ordenes', (req, res) => {
  const { usuario, items, direccion, total, pasarela, proveedorId } = req.body;
  if (!items?.length || !total) return res.status(400).json({ success: false, error: 'items y total requeridos' });
  const orden = { id: `ORD-${generarId()}`, usuario: usuario || 'Invitado', items, direccion, total: parseFloat(total), pasarela: pasarela || 'Desconocida', proveedorId: proveedorId || 'cj', estado: 'pendiente', fechaCreacion: new Date().toISOString() };
  DB.ordenes.push(orden);
  DB.transacciones.push({ id: `TXN-${generarId()}`, ordenId: orden.id, monto: orden.total, pasarela: orden.pasarela, estado: 'pendiente', fechaCreacion: orden.fechaCreacion });
  res.json({ success: true, orden });
});

/* ════════════════════════════════════════════════════════════
   👥 USUARIOS
════════════════════════════════════════════════════════════ */
app.post('/api/admin/usuarios', (req, res) => {
  const { email, nombre, telefono } = req.body;
  if (!email) return res.status(400).json({ success: false, error: 'email requerido' });
  const idx = DB.usuarios.findIndex(u => u.email === email);
  if (idx >= 0) { DB.usuarios[idx].nombre = nombre || DB.usuarios[idx].nombre; DB.usuarios[idx].telefono = telefono || DB.usuarios[idx].telefono; DB.usuarios[idx].compras = (DB.usuarios[idx].compras || 0) + 1; DB.usuarios[idx].ultimaCompra = new Date().toISOString(); return res.json({ success: true, usuario: DB.usuarios[idx] }); }
  const usuario = { id: `USR-${generarId()}`, email, nombre: nombre || email, telefono: telefono || '', compras: 1, ultimaCompra: new Date().toISOString(), fechaRegistro: new Date().toISOString() };
  DB.usuarios.push(usuario);
  res.json({ success: true, usuario });
});

app.get('/api/admin/usuarios', (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const total = DB.usuarios.length, inicio = (page - 1) * limit;
  res.json({ success: true, total, page: Number(page), limit: Number(limit), usuarios: DB.usuarios.slice(inicio, inicio + Number(limit)) });
});

/* ════════════════════════════════════════════════════════════
   💳 TRANSACCIONES
════════════════════════════════════════════════════════════ */
app.get('/api/admin/transacciones', (req, res) => {
  const { pasarela, page = 1, limit = 20 } = req.query;
  let txns = [...DB.transacciones];
  if (pasarela) txns = txns.filter(t => t.pasarela === pasarela);
  txns.sort((a, b) => new Date(b.fechaCreacion) - new Date(a.fechaCreacion));
  const total = txns.length, inicio = (page - 1) * limit;
  res.json({ success: true, total, page: Number(page), limit: Number(limit), transacciones: txns.slice(inicio, inicio + Number(limit)) });
});

/* ════════════════════════════════════════════════════════════
   🛍️ PRODUCTOS
════════════════════════════════════════════════════════════ */
app.get('/api/admin/productos', (req, res) => {
  const { categoria, page = 1, limit = 20 } = req.query;
  let productos = [...DB.productos];
  if (categoria) productos = productos.filter(p => p.categoria === categoria);
  const total = productos.length, inicio = (page - 1) * limit;
  res.json({ success: true, total, page: Number(page), limit: Number(limit), productos: productos.slice(inicio, inicio + Number(limit)) });
});

app.patch('/api/admin/productos/:id', (req, res) => {
  const idx = DB.productos.findIndex(p => p.id === req.params.id || p.sku === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, error: 'Producto no encontrado' });
  DB.productos[idx] = { ...DB.productos[idx], ...req.body, fechaActualizacion: new Date().toISOString() };
  res.json({ success: true, producto: DB.productos[idx] });
});

app.delete('/api/admin/productos/:id', (req, res) => {
  const idx = DB.productos.findIndex(p => p.id === req.params.id || p.sku === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, error: 'Producto no encontrado' });
  DB.productos.splice(idx, 1);
  res.json({ success: true, mensaje: 'Producto eliminado' });
});

/* ════════════════════════════════════════════════════════════
   📊 TRÁFICO
════════════════════════════════════════════════════════════ */
app.post('/api/tracking/visita', (req, res) => {
  const { pagina = '/', origen = 'directo', dispositivo = 'desktop' } = req.body;
  DB.contadorVisitas++;
  DB.trafico.push({ pagina, origen, dispositivo, fecha: new Date().toISOString() });
  if (DB.trafico.length > 10000) DB.trafico.shift();
  res.json({ success: true });
});

/* ════════════════════════════════════════════════════════════
   📈 DASHBOARD
════════════════════════════════════════════════════════════ */
app.get('/api/admin/dashboard', (req, res) => {
  const ahora = new Date(), hoy = ahora.toISOString().split('T')[0], mesAct = ahora.toISOString().substring(0, 7);
  const ordenes = DB.ordenes, totalOrdenes = ordenes.length;
  const ordenesHoy = ordenes.filter(o => o.fechaCreacion?.startsWith(hoy)).length;
  const ordenesConvertidas = ordenes.filter(o => ['pagado','enviado'].includes(o.estado));
  const montoTotal = ordenesConvertidas.reduce((s, o) => s + (o.total || 0), 0);
  const costoTotal = DB.productos.reduce((s, p) => { const vendidas = ordenes.filter(o => o.items?.some(i => i.sku === p.sku)).length; return s + (p.costoCJ || 0) * vendidas; }, 0);
  const gananciaTotal = montoTotal - costoTotal;
  const estadosConteo = { pendiente: 0, pagado: 0, enviado: 0, cancelado: 0 };
  for (const o of ordenes) estadosConteo[o.estado] = (estadosConteo[o.estado] || 0) + 1;
  const ventasPorMes = {};
  for (let i = 11; i >= 0; i--) { const d = new Date(ahora); d.setMonth(d.getMonth() - i); ventasPorMes[d.toISOString().substring(0, 7)] = 0; }
  for (const o of ordenesConvertidas) { const m = o.fechaCreacion?.substring(0, 7); if (m && ventasPorMes[m] !== undefined) ventasPorMes[m] += o.total || 0; }
  const totalVisitas = DB.contadorVisitas, visitasHoy = DB.trafico.filter(t => t.fecha?.startsWith(hoy)).length;
  const dispositivosConteo = {}, origenesConteo = {}, paginasConteo = {};
  for (const t of DB.trafico) { dispositivosConteo[t.dispositivo] = (dispositivosConteo[t.dispositivo] || 0) + 1; origenesConteo[t.origen] = (origenesConteo[t.origen] || 0) + 1; paginasConteo[t.pagina] = (paginasConteo[t.pagina] || 0) + 1; }
  const topPaginas = Object.entries(paginasConteo).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([pagina, visitas]) => ({ pagina, visitas }));
  const pasarelasConteo = {};
  for (const t of DB.transacciones) pasarelasConteo[t.pasarela] = (pasarelasConteo[t.pasarela] || 0) + (t.monto || 0);
  const ventasPorProducto = {};
  for (const o of ordenes) { for (const item of (o.items || [])) { if (!ventasPorProducto[item.sku]) ventasPorProducto[item.sku] = { sku: item.sku, nombre: item.nombre, ventas: 0, ingresos: 0 }; ventasPorProducto[item.sku].ventas += item.cantidad || 1; ventasPorProducto[item.sku].ingresos += (item.precio || 0) * (item.cantidad || 1); } }
  const topProductos = Object.values(ventasPorProducto).sort((a, b) => b.ventas - a.ventas).slice(0, 10);
  res.json({
    success: true, timestamp: new Date().toISOString(),
    resumen: { totalOrdenes, ordenesHoy, totalUsuarios: DB.usuarios.length, totalProductos: DB.productos.length, totalVisitas, visitasHoy, montoTotal: Math.round(montoTotal * 100) / 100, gananciaTotal: Math.round(gananciaTotal * 100) / 100, costoTotal: Math.round(costoTotal * 100) / 100 },
    ordenes: { estados: estadosConteo, ventasPorMes },
    finanzas: { montoTotal, gananciaTotal, costoTotal, margenPromedio: montoTotal > 0 ? Math.round((gananciaTotal / montoTotal) * 100) : 0, pasarelas: pasarelasConteo },
    trafico: { totalVisitas, visitasHoy, dispositivos: dispositivosConteo, origenes: origenesConteo, topPaginas },
    topProductos,
    recentOrdenes: [...ordenes].sort((a, b) => new Date(b.fechaCreacion) - new Date(a.fechaCreacion)).slice(0, 5)
  });
});

/* ════════════════════════════════════════════════════════════
   ℹ️ INFO Y 404
════════════════════════════════════════════════════════════ */
app.get('/api/providers/info', (req, res) => res.json({ success: true, proveedores_activos: Object.keys(PROVIDERS).length }));
app.use((req, res) => res.status(404).json({ error: 'Endpoint no encontrado', path: req.path }));
app.use((err, req, res, next) => { console.error('❌ Error:', err.stack); res.status(err.status || 500).json({ success: false, error: NODE_ENV === 'production' ? 'Error interno' : err.message }); });

/* ════════════════════════════════════════════════════════════
   🚀 ARRANQUE
════════════════════════════════════════════════════════════ */
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log('==================================================');
  console.log('✅ Bonü Backend v2.1 — LISTO PARA PRODUCCIÓN');
  console.log(`📡 Puerto: ${PORT} | 🔐 CJ: ${CJ_API_KEY ? '✅' : '⚠️'} | 🌐 ${process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`}`);
  console.log('==================================================');
});

// Graceful shutdown para Render
process.on('SIGTERM', () => { console.log('🔄 Cerrando servidor...'); server.close(() => process.exit(0)); });
process.on('SIGINT', () => { console.log('🔄 Cerrando servidor...'); server.close(() => process.exit(0)); });

// Exportar para testing (no afecta producción)
module.exports = app;