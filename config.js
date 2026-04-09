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
    region: 6,
    // 區域代碼（可多選，用逗號分隔）
    // 林口區 = 46, 淡水區 = 50, 新莊區 = 44
    // 其他常用：板橋 = 26, 三重 = 43, 中和 = 38, 永和 = 37, 新店 = 34
    // 桃園常用：龜山區 = 74, 蘆竹區 = 79, 
    section: '74',
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
