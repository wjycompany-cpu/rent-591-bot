// ============================================
// 執行狀態（跨執行保存）
// ============================================
// 591 會間歇性以 403 擋掉資料中心 IP。2026-08-26 實測失敗率約 34%，
// 且會隨時間漂移（08-24 約 17%、08-25 約 34%），所以「連續失敗 N 次」
// 不能當警示依據——在 34% 之下連續 3 輪平均每天就會發生一次，
// 警示只會變成狼來了，而它並沒有告訴使用者任何需要行動的事。
//
// 真正該衡量的是「多久沒拿到資料」。偶發的 403 下一輪就補回來了，
// 搜尋結果總數也遠小於分頁上限，漏抓幾輪只會延後推播而不會遺失物件；
// 只有長時間完全抓不到，才代表 591 改版、IP 被永久封鎖或程式壞了。

const fs = require('fs');

const STATE_PATH = './crawl_state.json';

// 距離上次成功超過這段時間才發警示。
// 排程實際約每小時跑一次（GitHub 會丟掉一半的 */30），6 小時等於連續六輪全滅，
// 以失敗率 34% 估算約半年才誤報一次；而「一天至少要抓到一次」還有四倍餘裕。
const ALERT_AFTER_MS = 6 * 60 * 60 * 1000;

const EMPTY = { consecutiveFailures: 0, lastSuccessAt: null, alerted: false };

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
 * @returns {{ count:number, outageMs:number, shouldAlert:boolean }}
 *   count 僅供 log 判讀，不再作為警示依據。
 *   shouldAlert 只在「跨過門檻」那一次為 true，持續中斷不會重複發送。
 */
function recordFailure(now = Date.now()) {
  const state = load();
  state.consecutiveFailures += 1;

  // 沒有成功記錄可比對時（第一次執行，或剛從舊版狀態檔升上來）先把此刻
  // 當成計時起點。寧可晚一輪才發警示，也不要一上線就用 0 當基準誤報。
  if (!state.lastSuccessAt) state.lastSuccessAt = now;

  const outageMs = Math.max(0, now - state.lastSuccessAt);
  const shouldAlert = outageMs >= ALERT_AFTER_MS && !state.alerted;
  if (shouldAlert) state.alerted = true;

  save(state);
  return { count: state.consecutiveFailures, outageMs, shouldAlert };
}

/**
 * 記錄一次抓取成功並歸零。
 * @returns {{ recovered:boolean, outageMs:number }}
 *   recovered 為 true 代表先前曾發出警示，此時應通知使用者已恢復，
 *   否則使用者只會收到「壞了」而永遠不知道問題何時解決。
 */
function recordSuccess(now = Date.now()) {
  const state = load();
  const recovered = state.alerted;
  const outageMs = state.lastSuccessAt ? Math.max(0, now - state.lastSuccessAt) : 0;

  save({ ...EMPTY, lastSuccessAt: now });
  return { recovered, outageMs };
}

/**
 * 把毫秒轉成中文的時間長度，供 log 與 Telegram 訊息共用。
 */
function formatDuration(ms) {
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes} 分鐘`;

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} 小時 ${rest} 分鐘` : `${hours} 小時`;
}

module.exports = {
  load, save, recordFailure, recordSuccess, formatDuration, ALERT_AFTER_MS, STATE_PATH,
};
