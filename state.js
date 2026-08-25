// ============================================
// 執行狀態（跨執行保存）
// ============================================
// 591 會間歇性以 403 擋掉資料中心 IP，實測約每四輪就有一輪失敗。
// 單次失敗無從處理也不需處理——下一輪通常就恢復了，逐次通知只是打擾。
// 真正需要知道的是「連續」失敗，那才代表 591 改版、IP 被永久封鎖或程式壞了。

const fs = require('fs');

const STATE_PATH = './crawl_state.json';

// 連續失敗達此次數才發出警示
const ALERT_AFTER = 3;

const EMPTY = { consecutiveFailures: 0, alerted: false };

function load() {
  try {
    if (fs.existsSync(STATE_PATH)) {
      return { ...EMPTY, ...JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')) };
    }
  } catch (error) {
    console.error('[狀態] 讀取失敗，視為初始狀態:', error.message);
  }
  return { ...EMPTY };
}

function save(state) {
  try {
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  } catch (error) {
    console.error('[狀態] 儲存失敗:', error.message);
  }
}

/**
 * 記錄一次抓取失敗。
 * @returns {{ count:number, shouldAlert:boolean }}
 *   shouldAlert 僅在「剛好達到門檻」那一次為 true，
 *   持續失敗不會重複發送，避免長時間中斷時洗版。
 */
function recordFailure() {
  const state = load();
  state.consecutiveFailures += 1;

  const shouldAlert = state.consecutiveFailures >= ALERT_AFTER && !state.alerted;
  if (shouldAlert) state.alerted = true;

  save(state);
  return { count: state.consecutiveFailures, shouldAlert };
}

/**
 * 記錄一次抓取成功並歸零。
 * @returns {{ recovered:boolean, previousFailures:number }}
 *   recovered 為 true 代表先前曾發出警示，此時應通知使用者已恢復，
 *   否則使用者無從得知問題是否解決。
 */
function recordSuccess() {
  const state = load();
  const recovered = state.alerted;
  const previousFailures = state.consecutiveFailures;

  if (previousFailures !== 0 || state.alerted) save({ ...EMPTY });
  return { recovered, previousFailures };
}

module.exports = { load, save, recordFailure, recordSuccess, ALERT_AFTER, STATE_PATH };
