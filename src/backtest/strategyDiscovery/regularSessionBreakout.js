// Strategy Discovery — Batch C: Regular Session Breakout.
// Tests the EXACT frozen Batch A Momentum Breakout definition (src/backtest/strategyDiscovery/
// momentumBreakout.js, imported and used completely unmodified) on a stricter research universe:
// only 1H bars fully contained inside the regular U.S. equity session. Per the protocol's Session
// and Data-Handling Conventions (docs/strategy-discovery-protocol.md, Section 17), bars are
// hour-aligned rather than 09:30-aligned, so the 09:00 ET bar (partially overlaps the session
// open) and the 16:00 ET bar (entirely postmarket) are excluded. The filtered series is built
// FIRST, then the frozen 20-bar lookback/ATR/volume-average/entry logic runs entirely on that
// filtered series — extended-hours candles never enter the lookback, and entry can never land on
// an excluded bar, since entry is always "the next candle in whichever series was passed in".
import { buildOccurrence, summarizeOccurrences } from './discoveryMetrics.js'
import { momentumBreakoutMeta, findMomentumBreakoutSignals } from './momentumBreakout.js'
import { synchronizeCandleSeries } from '../relativeValue.js'

export const strategyDiscoveryUniverse = ['SPY', 'QQQ', 'IWM']
export const strategyDiscoveryTimeframe = '1Hour'

// Bars whose Eastern start hour is NOT in this set are excluded: 09:00 ET (spans 09:00-10:00,
// partially overlaps the 09:30 session open) and 16:00 ET (spans 16:00-17:00, entirely postmarket)
// are the two boundary bars; anything earlier/later is ordinary extended-hours data.
export const regularSessionEasternHours = [10, 11, 12, 13, 14, 15]

function resolveGitCommit() {
  const commit = typeof import.meta !== 'undefined' ? import.meta.env?.VITE_GIT_COMMIT : undefined
  return commit || 'unavailable (not exposed by the current build/runtime)'
}

/** Eastern start-hour of one candle's timestamp, via Intl (handles DST correctly, causal — reads only this timestamp). */
function getEasternHour(timestamp) {
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour12: false, hour: '2-digit' })
  return Number(formatter.format(new Date(timestamp))) % 24
}

/**
 * Builds the regular-session-only series FIRST, before any breakout logic runs. Candle values are
 * never altered, reconstructed, or interpolated — bars outside the defined hours are simply
 * dropped, and the remaining bars keep their original order and values.
 */
export function filterToRegularSessionBars(candles) {
  return candles.filter((candle) => regularSessionEasternHours.includes(getEasternHour(candle.timestamp)))
}

/**
 * Runs the frozen Batch A Momentum Breakout definition, unmodified, entirely on the regular-
 * session-only series for one symbol. Because both signal detection and entry (signalIndex + 1)
 * operate on this same filtered array, the 20-bar lookback can never include an excluded
 * extended-hours bar, and a signal can never enter on an excluded bar — a 15:00 ET signal's entry
 * is whatever regular-session bar comes next in the filtered series (commonly the next trading
 * day's 10:00 ET bar), or the signal is excluded (no fabricated entry) if none exists.
 */
export function runRegularSessionBreakoutForSymbol(candles, symbol) {
  const regularSessionCandles = filterToRegularSessionBars(candles)
  return findMomentumBreakoutSignals(regularSessionCandles)
    .map(({ index, atr }) => buildOccurrence({
      candles: regularSessionCandles, signalIndex: index, symbol, risk: atr, primaryMaxBars: 5, primaryLabel: momentumBreakoutMeta.parameters.primaryOutcome,
    }))
    .filter(Boolean)
}

/**
 * Runs Batch C against the same `datasets` shape Batch A/B use. Returns unavailable (never
 * fabricated) if the SPY/QQQ/IWM universe isn't fully available.
 */
