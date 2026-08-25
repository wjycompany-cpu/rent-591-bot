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
  '抓取時間', '物件ID', '標題', '租金', '坪數', '類型',
  '樓層', '格局', '地區', '地址', '社區', '標籤', '連結',
  '實質月租', '管理費', '租金含', '車位型式', '出租方', '服務費', '押金', '寵物', '最短租期',
];

// 由欄數推算最後一欄的字母，避免日後增欄時漏改範圍
const LAST_COL = String.fromCharCode(64 + HEADER.length);

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
  const d = item.detail || {};
  return [
    timestamp,
    String(item.id ?? ''),
    item.title || '',
    item.price ? `${item.price} ${item.priceUnit || ''}`.trim() : '',
    item.area ? `${item.area} 坪` : '',
    item.kind || '',
    item.floor || '',
    item.layout || '',
    item.areaName || '',
    item.address || '',
    item.community || '',
    tags,
    item.url || '',
    // 以下來自詳情頁；沒抓到就留空，不影響前 13 欄
    // 寫成純數字，讓試算表能正確排序與做數值比較。
    // 「車位另計但未揭露金額」的資訊由「租金含」與「車位型式」兩欄即可判讀。
    d.effectiveRent || '',
    d.manageFeeText || '',
    d.priceContain || '',
    d.carportType || '',
    d.role || '',
    d.chargeText || d.serviceFee || '',
    d.deposit || '',
    d.pet || '',
    d.minLease || '',
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
  if (!listings || listings.length === 0) return 0;

  const sheetName = config.sheets.sheetName;

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

module.exports = { appendListings, isEnabled, HEADER };
