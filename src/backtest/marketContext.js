import { synchronizeCandleSeries } from './relativeValue.js'
import { causalRegimeDefaults, computeCausalRegimeSeries } from './causalRegimeBacktest.js'

export const marketContextSymbols = ['SPY', 'QQQ', 'IWM']
export const marketContextTimeframe = '1Hour'
export const marketContextSource = 'ALPACA HISTORICAL'
export const marketContextSourcePath = (symbol) => `https://data.alpaca.markets/v2/stocks/${encodeURIComponent(symbol)}/bars`
export const marketContextResearchStart = '2022-01-03T00:00:00.000Z'
export const marketContextResearchEnd = '2026-09-23T23:59:59.999Z'

const trendStateLabels = new Set(['Uptrend', 'Mixed', 'Downtrend'])

function normalizeTimestamp(timestamp) {
  const normalized = new Date(timestamp).toISOString()
  return normalized
}

function inResearchPeriod(timestamp) {
  const value = Date.parse(timestamp)
  return Number.isFinite(value) && value >= Date.parse(marketContextResearchStart) && value <= Date.parse(marketContextResearchEnd)
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
}

function buildBreadth(symbolPoints) {
  const states = symbolPoints.map((point) => point?.trend?.classification)
  if (states.length !== marketContextSymbols.length || states.some((state) => !trendStateLabels.has(state))) return null
  const upCount = states.filter((state) => state === 'Uptrend').length
  const mixedCount = states.filter((state) => state === 'Mixed').length
  const downCount = states.filter((state) => state === 'Downtrend').length
  return {
    coverageCount: states.length,
    upCount,
    mixedCount,
    downCount,
    upFraction: upCount / states.length,
    mixedFraction: mixedCount / states.length,
    downFraction: downCount / states.length,
  }
}

function buildRiskOnOffProxy(breadth, symbolPoints, coverageStatus) {
  if (coverageStatus !== 'complete') return { state: 'Insufficient-Coverage', averageReturn20: null }
  if (!breadth) return { state: 'Insufficient-History', averageReturn20: null }
  const averageReturn20 = average(symbolPoints.map((point) => point.trend.return20).filter((value) => value !== null))
  if (averageReturn20 === null) return { state: 'Insufficient-History', averageReturn20: null }
  if (breadth.upCount >= 2 && averageReturn20 > 0) return { state: 'Risk-On', averageReturn20 }
  if (breadth.downCount >= 2 && averageReturn20 < 0) return { state: 'Risk-Off', averageReturn20 }
  return { state: 'Neutral', averageReturn20 }
}

function deduplicateAndSortSeries(rawSeries, symbol) {
  const synchronized = synchronizeCandleSeries({ [symbol]: rawSeries ?? [] })
  return {
    candles: synchronized.series[symbol] ?? [],
    duplicateTimestamps: synchronized.duplicatesBySymbol[symbol] ?? [],
  }
}

export function buildMarketWideContext(rawSeriesBySymbol, { retrievalAt = null, retrievalAtBySymbol = {} } = {}) {
  const prepared = {}
  const regimeBySymbol = {}
  const sourceCounts = {}
  const deduplicatedCounts = {}
  const duplicateTimestampsBySymbol = {}
  const sourceTimestampExceptions = []

  marketContextSymbols.forEach((symbol) => {
    const rawSeries = (rawSeriesBySymbol?.[symbol] ?? []).filter((candle) => inResearchPeriod(candle.timestamp))
    const { candles, duplicateTimestamps } = deduplicateAndSortSeries(rawSeries, symbol)
    prepared[symbol] = candles
    sourceCounts[symbol] = rawSeries.length
    deduplicatedCounts[symbol] = candles.length
    duplicateTimestampsBySymbol[symbol] = duplicateTimestamps
    regimeBySymbol[symbol] = computeCausalRegimeSeries({ [symbol]: candles }, causalRegimeDefaults)
  })

  const pointBySymbolAndTimestamp = {}
  const candleBySymbolAndTimestamp = {}
  marketContextSymbols.forEach((symbol) => {
    pointBySymbolAndTimestamp[symbol] = new Map(regimeBySymbol[symbol].map((point) => [normalizeTimestamp(point.timestamp), point]))
    candleBySymbolAndTimestamp[symbol] = new Map(prepared[symbol].map((candle) => [normalizeTimestamp(candle.timestamp), candle]))
  })

  const timestamps = [...new Set(marketContextSymbols.flatMap((symbol) => prepared[symbol].map((candle) => normalizeTimestamp(candle.timestamp))))].sort()
  const rows = timestamps.map((timestampUTC) => {
    const symbolSnapshots = {}
    const symbolPoints = []
    let coverageCount = 0
    marketContextSymbols.forEach((symbol) => {
      const candle = candleBySymbolAndTimestamp[symbol].get(timestampUTC)
      const point = pointBySymbolAndTimestamp[symbol].get(timestampUTC) ?? null
      if (candle) coverageCount += 1
      symbolPoints.push(point)
      if (candle && Date.parse(candle.timestamp) !== Date.parse(timestampUTC)) {
        sourceTimestampExceptions.push({ symbol, sourceTimestamp: candle.timestamp, timestampUTC })
      }
      symbolSnapshots[symbol] = {
        coverageStatus: candle ? 'present' : 'missing',
        trendState: point?.trend?.classification ?? null,
        volatilityState: point?.volatility?.classification ?? null,
      }
    })
    const coverageStatus = coverageCount === marketContextSymbols.length ? 'complete' : 'incomplete'
    const breadth = coverageStatus === 'complete' ? buildBreadth(symbolPoints) : null
    return {
      timestampUTC,
      timeframe: marketContextTimeframe,
      coverageStatus,
      coverageCount,
      symbols: symbolSnapshots,
      breadth,
      riskOnOffProxy: buildRiskOnOffProxy(breadth, symbolPoints, coverageStatus),
    }
  })

  return {
    metadata: {
      source: marketContextSource,
      sourcePath: 'https://data.alpaca.markets/v2/stocks/{symbol}/bars',
      retrievalAtBySymbol: Object.keys(retrievalAtBySymbol).length ? retrievalAtBySymbol : null,
      timeframe: marketContextTimeframe,
      symbols: marketContextSymbols,
      researchStart: marketContextResearchStart,
      researchEnd: marketContextResearchEnd,
      sourceCounts,
      deduplicatedCounts,
      duplicateTimestampsBySymbol,
      sourceTimestampNormalization: 'For a present symbol, its original Alpaca source timestamp is the same instant as the row timestampUTC. Alpaca UTC timestamps may omit .000 milliseconds; normalization does not change the instant.',
      sourceTimestampExceptions,
      synchronizedTimestampCount: rows.length,
      completeCoverageCount: rows.filter((row) => row.coverageStatus === 'complete').length,
      incompleteCoverageCount: rows.filter((row) => row.coverageStatus === 'incomplete').length,
      exclusions: {
        duplicateTimestamps: 'Kept the first occurrence per symbol and timestamp; later duplicates were excluded.',
        incompleteCoverage: 'Retained on the union timestamp axis but excluded from three-symbol breadth and risk proxy calculations.',
      },
      causalRegimeParameters: causalRegimeDefaults,
    },
    rows,
  }
}