// Research Experiment #3A — Frozen Score Holdout.
// Tests whether the existing, unmodified SetupScan score/threshold relationship survives on a
// fixed retrospective historical window. It is not a prospective test: later data is used as
// development data, and the code cannot establish whether people previously inspected this window.
// No scoring weights are changed or optimized here.
// Reuses Experiment #2's catalogue (score, status, and component flags including the
// Experiment #1 relative-value confirmation) and trade-construction conventions unchanged.
import {
  signalQualityDefaults,
  scoreBucketDefinitions,
  buildAlignedSeries,
  buildCatalogueBySymbol,
  summarizeTrades,
  assessScoreMonotonicity,
} from './signalQualityBacktest.js'
import { buildTradeWithinEvaluationWindow } from './evaluationWindow.js'

export const frozenScoreHoldoutDefaults = {
  ...signalQualityDefaults,
  // Fixed older comparison window used by Experiment #1's robustness research.
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

function buildBucketsForSplit(catalogueBySymbol, alignedRaw, splitTimestampSet, splitTimestampList, evaluationEndIndex, options) {
  return scoreBucketDefinitions.map(([label, min, max]) => {
    const tradesBySymbol = Object.keys(catalogueBySymbol).map((symbol) => {
      const trades = catalogueBySymbol[symbol]
        .filter((entry) => splitTimestampSet.has(entry.timestamp) && entry.score >= min && entry.score <= max && entry.researchEligible)
        .map((entry) => buildTradeWithinEvaluationWindow(alignedRaw[symbol], entry.index, options, evaluationEndIndex, { symbol }))
        .filter(Boolean)
      return { symbol, trades }
    })
    return { label, min, max, ...summarizeTrades(tradesBySymbol, splitTimestampList, options.periodCount) }
  })
}

function buildVariantForSplit(catalogueBySymbol, alignedRaw, splitTimestampSet, splitTimestampList, evaluationEndIndex, options, predicate) {
  const tradesBySymbol = Object.keys(catalogueBySymbol).map((symbol) => {
    const trades = catalogueBySymbol[symbol]
      .filter((entry) => splitTimestampSet.has(entry.timestamp) && predicate(entry))
      .map((entry) => buildTradeWithinEvaluationWindow(alignedRaw[symbol], entry.index, options, evaluationEndIndex, { symbol }))
      .filter(Boolean)
    return { symbol, trades }
  })
  return summarizeTrades(tradesBySymbol, splitTimestampList, options.periodCount)
}

/**
 * Splits the synchronized SPY/QQQ/IWM timeline into a fixed 2022-2024 retrospective comparison
 * window and a development window containing timestamps after that window. Earlier timestamps
 * are omitted. This is not a prospective holdout, and prior human inspection cannot be established
 * from the code. The existing frozen scoring formula and Experiment #1 RV-confirmed variant are
 * evaluated on each split independently. No scoring weights are changed.
 */
export function runFrozenScoreHoldoutResearch(rawSeriesBySymbol, settings = {}) {
  const options = { ...frozenScoreHoldoutDefaults, ...settings }
  const aligned = buildAlignedSeries(rawSeriesBySymbol)
  const catalogueBySymbol = buildCatalogueBySymbol(aligned, options)
  const { holdout, development } = splitTimestamps(aligned.timestamps, options.holdoutStart, options.holdoutEnd)
  const holdoutSet = new Set(holdout)
  const developmentSet = new Set(development)
  const holdoutEndIndex = holdout.length ? aligned.timestamps.indexOf(holdout.at(-1)) : -1
  const developmentEndIndex = development.length ? aligned.timestamps.indexOf(development.at(-1)) : -1

  const holdoutBuckets = buildBucketsForSplit(catalogueBySymbol, aligned.raw, holdoutSet, holdout, holdoutEndIndex, options)
  const developmentBuckets = buildBucketsForSplit(catalogueBySymbol, aligned.raw, developmentSet, development, developmentEndIndex, options)

  const baselinePredicate = (entry) => entry.researchEligible && entry.score >= options.minimumScore
  const rvConfirmedPredicate = (entry) => baselinePredicate(entry) && entry.components.rvConfirmation

  const holdoutBaseline = buildVariantForSplit(catalogueBySymbol, aligned.raw, holdoutSet, holdout, holdoutEndIndex, options, baselinePredicate)
  const holdoutRvConfirmed = buildVariantForSplit(catalogueBySymbol, aligned.raw, holdoutSet, holdout, holdoutEndIndex, options, rvConfirmedPredicate)
  const developmentBaseline = buildVariantForSplit(catalogueBySymbol, aligned.raw, developmentSet, development, developmentEndIndex, options, baselinePredicate)
  const developmentRvConfirmed = buildVariantForSplit(catalogueBySymbol, aligned.raw, developmentSet, development, developmentEndIndex, options, rvConfirmedPredicate)

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
