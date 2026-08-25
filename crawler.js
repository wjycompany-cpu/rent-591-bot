// ============================================
// 591 租屋網爬蟲模組（Nuxt SSR 版）
// ============================================

const vm = require('vm');
const config = require('./config');

// 重試設定：591 會間歇性以 403 擋掉資料中心 IP，隔幾秒再試通常就過了
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS = [3000, 8000]; // 第 1、2 次失敗後各等多久（指數退避）

// 分頁上限：591 一頁 30 筆，5 頁 = 150 筆。
// 設上限是為了避免條件放寬後（例如 total 變成 800）一次打出幾十個請求。
const MAX_PAGES = 5;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 帶重試的抓取；回傳 HTML 字串。
 * 只對「有機會自己好」的狀況重試（403 / 429 / 5xx / 連線錯誤），
 * 4xx 的其他狀況視為永久性錯誤，直接放棄不浪費請求。
 * 重試用盡會 throw，並標記 isFetchFailure 讓上層知道這是連線層失敗。
 */
async function fetchWithRetry(url, headers) {
  let lastError;
  let attempts = 0;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    attempts = attempt;
    try {
      const response = await fetch(url, { headers });

      if (response.ok) {
        if (attempt > 1) console.log(`[爬蟲] 第 ${attempt} 次嘗試成功`);
        return await response.text();
      }

      const retryable = response.status === 403 || response.status === 429 || response.status >= 500;
      lastError = new Error(`HTTP ${response.status}`);
      if (!retryable) {
        console.error(`[爬蟲] HTTP ${response.status}（非暫時性錯誤，不重試）`);
        break;
      }
      console.warn(`[爬蟲] 第 ${attempt}/${MAX_ATTEMPTS} 次失敗：HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
      console.warn(`[爬蟲] 第 ${attempt}/${MAX_ATTEMPTS} 次失敗：${error.message}`);
    }

    const delay = RETRY_DELAYS[attempt - 1];
    if (attempt < MAX_ATTEMPTS && delay) {
      console.log(`[爬蟲] ${delay / 1000} 秒後重試...`);
      await sleep(delay);
    }
  }

  const failure = new Error(`抓取失敗（共嘗試 ${attempts} 次）: ${lastError.message}`);
  failure.isFetchFailure = true;
  throw failure;
}

/**
 * 抓取 591 租屋列表頁面 HTML，並從 window.__NUXT__ 提取資料
 */
/**
 * 印出連線失敗的細節，方便在 Actions log 裡除錯
 */
function logFetchError(error) {
  console.error('[爬蟲] 抓取失敗:', error.message);
  console.error('[爬蟲] error.name:', error.name);
  console.error('[爬蟲] error.code:', error.code);
  if (error.cause) {
    console.error('[爬蟲] error.cause:', error.cause);
    console.error('[爬蟲] cause.message:', error.cause.message);
    console.error('[爬蟲] cause.code:', error.cause.code);
  }
  console.error('[爬蟲] stack:', error.stack);
}

/**
 * 抓取並解析單一頁。
 * 連線失敗會往上拋（帶 isFetchFailure）；解析失敗回傳 null。
 */
async function fetchPage(url, headers) {
  const html = await fetchWithRetry(url, headers);
  console.log(`[爬蟲] 頁面大小: ${(html.length / 1024).toFixed(1)} KB`);

  const nuxtData = extractNuxtData(html);
  if (!nuxtData) {
    const hasNuxt = html.includes('__NUXT__');
    const hasItems = html.includes('items');
    console.error(`[爬蟲] 無法提取 NUXT 資料 (hasNuxt=${hasNuxt}, hasItems=${hasItems})`);
    return null;
  }

  return extractListings(nuxtData);
}

async function searchRentals() {
  console.log('[爬蟲] 開始抓取 591 租屋資料（Nuxt SSR 模式）...');

  const { region, section, rentPrice, kind, layout, other, keywords, order, orderType } = config.search;

  // 組合 591 列表頁網址（跟你在瀏覽器看到的一樣）
  const params = new URLSearchParams();
  params.append('region', String(region));
  if (section) params.append('section', section);
  if (kind) params.append('kind', String(kind));
  if (layout) params.append('layout', layout);
  if (rentPrice) params.append('rentprice', rentPrice);
  if (other) params.append('other', other);
  if (keywords) params.append('keywords', keywords);
  if (order) params.append('order', order);
  if (orderType) params.append('orderType', orderType);

  const baseUrl = `https://rent.591.com.tw/list?${params.toString()}`.replace(/%2C/g, ',');
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7',
    'Cookie': `urlJumpIp=${region}; urlJumpIpByTxt=${encodeURIComponent(getRegionName(region))}`,
  };

  const allListings = [];
  let pagesToFetch = 1; // 抓完第 1 頁、知道 total 後才會更新

  for (let page = 1; page <= pagesToFetch; page++) {
    const url = page === 1 ? baseUrl : `${baseUrl}&page=${page}`;
    console.log(`[爬蟲] 抓取第 ${page} 頁: ${url}`);

    let result;
    try {
      result = await fetchPage(url, headers);
    } catch (error) {
      logFetchError(error);
      // 第 1 頁就失敗代表這輪完全沒資料，往上拋讓主程式發 Telegram 警示；
      // 後續頁失敗則保留已取得的部分，有 30 筆總比 0 筆有用。
      if (page === 1) {
        if (error.isFetchFailure) throw error;
        return [];
      }
      console.warn(`[爬蟲] 第 ${page} 頁抓取失敗，保留已取得的 ${allListings.length} 筆`);
      break;
    }

    if (!result) {
      if (page === 1) return [];
      console.warn(`[爬蟲] 第 ${page} 頁解析失敗，保留已取得的 ${allListings.length} 筆`);
      break;
    }

    allListings.push(...result.listings);

    // 第 1 頁才需要換算總頁數
    if (page === 1) {
      const perPage = result.listings.length;
      if (result.total && perPage > 0) {
        const needed = Math.ceil(result.total / perPage);
        pagesToFetch = Math.min(needed, MAX_PAGES);
        console.log(`[爬蟲] 總物件數 ${result.total}，每頁 ${perPage} 筆，預計抓 ${pagesToFetch} 頁`);
        if (needed > MAX_PAGES) {
          console.warn(`[爬蟲] 需 ${needed} 頁但上限為 ${MAX_PAGES} 頁，將略過最舊的 ${result.total - MAX_PAGES * perPage} 筆`);
        }
      }
    }

    // 還有下一頁才需要等，避免請求過於密集
    if (page < pagesToFetch) {
      await sleep(config.crawler.requestDelay);
    }
  }

  console.log(`[爬蟲] 共取得 ${allListings.length} 筆物件`);
  return allListings;
}

/**
 * 從 HTML 提取並執行 window.__NUXT__ 腳本
 */
function extractNuxtData(html) {
  // 找到 window.__NUXT__ 的 script 區塊
  const startMarker = 'window.__NUXT__=';
  const startIdx = html.indexOf(startMarker);
  if (startIdx === -1) {
    console.error('[爬蟲] 在 HTML 中找不到 window.__NUXT__ 資料');
    return null;
  }

  const scriptEnd = html.indexOf('</script>', startIdx);
  if (scriptEnd === -1) {
    console.error('[爬蟲] 找不到 __NUXT__ script 結尾');
    return null;
  }

  const nuxtScript = html.substring(startIdx + startMarker.length, scriptEnd).trim();

  console.log(`[爬蟲] 找到 NUXT 腳本，長度: ${nuxtScript.length} 字元`);

  try {
    // 用 Node.js vm 模組在沙盒中執行該腳本
    const sandbox = {};
    const script = new vm.Script(`__result__ = ${nuxtScript}`);
    const context = vm.createContext(sandbox);
    script.runInContext(context, { timeout: 5000 });

    if (sandbox.__result__) {
      console.log('[爬蟲] NUXT 資料解析成功');
      return sandbox.__result__;
    }
  } catch (error) {
    console.error('[爬蟲] 執行 NUXT 腳本失敗:', error.message);
  }

  return null;
}

/**
 * 從 NUXT 資料結構中找出房屋列表
 */
function extractListings(nuxtData) {
  const allListings = [];
  let total = null;

  if (nuxtData.data) {
    for (const [key, value] of Object.entries(nuxtData.data)) {
      // 找到有 data.items 的那個
      if (value?.data?.items && Array.isArray(value.data.items)) {
        console.log(`[爬蟲] 在 key "${key.substring(0, 20)}..." 找到 ${value.data.items.length} 筆物件`);

        for (const item of value.data.items) {
          allListings.push(formatItem(item));
        }
      }

      if (value?.data?.total !== undefined) {
        total = Number(value.data.total);
      }
    }
  }

  // 如果上面沒找到，嘗試遞迴搜尋
  if (allListings.length === 0) {
    console.log('[爬蟲] 嘗試深層搜尋 items...');
    const found = deepFindItems(nuxtData);
    if (found) {
      console.log(`[爬蟲] 深層搜尋找到 ${found.length} 筆物件`);
      for (const item of found) {
        if (item.id && item.title) {
          allListings.push(formatItem(item));
        }
      }
    }
  }

  return { listings: allListings, total };
}

/**
 * 格式化單一物件
 */
function formatItem(item) {
  return {
    id: item.id || item.post_id,
    title: item.title || '',
    price: item.price || '',
    priceUnit: item.price_unit || '元/月',
    kind: item.kind_name || '',
    area: item.area || '',
    // 591 的 area_name 名稱誤導，內容是「69.4坪」這種坪數字串而非區域名稱；
    // 區域只出現在 address 的前綴（例如「淡水區-新市三路二段」），需自行取出。
    district: String(item.address || '').split('-')[0].trim(),
    floor: item.floor_name || '',
    layout: item.layoutStr || '',
    fitment: item.fitment_name || '',
    address: item.address || '',
    community: item.community_name || '',
    photo: item.cover || (item.photoList && item.photoList[0]) || '',
    url: item.url
      ? (item.url.startsWith('http') ? item.url : `https://rent.591.com.tw${item.url}`)
      : `https://rent.591.com.tw/${item.id}`,
    tags: (item.tags || []).filter(t => typeof t === 'string' && t.length > 0),
    refreshTime: item.refresh_time || '',
    browseCount: item.browse_count || 0,
    roleName: item.role_name || '',
    surrounding: item.surrounding || null,
  };
}

/**
 * 遞迴搜尋物件中包含 items 陣列的位置
 */
function deepFindItems(obj, depth = 0) {
  if (depth > 10 || !obj || typeof obj !== 'object') return null;

  if (Array.isArray(obj)) {
    if (obj.length > 0 && obj[0]?.id && obj[0]?.title && obj[0]?.price !== undefined) {
      return obj;
    }
    for (const item of obj) {
      const found = deepFindItems(item, depth + 1);
      if (found) return found;
    }
  } else {
    for (const value of Object.values(obj)) {
      const found = deepFindItems(value, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/**
 * 區域代碼對照
 */
function getRegionName(region) {
  const map = {
    1: '台北市', 3: '新北市', 6: '桃園市', 8: '新竹市',
    4: '基隆市', 5: '新竹縣', 7: '苗栗縣', 10: '台中市',
    11: '彰化縣', 12: '南投縣', 14: '嘉義市', 15: '台南市',
    17: '高雄市', 19: '屏東縣', 21: '台東縣', 22: '花蓮縣',
    23: '宜蘭縣',
  };
  return map[region] || '';
}

// fetchWithRetry 與 extractNuxtData 供 detail.js 共用，避免重複實作重試與解析邏輯
module.exports = { searchRentals, fetchWithRetry, extractNuxtData };
