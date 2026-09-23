// Research Experiment #6 — Walk-Forward Regime Validation.
// Tests whether Experiment #5's descriptive volatility-regime pattern would have remained
// observable when evaluated sequentially, using only information available before each test
// period. The scanner itself is completely frozen — this module only classifies already-frozen
// baseline/RV-confirmed trades into regimes whose boundaries were fixed from training data alone.
// Research only — does not modify production scoring, paper trading, the Render worker, or
// Supabase. No scanner parameters, scoring weights, or thresholds are changed.
import {
  signalQualityDefaults,
  scoreBucketDefinitions,
  buildAlignedSeries,
  buildCatalogueBySymbol,
  buildTradeFromIndex,
  summarizeTrades,
  assessScoreMonotonicity,
} from './signalQualityBacktest.js'

export const walkForwardDefaults = {
  ...signalQualityDefaults,
  smallSampleThreshold: 30,
  // Minimum number of training-period realizedVol20 observations required before that window's
  // tercile boundaries are considered valid (otherwise every test bar in the window classifies as
  // 'Insufficient-Training-History').
  volatilityTrainingWarmup: 60,
}

export const walkForwardWindows = [
  { label: 'Window 1', testYear: 2023, trainStart: '2022-01-01T00:00:00Z', trainEnd: '2022-12-31T23:59:59Z', testStart: '2023-01-01T00:00:00Z', testEnd: '2023-12-31T23:59:59Z' },
  { label: 'Window 2', testYear: 2024, trainStart: '2022-01-01T00:00:00Z', trainEnd: '2023-12-31T23:59:59Z', testStart: '2024-01-01T00:00:00Z', testEnd: '2024-12-31T23:59:59Z' },
  { label: 'Window 3', testYear: 2025, trainStart: '2022-01-01T00:00:00Z', trainEnd: '2024-12-31T23:59:59Z', testStart: '2025-01-01T00:00:00Z', testEnd: '2025-12-31T23:59:59Z' },
  { label: 'Window 4', testYear: '2026 YTD', trainStart: '2022-01-01T00:00:00Z', trainEnd: '2025-12-31T23:59:59Z', testStart: '2026-01-01T00:00:00Z', testEnd: '2026-12-31T23:59:59Z' },
]

export const volatilityLabels = ['Low', 'Medium', 'High']

const average = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0)
function median(values) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

// --- Causal building block, self-contained so Experiment #5's file is never touched. ---
function trailingRealizedVolatility(closes, index, period) {
  if (index < period) return null
  const returns = []
  for (let i = index - period + 1; i <= index; i += 1) returns.push((closes[i] - closes[i - 1]) / closes[i - 1])
  const mean = average(returns)
  const variance = average(returns.map((value) => (value - mean) ** 2))
  return Math.sqrt(variance)
}

/** Realized 20-bar volatility for every bar of one symbol's raw candle series — trailing only, no future data. */
export function buildRealizedVol20Series(rawCandles) {
  const closes = rawCandles.map((candle) => candle.close)
  return closes.map((_, index) => trailingRealizedVolatility(closes, index, 20))
}

/** Fixed tercile boundaries computed ONLY from the values passed in (the training-period sample). */
export function computeTercileBoundaries(trainingValues) {
  const sorted = [...trainingValues].sort((a, b) => a - b)
  const sampleSize = sorted.length
  if (!sampleSize) return { lowMediumBoundary: null, mediumHighBoundary: null, sampleSize: 0 }
  const at = (fraction) => sorted[Math.min(sampleSize - 1, Math.max(0, Math.floor(fraction * (sampleSize - 1))))]
  return { lowMediumBoundary: at(1 / 3), mediumHighBoundary: at(2 / 3), sampleSize }
}

/** Classifies a single (already-computed, causal) volatility value against frozen training-period boundaries. */
export function classifyVolatility(value, boundaries, warmup) {
  if (value === null || !boundaries || boundaries.sampleSize < warmup) return 'Insufficient-Training-History'
  if (value <= boundaries.lowMediumBoundary) return 'Low'
  if (value <= boundaries.mediumHighBoundary) return 'Medium'
  return 'High'
}

function indicesWithinRange(timestamps, start, end) {
  const startTime = new Date(start).getTime()
  const endTime = new Date(end).getTime()
  const indices = []
  timestamps.forEach((timestamp, index) => {
    const time = new Date(timestamp).getTime()
    if (time >= startTime && time <= endTime) indices.push(index)
  })
  return indices
}

function flagged(summary, threshold) {
  return { smallSample: summary.overall.tradeCount < threshold, ...summary }
}

