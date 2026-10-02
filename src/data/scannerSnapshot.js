import { enrichHistoricalCandles, fetchHistoricalMarketData } from './marketData.js'

export async function fetchScannerSnapshot(symbols, range, fetchData = fetchHistoricalMarketData, now = () => new Date()) {
  const nowMs = new Date(now()).getTime()
  return Promise.all(symbols.map(async (symbol) => {
    try {
      const data = await fetchData(symbol, '1Hour', range)
      const candles = data?.candles ?? []
      if (!candles.length) return { symbol, available: false }

      const completedCandles = candles.filter((candle) => {
        const timestampMs = new Date(candle.timestamp).getTime()
        return Number.isFinite(timestampMs) && timestampMs + 60 * 60 * 1000 <= nowMs
      })
      if (!completedCandles.length) return { symbol, available: false }

      const enriched = enrichHistoricalCandles(completedCandles)
      const latest = enriched[enriched.length - 1]
      const previous = enriched.length > 1 ? enriched[enriched.length - 2] : latest
      const change = previous.close ? ((latest.close - previous.close) / previous.close) * 100 : 0
      return {
        symbol,
        available: true,
        snapshot: {
          symbol,
          price: latest.price,
          change,
          vwap: latest.vwap,
          ema9: latest.ema9,
          ema21: latest.ema21,
          rsi: latest.rsi,
          relativeVolume: latest.relativeVolume,
          breakout: latest.breakout,
          trend: latest.trend,
          atr: latest.atr,
          volume: latest.volume,
        },
      }
          } catch (error) {
        return {
          symbol,
          available: false,
          error: error?.message ?? 'Unknown scanner error',
        }
    }
  }))
}

export function isSuccessfulScannerRefresh(entries) {
  return entries.some((entry) => entry.available)
}
