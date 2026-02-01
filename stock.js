const axios = require('axios');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');

// 設定台灣時區
process.env.TZ = 'Asia/Taipei';

const app = express();
const PORT = process.env.PORT || 3001;

const CONFIG = {
    monitorFile: path.join(__dirname, 'data', 'stocks.json'),
    logFile: path.join(__dirname, 'monitor.log'),
};

// 優先使用環境變數
const ENV_TOKEN = process.env.TELEGRAM_TOKEN;
const ENV_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Telegram Bot 初始化
let telegramBot = null;

function initTelegramBot() {
    const token = ENV_TOKEN || process.env.TELEGRAM_TOKEN;
    const chatId = ENV_CHAT_ID || process.env.TELEGRAM_CHAT_ID;
    
    if (token && chatId) {
        try {
            telegramBot = new TelegramBot(token, { polling: false });
            // 儲存到全域變數
            global.telegramConfig = { token, chatId };
            log('Telegram Bot 已透過環境變數初始化');
        } catch (err) {
            log(`Telegram Bot 初始化失敗: ${err.message}`);
        }
    } else {
        log('Telegram 未設定（需要環境變數 TELEGRAM_TOKEN 和 TELEGRAM_CHAT_ID）');
    }
}

initTelegramBot();

// 健康檢查端點 (Railway 需要)
app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'stock-monitor' });
});

// 首頁
app.get('/', (req, res) => {
    const tgConfigured = telegramBot && global.telegramConfig?.chatId;
    res.send(`
<!DOCTYPE html>
<html lang="zh-TW">
<head>
    <meta charset="UTF-8">
    <title>股票監控服務</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; background: #1a1a2e; color: #eee; }
        h1 { color: #00d4ff; }
        .card { background: #16213e; padding: 20px; border-radius: 10px; margin: 10px 0; }
        a { color: #00d4ff; }
        code { background: #0f3460; padding: 2px 8px; border-radius: 4px; }
        .status { padding: 5px 10px; border-radius: 5px; }
        .online { background: #00c853; }
        .offline { background: #ff1744; }
        .env { background: #0f3460; padding: 10px; border-radius: 5px; margin: 10px 0; }
    </style>
</head>
<body>
    <h1>📈 股票監控服務</h1>
    <div class="card">
        <h3>狀態</h3>
        <span class="status ${tgConfigured ? 'online' : 'offline'}">
            ${tgConfigured ? '✅ Telegram 已連線' : '⚪ Telegram 未設定'}
        </span>
    </div>
    <div class="card">
        <h3>API 端點</h3>
        <p><a href="/api/stocks">GET /api/stocks</a> - 取得所有股價</p>
        <p><code>POST /api/stocks/2337</code> - 新增股票</p>
        <p><code>DELETE /api/stocks/2337</code> - 移除股票</p>
        <p><a href="/health">GET /health</a> - 健康檢查</p>
    </div>
    <div class="card">
        <h3>🔔 Telegram 通知設定</h3>
        <p>請在 Railway 環境變數中設定：</p>
        <div class="env">
            <strong>TELEGRAM_TOKEN</strong>=8574404333:AAGqUgg9kGtuN2DLG3_yYlnAmLymVfjYR30<br><br>
            <strong>TELEGRAM_CHAT_ID</strong>=7711392074
        </div>
        <p>設定位置：Railway → 專案 → Variables → New Variable</p>
    </div>
</body>
</html>
    `);
});

