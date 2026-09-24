// Strategy Discovery — Batch B: Breakout Context Research.
// Investigates which market/context conditions are historically associated with different
// behavior of the FROZEN Batch A Momentum Breakout signal. The breakout definition itself
// (src/backtest/strategyDiscovery/momentumBreakout.js) is imported and used completely
// unmodified — this module only classifies each already-qualifying signal by causal context and
// reports the same standard metrics per context bucket. No thresholds are optimized, no bucket is
// ranked or declared a winner, and every classification uses only information available at or
// before the signal candle.
import {
  buildOccurrence,
  computeSessionVwapSeries,
  strategyDiscoveryResearchWindows,
  summarizeOccurrences,
  average,
} from './discoveryMetrics.js'
import { momentumBreakoutMeta, findMomentumBreakoutSignals } from './momentumBreakout.js'
import { synchronizeCandleSeries, computeRelativeStrengthConfirmation } from '../relativeValue.js'
import { relativeValueDefaults } from '../relativeValueBacktest.js'
import { computeCausalRegimeSeries, causalRegimeDefaults } from '../causalRegimeBacktest.js'

export const strategyDiscoveryUniverse = ['SPY', 'QQQ', 'IWM']
export const strategyDiscoveryTimeframe = '1Hour'
const LOW_EVIDENCE_THRESHOLD = 100 // per Strategy Discovery Protocol, Section 7

const INSUFFICIENT_HISTORY = 'Insufficient History'

function resolveGitCommit() {
  const commit = typeof import.meta !== 'undefined' ? import.meta.env?.VITE_GIT_COMMIT : undefined
  return commit || 'unavailable (not exposed by the current build/runtime)'
}

/** Eastern-time hour/minute/calendar-day for one timestamp, via Intl (handles DST correctly, causal — reads only this timestamp). */
function getEasternTimeParts(timestamp) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour12: false, hour: '2-digit', minute: '2-digit', year: 'numeric', month: '2-digit', day: '2-digit',
  })
  const parts = Object.fromEntries(formatter.formatToParts(new Date(timestamp)).map((part) => [part.type, part.value]))
  return { hour: Number(parts.hour) % 24, minute: Number(parts.minute), dateKey: `${parts.year}-${parts.month}-${parts.day}` }
}

/** Dimension 1 — Time of Day (Eastern), classified from the signal candle's own timestamp only. */
export function classifyTimeOfDay(timestamp) {
  const { hour, minute } = getEasternTimeParts(timestamp)
  const minutesSinceMidnight = hour * 60 + minute
  if (minutesSinceMidnight >= 9 * 60 + 30 && minutesSinceMidnight < 11 * 60) return 'Morning (09:30\u201311:00 ET)'
  if (minutesSinceMidnight >= 11 * 60 && minutesSinceMidnight < 14 * 60) return 'Midday (11:00\u201314:00 ET)'
  if (minutesSinceMidnight >= 14 * 60 && minutesSinceMidnight < 16 * 60) return 'Afternoon (14:00\u201316:00 ET)'
  return 'Outside Regular Session (Pre/Post-Market)'
}

/** Dimension 6 — Opening-Range Context. Simple, non-optimized definition: the opening range of an
 * ET calendar day is the high of that day's first observed (1-hour) candle; only usable starting
 * from the day's second candle onward (never from the opening bar itself or a future bar). */
function computeOpeningRangeLabels(candles) {
  const labels = new Array(candles.length).fill(INSUFFICIENT_HISTORY)
  let currentDayKey = null
  let openingRangeHigh = null
  candles.forEach((candle, index) => {
    const { dateKey } = getEasternTimeParts(candle.timestamp)
    if (dateKey !== currentDayKey) {
      currentDayKey = dateKey
      openingRangeHigh = candle.high
      return // this bar establishes the range; it cannot be classified against its own range
    }
    labels[index] = candle.high > openingRangeHigh ? 'Breakout Above Opening Range' : 'Not Above Opening Range'
  })
  return labels
}

/** Dimension 7 — Prior-Day Context. Reuses the same UTC-calendar-day boundary convention as the
 * frozen priorDayReclaim.js experiment, reimplemented locally so that module stays untouched. */
