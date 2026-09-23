// Research Experiment #5 — Causal Market-Regime Classification.
// Determines whether Experiment #4's calendar-year differences can instead be described using
// causal market-state variables known at the time of each signal (trend, volatility, breadth),
// rather than year labels. Reuses Experiment #2's per-candle catalogue (score/status/component
// flags, including the Experiment #1 relative-value confirmation) and trade-construction
// conventions unchanged. Research only — does not modify production scoring, paper trading, the
// Render worker, or Supabase. No scanner parameters or scoring weights are changed or optimized.
import {
  signalQualityDefaults,
  scoreBucketDefinitions,
  buildAlignedSeries,
  buildCatalogueBySymbol,
  buildTradeFromIndex,
  summarizeTrades,
  assessScoreMonotonicity,
} from './signalQualityBacktest.js'
import { groupTimestampsByYear } from './yearlyRegimeBacktest.js'

export const causalRegimeDefaults = {
  ...signalQualityDefaults,
  smallSampleThreshold: 30,
  // Minimum number of prior expanding-window volatility observations required before a bar is
  // classified into a volatility tercile at all (otherwise 'Insufficient-History').
  volatilityHistoryWarmup: 60,
  trendSlopeLookback: 10,
}

const average = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0)

export const trendLabels = ['Uptrend', 'Mixed', 'Downtrend']
export const volatilityLabels = ['Low', 'Medium', 'High']
export const breadthLabels = ['Strong', 'Mixed', 'Weak']

const trendVolatilityCombos = [
  ['Uptrend', 'Low'], ['Uptrend', 'Medium'], ['Uptrend', 'High'],
  ['Downtrend', 'Low'], ['Downtrend', 'Medium'], ['Downtrend', 'High'],
]
const trendBreadthCombos = [
  ['Uptrend', 'Strong'], ['Uptrend', 'Weak'], ['Downtrend', 'Strong'], ['Downtrend', 'Weak'],
]

// --- Causal building blocks: every function only ever reads index (index - period + 1) .. index. ---

function trailingSma(closes, index, period) {
  if (index < period - 1) return null
  let sum = 0
  for (let i = index - period + 1; i <= index; i += 1) sum += closes[i]
  return sum / period
}

function trailingReturn(closes, index, period) {
  if (index < period) return null
  const past = closes[index - period]
  return past ? (closes[index] - past) / past : null
}

function trueRange(candles, index) {
  if (index < 1) return candles[index].high - candles[index].low
  const previousClose = candles[index - 1].close
  return Math.max(candles[index].high - candles[index].low, Math.abs(candles[index].high - previousClose), Math.abs(candles[index].low - previousClose))
}

function trailingAtr(candles, index, period) {
  if (index < period) return null
  let sum = 0
  for (let i = index - period + 1; i <= index; i += 1) sum += trueRange(candles, i)
  return sum / period
}

function trailingRealizedVolatility(closes, index, period) {
  if (index < period) return null
  const returns = []
  for (let i = index - period + 1; i <= index; i += 1) returns.push((closes[i] - closes[i - 1]) / closes[i - 1])
  const mean = average(returns)
  const variance = average(returns.map((value) => (value - mean) ** 2))
  return Math.sqrt(variance)
}

/**
 * Builds, index-by-index, the causal (no-look-ahead) market-state variables described in Part A,
 * and the fixed descriptive regime classifications from Part B. Volatility terciles are computed
 * from an *expanding* history of the volatility series: at index i, the percentile rank of
 * realizedVol20[i] is computed only against realizedVol20[0..i] (values observed at or before the
 * current bar) — never against later observations. Terciles: rank<=1/3 Low, <=2/3 Medium, else High.
 */
