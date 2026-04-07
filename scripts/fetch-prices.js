const XLSX   = require('xlsx');
const fs     = require('fs');
const path   = require('path');

const CLIENT_ID     = process.env.NAVER_CLIENT_ID     || 'CsW83ZRverE3gRykEbKc';
const CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET || 'hVKOF6v9sX';
const OUT_PATH      = path.join(__dirname, '..', 'docs', 'data.json');

// 네이버 쇼핑 검색
async function searchNaver(keyword, display = 20) {
  const url = `https://openapi.naver.com/v1/search/shop.json?query=${encodeURIComponent(keyword)}&display=${display}&sort=sim`;
  const res  = await fetch(url, {
    headers: {
      'X-Naver-Client-Id':     CLIENT_ID,
      'X-Naver-Client-Secret': CLIENT_SECRET,
    }
  });
  if (!res.ok) {
    const text = await res.text();
    console.log(`  [네이버 API] ${res.status} ${text.slice(0, 80)}`);
    return [];
  }
  const data = await res.json();
  return data.items || [];
}

function stripHtml(str) {
  return str.replace(/<[^>]+>/g, '');
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

function loadExisting() {
  try {
    return JSON.parse(fs.readFileSync(OUT_PATH, 'utf8')).products || [];
  } catch { return []; }
}

function saveResults(results) {
  fs.writeFileSync(OUT_PATH, JSON.stringify({
    updatedAt: new Date().toISOString(),
    products:  results,
  }, null, 2), 'utf8');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const products = loadProducts();
  const existing = loadExisting();

  const prevMap = {};
  for (const p of existing) prevMap[p.model] = p;

  const results = products.map(p => ({
    ...p,
    cheapest: prevMap[p.model]?.cheapest || null,
    image:    prevMap[p.model]?.image    || null,
    top5:     prevMap[p.model]?.top5     || [],
  }));

  const todo = results.filter(p => !p.cheapest);
  console.log(`총 ${products.length}개 | 완료: ${results.length - todo.length}개 | 남은 것: ${todo.length}개\n`);

  if (todo.length === 0) {
    console.log('모두 완료되어 있습니다.');
    return;
  }

  for (const p of todo) {
    const refPrice  = p.coupangRef || p.naverRef;
    const min_price = refPrice ? Math.round(refPrice * 0.5) : 0;
    const max_price = refPrice ? Math.round(refPrice * 1.5) : Infinity;
    // 카테고리별 1차 키워드
    const firstKeyword = {
      '휴대폰': `삼성 ${p.note} 자급제 공기계`,
      '태블릿': `삼성 ${p.note} wifi`,
      '노트북': `삼성 ${p.note}`,
      '모니터': `삼성 ${p.note}`,
      '티비':   `삼성 ${p.note}`,
    };
    // 카테고리별 재시도 키워드 (모델번호 기반)
    const retryKeyword = {
      '휴대폰': `삼성 ${p.note} 자급제`,
      '태블릿': `삼성 ${p.model}`,
      '노트북': `삼성 ${p.model}`,
      '모니터': `삼성 ${p.model}`,
      '티비':   `삼성 ${p.model}`,
    };
    const keyword = firstKeyword[p.category] || `삼성 ${p.note}`;

    console.log(`[${p.id}/${products.length}] ${p.model} (${keyword}) 참고가: ${refPrice?.toLocaleString()}원`);

    try {
      let items = await searchNaver(keyword, 30);

      function filterItems(arr) {
        return arr
          .map(i => ({
            name:  stripHtml(i.title),
            price: parseInt(i.lprice, 10),
            url:   i.link,
            image: i.image || null,
            mall:  i.mallName || '',
          }))
          .filter(i => i.price >= 30000) // 액세서리(케이스·필름 등) 제외
          .filter(i => !refPrice || (i.price >= min_price && i.price <= max_price));
      }

      let inRange = filterItems(items);

      // 범위 내 없으면 모델번호 기반으로 재시도
      if (inRange.length === 0) {
        const retry = retryKeyword[p.category] || `삼성 ${p.model}`;
        console.log(`  → 재시도: ${retry}`);
        await sleep(500);
        items   = await searchNaver(retry, 30);
        inRange = filterItems(items);
      }

      const sorted   = inRange.sort((a, b) => a.price - b.price);
      const cheapest = sorted[0] || null;

      const target    = results.find(r => r.model === p.model);
      target.cheapest = cheapest;
      target.image    = cheapest?.image || null;
      target.top5     = sorted.slice(0, 5);

      if (cheapest) {
        console.log(`  → ${cheapest.price.toLocaleString()}원 (${cheapest.mall}) ${cheapest.name.slice(0, 30)}`);
      } else {
        console.log(`  → 범위 내 결과 없음 (${min_price.toLocaleString()}~${max_price.toLocaleString()}원)`);
      }
    } catch (e) {
      console.error(`  → 오류: ${e.message}`);
    }

    await sleep(300); // 네이버는 제한 여유로움, 0.3초 딜레이
  }

  saveResults(results);
  const done = results.filter(p => p.cheapest).length;
  console.log(`\n✅ 저장 완료: ${OUT_PATH}`);
  console.log(`완료 ${done}개 / 전체 ${results.length}개`);
}

main().catch(e => { console.error(e); process.exit(1); });
