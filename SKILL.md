# Stock Monitor Skill

股票監控系統，支援技術分析與 Telegram 通知。

## 功能

- 監控多檔股票 (2337、8110 等)
- 技術分析：MA、RSI、MACD
- 漲跌預測判斷 (看漲/看跌/中立)
- 週一至五 9:00、10:00 自動通知
- 台灣時區 (UTC+8)

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

## 技術指標

- MA5、MA10、MA20 移動平均線
- RSI 相對強弱指標
- MACD 指數平滑異同移動平均線

## 部署

1. Railway 部署 `stock-monitor` 資料夾
2. 設定 PORT 環境變數
3. 股票清單在 `data/stocks.json`

## 網址

- API: https://stock-monitor-xxxx.up.railway.app/
