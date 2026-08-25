# 591 租屋爬蟲 Telegram Bot 🏠

自動爬取 591 租屋網新物件，透過 Telegram Bot 即時推播，並可同步寫入 Google Sheet 留存紀錄。

## 功能

- 定時爬取 591 租屋網（GitHub Actions 每 30 分鐘排程）
- 依區域、租金、格局、物件類型、特色、關鍵字篩選
- 透過 Telegram Bot 推播新物件通知
- 自動去重，不重複推播已發送過的物件
- 自動翻頁，抓完符合條件的所有物件（上限 150 筆）
- 選用：把每筆新物件寫進 Google Sheet，方便後續比價與追蹤
- 被 591 擋下時自動重試，重試用盡會發 Telegram 警示

## 運作方式

平常由 GitHub Actions 排程執行，不需要自己開著電腦：

```
GitHub Actions（每 30 分鐘）
   └─ node index.js --once
        ├─ crawler.js  抓 591（自動翻頁 + 失敗重試）
        ├─ 比對 sent_records.json 過濾已推播過的
        ├─ notifier.js  發 Telegram
        └─ sheets.js    寫 Google Sheet（未設定則自動略過）
```

> ⚠️ 排程實際上不太準時。GitHub 免費方案在忙碌時會延遲甚至跳過，實測間隔多為 1 小時而非 30 分鐘。要立即執行請用手動觸發（見下方）。

## 設定步驟

### 1. 建立 Telegram Bot

1. 打開 Telegram，搜尋 `@BotFather`
2. 發送 `/newbot`，依照提示設定名稱和 username
3. 記下取得的 **Bot Token**

### 2. 取得 Chat ID

1. 對你剛建立的 Bot 發送一則訊息（例如 `/start`）
2. 在瀏覽器打開：
   ```
   https://api.telegram.org/bot<你的TOKEN>/getUpdates
   ```
3. 找到 `"chat": {"id": 123456789}` 中的數字，就是你的 **Chat ID**

### 3. 建立 .env

所有機密資訊都放在 `.env`，**不要寫進 `config.js`**（`config.js` 只從環境變數讀取，寫死在裡面不會生效，還會被 commit 上去）。

在專案根目錄建立 `.env`：

```bash
TELEGRAM_BOT_TOKEN=你的token
TELEGRAM_CHAT_ID=你的chatid

# 以下為 Google Sheets 選用設定，見第 5 節
GOOGLE_SERVICE_ACCOUNT_B64=
GOOGLE_SHEET_ID=
GOOGLE_SHEET_NAME=工作表1
```

`.env` 已列入 `.gitignore`，不會被 commit。

### 4. 調整搜尋條件

在 `config.js` 的 `search` 區塊修改：

```js
search: {
  region: 3,                  // 3=新北市
  section: '50',              // 淡水區（可多選，逗號分隔）
  rentPrice: '10000,22000',   // 租金範圍
  kind: 1,                    // 0=不限 1=整層住家 2=獨立套房 3=分租套房 4=雅房
  layout: '2,3',              // 格局：2房、3房（可多選）
  other: 'cook,cartplace',    // 特色：cook=可開伙 cartplace=車位 pet=可養寵物
  keywords: '',               // 關鍵字
  order: 'posttime',          // posttime=最新刊登 money=租金 area=坪數
  orderType: 'desc',
}
```

**區域代碼**（2026-08-25 逐一向 591 查證，每個代碼取樣 30 筆皆一致）：

| region | 縣市 | section | 區域 |
|--------|------|---------|------|
| 3 | 新北市 | 26 | 板橋區 |
| 3 | 新北市 | 34 | 新店區 |
| 3 | 新北市 | 37 | 永和區 |
| 3 | 新北市 | 38 | 中和區 |
| 3 | 新北市 | 43 | 三重區 |
| 3 | 新北市 | 44 | 新莊區 |
| 3 | 新北市 | 46 | 林口區 |
| 3 | 新北市 | 50 | 淡水區 |
| 6 | 桃園市 | 74 | 龜山區 |
| 6 | 桃園市 | 79 | 蘆竹區 |

> 其他區域代碼可在 591 網站上手動篩選後，從網址列的 `section=` 參數取得。

### 5. Google Sheets 寫入（選用）

不設定的話程式會自動略過寫表，其餘功能照常運作。