function computePriorDayHighLabels(candles) {
  const labels = new Array(candles.length).fill(INSUFFICIENT_HISTORY)
  let currentDayKey = null
  let currentDayMaxHigh = null
  let referenceLevel = null
  candles.forEach((candle, index) => {
    const day = candle.timestamp.slice(0, 10)
    if (day !== currentDayKey) {
      referenceLevel = currentDayKey === null ? null : currentDayMaxHigh
      currentDayKey = day
      currentDayMaxHigh = candle.high
    } else {
      currentDayMaxHigh = Math.max(currentDayMaxHigh, candle.high)
    }
    labels[index] = referenceLevel === null
      ? INSUFFICIENT_HISTORY
      : candle.high > referenceLevel ? 'Breakout Interacts With Prior-Day High' : 'No Prior-Day-High Interaction'
  })
  return labels
}

/** Dimension 8 — Volume Strength. Recomputes the exact same prior-20-candle volume ratio the
 * frozen breakout definition already requires (>=1.2x), purely to split qualifying signals into a
 * simple, predefined, non-optimized magnitude bucket. Does not change which signals qualify. */
function computeVolumeRatioLabel(candles, index, lookbackBars) {
  const lookback = candles.slice(index - lookbackBars, index)
  const averageVolume = average(lookback.map((candle) => candle.volume ?? 0))
  if (!(averageVolume > 0)) return INSUFFICIENT_HISTORY
  const ratio = (candles[index].volume ?? 0) / averageVolume
  return ratio >= 2 ? 'Volume Strength: High (\u22652x average)' : 'Volume Strength: Moderate (1.2x\u20132x average)'
}

/** Dimension 5 — VWAP Context, from the same causal session-VWAP series used elsewhere in Batch A/B. */
function computeVwapContextLabels(candles) {
  const vwapSeries = computeSessionVwapSeries(candles)
  return candles.map((candle, index) => {
    const vwap = vwapSeries[index]
    if (vwap === null) return INSUFFICIENT_HISTORY
    return candle.close > vwap ? 'Above Session VWAP' : 'At/Below Session VWAP'
  })
}

function toDimensionLabel(classification) {
  if (classification === 'Uptrend') return 'Trend Up'
  if (classification === 'Downtrend') return 'Trend Down'
  if (classification === 'Mixed') return 'Mixed'
  if (classification === 'Insufficient-History') return INSUFFICIENT_HISTORY
  return classification
}

const DIMENSION_META = [
  { key: 'timeOfDay', label: 'Time of Day' },
  { key: 'trendRegime', label: 'Market Trend Regime' },
  { key: 'volatilityRegime', label: 'Volatility Regime' },
  { key: 'relativeStrength', label: 'Relative Strength' },
  { key: 'vwapContext', label: 'VWAP Context' },
  { key: 'openingRangeContext', label: 'Opening-Range Context' },
  { key: 'priorDayContext', label: 'Prior-Day Context' },
  { key: 'volumeStrength', label: 'Volume Strength' },
]

/**
 * Runs Batch B against the same `datasets` shape Batch A and every other research lab use (an
 * array of { symbol, status, data }, where status === 'AVAILABLE' implies real, complete Alpaca
 * historical data). Returns unavailable (never fabricated) if the SPY/QQQ/IWM universe isn't
 * fully available.
 */
