// Research Experiment #2 — Signal Quality / Expected Value.
// Tests whether the existing SetupScan score and its components carry information about
// subsequent outcomes. Reuses the existing Alpaca pipeline, scanner, and Experiment #1
// relative-value confirmation. Research only — does not modify production scoring,
// paper trading, the Render worker, or Supabase.
import { enrichHistoricalCandles } from '../data/marketData.js'
import { scanSetups } from '../logic/scanner.js'
import { synchronizeCandleSeries, computeRelativeStrengthConfirmation } from './relativeValue.js'
import { relativeValueDefaults } from './relativeValueBacktest.js'

export const signalQualityDefaults = {
  lookback: relativeValueDefaults.lookback,
  minimumScore: 75,
  stopDistancePercent: 0.005,
  targetR: 2,
  maxHoldingBars: 12,
  periodCount: 4,
  negligibleThresholdR: 0.02,
}

export const scoreBucketDefinitions = [
  ['75-79', 75, 79],
  ['80-84', 80, 84],
  ['85-89', 85, 89],
  ['90-94', 90, 94],
  ['95-100', 95, 100],
]

export const componentDefinitions = [
  { key: 'aboveVwap', label: 'Price above VWAP', test: (candle) => candle.price > candle.vwap },
  { key: 'emaAligned', label: 'EMA9 > EMA21', test: (candle) => candle.ema9 > candle.ema21 },
  { key: 'rsiRange', label: 'RSI 55-70', test: (candle) => candle.rsi >= 55 && candle.rsi <= 70 },
  { key: 'relVolume', label: 'Relative volume >= 1.2', test: (candle) => candle.relativeVolume >= 1.2 },
  { key: 'breakout', label: 'Breakout / reclaim', test: (candle) => candle.breakout === true },
  { key: 'bullishTrend', label: 'Bullish trend', test: (candle) => candle.trend === 'Bullish' },
  { key: 'rvConfirmation', label: 'Relative-value confirmation (Experiment #1)', test: null },
]

export const costTierDefinitions = [
  ['Before execution costs', 0],
  ['Low execution costs', 0.02],
  ['Moderate execution costs', 0.05],
  ['High execution costs', 0.10],
]

const average = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0)

function median(values) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export function buildAlignedSeries(rawSeriesBySymbol) {
  const { timestamps, series, droppedCounts, duplicatesBySymbol } = synchronizeCandleSeries(rawSeriesBySymbol)
  const enriched = {}
  Object.keys(series).forEach((symbol) => { enriched[symbol] = enrichHistoricalCandles(series[symbol]) })
  return { timestamps, raw: series, enriched, droppedCounts, duplicatesBySymbol }
}

// Mirrors the existing baseline strategy's entry/exit convention (strategy.js createTrade):
// signal at index i -> entry at candle i+1 open -> stop/target evaluated from candle i+1 onward.
export function buildTradeFromIndex(candles, signalIndex, options, meta = {}) {
  const entryCandle = candles[signalIndex + 1]
  if (!entryCandle) return null
  const entryPrice = entryCandle.open ?? entryCandle.close
  const risk = entryPrice * options.stopDistancePercent
  if (!(risk > 0)) return null
  const stopPrice = entryPrice - risk
  const targetPrice = entryPrice + risk * options.targetR
  const maxBars = Math.min(options.maxHoldingBars, candles.length - signalIndex - 1)
  if (maxBars < 1) return null
  let exitReason = 'Expired'
  let exitPrice = candles[signalIndex + maxBars]?.close ?? entryPrice
  let holdingBars = maxBars
  for (let offset = 1; offset <= maxBars; offset += 1) {
    const candle = candles[signalIndex + offset]
    if (candle.low <= stopPrice) { exitReason = 'Stop'; exitPrice = stopPrice; holdingBars = offset; break }
    if (candle.high >= targetPrice) { exitReason = 'Target'; exitPrice = targetPrice; holdingBars = offset; break }
  }
  const rMultiple = (exitPrice - entryPrice) / risk
  return {
    symbol: meta.symbol,
    timestamp: candles[signalIndex].timestamp,
    entryPrice,
    stopPrice,
    targetPrice,
    exitPrice,
    exitReason,
    holdingBars,
    holdingTime: holdingBars * 60,
    rMultiple,
    outcome: rMultiple > 0 ? 'Win' : rMultiple < 0 ? 'Loss' : 'Breakeven',
  }
}

