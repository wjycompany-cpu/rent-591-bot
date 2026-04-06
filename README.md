# 591 租屋爬蟲 Telegram Bot 🏠

自動爬取 591 租屋網新物件，透過 Telegram Bot 即時推播通知。

## 功能

- 定時爬取 591 租屋網（預設每 30 分鐘）
- 依照設定的區域、租金範圍篩選物件
- 透過 Telegram Bot 推播新物件通知
- 自動去重，不重複推播已發送過的物件

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

### 3. 設定 config.js

打開 `config.js`，填入你的 Telegram Bot Token 和 Chat ID：

```js
telegram: {
  token: 'YOUR_TELEGRAM_BOT_TOKEN',  // 換成你的 token
  chatId: 'YOUR_CHAT_ID',            // 換成你的 chat id
}
```

或者用環境變數：

```bash
export TELEGRAM_BOT_TOKEN="你的token"
export TELEGRAM_CHAT_ID="你的chatid"
```

### 4. 調整搜尋條件

在 `config.js` 的 `search` 區塊修改：

```js
search: {
  region: 3,              // 新北市
  section: '43,23',       // 林口區,新莊區
  rentPrice: '10000,20000', // 1-2 萬
  kind: 0,                // 0=不限
}
```

**常用區域代碼（新北市 region=3）：**
| 代碼 | 區域 |
|------|------|
| 17   | 板橋區 |
| 22   | 三重區 |
| 23   | 新莊區 |
| 18   | 中和區 |
| 20   | 永和區 |
| 43   | 林口區 |
| 25   | 土城區 |
| 29   | 蘆洲區 |

### 5. 安裝 & 執行

```bash
# 安裝相依套件
npm install

# 測試一次（不啟動排程）
node index.js --once

# 正式啟動（含排程）
node index.js
```

### 6. 背景執行（可選）

```bash
# 用 pm2
npm install -g pm2
pm2 start index.js --name rent-bot
pm2 save

# 或用 nohup
nohup node index.js > bot.log 2>&1 &
```

## 檔案結構

```
rent-591-bot/
├── config.js       # 設定檔（Telegram、搜尋條件、排程）
├── crawler.js      # 591 爬蟲模組
├── notifier.js     # Telegram 推播模組
├── index.js        # 主程式（排程 + 去重邏輯）
├── sent_records.json  # 已發送記錄（自動產生）
└── README.md
```

## 注意事項

- 591 有反爬機制，請不要太頻繁抓取（建議間隔 >= 30 分鐘）
- 如果 591 改版導致爬蟲失敗，需要更新 `crawler.js` 中的 API 邏輯
- 此工具僅供個人使用，請勿用於商業用途
- Node.js 18+ 才有內建 `fetch`，如果用舊版需要安裝 `node-fetch`
