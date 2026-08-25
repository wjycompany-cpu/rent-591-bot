// ============================================
// 591 租屋爬蟲 + Telegram Bot 設定檔
// ============================================

require('dotenv').config();

module.exports = {
  // === Telegram Bot 設定 ===
  telegram: {
    // 從 @BotFather 取得的 token（存放在 .env 檔）
    token: process.env.TELEGRAM_BOT_TOKEN || '',
    // 你的 chat ID（存放在 .env 檔）
    chatId: process.env.TELEGRAM_CHAT_ID || '',
  },

  // === 591 搜尋條件 ===
  search: {
    // 台北市 = 1,新北市 = 3,桃園市 = 6
    region: 3,
    // 區域代碼（可多選，用逗號分隔）
    // 林口區 = 46, 淡水區 = 50, 新莊區 = 44
    // 其他常用：板橋 = 26, 三重 = 43, 中和 = 38, 永和 = 37, 新店 = 34
    // 桃園常用：龜山區 = 74, 蘆竹區 = 79, 
    section: '50',
    // 租金範圍（元）
    rentPrice: '10000,22000',
    // 物件類型：0=不限, 1=整層住家, 2=獨立套房, 3=分租套房, 4=雅房
    kind: 1,
    // 格局：2=2房, 3=3房（可多選，用逗號分隔）
    layout: '2,3',
    // 特色：可開伙 = cook,車位 = cartplace,可養寵物 = pet
    other: 'cook,cartplace',
    // 關鍵字搜尋
    keywords: '',
    // 排序：posttime=最新刊登, money=租金, area=坪數
    order: 'posttime',
    orderType: 'desc',
  },

  // === Google Sheets 寫入（選用）===
  // 兩個值都設定了才會啟用；沒設定就自動略過，爬蟲照常運作。
  sheets: {
    // 服務帳號金鑰 JSON 轉成 base64（避免 private_key 的換行破壞環境變數）
    //   base64 -i service-account.json | pbcopy
    credentialsB64: process.env.GOOGLE_SERVICE_ACCOUNT_B64 || '',
    // 試算表網址中 /d/ 與 /edit 之間那一長串
    sheetId: process.env.GOOGLE_SHEET_ID || '',
    // 分頁名稱（Sheet 左下角的頁籤，新建的預設叫「工作表1」）
    sheetName: process.env.GOOGLE_SHEET_NAME || '工作表1',
  },

  // === 爬蟲設定 ===
  crawler: {
    // 請求間隔（毫秒），避免被擋（換頁時用）
    requestDelay: 2000,
  },

  // === 排程設定 ===
  schedule: {
    // cron 表達式：每 30 分鐘執行一次
    // '*/30 * * * *' = 每 30 分鐘
    // '0 */1 * * *' = 每 1 小時
    // '0 9,12,18,21 * * *' = 每天 9, 12, 18, 21 點
    cron: '*/30 * * * *',
  },

  // === 已發送記錄檔路徑 ===
  sentRecordsPath: './sent_records.json',
};
