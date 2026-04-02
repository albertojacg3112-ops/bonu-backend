require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3001;

const CJ_API_KEY = process.env.CJ_API_KEY;
const CJ_API_URL = "https://developers.cjdropshipping.com/api2.0/v1";

let cjAccessToken = null;
let cjTokenExpiry = null;

async function getCJToken() {
    if (cjAccessToken && cjTokenExpiry && new Date() < new Date(cjTokenExpiry)) {
        return cjAccessToken;
    }
    console.log('🔐 Obteniendo nuevo token de CJ...');
    const response = await fetch(`${CJ_API_URL}/authentication/getAccessToken`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: CJ_API_KEY })
    });
    const data = await response.json();
    console.log('🔐 Respuesta token CJ:', JSON.stringify(data).substring(0, 200));
    if (data.code === 200 && data.data?.accessToken) {
        cjAccessToken = data.data.accessToken;
        cjTokenExpiry = data.data.accessTokenExpiryDate;
        console.log('✅ Token obtenido correctamente');
        return cjAccessToken;
    }
    throw new Error(`Error obteniendo token CJ: ${data.message}`);
}

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
    res.json({ success: true, message: 'Bonü Backend Activo', port: PORT });
});

app.get('/health', (req, res) => {
    res.json({ status: 'healthy', port: PORT, time: Date.now() });
});

app.get('/api/status', (req, res) => {
    res.json({ success: true, cjConfigured: !!CJ_API_KEY, timestamp: Date.now() });
});

app.get('/api/cj/test', (req, res) => {
    res.json({ success: true, message: 'Endpoint CJ funcionando correctamente' });
});

app.get('/api/cj/mis-productos', async (req, res) => {
    console.log('📦 Obteniendo lista de productos de CJ...');
    try {
        const token = await getCJToken();
        const response = await fetch(`${CJ_API_URL}/product/list`, {
            method: 'GET',
            headers: { 'CJ-Access-Token': token, 'Content-Type': 'application/json' }
        });
       const data = await response.json();
        console.log(`📡 CJ code=${data.code}, msg=${data.message}`);
        if (data.code === 200 && data.data?.list) {
            const productos = data.data.list.map(p => {
                let nombre = p.productName || 'Sin nombre';
                try {
                    const parsed = JSON.parse(nombre);
                    if (Array.isArray(parsed)) nombre = parsed[0];
                } catch(e) {}
                return {
                    pid: p.pid,
                    sku: p.sku || p.pid,
                    nombre: nombre,
                    precio: p.sellPrice || p.price,
                    stock: p.inventory || 100,
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
        const token = await getCJToken();
        const response = await fetch(`${CJ_API_URL}/product/list?productSku=${encodeURIComponent(sku)}&pageNum=1&pageSize=1`, {
            method: 'GET',
            headers: { 'CJ-Access-Token': token, 'Content-Type': 'application/json' }
        });
        const data = await response.json();
        if (data.code === 200 && data.data?.list?.length > 0) {
            const producto = data.data.list[0];
            res.json({
                success: true,
                product: {
                    pid: producto.pid,
                    sku: producto.sku,
                    nombre: producto.productName,
                    precio: producto.sellPrice,
                    stock: producto.inventory || 100,
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
        const listResponse = await fetch(`${CJ_API_URL}/product/list?productSku=${encodeURIComponent(sku)}&pageNum=1&pageSize=1`, {
            method: 'GET',
            headers: { 'CJ-Access-Token': token, 'Content-Type': 'application/json' }
        });
        const listData = await listResponse.json();
        if (listData.code !== 200 || !listData.data?.list?.length) {
            throw new Error(`Producto con SKU ${sku} no encontrado en CJ`);
        }
        const producto = listData.data.list[0];
        console.log(`✅ Producto encontrado: ${producto.productName}`);

        let imagenes = producto.productImage ? [producto.productImage] : [];
        try {
            const detailResponse = await fetch(`${CJ_API_URL}/product/query?pid=${producto.pid}`, {
                method: 'GET',
                headers: { 'CJ-Access-Token': token, 'Content-Type': 'application/json' }
            });
            const detailData = await detailResponse.json();
            if (detailData.code === 200 && detailData.data?.productImageSet) {
                imagenes = detailData.data.productImageSet.split(',');
            }
        } catch (imgError) {
            console.log('⚠️ Error obteniendo imágenes detalladas');
        }

        if (imagenes.length === 0) imagenes = ['https://picsum.photos/500/500?random=1'];

        const descuento = Math.floor(Math.random() * 20) + 5;
        const precioOriginal = parseFloat(precioVenta) / (1 - descuento / 100);

        res.json({
            success: true,
            message: 'Producto importado correctamente',
            product: {
                id: producto.pid,
                sku: sku,
                nombre: producto.productNameEn || producto.productName || `Producto ${sku}`,
                descripcion: producto.productNameEn || producto.productName || 'Sin descripción disponible',
                categoria: producto.categoryName || 'General',
                precioOriginal: Math.round(precioOriginal),
                precioFinal: parseFloat(precioVenta),
                precio: parseFloat(precioVenta),
                precioVenta: parseFloat(precioVenta),
                costoCJ: parseFloat(costoCJ) || 0,
                descuento: descuento,
                stock: producto.inventory || 100,
                tipo: tipo || 'Ofertas',
                rating: 4,
                imagenes: imagenes,
                cjData: { pid: producto.pid, sku: sku, imagenes: imagenes }
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
        const token = await getCJToken();
        const response = await fetch(`${CJ_API_URL}/product/query?pid=${pid}`, {
            method: 'GET',
            headers: { 'CJ-Access-Token': token, 'Content-Type': 'application/json' }
        });
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

app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint no encontrado' });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log('==================================================');
    console.log('✅ Bonü Backend LISTO PARA PRODUCCIÓN');
    console.log(`📡 Puerto: ${PORT}`);
    console.log(`🔐 CJ API KEY: ${CJ_API_KEY ? 'CONFIGURADA' : 'FALTA'}`);
    console.log(`🌐 URL: https://bonu-backend.onrender.com`);
    console.log('==================================================');
});