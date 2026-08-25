// ============================================
// 591 租屋爬蟲 Telegram Bot - 主程式
// ============================================

const cron = require('node-cron');
const fs = require('fs');
const config = require('./config');
const { searchRentals } = require('./crawler');
const { initBot, sendListings, sendStatus } = require('./notifier');
const { appendListings } = require('./sheets');
const { filterDuplicates, remember } = require('./dedupe');
const { enrichListings } = require('./detail');
const { recordFailure, recordSuccess, ALERT_AFTER } = require('./state');

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
    // 每筆物件會記下物件ID與複合鍵兩筆，故上限設為 4000（約等於 2000 個物件）
    const records = [...sentSet].slice(-4000);
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

    // 抓取成功即清空連續失敗計數；若先前曾發過警示，要讓使用者知道已恢復，
    // 否則他只會收到「壞了」而永遠不知道問題何時解決。
    const { recovered, previousFailures } = recordSuccess();
    if (recovered) {
      await sendStatus(`✅ 爬蟲已恢復正常（先前連續失敗 ${previousFailures} 次）`);
    }

    if (!listings || listings.length === 0) {
      console.log('[主程式] 沒有抓到任何物件');
      return;
    }

    // 2. 過濾已發送的，以及同一間房子的重複刊登
    const sentRecords = loadSentRecords();
    const { fresh: newListings, skipped } = filterDuplicates(listings, sentRecords);

    console.log(`[主程式] 新物件: ${newListings.length} 筆 (略過 ${skipped.length} 筆)`);
    const reasonCounts = skipped.reduce((acc, { reason }) => {
      acc[reason] = (acc[reason] || 0) + 1;
      return acc;
    }, {});
    for (const [reason, count] of Object.entries(reasonCounts)) {
      console.log(`[主程式]   ├ ${reason}: ${count} 筆`);
    }

    if (newListings.length === 0) {
      console.log('[主程式] 沒有新物件，跳過通知');
      return;
    }

    // 2.5 補上詳情頁資料（管理費、車位、出租方等）
    // 只對去重後真正要推播的物件抓取，日常多為 0~5 筆。
    // 這是附加功能：整段失敗也只是少了幾個欄位，不影響推播。
    try {
      await enrichListings(newListings);
    } catch (error) {
      console.error(`[主程式] 詳情頁補齊失敗（不影響推播）: ${error.message}`);
    }

    // 3. 發送通知
    const sentCount = await sendListings(newListings);

    // 3.5 寫入 Google Sheet（選用；失敗不影響推播）
    await appendListings(newListings);

    // 4. 更新已發送記錄（物件ID 與複合鍵都要記，才擋得住重新刊登）
    remember(sentRecords, newListings);
    saveSentRecords(sentRecords);

    console.log(`[主程式] 本次完成：發送 ${sentCount} 則通知`);
  } catch (error) {
    console.error('[主程式] 執行錯誤:', error);

    if (error.isFetchFailure) {
      // 591 的間歇性封鎖：實測約四輪就有一輪失敗，且下一輪多半自行恢復。
      // 單次失敗無從處理，逐次通知只是打擾，因此累積到門檻才發警示。
      const { count, shouldAlert } = recordFailure();
      console.log(
        `[主程式] 連續失敗 ${count} 次` +
        (shouldAlert ? '，發出警示' : `（未達 ${ALERT_AFTER} 次門檻，暫不通知）`)
      );
      if (shouldAlert) {
        await sendStatus(
          `❌ 爬蟲連續 ${count} 次抓取失敗，可能不只是暫時性封鎖\n最後錯誤：${error.message}`
        );
      }
    } else {
      // 非連線層的錯誤多為程式或解析問題，不會自行恢復，立即通知
      await sendStatus(`❌ 爬蟲執行錯誤: ${error.message}`);
    }
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
