import { apiUrl } from '../config/apiBase.js'

const marketFixtures = {
  SPY: { price: 574.81, change: 0.62, vwap: 572.94, ema9: 573.68, ema21: 570.55, rsi: 61, relativeVolume: 1.28, breakout: true, trend: 'Bullish' },
  QQQ: { price: 488.26, change: 0.41, vwap: 487.9, ema9: 487.55, ema21: 484.7, rsi: 58, relativeVolume: 1.12, breakout: true, trend: 'Bullish' },
  IWM: { price: 225.38, change: -0.27, vwap: 226.14, ema9: 225.62, ema21: 226.04, rsi: 46, relativeVolume: 0.86, breakout: false, trend: 'Bearish' },
  NVDA: { price: 139.91, change: 1.84, vwap: 137.88, ema9: 138.76, ema21: 134.66, rsi: 68, relativeVolume: 1.76, breakout: true, trend: 'Bullish' },
  TSLA: { price: 242.84, change: -1.12, vwap: 244.76, ema9: 243.32, ema21: 241.94, rsi: 49, relativeVolume: 1.34, breakout: false, trend: 'Bullish' },
  AAPL: { price: 228.87, change: 0.14, vwap: 228.32, ema9: 228.48, ema21: 227.86, rsi: 54, relativeVolume: 0.98, breakout: false, trend: 'Bullish' },
  AMD: { price: 158.42, change: -0.62, vwap: 160.08, ema9: 159.24, ema21: 161.12, rsi: 42, relativeVolume: 1.08, breakout: false, trend: 'Bearish' },
  META: { price: 591.73, change: 1.02, vwap: 588.2, ema9: 589.86, ema21: 583.44, rsi: 64, relativeVolume: 1.42, breakout: true, trend: 'Bullish' },
  AMZN: { price: 205.16, change: 0.33, vwap: 204.8, ema9: 204.91, ema21: 202.8, rsi: 57, relativeVolume: 1.05, breakout: false, trend: 'Bullish' },
}
export function getWatchlistSnapshot(symbols) { return symbols.map((symbol) => ({ symbol, ...marketFixtures[symbol] })) }

export async function fetchHistoricalMarketData(symbol = 'SPY', timeframe = '1Hour', { start, end } = {}) {
  const params = new URLSearchParams({ symbol, timeframe })
  if (start) params.set('start', start)
  if (end) params.set('end', end)
  const response = await fetch(apiUrl(`/api/historical?${params}`))
  const payload = await response.json()
  if (!response.ok) throw new Error(payload.error || 'Historical data request failed')
  return payload
}

const averageValues = (values) => values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0

export function enrichHistoricalCandles(candles) {
  return candles.map((candle, index) => {
    const priorCandles = candles.slice(Math.max(0, index - 20), index)
    const closes = priorCandles.map((item) => item.close)
    const volumes = priorCandles.map((item) => item.volume)
    const typicalPrice = (candle.high + candle.low + candle.close) / 3
    const previousTypicalPrices = candles.slice(0, index + 1).map((item) => (item.high + item.low + item.close) / 3)
    const previousVolume = averageValues(candles.slice(0, index + 1).map((item) => item.volume))
    const ema9 = index ? ((candle.close - candles[index - 1].close) / 9) + candles[index - 1].close : candle.close
    const ema21 = index ? ((candle.close - candles[index - 1].close) / 21) + candles[index - 1].close : candle.close
    const gains = closes.slice(1).map((close, closeIndex) => Math.max(0, close - closes[closeIndex]))
    const losses = closes.slice(1).map((close, closeIndex) => Math.max(0, closes[closeIndex] - close))
    const averageGain = averageValues(gains)
    const averageLoss = averageValues(losses)
    const relativeStrength = averageLoss ? averageGain / averageLoss : averageGain ? Infinity : 0
    const rsi = 100 - (100 / (1 + relativeStrength))
    const range = candle.high - candle.low
    return {
      ...candle,
      timeframe: '1h',
      price: candle.close,
      vwap: averageValues(previousTypicalPrices),
      ema9,
      ema21,
      rsi: Number.isFinite(rsi) ? Math.round(rsi) : 100,
      relativeVolume: previousVolume ? candle.volume / previousVolume : 1,
      breakout: priorCandles.length >= 20 && candle.close > Math.max(...priorCandles.map((item) => item.high)),
      trend: ema9 >= ema21 ? 'Bullish' : 'Bearish',
      atr: range,
    }
  })
}

export function getHistoricalMarketData(symbol = 'SPY', count = 180, timeframe = '1h') {
  const fixture = marketFixtures[symbol] ?? marketFixtures.SPY
  return Array.from({ length: count }, (_, index) => {
    const wave = Math.sin(index / 5) * 1.15 + Math.sin(index / 13) * 0.8
    const close = fixture.price + wave + index * 0.018
    const open = close - Math.sin(index / 3) * 0.42
    const high = Math.max(open, close) + 0.75 + (index % 4) * 0.08
    const low = Math.min(open, close) - 0.62 - (index % 3) * 0.09
    return { symbol, timeframe, timestamp: new Date(Date.UTC(2025, 0, 2, index + 10)).toISOString(), open, high, low, close, price: close, vwap: close - (index % 9 < 6 ? 0.35 : 0.9), ema9: close + (index % 11 < 8 ? 0.32 : -0.18), ema21: close - (index % 11 < 8 ? 0.22 : 0.28), rsi: 56 + Math.round(Math.sin(index / 4) * 10), relativeVolume: 1.2 + (index % 6) * 0.12, breakout: index % 10 === 0 || index % 10 === 1, trend: index % 17 < 12 ? 'Bullish' : 'Bearish', atr: 1.15, volume: 1000000 + (index % 7) * 100000 }
  })
}