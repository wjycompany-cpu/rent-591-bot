// ============================================
// 591 物件詳情頁抓取
// ============================================
// 列表頁只有標題與粗略標籤，詳情頁則有 591 整理好的費用結構：
// 管理費與車位費是實際金額，據此才能算出「實質月租」。
// 一筆 20,320 的物件加上 4,480 管理費後其實要 24,800，光看列表頁無從得知。
//
// 這是附加功能：任何失敗都只降級成「沿用列表頁資料」，絕不中斷推播。

const config = require('./config');
const { fetchWithRetry, extractNuxtData } = require('./crawler');

const BASE = 'https://rent.591.com.tw/';

// 單輪抓取上限。日常新物件多為個位數，設限是為了避免搜尋條件放寬後
// 一次湧入大量物件時瞬間送出過多請求。
const MAX_PER_RUN = 20;

// 連續失敗達此數即中止本輪。第一筆被 403 擋下通常代表整個 IP 被擋，
// 繼續對正在拒絕我們的伺服器重試既無意義也不禮貌。
const CIRCUIT_BREAK_AFTER = 3;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function headers(region) {
  return {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7',
    'Cookie': `urlJumpIp=${region}`,
  };
}

/**
 * NUXT 的資料掛在隨機雜湊 key 底下，路徑每次都不同，
 * 因此以「找得到這個 key」的方式深度搜尋，而非寫死路徑。
 */
function findKey(root, target, maxDepth = 12) {
  const stack = [[root, 0]];
  while (stack.length) {
    const [node, depth] = stack.pop();
    if (!node || typeof node !== 'object' || depth > maxDepth) continue;
    for (const [k, v] of Object.entries(node)) {
      if (k === target && v != null) return v;
      if (v && typeof v === 'object') stack.push([v, depth + 1]);
    }
  }
  return null;
}

/**
 * 由費用結構算出實質月租。
 *
 * 591 有兩種「不知道」會讓結果被低估，兩者都必須標示出來：
 *   1. manage_fee_text 為「無數據」——刊登者沒填管理費，並非沒有管理費
 *   2. 車位標示另計但 carport_price 為 0 ——沒有揭露車位月租
 * 這兩種情況下回傳的數字是下限，complete 為 false。
 */
function calcEffectiveRent(rc, hasCarport) {
  const rent = Number(rc.rent_price) || 0;
  const manage = Number(rc.manage_fee) || 0;
  const carportExtra = rc.price_has_carport ? 0 : (Number(rc.carport_price) || 0);

  const manageUnknown = rc.manage_fee_text === '無數據';
  const carportUnknown = hasCarport && !rc.price_has_carport && !rc.carport_price;

  return {
    effectiveRent: rent + manage + carportExtra,
    complete: !manageUnknown && !carportUnknown,
  };
}

/**
 * 車位費用的顯示文字。
 * 讓「租金 + 管理費 + 車位費 = 實質月租」這個算式在表上看得出來，
 * 否則使用者會看到實質月租多了兩千卻找不到來源。
 */
function carportFeeText(rc, hasCarport) {
  if (!hasCarport) return '無車位';
  if (rc.price_has_carport) return '含租金內';
  if (Number(rc.carport_price) > 0) return rc.carport_price_text || `${rc.carport_price}元/月`;
  return '無數據';
}

/**
 * 抓取並解析單一物件的詳情頁
 * @returns {Promise<object|null>} 解析失敗回傳 null（不 throw）
 */
async function fetchDetail(id, region) {
  const html = await fetchWithRetry(`${BASE}${id}`, headers(region));
  const nuxt = extractNuxtData(html);
  if (!nuxt) return null;

  const rc = findKey(nuxt, 'rent_calculation_data');
  const link = findKey(nuxt, 'linkInfo') || {};
  const desc = findKey(nuxt, 'descData') || [];
  const facility = findKey(nuxt, 'facility') || [];

  if (!rc) return null;

  // facility 每筆都有 active 旗標，0 代表「沒有這項設備」，必須濾掉
  const owned = facility.filter((f) => f && f.active === 1).map((f) => f.name);
  const byLabel = Object.fromEntries(desc.filter((d) => d && d.label).map((d) => [d.label, d.value]));
  const carportType = owned.find((n) => /車位/.test(n)) || '';
  const hasCarport = Boolean(carportType) || rc.price_has_carport || Number(rc.carport_price) > 0;
  const { effectiveRent, complete } = calcEffectiveRent(rc, hasCarport);

  return {
    rentPrice: Number(rc.rent_price) || 0,
    manageFee: Number(rc.manage_fee) || 0,
    manageFeeText: rc.manage_fee_text || '',
    carportIncluded: Boolean(rc.price_has_carport),
    carportPriceText: rc.carport_price_text || '',
    carportFee: carportFeeText(rc, hasCarport),
    carportType,
    priceContain: rc.price_contain_text || '',
    serviceFee: rc.service_fee || '',
    deposit: rc.deposit || '',
    role: link.roleName || '',           // 仲介 / 屋主
    chargeText: link.isrecmoney || '',   // 收服務費 / 不收服務費
    pet: byLabel['養寵物'] || '',
    cooking: byLabel['開伙'] || '',
    minLease: byLabel['最短租期'] || '',
    tenantReq: byLabel['身份要求'] || '',
    moveIn: byLabel['可遷入日'] || '',
    effectiveRent,
    effectiveRentComplete: complete,
  };
}

/**
 * 逐筆補上詳情資料。
 * 失敗的物件保留原樣，呼叫端不需區分成功與否——欄位不存在就是沒抓到。
 * @returns {Promise<{enriched:number, failed:number, capped:number}>}
 */
async function enrichListings(listings) {
  if (!listings || listings.length === 0) return { enriched: 0, failed: 0, capped: 0 };

  const targets = listings.slice(0, MAX_PER_RUN);
  const capped = listings.length - targets.length;
  if (capped > 0) {
    console.warn(`[詳情] 本輪 ${listings.length} 筆超過上限 ${MAX_PER_RUN}，其餘 ${capped} 筆僅使用列表頁資料`);
  }

  let enriched = 0;
  let failed = 0;
  let consecutiveFailures = 0;
  let aborted = 0;

  for (const [index, item] of targets.entries()) {
    try {
      const detail = await fetchDetail(item.id, config.search.region);
      if (detail) {
        item.detail = detail;
        enriched++;
        consecutiveFailures = 0;
      } else {
        failed++;
        consecutiveFailures++;
        console.warn(`[詳情] ${item.id} 解析不到費用資料，沿用列表頁`);
      }
    } catch (error) {
      failed++;
      consecutiveFailures++;
      console.warn(`[詳情] ${item.id} 抓取失敗（沿用列表頁）: ${error.message}`);
    }

    if (consecutiveFailures >= CIRCUIT_BREAK_AFTER) {
      aborted = targets.length - index - 1;
      console.warn(`[詳情] 連續失敗 ${consecutiveFailures} 次，中止本輪剩餘 ${aborted} 筆（多半是 IP 被擋）`);
      break;
    }

    if (index < targets.length - 1) await sleep(config.crawler.requestDelay);
  }

  console.log(`[詳情] 完成 ${enriched}/${targets.length} 筆${failed ? `（失敗 ${failed} 筆）` : ''}`);
  return { enriched, failed, capped, aborted };
}

module.exports = { fetchDetail, enrichListings, calcEffectiveRent, carportFeeText, MAX_PER_RUN };