export function computeCausalRegimeSeries(alignedRaw, options = causalRegimeDefaults) {
  const symbols = Object.keys(alignedRaw)
  const primary = symbols.includes('SPY') ? 'SPY' : symbols[0]
  const closesBySymbol = {}
  const sma50BySymbol = {}
  const return20BySymbol = {}
  symbols.forEach((symbol) => {
    closesBySymbol[symbol] = alignedRaw[symbol].map((candle) => candle.close)
    sma50BySymbol[symbol] = closesBySymbol[symbol].map((_, index) => trailingSma(closesBySymbol[symbol], index, 50))
    return20BySymbol[symbol] = closesBySymbol[symbol].map((_, index) => trailingReturn(closesBySymbol[symbol], index, 20))
  })

  const primaryCandles = alignedRaw[primary]
  const primaryCloses = closesBySymbol[primary]
  const n = primaryCloses.length
  const sma50 = sma50BySymbol[primary]
  const sma200 = primaryCloses.map((_, index) => trailingSma(primaryCloses, index, 200))
  const return20 = return20BySymbol[primary]
  const return50 = primaryCloses.map((_, index) => trailingReturn(primaryCloses, index, 50))
  const atrPercent = primaryCandles.map((candle, index) => {
    const value = trailingAtr(primaryCandles, index, 14)
    return value === null ? null : value / candle.close
  })
  const realizedVol20 = primaryCloses.map((_, index) => trailingRealizedVolatility(primaryCloses, index, 20))
  const realizedVol50 = primaryCloses.map((_, index) => trailingRealizedVolatility(primaryCloses, index, 50))

  const regimeByIndex = new Array(n)
  const expandingVolHistory = []

  for (let index = 0; index < n; index += 1) {
    const slope = (sma50[index] !== null && index >= options.trendSlopeLookback && sma50[index - options.trendSlopeLookback] !== null)
      ? sma50[index] - sma50[index - options.trendSlopeLookback]
      : null
    const aboveSma50 = sma50[index] !== null ? primaryCloses[index] > sma50[index] : null
    const aboveSma200 = sma200[index] !== null ? primaryCloses[index] > sma200[index] : null

    let trendClassification = 'Insufficient-History'
    if (aboveSma50 !== null && slope !== null) {
      if (aboveSma50 && slope > 0) trendClassification = 'Uptrend'
      else if (!aboveSma50 && slope < 0) trendClassification = 'Downtrend'
      else trendClassification = 'Mixed'
    }

    let countAboveSma50 = 0
    let countPositive20BarReturn = 0
    let breadthValid = true
    const returns20 = []
    symbols.forEach((symbol) => {
      const above = sma50BySymbol[symbol][index] !== null ? closesBySymbol[symbol][index] > sma50BySymbol[symbol][index] : null
      if (above === null) breadthValid = false
      else if (above) countAboveSma50 += 1
      const r20 = return20BySymbol[symbol][index]
      if (r20 === null) breadthValid = false
      else {
        returns20.push(r20)
        if (r20 > 0) countPositive20BarReturn += 1
      }
    })
    let breadthClassification = 'Insufficient-History'
    if (breadthValid) {
      breadthClassification = countAboveSma50 === symbols.length ? 'Strong' : countAboveSma50 === 0 ? 'Weak' : 'Mixed'
    }
    const averageReturn20 = breadthValid ? average(returns20) : null
    const dispersion20 = breadthValid ? Math.max(...returns20) - Math.min(...returns20) : null

    const currentVol = realizedVol20[index]
    let volatilityClassification = 'Insufficient-History'
    let percentileRank = null
    if (currentVol !== null) {
      expandingVolHistory.push(currentVol)
      if (expandingVolHistory.length >= options.volatilityHistoryWarmup) {
        const countLessOrEqual = expandingVolHistory.reduce((count, value) => count + (value <= currentVol ? 1 : 0), 0)
        percentileRank = countLessOrEqual / expandingVolHistory.length
        volatilityClassification = percentileRank <= 1 / 3 ? 'Low' : percentileRank <= 2 / 3 ? 'Medium' : 'High'
      }
    }

    regimeByIndex[index] = {
      index,
      timestamp: primaryCandles[index].timestamp,
      trend: { sma50: sma50[index], sma200: sma200[index], slope, return20: return20[index], return50: return50[index], aboveSma50, aboveSma200, classification: trendClassification },
      volatility: { atrPercent: atrPercent[index], realizedVol20: realizedVol20[index], realizedVol50: realizedVol50[index], percentileRank, classification: volatilityClassification },
      breadth: { countAboveSma50: breadthValid ? countAboveSma50 : null, countPositive20BarReturn: breadthValid ? countPositive20BarReturn : null, averageReturn20, dispersion20, classification: breadthClassification },
    }
  }

  return regimeByIndex
}

