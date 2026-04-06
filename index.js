// ============================================
// 591 租屋爬蟲 Telegram Bot - 主程式
// ============================================

const cron = require('node-cron');
const fs = require('fs');
const config = require('./config');
const { searchRentals } = require('./crawler');
const { initBot, sendListings, sendStatus } = require('./notifier');

// === 已發送記錄管理 ===

function loadSentRecords() {
  try {
    if (fs.existsSync(config.sentRecordsPath)) {
      const data = fs.readFileSync(config.sentRecordsPath, 'utf8');
      const records = JSON.parse(data);
      // 轉成 Set 加速查詢
      return new Set(records);
    }
  } catch (error) {
    console.error('[記錄] 讀取已發送記錄失敗:', error.message);
  }
  return new Set();
}

function saveSentRecords(sentSet) {
  try {
    // 只保留最近 2000 筆，避免檔案無限成長
    const records = [...sentSet].slice(-2000);
    fs.writeFileSync(config.sentRecordsPath, JSON.stringify(records, null, 2));
  } catch (error) {
    console.error('[記錄] 儲存已發送記錄失敗:', error.message);
  }
}

// === 主要執行邏輯 ===

async function run() {
  const startTime = new Date();
  console.log(`\n${'='.repeat(50)}`);
  console.log(`[主程式] 開始執行 - ${startTime.toLocaleString('zh-TW')}`);
  console.log('='.repeat(50));

  try {
    // 1. 抓取物件
    const listings = await searchRentals();
    if (!listings || listings.length === 0) {
      console.log('[主程式] 沒有抓到任何物件');
      return;
    }

    // 2. 過濾已發送的
    const sentRecords = loadSentRecords();
    const newListings = listings.filter(item => {
      const id = String(item.id);
      return id && !sentRecords.has(id);
    });

    console.log(`[主程式] 新物件: ${newListings.length} 筆 (已發送過: ${listings.length - newListings.length} 筆)`);

    if (newListings.length === 0) {
      console.log('[主程式] 沒有新物件，跳過通知');
      return;
    }

    // 3. 發送通知
    const sentCount = await sendListings(newListings);

    // 4. 更新已發送記錄
    newListings.forEach(item => sentRecords.add(String(item.id)));
    saveSentRecords(sentRecords);

    console.log(`[主程式] 本次完成：發送 ${sentCount} 則通知`);
  } catch (error) {
    console.error('[主程式] 執行錯誤:', error);
    await sendStatus(`❌ 爬蟲執行錯誤: ${error.message}`);
  }

  const elapsed = ((Date.now() - startTime.getTime()) / 1000).toFixed(1);
  console.log(`[主程式] 耗時 ${elapsed} 秒`);
}

// === 啟動 ===

async function main() {
  console.log('🏠 591 租屋爬蟲 Telegram Bot 啟動');
  console.log(`📍 搜尋區域: region=${config.search.region}, section=${config.search.section}`);
  console.log(`💰 租金範圍: ${config.search.rentPrice}`);
  console.log(`⏰ 排程: ${config.schedule.cron}`);
  console.log('');

  // 初始化 Telegram Bot
  const bot = initBot();

  // 判斷是否為一次性執行（傳入 --once 參數）
  const isOnce = process.argv.includes('--once');

  if (isOnce) {
    console.log('[主程式] 一次性執行模式');
    await run();
    process.exit(0);
  }

  // 啟動時先跑一次
  await run();

  // 設定排程
  if (cron.validate(config.schedule.cron)) {
    cron.schedule(config.schedule.cron, async () => {
      await run();
    });
    console.log(`\n[排程] 已啟動，下次執行: ${config.schedule.cron}`);
    await sendStatus('🚀 591 租屋爬蟲已啟動，每 30 分鐘自動抓取');
  } else {
    console.error(`[排程] 無效的 cron 表達式: ${config.schedule.cron}`);
  }
}

main().catch(console.error);