export function computeMetrics(trades, costR = 0) {
  const rValues = trades.map((trade) => trade.rMultiple - costR)
  const wins = rValues.filter((value) => value > 0)
  const losses = rValues.filter((value) => value < 0)
  const grossProfit = wins.reduce((sum, value) => sum + value, 0)
  const grossLoss = Math.abs(losses.reduce((sum, value) => sum + value, 0))
  let equity = 0
  let peak = 0
  let maximumDrawdown = 0
  rValues.forEach((value) => {
    equity += value
    peak = Math.max(peak, equity)
    maximumDrawdown = Math.max(maximumDrawdown, peak - equity)
  })
  const winRate = trades.length ? wins.length / trades.length : 0
  const lossRate = trades.length ? losses.length / trades.length : 0
  const averageWinner = average(wins)
  const averageLoser = average(losses)
  return {
    tradeCount: trades.length,
    winRate,
    lossRate,
    profitFactor: grossLoss ? grossProfit / grossLoss : grossProfit ? Infinity : 0,
    expectancy: winRate * averageWinner + lossRate * averageLoser,
    averageR: average(rValues),
    medianR: median(rValues),
    totalR: rValues.reduce((sum, value) => sum + value, 0),
    maximumDrawdown,
    averageHoldingTime: average(trades.map((trade) => trade.holdingTime)),
  }
}

function periodLabelForFactory(timestamps, periodCount) {
  const periodSize = Math.ceil(timestamps.length / periodCount)
  return (timestamp) => {
    const index = timestamps.indexOf(timestamp)
    if (index < 0) return null
    return `Period ${Math.floor(index / periodSize) + 1}`
  }
}

function periodBoundsFor(timestamps, periodCount) {
  const periodSize = Math.ceil(timestamps.length / periodCount)
  return Array.from({ length: periodCount }, (_, index) => ({
    label: `Period ${index + 1}`,
    start: timestamps[index * periodSize],
    end: timestamps[Math.min((index + 1) * periodSize, timestamps.length) - 1],
  }))
}

// Full breakdown (overall, by symbol, by period, by cost tier) for an arbitrary trade set.
export function summarizeTrades(tradesBySymbol, timestamps, periodCount) {
  const allTrades = tradesBySymbol.flatMap((entry) => entry.trades)
  const periodLabelFor = periodLabelForFactory(timestamps, periodCount)
  const periods = periodBoundsFor(timestamps, periodCount).map((period) => ({
    ...period,
    metrics: computeMetrics(allTrades.filter((trade) => periodLabelFor(trade.timestamp) === period.label)),
  }))
  return {
    overall: computeMetrics(allTrades),
    bySymbol: tradesBySymbol.map((entry) => ({ symbol: entry.symbol, metrics: computeMetrics(entry.trades) })),
    byPeriod: periods,
    costTiers: costTierDefinitions.map(([label, costR]) => ({ label, costR, metrics: computeMetrics(allTrades, costR) })),
    trades: allTrades,
  }
}

/** Builds, per symbol, a per-candle catalogue of score/status/component flags and RV confirmation. */
export function buildCatalogueBySymbol(aligned, options) {
  const symbols = Object.keys(aligned.raw)
  const catalogueBySymbol = {}
  symbols.forEach((symbol) => {
    const peerSymbols = symbols.filter((other) => other !== symbol)
    const raw = aligned.raw[symbol]
    const enriched = aligned.enriched[symbol]
    const peerRawList = peerSymbols.map((other) => aligned.raw[other])
    const confirmation = computeRelativeStrengthConfirmation(raw, peerRawList, options.lookback)
    const scoreByTimestamp = new Map(scanSetups(enriched).map((signal) => [signal.timestamp, signal]))
    catalogueBySymbol[symbol] = enriched.map((candle, index) => {
      const signal = scoreByTimestamp.get(candle.timestamp)
      const componentFlags = {}
      componentDefinitions.forEach((component) => {
        componentFlags[component.key] = component.key === 'rvConfirmation'
          ? Boolean(confirmation[index]?.confirmed)
          : Boolean(component.test(candle))
      })
      return { index, timestamp: candle.timestamp, score: signal?.score ?? 0, status: signal?.status ?? 'No Setup', components: componentFlags }
    })
  })
  return catalogueBySymbol
}

