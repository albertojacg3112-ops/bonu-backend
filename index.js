require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const crypto  = require('crypto');

const app  = express();
const PORT = process.env.PORT || 3001;

/* ════════════════════════════════════════════════════════════
   VARIABLES DE ENTORNO REQUERIDAS EN RENDER
   ────────────────────────────────────────────────────────────
   CJ_API_KEY            → tu key de CJ Dropshipping
   SUNSKY_API_KEY        → key de SunSky (cuando la obtengas)
   SUNSKY_API_SECRET     → secret de SunSky
   SUNSKY_BASE_URL       → https://www.sunsky-online.com/api
════════════════════════════════════════════════════════════ */
const CJ_API_KEY      = process.env.CJ_API_KEY;
const CJ_API_URL      = 'https://developers.cjdropshipping.com/api2.0/v1';

/* ────────────────────────────────────────────────────────────
   MIDDLEWARE
──────────────────────────────────────────────────────────── */
app.use(cors());
app.use(express.json());

/* ════════════════════════════════════════════════════════════
   TOKEN CJ  (caché en memoria)
════════════════════════════════════════════════════════════ */
let cjAccessToken  = null;
let cjTokenExpiry  = null;

async function getCJToken() {
    if (cjAccessToken && cjTokenExpiry && new Date() < new Date(cjTokenExpiry)) {
        return cjAccessToken;
    }
    console.log('🔐 Obteniendo nuevo token de CJ...');
    const response = await fetch(`${CJ_API_URL}/authentication/getAccessToken`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ apiKey: CJ_API_KEY })
    });
    const data = await response.json();
    console.log('🔐 Respuesta token CJ:', JSON.stringify(data).substring(0, 200));
    if (data.code === 200 && data.data?.accessToken) {
        cjAccessToken  = data.data.accessToken;
        cjTokenExpiry  = data.data.accessTokenExpiryDate;
        console.log('✅ Token CJ obtenido correctamente');
        return cjAccessToken;
    }
    throw new Error(`Error obteniendo token CJ: ${data.message}`);
}

/* ════════════════════════════════════════════════════════════
   UTILIDADES COMPARTIDAS
════════════════════════════════════════════════════════════ */

/**
 * Detecta la categoría Bonü a partir de texto libre del producto.
 */
function detectarCategoria(nombre = '', descripcion = '', categoriaRaw = '') {
    const txt = (nombre + ' ' + descripcion + ' ' + categoriaRaw).toLowerCase();
    const mapa = [
        ['Celulares y Accesorios',            ['celular','movil','iphone','samsung','xiaomi','funda','cargador','cable','smartphone','earphone','earbuds','auricular','audifonos']],
        ['Tecnología',                         ['computadora','laptop','tablet','teclado','mouse','monitor','drone','camara','smartwatch','bluetooth','wifi','router','usb','hdmi','hub','ssd','disco']],
        ['Ropa de mujer',                      ['vestido','blusa','falda','leggings','women','femenino','mujer','dress','skirt']],
        ['Ropa íntima',                        ['lencería','bragas','bra','boxer','ropa interior','intimo','panty','tangas']],
        ['Ropa de hombre',                     ['camisa','saco','corbata','traje','men','caballero','hombre','shirt','jacket']],
        ['Accesorios de mujer',                ['bolso','cartera','collar','aretes','pulsera','diadema','pasador','chal']],
        ['Accesorios de hombre',               ['cinturón','billetera','reloj hombre','gorra hombre','guantes']],
        ['Calzado de mujer',                   ['tacón','stiletto','ballerina','sandalia mujer','zapato mujer']],
        ['Calzado de Hombre',                  ['zapato hombre','tenis hombre','bota hombre','loafer','mocasin']],
        ['Belleza',                            ['maquillaje','cosmetico','crema','labial','rimel','base','skincare','facial','serum']],
        ['Perfumes',                           ['perfume','colonia','fragancia','eau de']],
        ['Joyería y relojes',                  ['reloj','pulsera','collar','anillo','aretes','watch','joya','plata','oro','zirconia']],
        ['Juguetes',                           ['juguete','toy','muñeca','peluche','lego','robot','armable']],
        ['Ropa de niños',                      ['niño','niña','kids','children','bebe','baby','infantil','mameluco']],
        ['Calzado de niños',                   ['zapato niño','tenis niño','baby shoes','calzado infantil']],
        ['Hogar y jardín',                     ['hogar','cocina','jardin','lampara','decoracion','mueble','cortina','sabana','toalla','cojin']],
        ['Consolas y videojuegos',             ['playstation','xbox','nintendo','switch','videojuego','game','consola','ps4','ps5','control','mando']],
        ['Equipo de gym',                      ['gym','pesas','mancuerna','fitness','yoga','ejercicio','banda','mat']],
        ['Mascotas y accesorios',              ['perro','gato','mascota','pet','correa','comedero','rascador']],
        ['Herramientas y accesorios de Auto',  ['herramienta','auto','coche','llanta','aceite','bateria','faro','volante']],
    ];
    for (const [cat, kws] of mapa) {
        if (kws.some(k => txt.includes(k))) return cat;
    }
    return 'General';
}

