// ============================================================
// [OG BONÜ 2026-11-13] og-bonu.js — Vista previa de productos
// en WhatsApp, Facebook, TikTok e Instagram (Open Graph).
//
// GET /p/<id>  ->  HTML con og:image del producto + redirección
//                  automática a bonü.com/producto/<id>
//
// FORMA DE USO (elige una):
//  A) Integrarlo en tu backend Express (2 líneas):
//       const { registrar } = require('./og-bonu');
//       registrar(app);            // junto a tus demás app.get(...)
//  B) Servicio independiente (sin Express ni dependencias):
//       Start Command en Render:  node og-bonu.js
//
// Requiere Node 18+ (usa fetch global). Sin paquetes externos.
// ============================================================
'use strict';

const FRONTEND = 'https://xn--bon-joa.com';   // bonü.com
const PROYECTO_FIRESTORE = 'bonumktp';

// ---------- utilidades ----------
function escapar(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function aHttps(u) { return String(u || '').replace(/^http:\/\//i, 'https://'); }
function recortar(s, max) {
  s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  return s.slice(0, max).replace(/[\s,\-–—:;·]+\S*$/, '') + '…';
}
function precioMXN(n) {
  const x = Number(n);
  if (!isFinite(x)) return '';
  return '$' + x.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ---------- Firestore (lectura pública, sin auth) ----------
async function traerProducto(id) {
  const url = 'https://firestore.googleapis.com/v1/projects/' + PROYECTO_FIRESTORE +
    '/databases/(default)/documents/productos/' + encodeURIComponent(id);
  const resp = await fetch(url, { signal: AbortSignal.timeout(6000) });
  if (!resp.ok) return null;
  const d = await resp.json();
  const f = d.fields || {};
  const val = (n) => {
    const x = f[n]; if (!x) return '';
    if (x.stringValue !== undefined) return x.stringValue;
    if (x.doubleValue !== undefined) return Number(x.doubleValue);
    if (x.integerValue !== undefined) return Number(x.integerValue);
    return '';
  };
  const imagenes = (((f.imagenes || {}).arrayValue || {}).values || [])
    .map((v) => v.stringValue).filter(Boolean);
  return {
    id: id,
    nombre: val('nombre') || 'Producto Bonü',
    precioFinal: val('precioFinal'),
    precioOriginal: val('precioOriginal'),
    descripcion: val('descripcion'),
    imagenes: imagenes,
  };
}

// ---------- página OG ----------
function paginaOG(p, urlCanonica) {
  const destino = FRONTEND + '/producto/' + encodeURIComponent(p.id);
  const img = (p.imagenes && p.imagenes[0]) ? aHttps(p.imagenes[0]) : (FRONTEND + '/og-image.jpg');
  const titulo = recortar(p.nombre, 110) + ' | Bonü.com';
  const descBase = p.descripcion && String(p.descripcion).trim()
    ? recortar(p.descripcion, 180) + ' '
    : '';
  const desc = descBase + 'Cómpralo en Bonü con 5% de cashback · 🚚 Envío gratis desde $999 · Envíos a todo México desde Puerto Vallarta.';
  const precio = precioMXN(p.precioFinal);
  const destinoJs = JSON.stringify(destino);

  return `<!doctype html>
<html lang="es"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapar(titulo)}</title>
<meta name="description" content="${escapar(recortar(desc, 200))}">
<meta property="og:site_name" content="Bonü">
<meta property="og:locale" content="es_MX">
<meta property="og:type" content="product">
<meta property="og:title" content="${escapar(titulo)}">
<meta property="og:description" content="${escapar(desc)}">
<meta property="og:image" content="${escapar(img)}">
<meta property="og:image:alt" content="${escapar(recortar(p.nombre, 80))}">
<meta property="og:url" content="${escapar(urlCanonica)}">
 ${precio ? '<meta property="product:price:amount" content="' + escapar(p.precioFinal) + '">\n<meta property="product:price:currency" content="MXN">' : ''}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapar(titulo)}">
<meta name="twitter:description" content="${escapar(recortar(desc, 180))}">
<meta name="twitter:image" content="${escapar(img)}">
<meta http-equiv="refresh" content="0; url=${escapar(destino)}">
</head><body style="font-family:system-ui,Arial,sans-serif;text-align:center;padding:40px 16px;color:#111">
<script>try{location.replace(${destinoJs})}catch(e){location.href=${destinoJs}}</script>
<noscript><meta http-equiv="refresh" content="0; url=${escapar(destino)}"></noscript>
<p>Abriendo <b>${escapar(recortar(p.nombre, 70))}</b> en Bonü…</p>
 ${img ? '<img src="' + escapar(img) + '" alt="' + escapar(recortar(p.nombre, 60)) + '" width="320" style="max-width:90%;border-radius:12px;margin:16px auto">' : ''}
<p><a href="${escapar(destino)}" style="display:inline-block;background:#facc15;color:#000;font-weight:bold;padding:12px 24px;border-radius:999px;text-decoration:none">Ver producto en Bonü →</a></p>
</body></html>`;
}

// ---------- página cuando el producto no existe ----------
function paginaNoEncontrado(urlCanonica) {
  const destinoJs = JSON.stringify(FRONTEND);
  return `<!doctype html>
<html lang="es"><head>
<meta charset="utf-8"><title>Producto no disponible | Bonü.com</title>
<meta property="og:site_name" content="Bonü">
<meta property="og:locale" content="es_MX">
<meta property="og:type" content="website">
<meta property="og:title" content="Bonü — El marketplace que te paga por comprar">
<meta property="og:description" content="Cashback del 5% en cada compra, envío gratis desde $999 y envíos a todo México desde Puerto Vallarta. Precios con IVA incluido.">
<meta property="og:image" content="${FRONTEND}/og-image.jpg">
<meta property="og:url" content="${escapar(urlCanonica)}">
<meta name="twitter:card" content="summary_large_image">
<meta http-equiv="refresh" content="0; url=${FRONTEND}">
</head><body style="font-family:system-ui,Arial,sans-serif;text-align:center;padding:40px 16px">
<script>try{location.replace(${destinoJs})}catch(e){location.href=${destinoJs}}</script>
<p>Este producto ya no está disponible.</p>
<p><a href="${FRONTEND}" style="display:inline-block;background:#facc15;color:#000;font-weight:bold;padding:12px 24px;border-radius:999px;text-decoration:none">Ir a Bonü.com →</a></p>
</body></html>`;
}

// ---------- envío compatible con Express y con http nativo ----------
function enviarHTML(res, html, status) {
  const s = status || 200;
  if (typeof res.status === 'function' && typeof res.type === 'function') {
    res.status(s).type('html').set('Cache-Control', 'public, max-age=300').send(html);
  } else {
    res.writeHead(s, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' });
    res.end(html);
  }
}

function urlCanonica(req, id) {
  try {
    const host = (typeof req.get === 'function' ? req.get('host') : (req.headers && req.headers.host)) || 'bonu-backend.onrender.com';
    const proto = (req.headers && req.headers['x-forwarded-proto']) || 'https';
    return proto + '://' + host + '/p/' + encodeURIComponent(id);
  } catch (e) { return FRONTEND; }
}

// ---------- handler principal ----------
async function handler(req, res) {
  let id = (req.params && req.params.id) || '';
  if (!id && req.url) {
    const m = String(req.url).split('?')[0].match(/^\/p\/([^/]+)$/);
    if (m) id = m[1];
  }
  try { id = decodeURIComponent(id); } catch (e) { /* id con % raro */ }
  const canon = urlCanonica(req, id);

  if (!id || id.length > 120 || /[^A-Za-z0-9_\-]/.test(id)) {
    return enviarHTML(res, paginaNoEncontrado(canon), 404);
  }
  try {
    if (typeof fetch !== 'function') throw new Error('fetch no disponible');
    const p = await traerProducto(id);
    if (!p || !p.nombre) return enviarHTML(res, paginaNoEncontrado(canon), 404);
    return enviarHTML(res, paginaOG(p, canon));
  } catch (e) {
    // nunca devolver 500 a los crawlers: redirigir al sitio
    return enviarHTML(res, paginaNoEncontrado(canon), 200);
  }
}

// ---------- integración ----------
function registrar(app) {
  app.get('/p/:id', handler);
}

module.exports = { registrar, handler, traerProducto, paginaOG, paginaNoEncontrado };

// ---------- modo independiente (node og-bonu.js) ----------
if (require.main === module) {
  const http = require('http');
  const server = http.createServer((req, res) => {
    const ruta = String(req.url || '/').split('?')[0];
    if (ruta === '/health') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
    if (/^\/p\/[^/]+$/.test(ruta)) return handler(req, res);
    res.writeHead(302, { Location: FRONTEND });
    res.end();
  });
  const puerto = Number(process.env.PORT) || 3000;
  server.listen(puerto, () => console.log('[OG BONÜ] listo en el puerto ' + puerto));
}
