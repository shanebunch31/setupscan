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