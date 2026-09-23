// Research Experiment #3A — Frozen Score Holdout.
// Tests whether the existing, unmodified SetupScan score/threshold relationship survives on a
// genuinely held-out historical window. No scoring weights are changed or optimized here.
// Reuses Experiment #2's catalogue (score, status, and component flags including the
// Experiment #1 relative-value confirmation) and trade-construction conventions unchanged.
import {
  signalQualityDefaults,
  scoreBucketDefinitions,
  buildAlignedSeries,
  buildCatalogueBySymbol,
  summarizeTrades,
  buildTradeFromIndex,
  assessScoreMonotonicity,
} from './signalQualityBacktest.js'

export const frozenScoreHoldoutDefaults = {
  ...signalQualityDefaults,
  // Previously-unseen older window used by Experiment #1's robustness research.
  holdoutStart: '2022-01-01T00:00:00Z',
  holdoutEnd: '2024-12-31T23:59:59Z',
}

function splitTimestamps(timestamps, holdoutStart, holdoutEnd) {
  const startTime = new Date(holdoutStart).getTime()
  const endTime = new Date(holdoutEnd).getTime()
  const holdout = []
  const development = []
  timestamps.forEach((timestamp) => {
    const time = new Date(timestamp).getTime()
    if (time >= startTime && time <= endTime) holdout.push(timestamp)
    else if (time > endTime) development.push(timestamp)
  })
  return { holdout, development }
}

function buildBucketsForSplit(catalogueBySymbol, alignedRaw, splitTimestampSet, splitTimestampList, options) {
  return scoreBucketDefinitions.map(([label, min, max]) => {
    const tradesBySymbol = Object.keys(catalogueBySymbol).map((symbol) => {
      const trades = catalogueBySymbol[symbol]
        .filter((entry) => splitTimestampSet.has(entry.timestamp) && entry.score >= min && entry.score <= max && entry.status === 'Bullish')
        .map((entry) => buildTradeFromIndex(alignedRaw[symbol], entry.index, options, { symbol }))
        .filter(Boolean)
      return { symbol, trades }
    })
    return { label, min, max, ...summarizeTrades(tradesBySymbol, splitTimestampList, options.periodCount) }
  })
}

function buildVariantForSplit(catalogueBySymbol, alignedRaw, splitTimestampSet, splitTimestampList, options, predicate) {
  const tradesBySymbol = Object.keys(catalogueBySymbol).map((symbol) => {
    const trades = catalogueBySymbol[symbol]
      .filter((entry) => splitTimestampSet.has(entry.timestamp) && predicate(entry))
      .map((entry) => buildTradeFromIndex(alignedRaw[symbol], entry.index, options, { symbol }))
      .filter(Boolean)
    return { symbol, trades }
  })
  return summarizeTrades(tradesBySymbol, splitTimestampList, options.periodCount)
}

/**
 * Splits the synchronized SPY/QQQ/IWM timeline into a holdout window (default: the
 * previously-unseen 2022-2024 period) and a development window (everything outside it),
 * then re-runs the existing frozen scoring formula and the Experiment #1 RV-confirmed
 * variant on each split independently. No scoring weights are changed.
 */
export function runFrozenScoreHoldoutResearch(rawSeriesBySymbol, settings = {}) {
  const options = { ...frozenScoreHoldoutDefaults, ...settings }
  const aligned = buildAlignedSeries(rawSeriesBySymbol)
  const catalogueBySymbol = buildCatalogueBySymbol(aligned, options)
  const { holdout, development } = splitTimestamps(aligned.timestamps, options.holdoutStart, options.holdoutEnd)
  const holdoutSet = new Set(holdout)
  const developmentSet = new Set(development)

  const holdoutBuckets = buildBucketsForSplit(catalogueBySymbol, aligned.raw, holdoutSet, holdout, options)
  const developmentBuckets = buildBucketsForSplit(catalogueBySymbol, aligned.raw, developmentSet, development, options)

  const baselinePredicate = (entry) => entry.score >= options.minimumScore && entry.status === 'Bullish'
  const rvConfirmedPredicate = (entry) => baselinePredicate(entry) && entry.components.rvConfirmation

  const holdoutBaseline = buildVariantForSplit(catalogueBySymbol, aligned.raw, holdoutSet, holdout, options, baselinePredicate)
  const holdoutRvConfirmed = buildVariantForSplit(catalogueBySymbol, aligned.raw, holdoutSet, holdout, options, rvConfirmedPredicate)
  const developmentBaseline = buildVariantForSplit(catalogueBySymbol, aligned.raw, developmentSet, development, options, baselinePredicate)
  const developmentRvConfirmed = buildVariantForSplit(catalogueBySymbol, aligned.raw, developmentSet, development, options, rvConfirmedPredicate)

  return {
    aligned,
    options,
    holdoutRange: { start: holdout[0] ?? null, end: holdout.at(-1) ?? null, candleCount: holdout.length },
    developmentRange: { start: development[0] ?? null, end: development.at(-1) ?? null, candleCount: development.length },
    holdoutBuckets,
    developmentBuckets,
    holdoutBaseline,
    holdoutRvConfirmed,
    developmentBaseline,
    developmentRvConfirmed,
  }
}

export { assessScoreMonotonicity }
