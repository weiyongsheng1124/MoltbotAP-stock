# Stock Monitor Skill

股票監控系統，支援技術分析與 Telegram 通知。

## 功能

- 監控多檔股票 (2337、8110 等)
- 技術分析：MA、RSI、MACD
- 明日走勢預測（技術面 + 市場環境）
- 推薦股票 TOP 5
- 週一至五 20:00 自動通知（台灣時間）
- 分兩封訊息發送（監控清單 + TOP5 推薦）

## API

### 取得股票資訊
```bash
GET /api/stocks
```

### 新增股票
```bash
POST /api/stocks/:id
```

### 健康檢查
```bash
GET /health
```

### 測試 Telegram
```bash
POST /api/telegram/test
```

## 技術指標

- MA5、MA10、MA20 移動平均線
- RSI 相對強弱指標
- MACD 指數平滑異同移動平均線
- 價格動量
- 成交量變化

## Bug Review & 修正 (2026-02-01)

### Bug 1：MA 排列條件重複
```javascript
// ❌ 錯誤：條件重複，第二個 else if 永遠不會執行
if (ma5 > ma10 && ma10 > ma20) { score += 2; }
else if (ma5 < ma10 && ma10 < ma20) { score -= 2; }
else if (ma5 > ma10 && ma10 > ma20) { score += 1; }  // 永遠 false!

// ✅ 正確：改為 else if (ma5 > ma10)
else if (ma5 > ma10) { score += 1; }
```

### Bug 2：RSI 計算除零保護
```javascript
// ❌ 錯誤：先算平均再檢查，可能 NaN
const avgGain = gains / period;
const avgLoss = losses / period;
if (avgLoss === 0) return 100;

// ✅ 正確：先檢查 losses 是否為 0
if (losses === 0) return 100;
const avgGain = gains / period;
const avgLoss = losses / period;
```

### Bug 3：Yahoo API 空陣列保護
```javascript
// ❌ 錯誤：直接存取可能 undefined
const result = response.data.chart.result[0];
const timestamps = result.timestamp;
const close = result.indicators.quote[0].close;

// ✅ 正確：加上可選鏈和空值檢查
const result = response.data.chart.result?.[0];
if (!result) throw new Error('API 返回空結果');
const timestamps = result.timestamp || [];
const quotes = result.indicators?.quote?.[0];
if (!timestamps.length || !quotes?.close) {
    throw new Error('股價資料為空');
}
```

### Bug 4：統一評分邏輯
```javascript
// ❌ 錯誤：重複計算評分（analyzeStock 和 predictNextDay 各算一次）
// ✅ 正確：統一使用 predictNextDay 的 score 和 prediction
```

## 部署

1. Railway 部署 `stock-monitor` 資料夾
2. 設定環境變數：
   - `PORT` - HTTP 埠號
   - `TELEGRAM_TOKEN` - Telegram Bot Token
   - `TELEGRAM_CHAT_ID` - 接收通知的 Chat ID
3. 股票清單在 `data/stocks.json`

## 股票代號對照

| 代號 | 名稱 |
|------|------|
| 2337 | 旺宏 |
| 8110 | 華豐 |
| 2330 | 台積電 |
| 2303 | 聯電 |
| 2377 | 崇越 |

## 網址

- API: https://stock-monitor-xxxx.up.railway.app/