export function runRegularSessionBreakoutResearch(datasets) {
  const bySymbol = Object.fromEntries((datasets ?? []).map((dataset) => [dataset.symbol, dataset]))
  const missingSymbols = strategyDiscoveryUniverse.filter((symbol) => bySymbol[symbol]?.status !== 'AVAILABLE')
  const gitCommit = resolveGitCommit()
  const generatedAt = new Date().toISOString()

  if (missingSymbols.length) {
    return { available: false, missingSymbols, universe: strategyDiscoveryUniverse, timeframe: strategyDiscoveryTimeframe, generatedAt, gitCommit }
  }

  const datasetInfo = []
  const occurrences = strategyDiscoveryUniverse.flatMap((symbol) => {
    const { series, droppedCounts } = synchronizeCandleSeries({ [symbol]: bySymbol[symbol].data.candles })
    const rawCandles = series[symbol]
    const regularSessionCandles = filterToRegularSessionBars(rawCandles)
    datasetInfo.push({
      symbol,
      provider: 'ALPACA HISTORICAL',
      rawCandleCount: rawCandles.length,
      regularSessionCandleCount: regularSessionCandles.length,
      start: rawCandles[0]?.timestamp ?? null,
      end: rawCandles.at(-1)?.timestamp ?? null,
      duplicatesRemoved: droppedCounts[symbol] ?? 0,
    })
    return runRegularSessionBreakoutForSymbol(rawCandles, symbol)
  })

  return {
    available: true,
    universe: strategyDiscoveryUniverse,
    timeframe: strategyDiscoveryTimeframe,
    regularSessionEasternHours,
    datasetInfo,
    generatedAt,
    gitCommit,
    frozenBreakoutDefinition: momentumBreakoutMeta,
    totalQualifyingSignals: occurrences.length,
    summary: summarizeOccurrences(occurrences),
  }
}

/**
 * Builds a side-by-side, non-judgmental diff between a Batch A experiment summary (full-session)
 * and a Batch C summary (regular-session-only). Only reports the numeric differences \u2014 it never
 * labels either version as better, best, superior, validated, or profitable.
 */
export function compareToBatchA(batchASummary, batchCSummary) {
  const diffMetric = (key) => ({
    batchA: batchASummary.overall[key],
    batchC: batchCSummary.overall[key],
    diff: typeof batchASummary.overall[key] === 'number' && typeof batchCSummary.overall[key] === 'number' && Number.isFinite(batchASummary.overall[key]) && Number.isFinite(batchCSummary.overall[key])
      ? batchCSummary.overall[key] - batchASummary.overall[key]
      : null,
  })
  const overall = Object.fromEntries([
    'occurrenceCount', 'winRate', 'profitFactor', 'expectancy', 'medianR', 'totalR', 'maximumDrawdown', 'averageHoldingBars', 'averageMfeR', 'averageMaeR',
  ].map((key) => [key, diffMetric(key)]))

  const groupDiff = (batchAGroup, batchCGroup) => {
    const labels = [...new Set([...batchAGroup.map((row) => row.label), ...batchCGroup.map((row) => row.label)])].sort()
    return labels.map((label) => {
      const a = batchAGroup.find((row) => row.label === label)
      const c = batchCGroup.find((row) => row.label === label)
      return {
        label,
        batchA: a ? { occurrenceCount: a.occurrenceCount, expectancy: a.expectancy, winRate: a.winRate } : null,
        batchC: c ? { occurrenceCount: c.occurrenceCount, expectancy: c.expectancy, winRate: c.winRate } : null,
      }
    })
  }

  const costTierDiff = batchASummary.costTiers.map((tierA) => {
    const tierC = batchCSummary.costTiers.find((tier) => tier.label === tierA.label)
    return {
      label: tierA.label,
      batchA: { occurrenceCount: tierA.metrics.occurrenceCount, expectancy: tierA.metrics.expectancy, winRate: tierA.metrics.winRate },
      batchC: tierC ? { occurrenceCount: tierC.metrics.occurrenceCount, expectancy: tierC.metrics.expectancy, winRate: tierC.metrics.winRate } : null,
    }
  })

  return {
    overall,
    byPeriod: groupDiff(batchASummary.byPeriod, batchCSummary.byPeriod),
    bySymbol: groupDiff(batchASummary.bySymbol, batchCSummary.bySymbol),
    costTiers: costTierDiff,
  }
}