/* ════════════════════════════════════════════════════════════
   REGISTRO DE PROVEEDORES
   ────────────────────────────────────────────────────────────
   Para agregar un proveedor nuevo:
     1. Añade un objeto aquí con fetchProduct()
     2. Agrega sus variables de entorno en Render
     3. Redeploy — el frontend lo verá automáticamente
════════════════════════════════════════════════════════════ */
const PROVIDERS = {

    /* ── CJ DROPSHIPPING ───────────────────────────────────── */
    cj: {
        id:          'cj',
        name:        'CJ Dropshipping',
        color:       '#7c3aed',
        type:        'api',
        hasApi:      true,
        description: 'Millones de productos globales',
        categories:  [],
        fetchProduct: async (sku) => {
            const token = await getCJToken();
            const listRes = await fetch(
                `${CJ_API_URL}/product/list?productSku=${encodeURIComponent(sku)}&pageNum=1&pageSize=1`,
                { method: 'GET', headers: { 'CJ-Access-Token': token, 'Content-Type': 'application/json' } }
            );
            const listData = await listRes.json();
            if (listData.code !== 200 || !listData.data?.list?.length) {
                throw new Error(`Producto ${sku} no encontrado en CJ`);
            }
            const p = listData.data.list[0];

            // Imágenes detalladas
            let imagenes = p.productImage ? [p.productImage] : [];
            try {
                const detRes  = await fetch(`${CJ_API_URL}/product/query?pid=${p.pid}`,
                    { method: 'GET', headers: { 'CJ-Access-Token': token, 'Content-Type': 'application/json' } });
                const detData = await detRes.json();
                if (detData.code === 200 && detData.data?.productImageSet) {
                    imagenes = detData.data.productImageSet.split(',').filter(Boolean);
                }
            } catch (_) {}

            if (!imagenes.length) imagenes = ['https://picsum.photos/500/500?random=1'];

            const nombre = p.productNameEn || p.productName || `Producto ${sku}`;
            return {
                sku,
                nombre,
                descripcion:  nombre,
                imagenes,
                stock:        p.inventory || 100,
                tallas:       '',
                colores:      '',
                medidas:      '',
                categoria:    detectarCategoria(nombre, '', p.categoryName || ''),
                proveedor:    'CJ Dropshipping',
                modoHybrid:   false,
                cjPid:        p.pid,
            };
        }
    },

    /* ── SUNSKY ────────────────────────────────────────────── */
    sunsky: {
        id:          'sunsky',
        name:        'SunSky',
        color:       '#f97316',
        type:        'api',
        hasApi:      true,
        description: 'Electrónica, gadgets y accesorios',
        categories:  ['Tecnología','Celulares y Accesorios','Hogar y jardín'],
        fetchProduct: async (sku) => {
            const key       = process.env.SUNSKY_API_KEY;
            const secret    = process.env.SUNSKY_API_SECRET;
            const baseUrl   = process.env.SUNSKY_BASE_URL || 'https://www.sunsky-online.com/api';

            if (!key || !secret) {
                /* Sin credenciales → devolvemos modo hybrid para que el admin
                   complete los datos manualmente hasta que se configure la API */
                return {
                    sku, nombre: '', descripcion: '', imagenes: [], stock: 100,
                    tallas: '', colores: '', medidas: '', categoria: 'Tecnología',
                    proveedor: 'SunSky', modoHybrid: true,
                    mensaje: 'Agrega SUNSKY_API_KEY y SUNSKY_API_SECRET en Render para activar la importación automática.'
                };
            }

            const timestamp = Math.floor(Date.now() / 1000);
            const sign = crypto
                .createHmac('sha256', secret)
                .update(`${key}${timestamp}${sku}`)
                .digest('hex');

            const res  = await fetch(`${baseUrl}/product/detail?api_key=${key}&timestamp=${timestamp}&sign=${sign}&sku=${sku}`, { timeout: 8000 });
            const d    = await res.json();
            if (!d || d.error) throw new Error(d?.message || 'Producto no encontrado en SunSky');

            const nombre = d.name || d.title || `Producto ${sku}`;
            return {
                sku,
                nombre,
                descripcion: d.description || d.short_desc || nombre,
                imagenes:    (d.images || d.image_list || []).map(i => i.url || i).filter(Boolean),
                stock:       Number(d.stock  || d.qty || 100),
                tallas:      (d.sizes  || []).join(', '),
                colores:     (d.colors || []).join(', '),
                medidas:     d.dimensions || '',
                categoria:   detectarCategoria(nombre, d.description || '', d.category || ''),
                proveedor:   'SunSky',
                modoHybrid:  false,
            };
        }
    },

    /* ── APPARELCN — sin API pública ────────────────────────── */
    apparelcn: {
        id:          'apparelcn',
        name:        'ApparelCN',
        color:       '#ec4899',
        type:        'hybrid',
        hasApi:      false,
        description: 'Ropa y moda mayorista desde China',
        categories:  ['Ropa de mujer','Ropa de hombre','Ropa de niños','Ropa íntima'],
        fetchProduct: async (sku) => ({
            sku, nombre: '', descripcion: '', imagenes: [], stock: 100,
            tallas: 'S,M,L,XL,XXL', colores: '', medidas: '',
            categoria: 'Ropa de mujer', proveedor: 'ApparelCN', modoHybrid: true,
            mensaje: 'ApparelCN no tiene API pública. Completa los datos manualmente.'
        })
    },

    /* ── AKZAN WHOLESALE ────────────────────────────────────── */
    akzan: {
        id:          'akzan',
        name:        'Akzan Wholesale',
        color:       '#16a34a',
        type:        'hybrid',
        hasApi:      false,
        description: 'Mayorista de ropa y accesorios',
        categories:  ['Ropa de mujer','Accesorios de mujer','Calzado de mujer'],
        fetchProduct: async (sku) => ({
            sku, nombre: '', descripcion: '', imagenes: [], stock: 50,
            tallas: 'S,M,L,XL', colores: '', medidas: '',
            categoria: 'Ropa de mujer', proveedor: 'Akzan Wholesale', modoHybrid: true,
            mensaje: 'Akzan no tiene API. Completa los datos manualmente.'
        })
    },

    /* ── MMS CLOTHING ───────────────────────────────────────── */
    mms: {
        id:          'mms',
        name:        'MMS Clothing',
        color:       '#1d4ed8',
        type:        'hybrid',
        hasApi:      false,
        description: 'Ropa mayorista y packs de temporada',
        categories:  ['Ropa de hombre','Ropa de mujer','Ropa de niños'],
        fetchProduct: async (sku) => ({
            sku, nombre: '', descripcion: '', imagenes: [], stock: 30,
            tallas: 'XS,S,M,L,XL,XXL', colores: '', medidas: '',
            categoria: 'Ropa de hombre', proveedor: 'MMS Clothing', modoHybrid: true,
            mensaje: 'MMS Clothing no tiene API. Completa los datos manualmente.'
        })
    },

    /* ── PAPACHINA ──────────────────────────────────────────── */
    papachina: {
        id:          'papachina',
        name:        'Papachina',
        color:       '#dc2626',
        type:        'hybrid',
        hasApi:      false,
        description: 'Productos variados y accesorios desde China',
        categories:  ['Ropa de mujer','Accesorios de mujer','Belleza'],
        fetchProduct: async (sku) => ({
            sku, nombre: '', descripcion: '', imagenes: [], stock: 100,
            tallas: '', colores: '', medidas: '',
            categoria: 'General', proveedor: 'Papachina', modoHybrid: true,
            mensaje: 'Papachina no tiene API. Completa los datos manualmente.'
        })
    },

    /* ── TVCCMALL ───────────────────────────────────────────── */
    tvccmall: {
        id:          'tvccmall',
        name:        'TVCmall',
        color:       '#0ea5e9',
        type:        'hybrid',
        hasApi:      false,
        description: 'Accesorios móviles, electrónica y gadgets',
        categories:  ['Celulares y Accesorios','Tecnología'],
        fetchProduct: async (sku) => ({
            sku, nombre: '', descripcion: '', imagenes: [], stock: 200,
            tallas: '', colores: '', medidas: '',
            categoria: 'Celulares y Accesorios', proveedor: 'TVCmall', modoHybrid: true,
            mensaje: 'TVCmall: ingresa los datos del producto manualmente.'
        })
    },

    /* ════════════════════════════════════════════════════════
       PLANTILLA PARA NUEVO PROVEEDOR
       ────────────────────────────────────────────────────────
       Copia este bloque, rellena los campos y agrega las
       variables de entorno en Render. Nada más.

    miproveedor: {
        id:          'miproveedor',
        name:        'Nombre del Proveedor',
        color:       '#hexcolor',
        type:        'api',          // 'api' | 'hybrid'
        hasApi:      true,
        description: 'Descripción corta',
        categories:  ['Tecnología'],
        fetchProduct: async (sku) => {
            const key = process.env.MIPROVEEDOR_API_KEY;
            if (!key) return { sku, nombre:'', modoHybrid:true, proveedor:'Nombre del Proveedor', mensaje:'Agrega MIPROVEEDOR_API_KEY en Render.' };
            const res = await fetch(`https://api.miproveedor.com/products/${sku}?key=${key}`, { timeout:8000 });
            const d   = await res.json();
            if (!d.product) throw new Error('Producto no encontrado');
            return {
                sku,
                nombre:      d.product.title,
                descripcion: d.product.description,
                imagenes:    d.product.images.map(i => i.url),
                stock:       d.product.stock,
                tallas:      (d.product.sizes  || []).join(', '),
                colores:     (d.product.colors || []).join(', '),
                medidas:     d.product.dimensions || '',
                categoria:   detectarCategoria(d.product.title, d.product.description, d.product.category),
                proveedor:   'Nombre del Proveedor',
                modoHybrid:  false,
            };
        }
    },
    ════════════════════════════════════════════════════════ */
};

