const XLSX    = require('xlsx');
const crypto  = require('crypto');
const fs      = require('fs');
const path    = require('path');

const ACCESS_KEY = process.env.COUPANG_ACCESS_KEY || '5071cf37-ab91-4a62-bf52-35a0ae61b15e';
const SECRET_KEY = process.env.COUPANG_SECRET_KEY || 'f66f24d0649ec9157b72602dc192f9b2a09bce3d';

function generateHmac(method, apiPath, query) {
  const now = new Date();
  const dt =
    String(now.getUTCFullYear()).slice(2) +
    String(now.getUTCMonth() + 1).padStart(2, '0') +
    String(now.getUTCDate()).padStart(2, '0') + 'T' +
    String(now.getUTCHours()).padStart(2, '0') +
    String(now.getUTCMinutes()).padStart(2, '0') +
    String(now.getUTCSeconds()).padStart(2, '0') + 'Z';
  const sig = crypto.createHmac('sha256', SECRET_KEY).update(dt + method + apiPath + query).digest('hex');
  return { datetime: dt, signature: sig };
}

async function searchCoupang(keyword) {
  const apiPath = '/v2/providers/affiliate_open_api/apis/openapi/v1/products/search';
  const query   = `keyword=${encodeURIComponent(keyword)}&limit=10`;
  const { datetime, signature } = generateHmac('GET', apiPath, query);
  const res = await fetch(`https://api-gateway.coupang.com${apiPath}?${query}`, {
    headers: {
      Authorization: `CEA algorithm=HmacSHA256, access-key=${ACCESS_KEY}, signed-date=${datetime}, signature=${signature}`,
    }
  });
  const data = await res.json();
  if (data.rCode !== '0') return [];
  return data.data?.productData || [];
}

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

async function main() {
  const products = loadProducts();
  console.log(`상품 ${products.length}개 로드`);

  const results = [];

  for (const p of products) {
    const keyword  = '삼성 ' + p.note;
    const refPrice = p.coupangRef || p.naverRef;
    const min_price = refPrice ? Math.round(refPrice * 0.7) : 0;
    const max_price = refPrice ? Math.round(refPrice * 1.3) : Infinity;

    try {
      const items = await searchCoupang(keyword);
      const withPrice = items.filter(i => i.productPrice > 0).map(i => ({
        name:  i.productName,
        price: i.productPrice,
        url:   i.productUrl,
        image: i.productImage || null,
      }));
      const inRange = refPrice
        ? withPrice.filter(i => i.price >= min_price && i.price <= max_price)
        : withPrice;
      const sorted   = inRange.sort((a, b) => a.price - b.price);
      const cheapest = sorted[0] || null;

      console.log(`  ${p.model} → ${cheapest ? cheapest.price + '원' : '없음'}`);
      results.push({ ...p, cheapest, image: cheapest?.image || null, top5: sorted.slice(0, 5) });
    } catch (e) {
      console.error(`  ${p.model} 오류:`, e.message);
      results.push({ ...p, cheapest: null, image: null, top5: [] });
    }

    // API 부하 방지
    await new Promise(r => setTimeout(r, 500));
  }

  const output = {
    updatedAt: new Date().toISOString(),
    products:  results,
  };

  const outPath = path.join(__dirname, '..', 'docs', 'data.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf8');
  console.log(`\n저장 완료: ${outPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });