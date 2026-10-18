// Strategy Discovery — shared, self-contained metrics and causal building blocks.
// Independent of the existing scanner/backtest indicator helpers on purpose: the existing
// enrichHistoricalCandles() vwap/atr fields are simplified scanner heuristics (a since-inception
// running average and single-candle range, respectively), not a true session VWAP or a true
// ATR(14). Strategy Discovery needs the textbook definitions, so this module reimplements them
// fresh rather than reusing an approximation that does not match the documented protocol.
//
// Research only. Not used by, and does not modify, the production scanner, paper trading, the
// Render worker, the API, or any existing research/backtest module.

import { candleCompletesBy } from '../../data/historicalDataContract.js'

export const strategyDiscoveryResearchWindows = {
  development: { start: '2022-01-01T00:00:00Z', end: '2024-12-31T23:59:59Z', label: 'Development' },
  outOfSample: { start: '2025-01-01T00:00:00Z', end: '2025-12-31T23:59:59Z', label: 'Out-of-Sample' },
  holdout: { start: '2026-01-01T00:00:00Z', end: null, label: 'Holdout (2026 YTD)' },
}

// Research-assumption execution-cost tiers, expressed in basis points of price per side, per the
// committed Strategy Discovery Protocol (docs/strategy-discovery-protocol.md, Section 9). These are
// intentionally separate from the flat R-unit costTierDefinitions used by the existing Experiment
// #2-#7 research labs, since this protocol defines cost in basis points of price, not flat R.
export const strategyDiscoveryCostTiers = [
  { label: 'Before execution costs', entryBps: 0, exitBps: 0 },
  { label: 'Low friction (1bp / 1bp)', entryBps: 1, exitBps: 1 },
  { label: 'Moderate friction (3bp / 3bp)', entryBps: 3, exitBps: 3 },
  { label: 'High friction (8bp / 8bp)', entryBps: 8, exitBps: 8 },
]

export const average = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0)

export function median(values) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** True range at `index`, causal — only reads candles[index] and candles[index - 1]. */
export function computeTrueRange(candles, index) {
  if (index < 1) return candles[index].high - candles[index].low
  const previousClose = candles[index - 1].close
  return Math.max(
    candles[index].high - candles[index].low,
    Math.abs(candles[index].high - previousClose),
    Math.abs(candles[index].low - previousClose),
  )
}

/** Trailing ATR(14) for every bar — causal, null until 14 trailing true-range values exist. */
export function computeAtr14Series(candles, period = 14) {
  return candles.map((_, index) => {
    if (index < period) return null
    let sum = 0
    for (let i = index - period + 1; i <= index; i += 1) sum += computeTrueRange(candles, i)
    return sum / period
  })
}

/**
 * Session VWAP for every bar — resets at each UTC calendar-day boundary, and at each bar only
 * accumulates volume-weighted typical price through that same bar (causal, no future information).
 * Returns null for a bar before any volume has accumulated that session.
 */
export function computeSessionVwapSeries(candles) {
  let cumulativePriceVolume = 0
  let cumulativeVolume = 0
  let currentDay = null
  return candles.map((candle) => {
    const day = candle.timestamp.slice(0, 10)
    if (day !== currentDay) {
      currentDay = day
      cumulativePriceVolume = 0
      cumulativeVolume = 0
    }
    const typicalPrice = (candle.high + candle.low + candle.close) / 3
    const volume = candle.volume ?? 0
    cumulativePriceVolume += typicalPrice * volume
    cumulativeVolume += volume
    return cumulativeVolume > 0 ? cumulativePriceVolume / cumulativeVolume : null
  })
}

/**
 * Determines, bar by bar starting after signalIndex, whether the lower barrier (stopPrice) or the
 * upper barrier (upperPrice) is reached first, within maxBars completed candles. The first checked
 * candle is the entry candle at the next candle's open. A stop gapped
 * through at the open fills at that open; a target remains filled at its limit price (no assumed
 * price improvement). If neither barrier is crossed at the open and both the low
 * and the high of the same bar cross their respective barriers, intrabar order cannot be
 * determined from OHLC data alone — per protocol, this is never guessed and is reported as
 * 'Ambiguous' rather than silently resolved in either direction.
 */
export function evaluateBarrierOutcome(candles, signalIndex, stopPrice, upperPrice, maxBars) {
  for (let offset = 1; offset <= maxBars; offset += 1) {
    const index = signalIndex + offset
    if (index >= candles.length) return { status: 'InsufficientData', barsElapsed: offset - 1, exitPrice: null }
    const candle = candles[index]
    // The open is the first known price in this candle and resolves a barrier gap
    // before considering later OHLC extremes. Target fills stay at the limit price.
    if (Number.isFinite(candle.open) && candle.open <= stopPrice) return { status: 'Stop', barsElapsed: offset, exitPrice: candle.open }
    if (Number.isFinite(candle.open) && candle.open >= upperPrice) return { status: 'Target', barsElapsed: offset, exitPrice: upperPrice }
    const hitStop = candle.low <= stopPrice
    const hitUpper = candle.high >= upperPrice
    if (hitStop && hitUpper) return { status: 'Ambiguous', barsElapsed: offset, exitPrice: null, reason: 'stop-and-target-both-within-same-candle-range' }
    if (hitStop) return { status: 'Stop', barsElapsed: offset, exitPrice: stopPrice }
    if (hitUpper) return { status: 'Target', barsElapsed: offset, exitPrice: upperPrice }
  }
  const finalIndex = Math.min(signalIndex + maxBars, candles.length - 1)
  return { status: 'Expired', barsElapsed: maxBars, exitPrice: candles[finalIndex].close }
}

/** Maximum favorable/adverse excursion, in R, from the entry candle over a fixed causal window. */
export function computeExcursion(candles, signalIndex, entryPrice, risk, maxBars) {
  let mfe = null
  let mae = null
  for (let offset = 1; offset <= maxBars; offset += 1) {
    const index = signalIndex + offset
    if (index >= candles.length) break
    const favorable = (candles[index].high - entryPrice) / risk
    const adverse = (candles[index].low - entryPrice) / risk
    mfe = mfe === null ? favorable : Math.max(mfe, favorable)
    mae = mae === null ? adverse : Math.min(mae, adverse)
  }
  return { mfeR: mfe, maeR: mae }
}

/** Converts a barrier-outcome result into a final R-multiple. Ambiguous/InsufficientData -> null (excluded, not guessed). */
export function outcomeToFinalR(outcome, entryPrice, risk, upperMultiple) {
  if (outcome.status === 'Target') return upperMultiple
  if (outcome.status === 'Stop') return (outcome.exitPrice - entryPrice) / risk
  if (outcome.status === 'Expired') return (outcome.exitPrice - entryPrice) / risk
  return null
}

export function classifyResearchPeriod(timestamp) {
  const time = new Date(timestamp).getTime()
  const { development, outOfSample, holdout } = strategyDiscoveryResearchWindows
  if (time >= new Date(development.start).getTime() && time <= new Date(development.end).getTime()) return development.label
  if (time >= new Date(outOfSample.start).getTime() && time <= new Date(outOfSample.end).getTime()) return outOfSample.label
  if (time >= new Date(holdout.start).getTime()) return holdout.label
  return null
}

function researchPeriodEnd(periodLabel) {
  return Object.values(strategyDiscoveryResearchWindows).find((period) => period.label === periodLabel)?.end ?? null
}

function outcomeContainedInPeriod(candles, signalIndex, barsElapsed, periodLabel) {
  const periodEnd = researchPeriodEnd(periodLabel)
  if (!periodLabel || !periodEnd || !(barsElapsed > 0)) return Boolean(periodLabel)
  const outcomeCandle = candles[signalIndex + barsElapsed]
  return Boolean(outcomeCandle && candleCompletesBy(
    outcomeCandle,
    outcomeCandle.timeframe ?? '1Hour',
    periodEnd,
  ))
}

/**
 * Builds one reproducible occurrence record from a signal index: entry at the next candle's open,
 * a 1-ATR stop, the experiment's own primary outcome (arbitrary upper price / horizon), plus the
 * shared secondary outcomes (+1R/-1R within 5, +2R/-1R within 10) and MFE/MAE over a 10-bar window.
 * Returns null (excluded, documented) if there is no next candle to enter on, or risk is invalid.
 * `getPrimaryUpperPrice(entryPrice, risk)` computes the primary upper barrier price; defaults to
 * entry + 1R for experiments whose primary outcome is the shared +1R-before-1R-within-5 rule.
 */
export function buildOccurrence({
  candles,
  signalIndex,
  symbol,
  risk,
  getPrimaryUpperPrice = (entryPrice, entryRisk) => entryPrice + entryRisk,
  primaryMaxBars = 5,
  primaryLabel,
}) {
  const entryIndex = signalIndex + 1
  if (entryIndex >= candles.length) return null
  const entryCandle = candles[entryIndex]
  const entryPrice = entryCandle.open ?? entryCandle.close
  if (!(risk > 0) || !(entryPrice > 0)) return null
  const stopPrice = entryPrice - risk

  const primaryUpperPrice = getPrimaryUpperPrice(entryPrice, risk)
  if (!(primaryUpperPrice > entryPrice)) return null
  const primaryUpperMultiple = (primaryUpperPrice - entryPrice) / risk
  // The signal candle is complete before entry. Starting after it counts the entry candle as bar 1,
  // so the existing 5/10-bar outcome and excursion horizons do not gain an extra candle.
  const primaryOutcome = evaluateBarrierOutcome(candles, signalIndex, stopPrice, primaryUpperPrice, primaryMaxBars)
  const secondary1R5Outcome = evaluateBarrierOutcome(candles, signalIndex, stopPrice, entryPrice + risk, 5)
  const secondary2R10Outcome = evaluateBarrierOutcome(candles, signalIndex, stopPrice, entryPrice + 2 * risk, 10)
  const { mfeR, maeR } = computeExcursion(candles, signalIndex, entryPrice, risk, 10)
  const period = classifyResearchPeriod(entryCandle.timestamp)
  const primaryPeriodBoundaryExcluded = period !== null && primaryOutcome.status !== 'InsufficientData' &&
    !outcomeContainedInPeriod(candles, signalIndex, primaryOutcome.barsElapsed, period)
  const secondary1R5PeriodBoundaryExcluded = period !== null && secondary1R5Outcome.status !== 'InsufficientData' &&
    !outcomeContainedInPeriod(candles, signalIndex, secondary1R5Outcome.barsElapsed, period)
  const secondary2R10PeriodBoundaryExcluded = period !== null && secondary2R10Outcome.status !== 'InsufficientData' &&
    !outcomeContainedInPeriod(candles, signalIndex, secondary2R10Outcome.barsElapsed, period)
  const excursionPeriodBoundaryExcluded = period !== null &&
    candles[signalIndex + 10] !== undefined &&
    !outcomeContainedInPeriod(candles, signalIndex, 10, period)

  return {
    symbol,
    signalTimestamp: candles[signalIndex].timestamp,
    timestamp: entryCandle.timestamp,
    entryPrice,
    stopPrice,
    risk,
    primaryLabel,
    primaryStatus: primaryOutcome.status,
    primaryR: outcomeToFinalR(primaryOutcome, entryPrice, risk, primaryUpperMultiple),
    holdingBars: primaryOutcome.barsElapsed,
    secondary1R5: { status: secondary1R5Outcome.status, r: outcomeToFinalR(secondary1R5Outcome, entryPrice, risk, 1), barsElapsed: secondary1R5Outcome.barsElapsed, periodBoundaryExcluded: secondary1R5PeriodBoundaryExcluded },
    secondary2R10: { status: secondary2R10Outcome.status, r: outcomeToFinalR(secondary2R10Outcome, entryPrice, risk, 2), barsElapsed: secondary2R10Outcome.barsElapsed, periodBoundaryExcluded: secondary2R10PeriodBoundaryExcluded },
    excursionPeriodBoundaryExcluded,
    mfeR,
    maeR,
    period,
    primaryPeriodBoundaryExcluded,
  }
}


/** Cost in R for one occurrence, approximating bp-of-price frictions relative to the R-denominated risk used for that trade. */
export function computeCostAdjustedR(rMultiple, entryPrice, risk, tier) {
  const costPrice = entryPrice * ((tier.entryBps + tier.exitBps) / 10000)
  return rMultiple - costPrice / risk
}

function summarizeR(rValues) {
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
  const winRate = rValues.length ? wins.length / rValues.length : 0
  const lossRate = rValues.length ? losses.length / rValues.length : 0
  return {
    occurrenceCount: rValues.length,
    winRate,
    lossRate,
    profitFactor: grossLoss ? grossProfit / grossLoss : grossProfit ? Infinity : 0,
    expectancy: rValues.length ? average(rValues) : 0,
    averageR: rValues.length ? average(rValues) : 0,
    medianR: median(rValues),
    totalR: rValues.reduce((sum, value) => sum + value, 0),
    maximumDrawdown,
  }
}

/**
 * Builds the full standard-metrics summary (overall + by year/symbol/period/cost-tier) from a flat
 * list of occurrence records. Occurrences whose primary outcome is null (Ambiguous/InsufficientData)
 * or fall outside the defined research windows are counted and reported, but excluded from the R
 * statistics rather than silently dropped or guessed.
 */
export function summarizeOccurrences(occurrences) {
  const resolved = occurrences
    .filter((occurrence) => occurrence.primaryR !== null && occurrence.period !== null && !occurrence.primaryPeriodBoundaryExcluded)
    // Cumulative-R/drawdown calculations depend on chronological order. Occurrences are generated
    // per symbol (all SPY, then all QQQ, then all IWM), so they must be re-sorted here by actual
    // entry timestamp into one interleaved sequence before any equity curve is computed below —
    // otherwise drawdown would be measured across an artificial symbol-by-symbol concatenation
    // rather than the order trades would actually have occurred in.
    // Candle timestamps can tie across symbols. Use stable trade fields after time so pooled
    // drawdown does not depend on the order symbols happened to be fetched or inserted.
    .sort((a, b) =>
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime() ||
      String(a.symbol ?? '').localeCompare(String(b.symbol ?? '')) ||
      (a.holdingBars ?? 0) - (b.holdingBars ?? 0) ||
      (a.primaryR ?? 0) - (b.primaryR ?? 0) ||
      String(a.primaryStatus ?? '').localeCompare(String(b.primaryStatus ?? '')),
    )
  const excludedAmbiguous = occurrences.filter((occurrence) => occurrence.primaryStatus === 'Ambiguous')
  const ambiguousInResearchWindow = excludedAmbiguous.filter((occurrence) => occurrence.period !== null && occurrence.period !== undefined && !occurrence.primaryPeriodBoundaryExcluded)
  const excludedInsufficientData = occurrences.filter((occurrence) => occurrence.primaryStatus === 'InsufficientData')
  const excludedOutsideWindow = occurrences.filter((occurrence) => occurrence.primaryR !== null && occurrence.period === null)
  const excludedPeriodBoundary = occurrences.filter((occurrence) => occurrence.primaryPeriodBoundaryExcluded)
  const classifiableInResearchWindowCount = resolved.length + ambiguousInResearchWindow.length
  const excursionResolved = resolved.filter((occurrence) =>
    !occurrence.excursionPeriodBoundaryExcluded && occurrence.mfeR !== null && occurrence.maeR !== null)

  const overall = {
    ...summarizeR(resolved.map((occurrence) => occurrence.primaryR)),
    averageHoldingBars: average(resolved.map((occurrence) => occurrence.holdingBars)),
    excursionObservationCount: excursionResolved.length,
    averageMfeR: excursionResolved.length ? average(excursionResolved.map((occurrence) => occurrence.mfeR)) : null,
    averageMaeR: excursionResolved.length ? average(excursionResolved.map((occurrence) => occurrence.maeR)) : null,
  }

  const groupBy = (keyFn) => {
    const groups = new Map()
    resolved.forEach((occurrence) => {
      const key = keyFn(occurrence)
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(occurrence)
    })
    return [...groups.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, group]) => ({ label: key, ...summarizeR(group.map((occurrence) => occurrence.primaryR)) }))
  }

  const costTiers = strategyDiscoveryCostTiers.map((tier) => ({
    label: tier.label,
    entryBps: tier.entryBps,
    exitBps: tier.exitBps,
    metrics: summarizeR(resolved.map((occurrence) => computeCostAdjustedR(occurrence.primaryR, occurrence.entryPrice, occurrence.risk, tier))),
  }))

  return {
    overall,
    byYear: groupBy((occurrence) => String(new Date(occurrence.timestamp).getUTCFullYear())),
    bySymbol: groupBy((occurrence) => occurrence.symbol),
    byPeriod: groupBy((occurrence) => occurrence.period),
    costTiers,
    excluded: {
      ambiguousCount: excludedAmbiguous.length,
      ambiguousInResearchWindowCount: ambiguousInResearchWindow.length,
      classifiableInResearchWindowCount,
      ambiguousInResearchWindowRate: classifiableInResearchWindowCount
        ? ambiguousInResearchWindow.length / classifiableInResearchWindowCount
        : null,
      insufficientDataCount: excludedInsufficientData.length,
      outsideResearchWindowCount: excludedOutsideWindow.length,
      periodBoundaryCount: excludedPeriodBoundary.length,
      periodBoundaryByPeriod: Object.values(strategyDiscoveryResearchWindows).map(({ label }) => ({
        period: label,
        count: excludedPeriodBoundary.filter((occurrence) => occurrence.period === label).length,
      })),
      excursionPeriodBoundaryCount: occurrences.filter((occurrence) => occurrence.excursionPeriodBoundaryExcluded).length,
    },
  }
}

/** Aggregate win rate/count for a shared secondary outcome (e.g. +1R/5 or +2R/10) across occurrences. */
export function summarizeSecondaryOutcome(occurrences, key) {
  const resolved = occurrences
    .map((occurrence) => occurrence[key])
    .filter((outcome) => outcome && outcome.r !== null && !outcome.periodBoundaryExcluded)
  const wins = resolved.filter((outcome) => outcome.r > 0)
  const boundaryExcluded = occurrences.filter((occurrence) => occurrence[key]?.periodBoundaryExcluded)
  return {
    occurrenceCount: resolved.length,
    winRate: resolved.length ? wins.length / resolved.length : 0,
    averageR: resolved.length ? average(resolved.map((outcome) => outcome.r)) : 0,
    ambiguousCount: occurrences.filter((occurrence) => occurrence[key]?.status === 'Ambiguous' && !occurrence[key]?.periodBoundaryExcluded).length,
    insufficientDataCount: occurrences.filter((occurrence) => occurrence[key]?.status === 'InsufficientData').length,
    periodBoundaryExcludedCount: boundaryExcluded.length,
  }
}
