// ============================================
// Google Sheets 寫入模組
// ============================================
// 把新抓到的物件 append 成 Google Sheet 的一列。
// 設計原則：這是「附加輸出」，任何失敗都只記 log，絕不影響爬蟲與 Telegram 推播。

const { JWT } = require('google-auth-library');
const config = require('./config');

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
const API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

// 表頭；順序必須與 formatRow() 一致。
// 第 14 欄之後來自詳情頁，抓取失敗時留空。
const HEADER = [
  '標題',
  // 費用：租金 + 管理費 = 實質月租，依算式順序排列
  '租金', '管理費', '車位費', '實質月租', '租金含',
  // 房屋本身
  '坪數', '格局', '樓層', '車位型式',
  // 位置
  '社區', '地址',
  // 交易條件
  '出租方', '服務費', '押金', '最短租期', '寵物',
  // 次要／查核用
  '類型', '標籤', '連結', '物件ID', '抓取時間',
];

// 由欄數推算最後一欄的字母，避免日後增欄時漏改範圍
const LAST_COL = String.fromCharCode(64 + HEADER.length);

// 租金上限同步到資料範圍右側的儲存格，供條件式格式參照。
// 直接把數字寫死在格式規則裡的話，改了 config.js 之後標示就會失準而且不會有人發現。
const BUDGET_LABEL_CELL = String.fromCharCode(64 + HEADER.length + 1) + '1'; // X1
const BUDGET_VALUE_CELL = String.fromCharCode(64 + HEADER.length + 2) + '1'; // Y1

/**
 * 從搜尋條件的租金範圍取出上限，例如 '10000,22000' → 22000
 */
function budgetLimit() {
  const upper = String(config.search.rentPrice || '').split(',')[1];
  const n = parseInt(upper, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * 把租金上限寫進試算表，讓條件式格式能參照到最新值。
 * 失敗只記 log——這只是輔助資訊，不該影響資料寫入。
 */
async function syncBudgetCell(client, sheetName) {
  const limit = budgetLimit();
  if (limit === null) return;

  const range = encodeURIComponent(`${sheetName}!${BUDGET_LABEL_CELL}:${BUDGET_VALUE_CELL}`);
  try {
    await client.request({
      url: `${API_BASE}/${config.sheets.sheetId}/values/${range}?valueInputOption=RAW`,
      method: 'PUT',
      data: { values: [['租金上限（自動同步自 config.js，請勿手動修改）', limit]] },
    });
  } catch (error) {
    console.warn(`[Sheets] 租金上限同步失敗（不影響寫入）: ${error.message}`);
  }
}

let cachedClient = null;

/**
 * 是否已完成設定（未設定就整個功能靜默略過）
 */
function isEnabled() {
  return Boolean(config.sheets.credentialsB64 && config.sheets.sheetId);
}

/**
 * 從 base64 環境變數還原服務帳號金鑰
 */
function loadCredentials() {
  const json = Buffer.from(config.sheets.credentialsB64, 'base64').toString('utf8');
  const creds = JSON.parse(json);
  if (!creds.client_email || !creds.private_key) {
    throw new Error('金鑰缺少 client_email 或 private_key');
  }
  return creds;
}

/**
 * 取得（並快取）已授權的 JWT client
 */
async function getClient() {
  if (cachedClient) return cachedClient;

  const creds = loadCredentials();
  const client = new JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: SCOPES,
  });
  await client.authorize();

  console.log(`[Sheets] 已授權（服務帳號：${creds.client_email}）`);
  cachedClient = client;
  return client;
}

/**
 * 台北時間的可讀時間字串
 */
function nowString() {
  return new Date().toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei',
    hour12: false,
  });
}

/**
 * 單一物件 → 一列資料（順序須與 HEADER 一致）
 */
