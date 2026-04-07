// ============================================
// 591 租屋網爬蟲模組（Nuxt SSR 版）
// ============================================

const vm = require('vm');
const config = require('./config');

/**
 * 抓取 591 租屋列表頁面 HTML，並從 window.__NUXT__ 提取資料
 */
async function searchRentals() {
  console.log('[爬蟲] 開始抓取 591 租屋資料（Nuxt SSR 模式）...');

  const { region, section, rentPrice, kind, other, keywords, order, orderType } = config.search;

  // 組合 591 列表頁網址（跟你在瀏覽器看到的一樣）
  const params = new URLSearchParams();
  params.append('region', String(region));
  if (section) params.append('section', section);
  if (kind) params.append('kind', String(kind));
  if (rentPrice) params.append('rentprice', rentPrice);
  if (other) params.append('other', other);
  if (keywords) params.append('keywords', keywords);
  if (order) params.append('order', order);
  if (orderType) params.append('orderType', orderType);

  const url = `https://rent.591.com.tw/list?${params.toString()}`;
  console.log(`[爬蟲] 抓取網址: ${url}`);

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7',
        'Cookie': `urlJumpIp=${region}; urlJumpIpByTxt=${encodeURIComponent(getRegionName(region))}`,
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();
    console.log(`[爬蟲] 頁面大小: ${(html.length / 1024).toFixed(1)} KB`);

    // 從 HTML 中提取 window.__NUXT__ 的內容
    const nuxtData = extractNuxtData(html);
    if (!nuxtData) {
      const hasNuxt = html.includes('__NUXT__');
      const hasItems = html.includes('items');
      console.error(`[爬蟲] 無法提取 NUXT 資料 (hasNuxt=${hasNuxt}, hasItems=${hasItems})`);
      return [];
    }

    // 從 NUXT 資料中找到房屋列表
    const listings = extractListings(nuxtData);
    console.log(`[爬蟲] 共取得 ${listings.length} 筆物件`);
    return listings;

  } catch (error) {
    console.error('[爬蟲] 抓取失敗:', error.message);
    return [];
  }
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
        console.log(`[爬蟲] 總物件數: ${value.data.total}`);
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

  return allListings;
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
    areaName: item.area_name || '',
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

module.exports = { searchRentals };
