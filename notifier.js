// ============================================
// Telegram 推播模組
// ============================================

const TelegramBot = require('node-telegram-bot-api');
const config = require('./config');

let bot = null;

/**
 * 初始化 Telegram Bot
 */
function initBot() {
  if (!config.telegram.token || config.telegram.token === 'YOUR_TELEGRAM_BOT_TOKEN') {
    console.warn('[Telegram] ⚠️  尚未設定 Bot Token，請先設定 config.js 或環境變數 TELEGRAM_BOT_TOKEN');
    return null;
  }

  bot = new TelegramBot(config.telegram.token, { polling: false });

  // 監聽指令（可選，開 polling 才有用）
  // bot.onText(/\/start/, (msg) => {
  //   bot.sendMessage(msg.chat.id, `你的 Chat ID 是: ${msg.chat.id}`);
  // });

  console.log('[Telegram] Bot 初始化完成');
  return bot;
}

/**
 * 格式化物件訊息
 */
function formatListing(listing) {
  const tags = Array.isArray(listing.tags)
    ? listing.tags.map(t => typeof t === 'string' ? t : t.name || '').filter(Boolean).join(' | ')
    : '';

  // 使用 Telegram MarkdownV2 格式
  const lines = [
    `🏠 *${escapeMarkdown(listing.title)}*`,
    '',
    `💰 租金：${escapeMarkdown(listing.price)} ${escapeMarkdown(listing.priceUnit)}`,
    `📍 地點：${escapeMarkdown(listing.address)}`,
  ];

  if (listing.area) lines.push(`📐 坪數：${escapeMarkdown(String(listing.area))} 坪`);
  if (listing.kind) lines.push(`🏷 類型：${escapeMarkdown(listing.kind)}`);
  if (listing.floor) lines.push(`🔼 樓層：${escapeMarkdown(listing.floor)}`);
  if (tags) lines.push(`🏷 標籤：${escapeMarkdown(tags)}`);

  lines.push('');
  lines.push(`🔗 [查看詳情](${listing.url})`);

  return lines.join('\n');
}

/**
 * 轉義 MarkdownV2 特殊字元
 */
function escapeMarkdown(text) {
  if (!text) return '';
  return String(text).replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

/**
 * 發送單一物件通知
 */
async function sendListing(listing) {
  if (!bot) {
    console.log('[Telegram] Bot 未初始化，跳過發送');
    return false;
  }

  const chatId = config.telegram.chatId;
  if (!chatId || chatId === 'YOUR_CHAT_ID') {
    console.warn('[Telegram] ⚠️  尚未設定 Chat ID');
    return false;
  }

  try {
    const message = formatListing(listing);
    await bot.sendMessage(chatId, message, {
      parse_mode: 'MarkdownV2',
      disable_web_page_preview: false,
    });
    return true;
  } catch (error) {
    console.error(`[Telegram] 發送失敗 (${listing.id}):`, error.message);

    // 如果 MarkdownV2 解析失敗，改用純文字
    try {
      const plainText = [
        `🏠 ${listing.title}`,
        `💰 租金：${listing.price} ${listing.priceUnit}`,
        `📍 地點：${listing.address}`,
        listing.area ? `📐 坪數：${listing.area} 坪` : '',
        listing.kind ? `🏷 類型：${listing.kind}` : '',
        listing.floor ? `🔼 樓層：${listing.floor}` : '',
        '',
        `🔗 ${listing.url}`,
      ].filter(Boolean).join('\n');

      await bot.sendMessage(chatId, plainText);
      return true;
    } catch (err2) {
      console.error(`[Telegram] 純文字發送也失敗:`, err2.message);
      return false;
    }
  }
}

/**
 * 批次發送多個物件（帶延遲避免被 Telegram 限速）
 */
async function sendListings(listings) {
  let sent = 0;
  for (const listing of listings) {
    const success = await sendListing(listing);
    if (success) sent++;
    // Telegram 限速：每秒最多 30 則訊息，保守起見每則間隔 1 秒
    await new Promise(r => setTimeout(r, 1000));
  }

  if (sent > 0) {
    console.log(`[Telegram] 成功發送 ${sent}/${listings.length} 則通知`);
  }

  return sent;
}

/**
 * 發送狀態通知（例如啟動、錯誤等）
 */
async function sendStatus(message) {
  if (!bot) return;
  const chatId = config.telegram.chatId;
  if (!chatId || chatId === 'YOUR_CHAT_ID') return;

  try {
    await bot.sendMessage(chatId, `🤖 ${message}`);
  } catch (error) {
    console.error('[Telegram] 狀態通知發送失敗:', error.message);
  }
}

module.exports = { initBot, sendListing, sendListings, sendStatus };