function formatRow(item, timestamp) {
  const tags = Array.isArray(item.tags) ? item.tags.join(' | ') : '';
  const d = item.detail || {};   // 詳情頁抓取失敗時為空物件，相關欄位留白
  return [
    item.title || '',
    item.price ? `${item.price} ${item.priceUnit || ''}`.trim() : '',
    d.manageFeeText || '',
    d.carportFee || '',
    // 寫成純數字，讓試算表能正確排序與做數值比較。
    // 「車位另計但未揭露金額」可由「租金含」與「車位型式」兩欄判讀。
    d.effectiveRent || '',
    d.priceContain || '',
    item.area ? `${item.area} 坪` : '',
    item.layout || '',
    item.floor || '',
    d.carportType || '',
    item.community || '',
    // 地址前綴已含區域（如「淡水區-新市三路二段」），不另立地區欄以免重複。
    // 需要按區篩選時，對地址做「包含」篩選即可；crawler.js 仍保有 district 欄位。
    item.address || '',
    d.role || '',
    d.chargeText || d.serviceFee || '',
    d.deposit || '',
    d.minLease || '',
    d.pet || '',
    item.kind || '',
    tags,
    item.url || '',
    String(item.id ?? ''),
    timestamp,
  ];
}

/**
 * 表頭不存在就補上（只在第一次執行時真的會寫入）
 */
async function ensureHeader(client, sheetName) {
  const range = encodeURIComponent(`${sheetName}!A1:${LAST_COL}1`);
  const res = await client.request({
    url: `${API_BASE}/${config.sheets.sheetId}/values/${range}`,
  });

  // 既有表頭欄位變少時也要補寫，否則新增欄位會沒有標題
  const existing = res.data.values?.[0] || [];
  const upToDate = existing.length === HEADER.length && HEADER.every((h, i) => existing[i] === h);
  if (upToDate) return;

  await client.request({
    url: `${API_BASE}/${config.sheets.sheetId}/values/${range}?valueInputOption=RAW`,
    method: 'PUT',
    data: { values: [HEADER] },
  });
  console.log(existing.length ? '[Sheets] 已更新表頭（欄位有變動）' : '[Sheets] 已建立表頭');
}

/**
 * 把物件清單 append 到 Sheet 最下方
 * @returns {Promise<number>} 實際寫入的列數（失敗回 0）
 */
async function appendListings(listings) {
  if (!isEnabled()) {
    console.log('[Sheets] 未設定 GOOGLE_SERVICE_ACCOUNT_B64 / GOOGLE_SHEET_ID，略過寫入');
    return 0;
  }
  const sheetName = config.sheets.sheetName;

  // 即使本輪沒有新物件也要同步租金上限。多數執行都是 0 筆新物件，
  // 若只在寫入時同步，改了 config.js 後可能要等好幾天才生效，
  // 期間試算表的標示門檻是舊的而且不會有任何提示。
  try {
    await syncBudgetCell(await getClient(), sheetName);
  } catch (error) {
    console.warn(`[Sheets] 租金上限同步失敗（不影響其餘功能）: ${error.message}`);
  }

  if (!listings || listings.length === 0) return 0;

  try {
    const client = await getClient();
    await ensureHeader(client, sheetName);

    const timestamp = nowString();
    const rows = listings.map((item) => formatRow(item, timestamp));

    const range = encodeURIComponent(`${sheetName}!A:${LAST_COL}`);
    await client.request({
      url:
        `${API_BASE}/${config.sheets.sheetId}/values/${range}:append` +
        '?valueInputOption=RAW&insertDataOption=INSERT_ROWS',
      method: 'POST',
      data: { values: rows },
    });

    console.log(`[Sheets] 成功寫入 ${rows.length} 列`);
    return rows.length;
  } catch (error) {
    // 刻意不 throw：寫表失敗不該讓整支爬蟲失敗
    const detail = error.response?.data?.error?.message || error.message;
    console.error(`[Sheets] 寫入失敗（不影響推播）: ${detail}`);
    if (error.response?.status === 403) {
      console.error('[Sheets] 403 多半是「Sheet 沒有分享給服務帳號的 email」，請確認共用設定');
    }
    return 0;
  }
}

module.exports = { appendListings, isEnabled, HEADER, budgetLimit, BUDGET_VALUE_CELL };
