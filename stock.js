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

// 台股股票名稱對照表
const STOCK_NAMES = {
    '2337': '旺宏',
    '8110': '華豐',
    '2330': '台積電',
    '2303': '聯電',
    '2377': '崇越',
    '2376': '技嘉',
    '2382': '廣達',
    '2409': '友達',
    '2474': '可成',
    '3008': '大立光',
    '3711': '日月光',
    '4958': '振曜',
    '6213': '聯強',
    '6285': '廣明',
    '6515': '慧洋-KY'
};

// 取得股票名稱
function getStockName(id) {
    return STOCK_NAMES[id] || id;
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

// 取得大盤/市場環境資料
async function getMarketData() {
    try {
        // 抓取台股指數
        const twiiRes = await axios.get('https://query1.finance.yahoo.com/v8/finance/chart/^TWII?interval=1d&range=5d', {
            timeout: 15000,
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        
        const twiiResult = twiiRes.data.chart.result?.[0];
        const twiiPrices = twiiResult?.indicators?.quote?.[0]?.close || [];
        const twiiCurrent = twiiPrices[twiiPrices.length - 1];
        const twiiPrev = twiiPrices[twiiPrices.length - 2];
        const twiiChange = ((twiiCurrent - twiiPrev) / twiiPrev) * 100;
        
        // 抓取道瓊指數（美股）
        const dowRes = await axios.get('https://query1.finance.yahoo.com/v8/finance/chart/^DJI?interval=1d&range=5d', {
            timeout: 15000,
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        
        const dowResult = dowRes.data.chart.result?.[0];
        const dowPrices = dowResult?.indicators?.quote?.[0]?.close || [];
        const dowCurrent = dowPrices[dowPrices.length - 1];
        const dowPrev = dowPrices[dowPrices.length - 2];
        const dowChange = ((dowCurrent - dowPrev) / dowPrev) * 100;
        
        return {
            twii: {
                price: twiiCurrent?.toFixed(0) || 'N/A',
                change: twiiChange?.toFixed(2) || '0'
            },
            dow: {
                price: dowCurrent?.toFixed(0) || 'N/A',
                change: dowChange?.toFixed(2) || '0'
            },
            indexTrend: twiiChange > 0.5 ? 'up' : twiiChange < -0.5 ? 'down' : 'neutral',
            usMarket: dowChange > 0 ? 'up' : dowChange < 0 ? 'down' : 'neutral'
        };
    } catch (err) {
        log(`抓取大盤資料失敗: ${err.message}`);
        return { indexTrend: 'neutral', usMarket: 'neutral' };
    }
}

// 計算成交量變化
function calculateVolumeTrend(volumes) {
    if (volumes.length < 5) return { trend: 'normal', ratio: 1 };
    
    const recent = volumes.slice(-5);
    const avg = recent.reduce((a, b) => a + b, 0) / 5;
    const latest = volumes[volumes.length - 1];
    
    return {
        trend: latest > avg * 1.5 ? 'high' : latest < avg * 0.5 ? 'low' : 'normal',
        ratio: latest / avg
    };
}

// 計算價格動量
function calculateMomentum(prices, period = 10) {
    if (prices.length < period + 1) return null;
    
    const current = prices[prices.length - 1];
    const past = prices[prices.length - period - 1];
    
    return ((current - past) / past) * 100;
}

// 明日走勢預測（技術面 + 市場環境）
function predictNextDay(stockData, priceHistory, marketData = {}) {
    if (!priceHistory || priceHistory.length < 30) {
        return {
            prediction: '⚪ 觀望',
            confidence: '低',
            reason: '數據不足，無法預測'
        };
    }
    
    const prices = priceHistory.map(p => p.close);
    const volumes = priceHistory.map(p => p.volume || 0);
    const currentPrice = prices[prices.length - 1];
    const currentVol = volumes[volumes.length - 1];
    
    // 技術指標
    const ma5 = calculateMA(prices, 5);
    const ma10 = calculateMA(prices, 10);
    const ma20 = calculateMA(prices, 20);
    const ma60 = calculateMA(prices, 60);
    const rsi = calculateRSI(prices);
    const macd = calculateMACD(prices);
    const momentum = calculateMomentum(prices);
    const volTrend = calculateVolumeTrend(volumes);
    
    // 評分系統
    let score = 0;
    let reasons = [];
    let factors = [];
    
    // === 技術面因素 ===
    
    // 1. MA 排列（多頭排列/空頭排列）
    const maTrend = [];
    if (ma5 && ma10 && ma20) {
        if (ma5 > ma10 && ma10 > ma20) {
            score += 2;
            maTrend.push('多頭排列');
        } else if (ma5 < ma10 && ma10 < ma20) {
            score -= 2;
            maTrend.push('空頭排列');
        } else if (ma5 > ma10 && ma10 > ma20) {
            score += 1;
            maTrend.push('短期均線向上');
        } else if (ma5 < ma10) {
            score -= 1;
            maTrend.push('短期均線向下');
        }
    }
    
    // 2. 股價相對均線位置
    if (ma20) {
        if (currentPrice > ma20 * 1.05) {
            score += 1;
            factors.push('股價站穩 20 日線上方 (+5%)');
        } else if (currentPrice < ma20 * 0.95) {
            score -= 1;
            factors.push('股價跌破 20 日線 (-5%)');
        }
    }
    
    // 3. RSI 位置
    if (rsi !== null) {
        if (rsi > 70) {
            score -= 1.5;
            factors.push(`RSI ${rsi.toFixed(0)} (過熱，可能回調)`);
        } else if (rsi < 30) {
            score += 1.5;
            factors.push(`RSI ${rsi.toFixed(0)} (超賣，可能反彈)`);
        } else if (rsi > 55) {
            score += 1;
            factors.push(`RSI ${rsi.toFixed(0)} (偏多)`);
        } else if (rsi < 45) {
            score -= 1;
            factors.push(`RSI ${rsi.toFixed(0)} (偏空)`);
        }
    }
    
    // 4. MACD 狀態
    if (macd) {
        if (macd.dif > macd.dea && macd.histogram > 0) {
            score += 2;
            factors.push('MACD 多頭訊號 (DIF>DEA)');
        } else if (macd.dif < macd.dea && macd.histogram < 0) {
            score -= 2;
            factors.push('MACD 空頭訊號 (DIF<DEA)');
        } else if (macd.histogram > 0) {
            score += 0.5;
            factors.push('MACD 轉強');
        } else {
            score -= 0.5;
            factors.push('MACD 轉弱');
        }
    }
    
    // 5. 動量
    if (momentum !== null) {
        if (momentum > 10) {
            score += 1.5;
            factors.push(`動能強 (+${momentum.toFixed(1)}%)`);
        } else if (momentum > 5) {
            score += 1;
            factors.push(`動能正向 (+${momentum.toFixed(1)}%)`);
        } else if (momentum < -10) {
            score -= 1.5;
            factors.push(`動能弱 (${momentum.toFixed(1)}%)`);
        } else if (momentum < -5) {
            score -= 1;
            factors.push(`動能負向 (${momentum.toFixed(1)}%)`);
        }
    }
    
    // 6. 成交量
    if (volTrend.ratio > 2) {
        score += 1;
        factors.push('成交量明顯放大 (突破?)');
    } else if (volTrend.ratio < 0.5) {
        score -= 0.5;
        factors.push('成交量萎縮');
    }
    
    // === 市場環境因素 ===
    
    // 7. 大盤環境
    if (marketData.indexTrend === 'up') {
        score += 1;
        factors.push('大盤偏多');
    } else if (marketData.indexTrend === 'down') {
        score -= 1;
        factors.push('大盤偏空');
    }
    
    // 8. 國際市場
    if (marketData.usMarket === 'up') {
        score += 0.5;
        factors.push('美股收紅');
    } else if (marketData.usMarket === 'down') {
        score -= 0.5;
        factors.push('美股收黑');
    }
    
    // 計算信心度
    const absScore = Math.abs(score);
    let confidence;
    if (absScore >= 5) confidence = '高';
    else if (absScore >= 3) confidence = '中';
    else if (absScore >= 1) confidence = '低';
    else confidence = '極低';
    
    // 預測結果
    let prediction;
    if (score >= 3) {
        prediction = '📈 看漲';
    } else if (score <= -3) {
        prediction = '📉 看跌';
    } else if (score >= 1) {
        prediction = '🟡 偏漲';
    } else if (score <= -1) {
        prediction = '🟠 偏跌';
    } else {
        prediction = '⚪ 觀望';
    }
    
    // 組合理由
    const allReasons = [...maTrend, ...factors].slice(0, 5);
    
    return {
        prediction,
        confidence,
        score: score.toFixed(1),
        reasons: allReasons,
        factors: {
            ma: maTrend.length > 0 ? maTrend.join(', ') : '無明顯趨勢',
            rsi: rsi?.toFixed(0) || 'N/A',
            macd: macd ? (macd.histogram > 0 ? '多頭' : '空頭') : 'N/A',
            momentum: momentum?.toFixed(1) ? `${momentum.toFixed(1)}%` : 'N/A',
            volume: volTrend.trend
        }
    };
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
        
        // 明日走勢預測（技術面 + 市場環境）
        const prediction = predictNextDay({ price: currentPrice }, priceHistory, {});
        
        return {
            id: stockId,
            price: currentPrice.toFixed(2),
            change: change >= 0 ? `+${change}` : `${change}`,
            percent: parseFloat(((change / prevClose) * 100).toFixed(2)),
            analysis,
            prediction,
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

// 格式化訊息（分為監控清單和推薦股票）
function formatStockMessages(stocks, marketData = {}) {
    if (stocks.length === 0) {
        return { watchlist: '監控清單為空', recommendations: null };
    }
    
    let watchlist = '📈 <b>股票監控清單</b>\n';
    watchlist += '═'.repeat(22) + '\n';
    
    // 大盤資訊
    if (marketData.twii) {
        const twiiEmoji = parseFloat(marketData.twii.change) >= 0 ? '🟢' : '🔴';
        watchlist += `📊 台股: ${marketData.twii.price} (${twiiEmoji} ${marketData.twii.change}%)\n`;
    }
    
    // 檢查是否為交易日
    if (!isTradingDay()) {
        watchlist += '⚪ 今天是週末，股市休市\n';
        watchlist += '═'.repeat(22) + '\n';
        watchlist += '開盤日再更新股價';
        return { watchlist, recommendations: null };
    }
    
    // 監控清單
    stocks.forEach(s => {
        const emoji = s.percent >= 0 ? '🟢' : '🔴';
        watchlist += `${emoji} <b>${s.id} ${getStockName(s.id)}</b>: $${s.price} (${s.change}%)\n`;
        
        if (s.prediction) {
            const confEmoji = s.prediction.confidence === '高' ? '💪' : s.prediction.confidence === '中' ? '👌' : '🤔';
            watchlist += `   🔮 ${s.prediction.prediction} ${confEmoji} | 評分: ${s.prediction.score}\n`;
            watchlist += `   RSI: ${s.prediction.factors?.rsi || 'N/A'} | MACD: ${s.prediction.factors?.macd || 'N/A'}\n`;
        }
        watchlist += '─'.repeat(22) + '\n';
    });
    
    watchlist += `\n🕐 ${stocks[0]?.time || 'N/A'}`;
    
    // 推薦股票 TOP 5
    const stocksWithScore = stocks.map(s => ({
        ...s,
        score: parseFloat(s.prediction?.score || 0),
        prediction: s.prediction?.prediction || '⚪'
    }));
    
    const sorted = [...stocksWithScore].sort((a, b) => b.score - a.score);
    const top5 = sorted.slice(0, 5).filter(s => s.score > 0);
    
    let recommendations = null;
    if (top5.length > 0) {
        recommendations = '🌟 <b>推薦股票 TOP 5</b>\n';
        recommendations += '═'.repeat(22) + '\n';
        
        top5.forEach((s, i) => {
            const emoji = s.percent >= 0 ? '🟢' : '🔴';
            const stars = s.score >= 5 ? '⭐⭐⭐' : s.score >= 3 ? '⭐⭐' : '⭐';
            recommendations += `${i+1}. <b>${s.id} ${getStockName(s.id)}</b> ${stars} ${s.prediction}\n`;
            recommendations += `   評分: ${s.score.toFixed(1)} | $${s.price} (${emoji} ${s.change}%)\n`;
            if (s.prediction.reasons && s.prediction.reasons.length > 0) {
                recommendations += `   重點: ${s.prediction.reasons[0]}\n`;
            }
            recommendations += '─'.repeat(22) + '\n';
        });
        
        recommendations += `\n🕐 ${stocks[0]?.time || 'N/A'}`;
    }
    
    return { watchlist, recommendations };
}

// 發送 Telegram 通知（支援多封訊息）
async function sendTelegramNotifications(messages) {
    if (!telegramBot || !global.telegramConfig?.chatId) {
        log('Telegram 未設定，無法發送通知');
        return false;
    }
    
    try {
        // 發送第一封（監控清單）
        if (messages.watchlist) {
            await telegramBot.sendMessage(global.telegramConfig.chatId, messages.watchlist, { parse_mode: 'HTML' });
            log('監控清單已發送');
        }
        
        // 發送第二封（推薦股票）
        if (messages.recommendations) {
            await new Promise(resolve => setTimeout(resolve, 500)); // 稍微延遲
            await telegramBot.sendMessage(global.telegramConfig.chatId, messages.recommendations, { parse_mode: 'HTML' });
            log('推薦股票已發送');
        }
        
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
    const marketData = await getMarketData();
    const stocks = await getAllStockData();
    const messages = formatStockMessages(stocks, marketData);
    
    console.log('--- 監控清單 ---');
    console.log(messages.watchlist);
    console.log('\n--- 推薦股票 ---');
    console.log(messages.recommendations || '無推薦');
    
    await sendTelegramNotifications(messages);
    log('測試完成');
}

// 設定排程
cron.schedule('0 20 * * 1-5', async () => {
    if (!isTradingDay()) {
        log('今天是週末，跳過通知');
        return;
    }
    log('定時檢查股價');
    const marketData = await getMarketData();
    const stockData = await getAllStockData();
    const messages = formatStockMessages(stockData, marketData);
    
    await sendTelegramNotifications(messages);
    log('股價通知已發送');
});

test().catch(err => {
    log(`錯誤: ${err.message}`);
    process.exit(1);
});