export function runBreakoutContextResearch(datasets) {
  const bySymbol = Object.fromEntries((datasets ?? []).map((dataset) => [dataset.symbol, dataset]))
  const missingSymbols = strategyDiscoveryUniverse.filter((symbol) => bySymbol[symbol]?.status !== 'AVAILABLE')
  const gitCommit = resolveGitCommit()
  const generatedAt = new Date().toISOString()

  if (missingSymbols.length) {
    return { available: false, missingSymbols, universe: strategyDiscoveryUniverse, timeframe: strategyDiscoveryTimeframe, generatedAt, gitCommit }
  }

  // Per-symbol dedup, identical approach to Batch A (discoveryRunner.js) — used for signal
  // detection and every symbol-local causal context (VWAP, opening range, prior-day, volume).
  const perSymbol = {}
  const datasetInfo = []
  strategyDiscoveryUniverse.forEach((symbol) => {
    const { series, droppedCounts } = synchronizeCandleSeries({ [symbol]: bySymbol[symbol].data.candles })
    perSymbol[symbol] = series[symbol]
    datasetInfo.push({
      symbol,
      provider: 'ALPACA HISTORICAL',
      candleCount: series[symbol].length,
      start: series[symbol][0]?.timestamp ?? null,
      end: series[symbol].at(-1)?.timestamp ?? null,
      duplicatesRemoved: droppedCounts[symbol] ?? 0,
    })
  })

  // A single 3-way aligned (common-timestamp) dataset, used ONLY for the two context dimensions
  // that are inherently cross-symbol/market-wide: trend/volatility regime (existing causal
  // classification reused unchanged from Experiment #5) and relative strength (existing causal
  // confirmation reused unchanged from Experiment #1). Signals themselves are still detected on
  // each symbol's own (unaligned) series above, exactly as Batch A does.
  const aligned = synchronizeCandleSeries(Object.fromEntries(strategyDiscoveryUniverse.map((symbol) => [symbol, perSymbol[symbol]])))
  const regimeByIndex = computeCausalRegimeSeries(aligned.series, causalRegimeDefaults)
  const regimeByTimestamp = new Map(aligned.timestamps.map((timestamp, index) => [timestamp, regimeByIndex[index]]))
  const relativeStrengthByTimestampBySymbol = {}
  strategyDiscoveryUniverse.forEach((symbol) => {
    const peers = strategyDiscoveryUniverse.filter((other) => other !== symbol).map((other) => aligned.series[other])
    const confirmation = computeRelativeStrengthConfirmation(aligned.series[symbol], peers, relativeValueDefaults.lookback)
    relativeStrengthByTimestampBySymbol[symbol] = new Map(confirmation.map((entry) => [entry.timestamp, entry.confirmed]))
  })

  // Bucketed occurrences per dimension, across all three symbols.
  const bucketed = Object.fromEntries(DIMENSION_META.map((dimension) => [dimension.key, new Map()]))
  const pushOccurrence = (dimensionKey, label, occurrence) => {
    const map = bucketed[dimensionKey]
    if (!map.has(label)) map.set(label, [])
    map.get(label).push(occurrence)
  }

  let totalQualifyingSignals = 0
  strategyDiscoveryUniverse.forEach((symbol) => {
    const candles = perSymbol[symbol]
    const signals = findMomentumBreakoutSignals(candles) // frozen Batch A definition, unmodified
    const openingRangeLabels = computeOpeningRangeLabels(candles)
    const priorDayLabels = computePriorDayHighLabels(candles)
    const vwapLabels = computeVwapContextLabels(candles)

    signals.forEach(({ index, atr }) => {
      totalQualifyingSignals += 1
      const occurrence = buildOccurrence({
        candles, signalIndex: index, symbol, risk: atr, primaryMaxBars: 5, primaryLabel: momentumBreakoutMeta.parameters.primaryOutcome,
      })
      if (!occurrence) return // no next candle to enter on — excluded, same as Batch A

      const timestamp = candles[index].timestamp
      const regime = regimeByTimestamp.get(timestamp)
      const relativeStrengthConfirmed = relativeStrengthByTimestampBySymbol[symbol].get(timestamp)

      pushOccurrence('timeOfDay', classifyTimeOfDay(timestamp), occurrence)
      pushOccurrence('trendRegime', regime ? toDimensionLabel(regime.trend.classification) : INSUFFICIENT_HISTORY, occurrence)
      pushOccurrence('volatilityRegime', regime ? toDimensionLabel(regime.volatility.classification) : INSUFFICIENT_HISTORY, occurrence)
      pushOccurrence('relativeStrength', relativeStrengthConfirmed === undefined
        ? INSUFFICIENT_HISTORY
        : relativeStrengthConfirmed ? 'Relative Strength Positive' : 'Relative Strength Neutral/Negative', occurrence)
      pushOccurrence('vwapContext', vwapLabels[index], occurrence)
      pushOccurrence('openingRangeContext', openingRangeLabels[index], occurrence)
      pushOccurrence('priorDayContext', priorDayLabels[index], occurrence)
      pushOccurrence('volumeStrength', computeVolumeRatioLabel(candles, index, momentumBreakoutMeta.parameters.lookbackBars), occurrence)
    })
  })

  const dimensions = DIMENSION_META.map((dimension) => ({
    key: dimension.key,
    label: dimension.label,
    buckets: [...bucketed[dimension.key].entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([label, occurrences]) => ({
        label,
        lowEvidence: occurrences.length < LOW_EVIDENCE_THRESHOLD,
        summary: summarizeOccurrences(occurrences),
      })),
  }))

  return {
    available: true,
    universe: strategyDiscoveryUniverse,
    timeframe: strategyDiscoveryTimeframe,
    researchWindows: strategyDiscoveryResearchWindows,
    datasetInfo,
    generatedAt,
    gitCommit,
    frozenBreakoutDefinition: momentumBreakoutMeta,
    totalQualifyingSignals,
    dimensions,
  }
}
