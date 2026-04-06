const express = require('express');
const path    = require('path');
const XLSX    = require('xlsx');
const crypto  = require('crypto');
const app     = express();
const PORT    = 3737;

const ACCESS_KEY = '5071cf37-ab91-4a62-bf52-35a0ae61b15e';
const SECRET_KEY = 'f66f24d0649ec9157b72602dc192f9b2a09bce3d';
const DOMAIN     = 'https://api-gateway.coupang.com';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── 엑셀 로드 ───
function loadProducts() {
  const wb   = XLSX.readFile(path.join(__dirname, '..', 's-mn-claude.xlsx'));
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
  const products = [];
  let id = 1;
  for (const row of rows) {
    const [category, model, , , , coupangRef, naverRef, note] = row;
    if (!category || !model || typeof model !== 'string' || model === '모델명') continue;
    if (typeof coupangRef !== 'number' && typeof naverRef !== 'number') continue;
    products.push({
      id: id++, category, model,
      note: note || model,
      coupangRef: typeof coupangRef === 'number' ? Math.round(coupangRef) : null,
      naverRef:   typeof naverRef   === 'number' ? Math.round(naverRef)   : null,
    });
  }
  return products;
}

app.get('/api/products', (req, res) => {
  try { res.json(loadProducts()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── 쿠팡 파트너스 HMAC 서명 ───
function generateHmac(method, path, query) {
  const now = new Date();
  const datetime =
    String(now.getUTCFullYear()).slice(2) +
    String(now.getUTCMonth() + 1).padStart(2, '0') +
    String(now.getUTCDate()).padStart(2, '0') +
    'T' +
    String(now.getUTCHours()).padStart(2, '0') +
    String(now.getUTCMinutes()).padStart(2, '0') +
    String(now.getUTCSeconds()).padStart(2, '0') +
    'Z';

  const message   = datetime + method + path + (query || '');
  const signature = crypto.createHmac('sha256', SECRET_KEY).update(message).digest('hex');
  return { datetime, signature };
}

// ─── 쿠팡 로켓 상품 검색 ───
async function searchCoupang(keyword, limit = 10) {
  const apiPath = '/v2/providers/affiliate_open_api/apis/openapi/v1/products/search';
  const query   = `keyword=${encodeURIComponent(keyword)}&limit=${limit}`;
  const { datetime, signature } = generateHmac('GET', apiPath, query);

  const url = `${DOMAIN}${apiPath}?${query}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `CEA algorithm=HmacSHA256, access-key=${ACCESS_KEY}, signed-date=${datetime}, signature=${signature}`,
      'Content-Type': 'application/json',
    }
  });

  const data = await res.json();
  console.log('[쿠팡 API]', keyword, '→', data.rCode, data.rMessage || '');

  if (data.rCode !== '0') throw new Error(data.rMessage || 'API 오류');
  return data.data?.productData || [];
}

// ─── 가격 범위 검색 ───
app.post('/api/search', async (req, res) => {
  const { model, keyword, refPrice } = req.body;
  if (!keyword) return res.status(400).json({ error: 'keyword required' });

  const min_price = refPrice ? Math.round(refPrice * 0.7) : undefined;
  const max_price = refPrice ? Math.round(refPrice * 1.3) : undefined;

  function filterItems(items) {
    const withPrice = items.filter(p => p.productPrice > 0).map(p => ({
      name:  p.productName,
      price: p.productPrice,
      url:   p.productUrl,
      image: p.productImage || null,
    }));
    return refPrice
      ? withPrice.filter(p => p.price >= min_price && p.price <= max_price)
      : withPrice;
  }

  try {
    let items = await searchCoupang(keyword, 10);
    let inRange = filterItems(items);

    // 범위 내 결과 없으면 모델명으로 재시도
    if (inRange.length === 0 && keyword !== model) {
      console.log('[재시도]', model);
      items = await searchCoupang(model, 10);
      inRange = filterItems(items);
    }

    const sorted   = inRange.sort((a, b) => a.price - b.price);
    const cheapest = sorted[0] || null;
    const image    = cheapest?.image || null;

    res.json({ success: true, model, cheapest, image, top5: sorted.slice(0, 5) });
  } catch (e) {
    console.error('[검색 오류]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── Bing 이미지 검색 (이미지 없을 때 폴백) ───
async function searchBingImage(query) {
  try {
    const url = `https://www.bing.com/images/search?q=${encodeURIComponent(query)}&count=5&first=1`;
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
      }
    });
    const html    = (await r.text()).replace(/&quot;/g, '"');
    const matches = [...html.matchAll(/"murl":"(https?:[^"]+)"/g)].map(m => m[1]);
    return matches.find(u => /\.(jpg|jpeg|png|webp)/i.test(u)) || null;
  } catch { return null; }
}

app.listen(PORT, () => console.log(`\n✅  http://localhost:${PORT}\n`));
