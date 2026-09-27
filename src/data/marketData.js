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

const averageValues = (values) => values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0

export const EMA_CONTRACT_VERSION = 'setupscan-ema-sma-seeded-recursive-v1'
const emaPrecomputedMarker = Symbol.for(`setupscan.${EMA_CONTRACT_VERSION}`)
const EMA_PREROLL_DAYS = 30

function emaSeries(candles, period) {
  const alpha = 2 / (period + 1)
  const seed = []
  let value = null
  return candles.map((candle) => {
    if (candle?.close === null || candle?.close === undefined || candle.close === '') return null
    const close = Number(candle?.close)
    if (!Number.isFinite(close)) return null
    if (value === null) {
      seed.push(close)
      if (seed.length < period) return null
      value = averageValues(seed)
      return value
    }
    value = alpha * close + (1 - alpha) * value
    return value
  })
}

function historicalFetchRange(range = {}, timeframe = '1Hour') {
  const { start, end } = range
  if (!start || timeframe !== '1Hour') return { start, end, requestedStart: start ?? null, requestedEnd: end ?? null }
  const parsedStart = new Date(start)
  if (!Number.isFinite(parsedStart.getTime())) return { start, end, requestedStart: start, requestedEnd: end }
  const requestedStart = start
  parsedStart.setUTCDate(parsedStart.getUTCDate() - EMA_PREROLL_DAYS)
  return { start: parsedStart.toISOString(), end, requestedStart, requestedEnd: end ?? null }
}

export function enrichHistoricalCandles(candles) {
  const ema9Series = emaSeries(candles, 9)
  const ema21Series = emaSeries(candles, 21)
  return candles.map((candle, index) => {
    const priorCandles = candles.slice(Math.max(0, index - 20), index)
    const closes = priorCandles.map((item) => item.close)
    const volumes = priorCandles.map((item) => item.volume)
    const typicalPrice = (candle.high + candle.low + candle.close) / 3
    const previousTypicalPrices = candles.slice(0, index + 1).map((item) => (item.high + item.low + item.close) / 3)
    const previousVolume = averageValues(candles.slice(0, index + 1).map((item) => item.volume))
    const usePrecomputedEma = candle?.[emaPrecomputedMarker] === EMA_CONTRACT_VERSION
    const ema9 = usePrecomputedEma ? candle.ema9 : ema9Series[index]
    const ema21 = usePrecomputedEma ? candle.ema21 : ema21Series[index]
    const gains = closes.slice(1).map((close, closeIndex) => Math.max(0, close - closes[closeIndex]))
    const losses = closes.slice(1).map((close, closeIndex) => Math.max(0, closes[closeIndex] - close))
    const averageGain = averageValues(gains)
    const averageLoss = averageValues(losses)
    const relativeStrength = averageLoss ? averageGain / averageLoss : averageGain ? Infinity : 0
    const rsi = 100 - (100 / (1 + relativeStrength))
    const range = candle.high - candle.low
    const enrichedCandle = {
      ...candle,
      timeframe: '1h',
      price: candle.close,
      vwap: averageValues(previousTypicalPrices),
      ema9,
      ema21,
      rsi: Number.isFinite(rsi) ? Math.round(rsi) : 100,
      relativeVolume: previousVolume ? candle.volume / previousVolume : 1,
      breakout: priorCandles.length >= 20 && candle.close > Math.max(...priorCandles.map((item) => item.high)),
      trend: !Number.isFinite(ema9) || !Number.isFinite(ema21) || ema9 === ema21
        ? 'Neutral'
        : ema9 > ema21 ? 'Bullish' : 'Bearish',
      atr: range,
    }
    if (usePrecomputedEma) Object.defineProperty(enrichedCandle, emaPrecomputedMarker, { value: EMA_CONTRACT_VERSION })
    return enrichedCandle
  })
}

export async function fetchHistoricalMarketData(symbol = 'SPY', timeframe = '1Hour', range = {}) {
  const fetchRange = historicalFetchRange(range, timeframe)
  const params = new URLSearchParams({ symbol, timeframe })
  if (fetchRange.start) params.set('start', fetchRange.start)
  if (fetchRange.end) params.set('end', fetchRange.end)
  const response = await fetch(apiUrl(`/api/historical?${params}`))
  const payload = await response.json()
  if (!response.ok) throw new Error(payload.error || 'Historical data request failed')

  const fetchedCandles = Array.isArray(payload.candles) ? payload.candles : []
  const ema9ByBar = emaSeries(fetchedCandles, 9)
  const ema21ByBar = emaSeries(fetchedCandles, 21)
  const requestedStartTime = fetchRange.requestedStart ? new Date(fetchRange.requestedStart).getTime() : null
  const requestedEndTime = fetchRange.requestedEnd ? new Date(fetchRange.requestedEnd).getTime() : null
  const requestedRawCandles = fetchRange.requestedStart ? fetchedCandles.filter((candle) => {
    const timestamp = new Date(candle.timestamp).getTime()
    return Number.isFinite(timestamp)
      && (requestedStartTime === null || timestamp >= requestedStartTime)
      && (requestedEndTime === null || timestamp <= requestedEndTime)
  }) : fetchedCandles
  const requestedEnriched = enrichHistoricalCandles(requestedRawCandles)
  const emaByTimestamp = new Map(fetchedCandles.map((candle, index) => [candle.timestamp, {
    ema9: ema9ByBar[index],
    ema21: ema21ByBar[index],
  }]))
  const requestedCandles = requestedEnriched.map((candle) => {
    const precomputed = emaByTimestamp.get(candle.timestamp)
    const withEma = {
      ...candle,
      ema9: precomputed?.ema9 ?? null,
      ema21: precomputed?.ema21 ?? null,
      trend: !Number.isFinite(precomputed?.ema9) || !Number.isFinite(precomputed?.ema21) || precomputed.ema9 === precomputed.ema21
        ? 'Neutral'
        : precomputed.ema9 > precomputed.ema21 ? 'Bullish' : 'Bearish',
    }
    Object.defineProperty(withEma, emaPrecomputedMarker, { value: EMA_CONTRACT_VERSION })
    return withEma
  })
  const requestedDays = fetchRange.requestedStart && fetchRange.requestedEnd
    ? (new Date(fetchRange.requestedEnd) - new Date(fetchRange.requestedStart)) / 86400000
    : 0
  const minimumExpectedCandles = requestedDays
    ? Math.min(1000, Math.max(20, Math.floor(requestedDays * 2)))
    : payload.minimumExpectedCandles ?? 0
  const result = {
    ...payload,
    start: requestedCandles[0]?.timestamp ?? null,
    end: requestedCandles.at(-1)?.timestamp ?? null,
    calculationStart: fetchedCandles[0]?.timestamp ?? null,
    calculationEnd: fetchedCandles.at(-1)?.timestamp ?? null,
    calculationCandleCount: fetchedCandles.length,
    requestedStart: fetchRange.requestedStart,
    requestedEnd: fetchRange.requestedEnd,
    requestedCandleCount: requestedCandles.length,
    candleCount: requestedCandles.length,
    minimumExpectedCandles,
    complete: !minimumExpectedCandles || requestedCandles.length >= minimumExpectedCandles,
    candles: requestedCandles,
  }
  Object.defineProperty(result, 'calculationCandles', { value: fetchedCandles })
  return result
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