1. 到 [Google Cloud Console](https://console.cloud.google.com) 建立專案
2. 「API 和服務」→「程式庫」→ 搜尋 **Google Sheets API** →「啟用」
   （容易漏掉這步：把專案取名叫 “Google Sheets API” 不等於啟用了 API）
3. 「憑證」→「建立憑證」→「服務帳戶」→ 建立（角色可略過）
4. 點進該服務帳戶 →「金鑰」分頁 →「新增金鑰」→ JSON → 下載
5. 建立一個 Google 試算表，按「共用」把**服務帳戶的 email** 加為**編輯者**
   （沒做這步，API 會回 403）
6. 把金鑰轉成 base64 填進 `.env`：

   ```bash
   # macOS
   printf 'GOOGLE_SERVICE_ACCOUNT_B64=%s\n' \
     "$(base64 -i ~/Downloads/你的金鑰.json | tr -d '\n')" >> .env
   ```

   > 用 base64 是為了避免 `private_key` 裡的換行符破壞環境變數格式。

7. `GOOGLE_SHEET_ID` 填試算表網址中 `/d/` 與 `/edit` 之間那一長串

表頭會在第一次寫入時自動建立，共 13 欄：抓取時間、物件ID、標題、租金、坪數、類型、樓層、格局、地區、地址、社區、標籤、連結。

### 6. 設定 GitHub Secrets

本機的 `.env` 不會上傳，GitHub Actions 需要另外設定。到 repo 的
**Settings → Secrets and variables → Actions → New repository secret**，新增：

| Secret 名稱 | 說明 |
|---|---|
| `TELEGRAM_BOT_TOKEN` | 必填 |
| `TELEGRAM_CHAT_ID` | 必填 |
| `GOOGLE_SERVICE_ACCOUNT_B64` | 選用，同 `.env` 的值 |
| `GOOGLE_SHEET_ID` | 選用 |
| `GOOGLE_SHEET_NAME` | 選用，預設 `工作表1` |

名稱必須完全一致。打錯不會報錯，只會靜默略過寫表。

## 執行

```bash
npm install

# 執行一次就結束（GitHub Actions 用的就是這個）
node index.js --once

# 常駐執行，內建 30 分鐘排程，Ctrl+C 停止
node index.js
```

**手動觸發 GitHub Actions**（不必等排程）：

```bash
gh workflow run crawl.yml
```

或在 GitHub 的 Actions 分頁選擇「591 租屋爬蟲」→ **Run workflow**。

> 本機執行同樣會發 Telegram、寫 Google Sheet、更新 `sent_records.json`。
> 由於本機與 Actions 的去重紀錄各自獨立（前者是本地檔案，後者是 Actions cache），
> 兩邊都跑的話同一物件可能被推播兩次。

## 檔案結構

```
rent-591-bot/
├── .github/workflows/crawl.yml  # GitHub Actions 排程
├── config.js           # 設定檔（搜尋條件、排程、環境變數對應）
├── crawler.js          # 591 爬蟲（Nuxt SSR 解析 + 翻頁 + 重試）
├── notifier.js         # Telegram 推播
├── sheets.js           # Google Sheets 寫入
├── index.js            # 主程式（排程 + 去重）
├── .env                # 機密設定（不進 repo）
├── sent_records.json   # 已發送記錄（自動產生，不進 repo）
└── README.md
```

## 已知限制

- **591 會間歇性回 403 擋掉 GitHub Actions 的 IP。** 屬正常現象，程式會重試 3 次
  （間隔 3 秒、8 秒）；三次都失敗會發 `❌ 爬蟲執行錯誤` 的 Telegram 訊息。
  偶爾發生不必理會，連續多輪失敗才需要處理。
- **翻頁上限 5 頁（150 筆）。** 超過的部分會略過最舊的物件，log 會標示略過幾筆。
  搜尋條件放太寬時要注意。
- **591 本身有重複刊登。** 同一物件被貼多次會有不同的物件ID，程式的去重機制無法識別。
- 591 改版可能導致解析失敗，屆時需更新 `crawler.js`。
- 此工具僅供個人使用，請勿用於商業用途。

## 更新紀錄

### 2026-08-25

- **新增 Google Sheets 寫入**（`sheets.js`）。每次推播的新物件同步 append 到試算表；
  寫表失敗只記 log 不中斷流程，不影響爬蟲與 Telegram 推播。
- **修正 403 靜默失敗。** 先前連線失敗會 `return []`，被主程式當成「沒有新物件」，
  workflow 仍顯示成功，導致長期抓不到資料也無從察覺。改為重試 3 次並在用盡後拋出，
  由既有的錯誤處理發出 Telegram 警示。
- **新增自動翻頁。** 先前只抓第 1 頁 30 筆，`posttime desc` 排序下第 31 筆之後的
  舊物件永遠不會被看到。改為依 `total` 換算頁數逐頁抓取，上限 5 頁。
- **升級 GitHub Actions**：checkout v4→v7、setup-node v4→v7、cache v4→v6，
  執行環境由已 EOL 的 Node 20 改為 Node 22 LTS。
- **修正 README 的區域代碼表。** 舊表的代碼（板橋 17、三重 22、新莊 23、林口 43）
  全數有誤，已逐一向 591 查證後更新。
- 搜尋條件由桃園龜山區改為新北淡水區。
