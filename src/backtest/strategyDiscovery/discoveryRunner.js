// Strategy Discovery — Batch A orchestrator.
// Wires the four independent Batch A experiments (Momentum/Breakout, Mean Reversion,
// Prior-Day High Reclaim, Volatility Compression\u2192Expansion) to real, already-fetched Alpaca
// historical data (the same `datasets` shape already used by the other research labs — fetched
// server-side via server/alpacaProxy.js and never falling back to demo data). Never fabricates
// results: an experiment is reported as unavailable rather than filled in with invented numbers.
import { synchronizeCandleSeries } from '../relativeValue.js'
import {
  strategyDiscoveryCostTiers,
  strategyDiscoveryResearchWindows,
  summarizeOccurrences,
  summarizeSecondaryOutcome,
} from './discoveryMetrics.js'
import { momentumBreakoutMeta, runMomentumBreakoutForSymbol } from './momentumBreakout.js'
import { meanReversionMeta, runMeanReversionForSymbol } from './meanReversion.js'
import { priorDayReclaimMeta, runPriorDayReclaimForSymbol } from './priorDayReclaim.js'
import { volatilityExpansionMeta, runVolatilityExpansionForSymbol } from './volatilityExpansion.js'

export const strategyDiscoveryUniverse = ['SPY', 'QQQ', 'IWM']
export const strategyDiscoveryTimeframe = '1Hour'

const BATCH_A_EXPERIMENTS = [
  { meta: momentumBreakoutMeta, runForSymbol: runMomentumBreakoutForSymbol },
  { meta: meanReversionMeta, runForSymbol: runMeanReversionForSymbol },
  { meta: priorDayReclaimMeta, runForSymbol: runPriorDayReclaimForSymbol },
  { meta: volatilityExpansionMeta, runForSymbol: runVolatilityExpansionForSymbol },
]

/** Reports the running app's git commit if the build exposed one; never invents a value. */
function resolveGitCommit() {
  const commit = typeof import.meta !== 'undefined' ? import.meta.env?.VITE_GIT_COMMIT : undefined
  return commit || 'unavailable (not exposed by the current build/runtime)'
}

/**
 * Deduplicates one symbol's raw candle series and records data-integrity metadata. Reuses the
 * existing synchronizeCandleSeries() from Experiment #1 rather than duplicating dedup logic —
 * called with a single symbol, it still performs full per-symbol duplicate detection and sorting,
 * it just has nothing else to intersect against.
 */
function prepareSymbolData(symbol, candles) {
  const { series, droppedCounts, duplicatesBySymbol } = synchronizeCandleSeries({ [symbol]: candles })
  const cleaned = series[symbol]
  return {
    candles: cleaned,
    dataset: {
      symbol,
      provider: 'ALPACA HISTORICAL',
      candleCount: cleaned.length,
      start: cleaned[0]?.timestamp ?? null,
      end: cleaned.at(-1)?.timestamp ?? null,
      duplicatesRemoved: droppedCounts[symbol] ?? 0,
      duplicateTimestamps: duplicatesBySymbol[symbol] ?? [],
    },
  }
}

/**
 * Runs Batch A against the provided datasets (same shape as the other research labs: an array of
 * { symbol, status, data } where status === 'AVAILABLE' implies real, complete Alpaca historical
 * data). Returns per-experiment results only for symbols/datasets that are actually available; if
 * the SPY/QQQ/IWM universe is not fully available, every experiment is reported as unavailable.
 */
export function runStrategyDiscoveryBatchA(datasets) {
  const bySymbol = Object.fromEntries((datasets ?? []).map((dataset) => [dataset.symbol, dataset]))
  const missingSymbols = strategyDiscoveryUniverse.filter((symbol) => bySymbol[symbol]?.status !== 'AVAILABLE')
  const gitCommit = resolveGitCommit()
  const generatedAt = new Date().toISOString()

  if (missingSymbols.length) {
    return {
      available: false,
      missingSymbols,
      universe: strategyDiscoveryUniverse,
      timeframe: strategyDiscoveryTimeframe,
      generatedAt,
      gitCommit,
    }
  }

  const symbolData = strategyDiscoveryUniverse.map((symbol) => prepareSymbolData(symbol, bySymbol[symbol].data.candles))

  const experiments = BATCH_A_EXPERIMENTS.map(({ meta, runForSymbol }) => {
    const occurrences = symbolData.flatMap(({ candles, dataset }) => runForSymbol(candles, dataset.symbol))
    const summary = summarizeOccurrences(occurrences)
    return {
      experimentId: meta.experimentId,
      label: meta.label,
      hypothesis: meta.hypothesis,
      parameters: meta.parameters,
      summary,
      secondaryOutcomes: {
        plus1RBefore1RWithin5: summarizeSecondaryOutcome(occurrences, 'secondary1R5'),
        plus2RBefore1RWithin10: summarizeSecondaryOutcome(occurrences, 'secondary2R10'),
      },
    }
  })

  return {
    available: true,
    universe: strategyDiscoveryUniverse,
    timeframe: strategyDiscoveryTimeframe,
    researchWindows: strategyDiscoveryResearchWindows,
    costTiers: strategyDiscoveryCostTiers,
    datasetInfo: symbolData.map(({ dataset }) => dataset),
    generatedAt,
    gitCommit,
    experiments,
  }
}