// API: 取得股價資訊
app.get('/api/stocks', async (req, res) => {
    try {
        const stocks = await getAllStockData();
        res.json(stocks);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API: 新增股票
app.post('/api/stocks/:id', (req, res) => {
    addStock(req.params.id);
    res.json({ success: true, stocks: readStockList() });
});

// API: 移除股票
app.delete('/api/stocks/:id', (req, res) => {
    removeStock(req.params.id);
    res.json({ success: true, stocks: readStockList() });
});

// API: 測試 Telegram 通知
app.post('/api/telegram/test', async (req, res) => {
    if (!telegramBot || !global.telegramConfig?.chatId) {
        return res.status(500).json({ error: 'Telegram 未設定（需要環境變數）' });
    }
    
    try {
        await telegramBot.sendMessage(global.telegramConfig.chatId, '✅ 股票監控通知測試成功！');
        res.json({ success: true, message: '測試訊息已發送' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 啟動 HTTP 伺服器
app.listen(PORT, () => {
    log(`HTTP 伺服器啟動: port ${PORT}`);
});

// 確保資料目錄存在
const dataDir = path.dirname(CONFIG.monitorFile);
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

function log(msg) {
    const time = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
    const logMsg = `[${time}] ${msg}\n`;
    fs.appendFileSync(CONFIG.logFile, logMsg);
}

// 讀取監控清單
function readStockList() {
    try {
        if (fs.existsSync(CONFIG.monitorFile)) {
            return JSON.parse(fs.readFileSync(CONFIG.monitorFile, 'utf8'));
        }
    } catch (err) {
        log(`讀取失敗: ${err.message}`);
    }
    return [];
}

function saveStockList(stocks) {
    fs.writeFileSync(CONFIG.monitorFile, JSON.stringify(stocks, null, 2), 'utf8');
}

// 計算移動平均線
function calculateMA(prices, days) {
    if (prices.length < days) return null;
    const recent = prices.slice(-days);
    const sum = recent.reduce((a, b) => a + b, 0);
    return sum / days;
}

// 計算 RSI
function calculateRSI(prices, period = 14) {
    if (prices.length < period + 1) return null;
    
    let gains = 0, losses = 0;
    
    for (let i = prices.length - period; i < prices.length; i++) {
        const change = prices[i] - prices[i - 1];
        if (change > 0) gains += change;
        else losses -= change;
    }
    
    const avgGain = gains / period;
    const avgLoss = losses / period;
    
    if (avgLoss === 0) return 100;
    
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
}

// 計算 MACD
function calculateMACD(prices) {
    if (prices.length < 26) return null;
    
    const ema12 = calculateEMA(prices, 12);
    const ema26 = calculateEMA(prices, 26);
    
    if (!ema12 || !ema26) return null;
    
    const dif = ema12 - ema26;
    const dea = calculateEMA([dif], 9);
    const histogram = (dif - dea) * 2;
    
    return { dif, dea, histogram };
}

// 計算 EMA
function calculateEMA(prices, days) {
    if (prices.length < days) return null;
    
    const k = 2 / (days + 1);
    let ema = prices[0];
    
    for (let i = 1; i < prices.length; i++) {
        ema = prices[i] * k + ema * (1 - k);
    }
    
    return ema;
}

// 技術分析判斷
function analyzeStock(stockData, priceHistory) {
    if (!priceHistory || priceHistory.length < 30) {
        return {
            signal: '⚪ 中立',
            reason: '數據不足，無法分析'
        };
    }
    
    const prices = priceHistory.map(p => p.close);
    const currentPrice = prices[prices.length - 1];
    const ma5 = calculateMA(prices, 5);
    const ma10 = calculateMA(prices, 10);
    const ma20 = calculateMA(prices, 20);
    const rsi = calculateRSI(prices);
    const macd = calculateMACD(prices);
    
    // 評分系統
    let score = 0;
    let reasons = [];
    
    // 趨勢判斷 (MA)
    if (ma5 && currentPrice > ma5) {
        score += 1;
        reasons.push('股價站上 5 日線');
    } else if (ma5) {
        score -= 1;
        reasons.push('股價跌破 5 日線');
    }
    
    if (ma10 && currentPrice > ma10) {
        score += 1;
        reasons.push('股價站上 10 日線');
    } else if (ma10) {
        score -= 1;
        reasons.push('股價跌破 10 日線');
    }
    
    if (ma20 && currentPrice > ma20) {
        score += 1;
        reasons.push('股價站上 20 日線');
    } else if (ma20) {
        score -= 1;
        reasons.push('股價跌破 20 日線');
    }
    
    // RSI 判斷
    if (rsi !== null) {
        if (rsi > 70) {
            score -= 1;
            reasons.push(`RSI ${rsi.toFixed(0)} (過熱)`);
        } else if (rsi < 30) {
            score += 1;
            reasons.push(`RSI ${rsi.toFixed(0)} (超賣)`);
        } else if (rsi > 50) {
            score += 0.5;
            reasons.push(`RSI ${rsi.toFixed(0)} (偏多)`);
        } else {
            score -= 0.5;
            reasons.push(`RSI ${rsi.toFixed(0)} (偏空)`);
        }
    }
    
    // MACD 判斷
    if (macd) {
        if (macd.histogram > 0) {
            score += 1;
            reasons.push('MACD 黃金交叉');
        } else if (macd.histogram < 0) {
            score -= 1;
            reasons.push('MACD 死亡交叉');
        }
    }
    
    // 總結訊號
    let signal, emoji;
    if (score >= 2) {
        signal = '🟢 看漲';
        emoji = '📈';
    } else if (score <= -2) {
        signal = '🔴 看跌';
        emoji = '📉';
    } else {
        signal = '🟡 中立';
        emoji = '➖';
    }
    
    return {
        signal,
        score,
        reasons,
        indicators: {
            ma5: ma5?.toFixed(2) || 'N/A',
            ma10: ma10?.toFixed(2) || 'N/A',
            ma20: ma20?.toFixed(2) || 'N/A',
            rsi: rsi?.toFixed(0) || 'N/A',
            macd: macd ? macd.dif.toFixed(2) : 'N/A'
        }
    };
}

// 抓取股票價格和歷史資料
async function getStockData(stockId) {
    try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${stockId}.TW?interval=1d&range=60d`;
        const response = await axios.get(url, {
            timeout: 15000,
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        
        const result = response.data.chart.result[0];
        const meta = result.meta;
        const timestamps = result.timestamp;
        const quotes = result.indicators.quote[0];
        const adjClose = result.indicators.adjclose?.[0]?.adjclose || quotes.close;
        
        const currentPrice = meta.regularMarketPrice;
        const prevClose = meta.regularMarketPreviousClose || adjClose[adjClose.length - 2];
        
        // 建立價格歷史
        const priceHistory = timestamps.map((t, i) => ({
            date: new Date(t * 1000).toISOString().split('T')[0],
            close: adjClose[i] || quotes.close[i],
            open: quotes.open?.[i],
            high: quotes.high?.[i],
            low: quotes.low?.[i]
        }));
        
        const change = parseFloat((currentPrice - prevClose).toFixed(2));
        
        // 技術分析
        const analysis = analyzeStock({ price: currentPrice }, priceHistory);
        
        return {
            id: stockId,
            price: currentPrice.toFixed(2),
            change: change >= 0 ? `+${change}` : `${change}`,
            percent: parseFloat(((change / prevClose) * 100).toFixed(2)),
            analysis,
            time: new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })
        };
    } catch (err) {
        log(`抓取 ${stockId} 失敗: ${err.message}`);
        return {
            id: stockId,
            price: 'Error',
            change: 'N/A',
            percent: 0,
            analysis: { signal: '❌ 取得失敗' },
            error: err.message
        };
    }
}

// 取得所有股票資料
async function getAllStockData() {
    const stocks = readStockList();
    if (stocks.length === 0) {
        log('監控清單為空');
        return [];
    }
    
    const results = await Promise.all(stocks.map(s => getStockData(s.id)));
    return results;
}

// 新增股票
function addStock(stockId) {
    const stocks = readStockList();
    if (!stocks.find(s => s.id === stockId)) {
        stocks.push({ id: stockId, addedAt: new Date().toISOString() });
        saveStockList(stocks);
        log(`新增 ${stockId}`);
    }
    return stocks;
}

// 移除股票
function removeStock(stockId) {
    let stocks = readStockList();
    stocks = stocks.filter(s => s.id !== stockId);
    saveStockList(stocks);
    log(`移除 ${stockId}`);
    return stocks;
}

// 檢查是否為交易日
function isTradingDay() {
    const today = new Date();
    const day = today.getDay();
    return day >= 1 && day <= 5;
}

// 格式化訊息
function formatStockMessage(stocks) {
    if (stocks.length === 0) return '監控清單為空';
    
    let msg = '📈 股票監控 & 技術分析\n';
    msg += '═'.repeat(22) + '\n';
    
    // 檢查是否為交易日
    if (!isTradingDay()) {
        msg += '⚪ 今天是週末，股市休市\n';
        msg += '═'.repeat(22) + '\n';
        msg += '開盤日再更新股價\n';
        return msg;
    }
    
    stocks.forEach(s => {
        const emoji = s.percent >= 0 ? '🟢' : '🔴';
        msg += `${emoji} ${s.id}: $${s.price} (${s.change})\n`;
        msg += `   ${s.analysis.signal}\n`;
        
        if (s.analysis.reasons && s.analysis.reasons.length > 0) {
            s.analysis.reasons.forEach(r => {
                msg += `   • ${r}\n`;
            });
        }
        
        msg += '─'.repeat(22) + '\n';
    });
    
    msg += `時間: ${stocks[0]?.time || 'N/A'}\n`;
    msg += `排程: 週一至五 9:00、10:00\n`;
    
    return msg;
}

// 發送 Telegram 通知
async function sendTelegramNotification(message) {
    if (!telegramBot || !global.telegramConfig?.chatId) {
        log('Telegram 未設定，無法發送通知');
        return false;
    }
    
    try {
        await telegramBot.sendMessage(global.telegramConfig.chatId, message, { parse_mode: 'HTML' });
        log('Telegram 通知已發送');
        return true;
    } catch (err) {
        log(`Telegram 發送失敗: ${err.message}`);
        return false;
    }
}

// 初始化
function init() {
    const stocks = readStockList();
    if (stocks.length === 0) {
        addStock('2337');
        log('初始化: 2337');
    }
}

// 測試執行
async function test() {
    init();
    log('測試抓取股價...');
    const stocks = await getAllStockData();
    const msg = formatStockMessage(stocks);
    console.log(msg);
    log('測試完成');
}

// 設定排程
cron.schedule('0 9,10 * * 1-5', async () => {
    if (!isTradingDay()) {
        log('今天是週末，跳過通知');
        return;
    }
    log('定時檢查股價');
    const stockData = await getAllStockData();
    const msg = formatStockMessage(stockData);
    console.log(msg);
    
    // 發送 Telegram 通知
    await sendTelegramNotification('```\n' + msg + '\n```');
    log('股價通知已發送');
});

test().catch(err => {
    log(`錯誤: ${err.message}`);
    process.exit(1);
});