function buildTradesBySymbol(catalogueBySymbol, alignedRaw, predicate, options) {
  return Object.keys(catalogueBySymbol).map((symbol) => {
    const trades = catalogueBySymbol[symbol]
      .filter(predicate)
      .map((entry) => buildTradeFromIndex(alignedRaw[symbol], entry.index, options, { symbol }))
      .filter(Boolean)
    return { symbol, trades }
  })
}

/**
 * Runs the frozen baseline strategy and the Experiment #1 RV-confirmed variant against every
 * predefined causal regime classification (trend, volatility, breadth), predefined combined
 * regime states, per-year regime composition, per-regime score-bucket stability, and per-regime
 * execution-cost tiers. All classifications are fixed/predefined (Part B) — none are searched or
 * optimized for historical performance.
 */
export function runCausalRegimeResearch(rawSeriesBySymbol, settings = {}) {
  const options = { ...causalRegimeDefaults, ...settings }
  const aligned = buildAlignedSeries(rawSeriesBySymbol)
  const catalogueBySymbol = buildCatalogueBySymbol(aligned, options)
  const regimeByIndex = computeCausalRegimeSeries(aligned.raw, options)
  const symbols = Object.keys(aligned.raw)

  const baselinePredicate = (entry) => entry.score >= options.minimumScore && entry.status === 'Bullish'
  const rvConfirmedPredicate = (entry) => baselinePredicate(entry) && entry.components.rvConfirmation
  const regimeOf = (entry) => regimeByIndex[entry.index]

  function summarizeForPredicate(predicate) {
    const tradesBySymbol = buildTradesBySymbol(catalogueBySymbol, aligned.raw, predicate, options)
    return summarizeTrades(tradesBySymbol, aligned.timestamps, 1)
  }
  function flagged(summary) {
    return { smallSample: summary.overall.tradeCount < options.smallSampleThreshold, ...summary }
  }

  const trendGroups = trendLabels.map((label) => ({
    label,
    baseline: flagged(summarizeForPredicate((entry) => baselinePredicate(entry) && regimeOf(entry).trend.classification === label)),
  }))
  const volatilityGroups = volatilityLabels.map((label) => ({
    label,
    baseline: flagged(summarizeForPredicate((entry) => baselinePredicate(entry) && regimeOf(entry).volatility.classification === label)),
  }))
  const breadthGroups = breadthLabels.map((label) => ({
    label,
    baseline: flagged(summarizeForPredicate((entry) => baselinePredicate(entry) && regimeOf(entry).breadth.classification === label)),
  }))

  const combinedTrendVolatility = trendVolatilityCombos.map(([trend, volatility]) => ({
    label: `${trend} + ${volatility} volatility`,
    baseline: flagged(summarizeForPredicate((entry) => baselinePredicate(entry) && regimeOf(entry).trend.classification === trend && regimeOf(entry).volatility.classification === volatility)),
  }))
  const combinedTrendBreadth = trendBreadthCombos.map(([trend, breadth]) => ({
    label: `${trend} + ${breadth} breadth`,
    baseline: flagged(summarizeForPredicate((entry) => baselinePredicate(entry) && regimeOf(entry).trend.classification === trend && regimeOf(entry).breadth.classification === breadth)),
  }))

  const yearGroups = groupTimestampsByYear(aligned.timestamps)
  // Only count entries that actually produce a constructible trade (matches combinedBaseline's
  // trade count exactly) — a baseline-qualifying signal on the very last candle has no following
  // candle to enter on and is excluded from trade counts everywhere else in this module too.
  const yearRegimeDistribution = yearGroups.map(({ year, timestamps }) => {
    const yearSet = new Set(timestamps)
    const entries = symbols.flatMap((symbol) => catalogueBySymbol[symbol].filter((entry) => yearSet.has(entry.timestamp) && baselinePredicate(entry) && buildTradeFromIndex(aligned.raw[symbol], entry.index, options, { symbol })))
    const total = entries.length
    const distributionFor = (dimension, labels) => {
      const counts = Object.fromEntries(labels.map((label) => [label, 0]))
      let insufficientHistoryCount = 0
      entries.forEach((entry) => {
        const classification = regimeOf(entry)[dimension].classification
        if (classification in counts) counts[classification] += 1
        else insufficientHistoryCount += 1
      })
      const percentages = Object.fromEntries(labels.map((label) => [label, total ? counts[label] / total : 0]))
      return { counts, percentages, insufficientHistoryCount }
    }
    return {
      year,
      totalBaselineTrades: total,
      trend: distributionFor('trend', trendLabels),
      volatility: distributionFor('volatility', volatilityLabels),
      breadth: distributionFor('breadth', breadthLabels),
    }
  })

  function bucketsForPredicate(basePredicate) {
    return scoreBucketDefinitions.map(([label, min, max]) => {
      const summary = summarizeForPredicate((entry) => basePredicate(entry) && entry.score >= min && entry.score <= max && entry.status === 'Bullish')
      return { label, min, max, smallSample: summary.overall.tradeCount < options.smallSampleThreshold, ...summary }
    })
  }
  function monotonicityIfSufficient(buckets) {
    const sufficientBucketCount = buckets.filter((bucket) => bucket.overall.tradeCount >= options.smallSampleThreshold).length
    if (sufficientBucketCount < 2) return { evaluable: false, reason: 'insufficient-sample' }
    return assessScoreMonotonicity(buckets)
  }

  const majorRegimes = [
    ...trendLabels.map((label) => ({ dimension: 'trend', label, predicate: (entry) => regimeOf(entry).trend.classification === label })),
    ...volatilityLabels.map((label) => ({ dimension: 'volatility', label, predicate: (entry) => regimeOf(entry).volatility.classification === label })),
    ...breadthLabels.map((label) => ({ dimension: 'breadth', label, predicate: (entry) => regimeOf(entry).breadth.classification === label })),
  ]

  const scoreByRegime = majorRegimes.map(({ dimension, label, predicate }) => {
    const buckets = bucketsForPredicate(predicate)
    return { dimension, label, buckets, monotonicity: monotonicityIfSufficient(buckets) }
  })

  const rvByRegime = [
    ...trendLabels.map((label) => ({
      dimension: 'trend',
      label,
      baseline: summarizeForPredicate((entry) => baselinePredicate(entry) && regimeOf(entry).trend.classification === label),
      rvConfirmed: summarizeForPredicate((entry) => rvConfirmedPredicate(entry) && regimeOf(entry).trend.classification === label),
    })),
    ...volatilityLabels.map((label) => ({
      dimension: 'volatility',
      label,
      baseline: summarizeForPredicate((entry) => baselinePredicate(entry) && regimeOf(entry).volatility.classification === label),
      rvConfirmed: summarizeForPredicate((entry) => rvConfirmedPredicate(entry) && regimeOf(entry).volatility.classification === label),
    })),
  ]

  const costByRegime = majorRegimes.map(({ dimension, label, predicate }) => ({
    dimension,
    label,
    baseline: summarizeForPredicate((entry) => baselinePredicate(entry) && predicate(entry)),
    rvConfirmed: summarizeForPredicate((entry) => rvConfirmedPredicate(entry) && predicate(entry)),
  }))

  const combinedBaseline = summarizeForPredicate(baselinePredicate)
  const combinedRvConfirmed = summarizeForPredicate(rvConfirmedPredicate)

  return {
    aligned,
    options,
    regimeByIndex,
    trendGroups,
    volatilityGroups,
    breadthGroups,
    combinedTrendVolatility,
    combinedTrendBreadth,
    yearRegimeDistribution,
    scoreByRegime,
    rvByRegime,
    costByRegime,
    combinedBaseline,
    combinedRvConfirmed,
  }
}