function monotonicityIfSufficient(buckets, threshold) {
  const sufficientBucketCount = buckets.filter((bucket) => bucket.overall.tradeCount >= threshold).length
  if (sufficientBucketCount < 2) return { evaluable: false, reason: 'insufficient-sample' }
  return assessScoreMonotonicity(buckets)
}

/**
 * Runs the chronological walk-forward volatility-regime validation described in Experiment #6.
 * For each window: (1) computes tercile volatility boundaries using ONLY that window's training
 * timestamps, (2) freezes those boundaries, (3) classifies every bar of that window's test period
 * against the frozen boundaries, (4) reports the existing frozen baseline / RV-confirmed strategy
 * broken down by that classification. Nothing about the scanner itself is changed.
 */

/**
 * Shared building block (reused by Experiment #7): aligns the data, builds the frozen catalogue,
 * and computes each walk-forward window's training-only volatility boundaries plus the frozen
 * test-period classification for every bar. Exposed so downstream research (e.g. volatility-aware
 * strategy variants) can reuse the exact same causal windows/boundaries without recomputation.
 */
export function computeWalkForwardWindows(rawSeriesBySymbol, options) {
  const aligned = buildAlignedSeries(rawSeriesBySymbol)
  const catalogueBySymbol = buildCatalogueBySymbol(aligned, options)
  const symbols = Object.keys(aligned.raw)
  const primary = symbols.includes('SPY') ? 'SPY' : symbols[0]
  const timestamps = aligned.timestamps
  const realizedVol20 = buildRealizedVol20Series(aligned.raw[primary])

  const windows = walkForwardWindows.map((windowDef) => {
    const trainIndices = indicesWithinRange(timestamps, windowDef.trainStart, windowDef.trainEnd)
    const testIndices = indicesWithinRange(timestamps, windowDef.testStart, windowDef.testEnd)
    const trainingVolValues = trainIndices.map((index) => realizedVol20[index]).filter((value) => value !== null)
    const boundaries = computeTercileBoundaries(trainingVolValues)
    const testRegimeByIndex = new Map()
    testIndices.forEach((index) => {
      testRegimeByIndex.set(index, classifyVolatility(realizedVol20[index], boundaries, options.volatilityTrainingWarmup))
    })
    return {
      ...windowDef,
      trainIndices,
      testIndices,
      boundaries,
      testRegimeByIndex,
      trainRealizedStart: trainIndices.length ? timestamps[trainIndices[0]] : null,
      trainRealizedEnd: trainIndices.length ? timestamps[trainIndices.at(-1)] : null,
      testRealizedStart: testIndices.length ? timestamps[testIndices[0]] : null,
      testRealizedEnd: testIndices.length ? timestamps[testIndices.at(-1)] : null,
      trainCandleCount: trainIndices.length,
      testCandleCount: testIndices.length,
    }
  })

  return { aligned, catalogueBySymbol, symbols, timestamps, realizedVol20, windows }
}