/* ════════════════════════════════════════════════════════════
   RUTAS BASE
════════════════════════════════════════════════════════════ */
app.get('/', (req, res) => {
    res.json({ success: true, message: 'Bonü Backend Activo', port: PORT });
});
app.get('/health', (req, res) => {
    res.json({ status: 'healthy', port: PORT, time: Date.now() });
});
app.get('/api/status', (req, res) => {
    res.json({ success: true, cjConfigured: !!CJ_API_KEY, timestamp: Date.now() });
});

/* ════════════════════════════════════════════════════════════
   RUTAS CJ (las originales, sin cambios)
════════════════════════════════════════════════════════════ */
app.get('/api/cj/test', (req, res) => {
    res.json({ success: true, message: 'Endpoint CJ funcionando correctamente' });
});

app.get('/api/cj/mis-productos', async (req, res) => {
    console.log('📦 Obteniendo lista de productos de CJ...');
    try {
        const token    = await getCJToken();
        const response = await fetch(`${CJ_API_URL}/product/list`, {
            method:  'GET',
            headers: { 'CJ-Access-Token': token, 'Content-Type': 'application/json' }
        });
        const data = await response.json();
        console.log(`📡 CJ code=${data.code}, msg=${data.message}`);
        if (data.code === 200 && data.data?.list) {
            const productos = data.data.list.map(p => {
                let nombre = p.productName || 'Sin nombre';
                try { const parsed = JSON.parse(nombre); if (Array.isArray(parsed)) nombre = parsed[0]; } catch (_) {}
                return {
                    pid:      p.pid,
                    sku:      p.sku || p.pid,
                    nombre,
                    precio:   p.sellPrice || p.price,
                    stock:    p.inventory || 100,
                    imagenes: p.productImage ? [p.productImage] : []
                };
            });
            res.json({ success: true, total: productos.length, productos });
        } else {
            res.json({ success: false, code: data.code, msg: data.message, raw: data });
        }
    } catch (error) {
        console.error('❌ Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/cj/buscar', async (req, res) => {
    const { sku } = req.body;
    if (!sku) return res.status(400).json({ success: false, error: 'SKU requerido' });
    console.log(`🔍 Buscando SKU: ${sku}`);
    try {
        const token    = await getCJToken();
        const response = await fetch(
            `${CJ_API_URL}/product/list?productSku=${encodeURIComponent(sku)}&pageNum=1&pageSize=1`,
            { method: 'GET', headers: { 'CJ-Access-Token': token, 'Content-Type': 'application/json' } }
        );
        const data = await response.json();
        if (data.code === 200 && data.data?.list?.length > 0) {
            const producto = data.data.list[0];
            res.json({
                success: true,
                product: {
                    pid:      producto.pid,
                    sku:      producto.sku,
                    nombre:   producto.productName,
                    precio:   producto.sellPrice,
                    stock:    producto.inventory || 100,
                    imagenes: producto.productImage ? [producto.productImage] : []
                }
            });
        } else {
            throw new Error(`Producto ${sku} no encontrado`);
        }
    } catch (error) {
        console.error('❌ Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/cj/import', async (req, res) => {
    let { sku, precioVenta, costoCJ, tipo } = req.body;
    if (!sku) return res.status(400).json({ success: false, error: 'SKU requerido' });
    sku = sku.split('-')[0];
    console.log(`📦 IMPORTANDO SKU: ${sku}`);
    try {
        const token = await getCJToken();
        const listRes = await fetch(
            `${CJ_API_URL}/product/list?productSku=${encodeURIComponent(sku)}&pageNum=1&pageSize=1`,
            { method: 'GET', headers: { 'CJ-Access-Token': token, 'Content-Type': 'application/json' } }
        );
        const listData = await listRes.json();
        if (listData.code !== 200 || !listData.data?.list?.length) {
            throw new Error(`Producto con SKU ${sku} no encontrado en CJ`);
        }
        const producto = listData.data.list[0];
        console.log(`✅ Producto encontrado: ${producto.productName}`);

        let imagenes = producto.productImage ? [producto.productImage] : [];
        try {
            const detRes  = await fetch(`${CJ_API_URL}/product/query?pid=${producto.pid}`,
                { method: 'GET', headers: { 'CJ-Access-Token': token, 'Content-Type': 'application/json' } });
            const detData = await detRes.json();
            if (detData.code === 200 && detData.data?.productImageSet) {
                imagenes = detData.data.productImageSet.split(',').filter(Boolean);
            }
        } catch (_) { console.log('⚠️ Error obteniendo imágenes detalladas'); }

        if (!imagenes.length) imagenes = ['https://picsum.photos/500/500?random=1'];

        const descuento     = Math.floor(Math.random() * 20) + 5;
        const precioOriginal = parseFloat(precioVenta) / (1 - descuento / 100);
        const nombre         = producto.productNameEn || producto.productName || `Producto ${sku}`;

        res.json({
            success: true,
            message: 'Producto importado correctamente',
            product: {
                id:           producto.pid,
                sku,
                nombre,
                descripcion:  nombre,
                categoria:    detectarCategoria(nombre, '', producto.categoryName || ''),
                precioOriginal: Math.round(precioOriginal),
                precioFinal:    parseFloat(precioVenta),
                precio:         parseFloat(precioVenta),
                precioVenta:    parseFloat(precioVenta),
                costoCJ:        parseFloat(costoCJ) || 0,
                descuento,
                stock:          producto.inventory || 100,
                tipo:           tipo || 'Ofertas',
                rating:         4,
                imagenes,
                cjData:         { pid: producto.pid, sku, imagenes }
            }
        });
    } catch (error) {
        console.error('❌ Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/cj/detalle', async (req, res) => {
    const { pid } = req.body;
    if (!pid) return res.status(400).json({ success: false, error: 'PID requerido' });
    try {
        const token    = await getCJToken();
        const response = await fetch(`${CJ_API_URL}/product/query?pid=${pid}`,
            { method: 'GET', headers: { 'CJ-Access-Token': token, 'Content-Type': 'application/json' } });
        const data = await response.json();
        if (data.code === 200 && data.data) {
            res.json({ success: true, product: data.data });
        } else {
            throw new Error(data.message || 'Producto no encontrado');
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/* ════════════════════════════════════════════════════════════
   RUTAS MULTI-PROVEEDOR  /api/providers/*
════════════════════════════════════════════════════════════ */

/**
 * GET /api/providers/list
 * Lista todos los proveedores registrados (sin credenciales).
 */
app.get('/api/providers/list', (req, res) => {
    const list = Object.values(PROVIDERS).map(p => ({
        id:          p.id,
        name:        p.name,
        color:       p.color,
        type:        p.type,
        hasApi:      p.hasApi,
        description: p.description,
        categories:  p.categories,
    }));
    res.json({ success: true, providers: list });
});

/**
 * POST /api/providers/fetch-product
 * Body: { providerId: 'sunsky', sku: 'ABC123' }
 * Busca el producto en el proveedor y devuelve datos normalizados.
 */
app.post('/api/providers/fetch-product', async (req, res) => {
    const { providerId, sku } = req.body;
    if (!providerId || !sku) {
        return res.status(400).json({ success: false, error: 'providerId y sku son requeridos' });
    }
    const provider = PROVIDERS[providerId];
    if (!provider) {
        return res.status(404).json({ success: false, error: `Proveedor "${providerId}" no registrado` });
    }
    try {
        console.log(`🔍 [${provider.name}] Buscando SKU: ${sku}`);
        const product = await provider.fetchProduct(sku.trim());
        res.json({ success: true, product, provider: { id: provider.id, name: provider.name } });
    } catch (err) {
        console.error(`❌ [${provider.name}] Error:`, err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/providers/order
 * Registra un pedido al proveedor cuando el cliente compra.
 * Body: { pedidoId, proveedorId, items:[{sku,nombre,costo}], direccion }
 *
 * Aquí se puede integrar la API de cada proveedor para hacer
 * el pedido automáticamente (cuando la tienen disponible).
 */
app.post('/api/providers/order', async (req, res) => {
    const { pedidoId, proveedorId, items, direccion } = req.body;
    if (!pedidoId || !proveedorId || !items?.length) {
        return res.status(400).json({ success: false, error: 'Faltan datos del pedido' });
    }
    const provider = PROVIDERS[proveedorId];
    if (!provider) {
        return res.status(404).json({ success: false, error: `Proveedor "${proveedorId}" no registrado` });
    }

    console.log(`📦 [${provider.name}] Nuevo pedido: ${pedidoId} — ${items.length} item(s)`);

    /* ── CJ: hacer pedido automático ───────────────────────── */
    if (proveedorId === 'cj') {
        try {
            const token = await getCJToken();
            // Construir payload de orden CJ
            const orderPayload = {
                orderNumber: pedidoId,
                shippingZip:     direccion?.cp        || '',
                shippingCountry: direccion?.pais      || 'MX',
                shippingAddress: direccion?.direccion || '',
                shippingCustomerName: direccion?.nombre  || '',
                shippingPhone:   direccion?.telefono  || '',
                houseNumber:     '',
                products: items.map(item => ({
                    vid:      item.cjVid || item.sku,
                    quantity: item.cantidad || 1,
                }))
            };
            const orderRes  = await fetch(`${CJ_API_URL}/shopping/order/createOrderV2`, {
                method:  'POST',
                headers: { 'CJ-Access-Token': token, 'Content-Type': 'application/json' },
                body:    JSON.stringify(orderPayload)
            });
            const orderData = await orderRes.json();
            if (orderData.code === 200) {
                console.log(`✅ Pedido CJ creado: ${orderData.data?.orderId}`);
                return res.json({ success: true, proveedorOrdenId: orderData.data?.orderId, proveedor: 'CJ Dropshipping' });
            }
            // Si falla el pedido automático, lo registramos para revisión manual
            console.warn(`⚠️ CJ no pudo crear el pedido automáticamente: ${orderData.message}`);
        } catch (cjErr) {
            console.error('❌ Error creando pedido CJ:', cjErr.message);
        }
    }

    /* ── Proveedores sin API: registrar para gestión manual ── */
    // En este punto podrías enviar un email/WhatsApp al admin
    // con los detalles del pedido para que lo haga manualmente.
    res.json({
        success:      true,
        manual:       true,
        proveedor:    provider.name,
        mensaje:      `Pedido registrado. ${provider.name} requiere gestión manual.`,
        pedidoId,
        items,
        direccion,
    });
});

/**
 * GET /api/providers/info
 * Instrucciones para agregar un nuevo proveedor (uso interno/debug).
 */
app.get('/api/providers/info', (req, res) => {
    res.json({
        success: true,
        proveedores_activos: Object.keys(PROVIDERS).length,
        con_api:    Object.values(PROVIDERS).filter(p => p.hasApi).map(p => p.name),
        sin_api:    Object.values(PROVIDERS).filter(p => !p.hasApi).map(p => p.name),
        como_agregar: [
            '1. Añade un objeto al registro PROVIDERS en index.js',
            '2. Implementa fetchProduct(sku) devolviendo el formato estándar',
            '3. Agrega la variable MIPROVEEDOR_API_KEY en Render > Environment',
            '4. Redeploy — el frontend lo detecta automáticamente',
        ]
    });
});

/* ════════════════════════════════════════════════════════════
   404 FALLBACK
════════════════════════════════════════════════════════════ */
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint no encontrado', path: req.path });
});

/* ════════════════════════════════════════════════════════════
   ARRANQUE
════════════════════════════════════════════════════════════ */
app.listen(PORT, '0.0.0.0', () => {
    console.log('==================================================');
    console.log('✅  Bonü Backend LISTO PARA PRODUCCIÓN');
    console.log(`📡  Puerto        : ${PORT}`);
    console.log(`🔐  CJ API KEY    : ${CJ_API_KEY  ? 'CONFIGURADA ✅' : 'FALTA ⚠️'}`);
    console.log(`☀️   SunSky KEY   : ${process.env.SUNSKY_API_KEY ? 'CONFIGURADA ✅' : 'Pendiente (modo hybrid)'}`);
    console.log(`🏭  Proveedores   : ${Object.keys(PROVIDERS).length} registrados`);
    console.log(`🌐  URL           : https://bonu-backend.onrender.com`);
    console.log(`📋  Rutas activas :`);
    console.log('     GET  /api/providers/list');
    console.log('     POST /api/providers/fetch-product');
    console.log('     POST /api/providers/order');
    console.log('     POST /api/cj/import   (ruta legacy)');
    console.log('==================================================');
});