/** Runs the full Experiment #2 battery: score buckets, per-component independent/conditional tests, and decomposition. */
export function runSignalQualityResearch(rawSeriesBySymbol, settings = {}) {
  const options = { ...signalQualityDefaults, ...settings }
  const aligned = buildAlignedSeries(rawSeriesBySymbol)
  const symbols = Object.keys(aligned.raw)
  const catalogueBySymbol = buildCatalogueBySymbol(aligned, options)
  const timestamps = aligned.timestamps

  // Score buckets — same score-based membership rule as the existing baseline (no edge-triggering).
  const scoreBuckets = scoreBucketDefinitions.map(([label, min, max]) => {
    const tradesBySymbol = symbols.map((symbol) => {
      const trades = catalogueBySymbol[symbol]
        .filter((entry) => entry.score >= min && entry.score <= max && entry.status === 'Bullish')
        .map((entry) => buildTradeFromIndex(aligned.raw[symbol], entry.index, options, { symbol }))
        .filter(Boolean)
      return { symbol, trades }
    })
    const summary = summarizeTrades(tradesBySymbol, timestamps, options.periodCount)
    return { label, min, max, ...summary }
  })

  // Components — A) independent (edge-triggered on the component alone) and B) conditional on the existing 75+ baseline.
  const components = componentDefinitions.map((component) => {
    const independentBySymbol = symbols.map((symbol) => {
      const catalogue = catalogueBySymbol[symbol]
      const trades = []
      for (let index = 1; index < catalogue.length - 1; index += 1) {
        if (catalogue[index].components[component.key] && !catalogue[index - 1].components[component.key]) {
          const trade = buildTradeFromIndex(aligned.raw[symbol], index, options, { symbol })
          if (trade) trades.push(trade)
        }
      }
      return { symbol, trades }
    })
    const conditionalBySymbol = symbols.map((symbol) => {
      const catalogue = catalogueBySymbol[symbol]
      const trades = catalogue
        .filter((entry) => entry.score >= options.minimumScore && entry.status === 'Bullish' && entry.components[component.key])
        .map((entry) => buildTradeFromIndex(aligned.raw[symbol], entry.index, options, { symbol }))
        .filter(Boolean)
      return { symbol, trades }
    })
    return {
      key: component.key,
      label: component.label,
      independent: summarizeTrades(independentBySymbol, timestamps, options.periodCount),
      conditional: summarizeTrades(conditionalBySymbol, timestamps, options.periodCount),
    }
  })

  // Decomposition: among the existing 75+ baseline signals, present vs. absent per component.
  const decomposition = componentDefinitions.map((component) => {
    const presentBySymbol = symbols.map((symbol) => {
      const catalogue = catalogueBySymbol[symbol]
      const trades = catalogue
        .filter((entry) => entry.score >= options.minimumScore && entry.status === 'Bullish' && entry.components[component.key])
        .map((entry) => buildTradeFromIndex(aligned.raw[symbol], entry.index, options, { symbol }))
        .filter(Boolean)
      return { symbol, trades }
    })
    const absentBySymbol = symbols.map((symbol) => {
      const catalogue = catalogueBySymbol[symbol]
      const trades = catalogue
        .filter((entry) => entry.score >= options.minimumScore && entry.status === 'Bullish' && !entry.components[component.key])
        .map((entry) => buildTradeFromIndex(aligned.raw[symbol], entry.index, options, { symbol }))
        .filter(Boolean)
      return { symbol, trades }
    })
    const present = summarizeTrades(presentBySymbol, timestamps, options.periodCount)
    const absent = summarizeTrades(absentBySymbol, timestamps, options.periodCount)
    const contributionR = present.overall.averageR - absent.overall.averageR
    const classification = present.overall.tradeCount === 0 || absent.overall.tradeCount === 0
      ? 'insufficient-data'
      : contributionR < 0
        ? 'negative'
        : Math.abs(contributionR) < options.negligibleThresholdR
          ? 'negligible'
          : 'positive'
    return { key: component.key, label: component.label, present, absent, contributionR, classification }
  })

  return { aligned, options, scoreBuckets, components, decomposition }
}

/** Descriptive check: do higher score buckets actually show better average-R / win-rate trends? */
export function assessScoreMonotonicity(scoreBuckets) {
  const points = scoreBuckets
    .map((bucket, index) => ({ index, averageR: bucket.overall.averageR, winRate: bucket.overall.winRate, tradeCount: bucket.overall.tradeCount }))
    .filter((point) => point.tradeCount > 0)
  if (points.length < 2) return { evaluable: false }
  const correlationFor = (key) => {
    const xs = points.map((point) => point.index)
    const ys = points.map((point) => point[key])
    const meanX = average(xs)
    const meanY = average(ys)
    const covariance = xs.reduce((sum, x, i) => sum + (x - meanX) * (ys[i] - meanY), 0)
    const stdX = Math.sqrt(xs.reduce((sum, x) => sum + (x - meanX) ** 2, 0))
    const stdY = Math.sqrt(ys.reduce((sum, y) => sum + (y - meanY) ** 2, 0))
    return stdX && stdY ? covariance / (stdX * stdY) : 0
  }
  const averageRCorrelation = correlationFor('averageR')
  const winRateCorrelation = correlationFor('winRate')
  let increasingSteps = 0
  for (let i = 1; i < points.length; i += 1) if (points[i].averageR >= points[i - 1].averageR) increasingSteps += 1
  return {
    evaluable: true,
    averageRCorrelation,
    winRateCorrelation,
    monotonicIncreasing: increasingSteps === points.length - 1,
    increasingStepFraction: increasingSteps / (points.length - 1),
  }
}