export function runWalkForwardRegimeResearch(rawSeriesBySymbol, settings = {}) {
  const options = { ...walkForwardDefaults, ...settings }
  const { aligned, catalogueBySymbol, symbols, timestamps, windows: builtWindows } = computeWalkForwardWindows(rawSeriesBySymbol, options)

  const baselinePredicate = (entry) => entry.score >= options.minimumScore && entry.status === 'Bullish'
  const rvConfirmedPredicate = (entry) => baselinePredicate(entry) && entry.components.rvConfirmation

  function summarizeForPredicate(predicate) {
    const tradesBySymbol = symbols.map((symbol) => {
      const trades = catalogueBySymbol[symbol]
        .filter(predicate)
        .map((entry) => buildTradeFromIndex(aligned.raw[symbol], entry.index, options, { symbol }))
        .filter(Boolean)
      return { symbol, trades }
    })
    return summarizeTrades(tradesBySymbol, timestamps, 1)
  }

  const globalTestRegimeByTimestamp = new Map()

  const windows = builtWindows.map((windowEntry) => {
    const { boundaries, testRegimeByIndex, testIndices } = windowEntry
    testIndices.forEach((index) => globalTestRegimeByTimestamp.set(timestamps[index], testRegimeByIndex.get(index)))
    const testTimestampSet = new Set(testIndices.map((index) => timestamps[index]))
    const regimeOfEntry = (entry) => testRegimeByIndex.get(entry.index) ?? null

    const baseline = summarizeForPredicate((entry) => testTimestampSet.has(entry.timestamp) && baselinePredicate(entry))
    const rvConfirmed = summarizeForPredicate((entry) => testTimestampSet.has(entry.timestamp) && rvConfirmedPredicate(entry))

    const volatilityGroups = volatilityLabels.map((label) => ({
      label,
      baseline: flagged(summarizeForPredicate((entry) => testTimestampSet.has(entry.timestamp) && baselinePredicate(entry) && regimeOfEntry(entry) === label), options.smallSampleThreshold),
      rvConfirmed: flagged(summarizeForPredicate((entry) => testTimestampSet.has(entry.timestamp) && rvConfirmedPredicate(entry) && regimeOfEntry(entry) === label), options.smallSampleThreshold),
    }))

    const scoreByVolatility = volatilityLabels.map((volatilityLabel) => {
      const buckets = scoreBucketDefinitions.map(([bucketLabel, min, max]) => {
        const summary = summarizeForPredicate((entry) => testTimestampSet.has(entry.timestamp) && entry.score >= min && entry.score <= max && entry.status === 'Bullish' && regimeOfEntry(entry) === volatilityLabel)
        return { label: bucketLabel, min, max, smallSample: summary.overall.tradeCount < options.smallSampleThreshold, ...summary }
      })
      return { volatilityLabel, buckets, monotonicity: monotonicityIfSufficient(buckets, options.smallSampleThreshold) }
    })

    return {
      label: windowEntry.label,
      testYear: windowEntry.testYear,
      trainStart: windowEntry.trainStart,
      trainEnd: windowEntry.trainEnd,
      testStart: windowEntry.testStart,
      testEnd: windowEntry.testEnd,
      trainRealizedStart: windowEntry.trainRealizedStart,
      trainRealizedEnd: windowEntry.trainRealizedEnd,
      testRealizedStart: windowEntry.testRealizedStart,
      testRealizedEnd: windowEntry.testRealizedEnd,
      trainCandleCount: windowEntry.trainCandleCount,
      testCandleCount: windowEntry.testCandleCount,
      boundaries,
      baseline,
      rvConfirmed,
      volatilityGroups,
      scoreByVolatility,
    }
  })

  // Part C (pooled) / Part D: pool every test period's trades by regime, using each window's own frozen boundaries.
  const pooledVolatilityGroups = volatilityLabels.map((label) => ({
    label,
    baseline: flagged(summarizeForPredicate((entry) => baselinePredicate(entry) && globalTestRegimeByTimestamp.get(entry.timestamp) === label), options.smallSampleThreshold),
    rvConfirmed: flagged(summarizeForPredicate((entry) => rvConfirmedPredicate(entry) && globalTestRegimeByTimestamp.get(entry.timestamp) === label), options.smallSampleThreshold),
  }))

  const evidenceTable = windows.map((windowEntry) => ({
    testYear: windowEntry.testYear,
    low: windowEntry.volatilityGroups.find((g) => g.label === 'Low').baseline.overall,
    medium: windowEntry.volatilityGroups.find((g) => g.label === 'Medium').baseline.overall,
    high: windowEntry.volatilityGroups.find((g) => g.label === 'High').baseline.overall,
  }))

  const highExpectancies = evidenceTable.map((row) => row.high.expectancy)
  const mediumExpectancies = evidenceTable.map((row) => row.medium.expectancy)
  const lowExpectancies = evidenceTable.map((row) => row.low.expectancy)
  const criticalTest = {
    highVolatilityPositiveCount: evidenceTable.filter((row) => row.high.tradeCount > 0 && row.high.expectancy > 0).length,
    highVolatilityNegativeCount: evidenceTable.filter((row) => row.high.tradeCount > 0 && row.high.expectancy < 0).length,
    mediumExceedsLowCount: evidenceTable.filter((row) => row.medium.expectancy > row.low.expectancy).length,
    lowExceedsMediumCount: evidenceTable.filter((row) => row.low.expectancy > row.medium.expectancy).length,
    averageHighVolatilityExpectancy: average(highExpectancies),
    averageMediumVolatilityExpectancy: average(mediumExpectancies),
    averageLowVolatilityExpectancy: average(lowExpectancies),
    medianHighVolatilityExpectancy: median(highExpectancies),
    medianMediumVolatilityExpectancy: median(mediumExpectancies),
    medianLowVolatilityExpectancy: median(lowExpectancies),
  }

  const combinedBaseline = summarizeForPredicate(baselinePredicate)
  const combinedRvConfirmed = summarizeForPredicate(rvConfirmedPredicate)

  return {
    aligned,
    options,
    windows,
    pooledVolatilityGroups,
    evidenceTable,
    criticalTest,
    combinedBaseline,
    combinedRvConfirmed,
  }
}
