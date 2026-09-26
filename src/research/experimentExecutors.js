import { enrichHistoricalCandles } from '../data/marketData.js'
import { runCausalRegimeResearch } from '../backtest/causalRegimeBacktest.js'
import { runFrozenScoreHoldoutResearch } from '../backtest/frozenScoreHoldoutBacktest.js'
import { runRelativeValueResearch } from '../backtest/relativeValueBacktest.js'
import { runMarketConditionResearch, runThresholdResearch } from '../backtest/robustness.js'
import { runSignalQualityResearch } from '../backtest/signalQualityBacktest.js'
import { runStrategyComparison } from '../backtest/strategyComparison.js'
import { runStrategyDiscoveryBatchA } from '../backtest/strategyDiscovery/discoveryRunner.js'
import { runVolatilityAwareVariantsResearch } from '../backtest/volatilityAwareVariantsBacktest.js'
import { runWalkForwardRegimeResearch } from '../backtest/walkForwardRegimeBacktest.js'
import { runYearlyRegimeResearch } from '../backtest/yearlyRegimeBacktest.js'

const MULTI_SYMBOL_UNIVERSE = Object.freeze(['SPY', 'QQQ', 'IWM'])
const enrichedByRawCandles = new WeakMap()

function getEnrichedCandles(rawCandles) {
  let enriched = enrichedByRawCandles.get(rawCandles)
  if (!enriched) {
    enriched = enrichHistoricalCandles(rawCandles)
    enrichedByRawCandles.set(rawCandles, enriched)
  }
  return enriched
}

function freezeExecutor({ requiredSymbols = [], execute }) {
  return Object.freeze({ requiredSymbols: Object.freeze([...requiredSymbols]), execute })
}

function rawSeriesFor(symbols, availableBySymbol) {
  return Object.fromEntries(symbols.map((symbol) => [symbol, availableBySymbol.get(symbol).candles]))
}

function discoveryDatasetsFor(symbols, availableBySymbol) {
  return symbols.map((symbol) => {
    const source = availableBySymbol.get(symbol)
    if (source.nativeDataset) return source.nativeDataset
    return { symbol, status: 'AVAILABLE', data: { candles: source.candles } }
  })
}

/**
 * Explicit native execution lookup. Inputs are existing research-lab dataset entries
 * (`{ symbol, status, data: { candles } }`) or an existing raw series map (`{ SPY: candles }`).
 * No executor fetches, aligns, filters, or rewrites the shared raw candles.
 */
export const researchExperimentExecutors = Object.freeze({
  robustness: freezeExecutor({
    requiredSymbols: ['SPY'],
    execute: ({ availableBySymbol }) => {
      const candles = getEnrichedCandles(availableBySymbol.get('SPY').candles)
      return {
        thresholdResults: runThresholdResearch(candles),
        periodResults: runMarketConditionResearch(candles),
      }
    },
  }),
  'relative-value': freezeExecutor({
    requiredSymbols: MULTI_SYMBOL_UNIVERSE,
    execute: ({ availableBySymbol }) => runRelativeValueResearch(rawSeriesFor(MULTI_SYMBOL_UNIVERSE, availableBySymbol)),
  }),
  'signal-quality': freezeExecutor({
    requiredSymbols: MULTI_SYMBOL_UNIVERSE,
    execute: ({ availableBySymbol }) => runSignalQualityResearch(rawSeriesFor(MULTI_SYMBOL_UNIVERSE, availableBySymbol)),
  }),
  'frozen-score-holdout': freezeExecutor({
    requiredSymbols: MULTI_SYMBOL_UNIVERSE,
    execute: ({ availableBySymbol }) => runFrozenScoreHoldoutResearch(rawSeriesFor(MULTI_SYMBOL_UNIVERSE, availableBySymbol)),
  }),
  'yearly-regime': freezeExecutor({
    requiredSymbols: MULTI_SYMBOL_UNIVERSE,
    execute: ({ availableBySymbol }) => runYearlyRegimeResearch(rawSeriesFor(MULTI_SYMBOL_UNIVERSE, availableBySymbol)),
  }),
  'causal-regime': freezeExecutor({
    requiredSymbols: MULTI_SYMBOL_UNIVERSE,
    execute: ({ availableBySymbol }) => runCausalRegimeResearch(rawSeriesFor(MULTI_SYMBOL_UNIVERSE, availableBySymbol)),
  }),
  'walk-forward-regime': freezeExecutor({
    requiredSymbols: MULTI_SYMBOL_UNIVERSE,
    execute: ({ availableBySymbol }) => runWalkForwardRegimeResearch(rawSeriesFor(MULTI_SYMBOL_UNIVERSE, availableBySymbol)),
  }),
  'volatility-aware-variants': freezeExecutor({
    requiredSymbols: MULTI_SYMBOL_UNIVERSE,
    execute: ({ availableBySymbol }) => runVolatilityAwareVariantsResearch(rawSeriesFor(MULTI_SYMBOL_UNIVERSE, availableBySymbol)),
  }),
  'strategy-discovery': freezeExecutor({
    requiredSymbols: MULTI_SYMBOL_UNIVERSE,
    execute: ({ availableBySymbol }) => runStrategyDiscoveryBatchA(discoveryDatasetsFor(MULTI_SYMBOL_UNIVERSE, availableBySymbol)),
  }),
  'strategy-comparison': freezeExecutor({
    execute: ({ availableBySymbol, requestedSymbols }) => ({
      bySymbol: Object.fromEntries(requestedSymbols
        .filter((symbol) => availableBySymbol.has(symbol))
        .map((symbol) => {
          const rawCandles = availableBySymbol.get(symbol).candles
          return [symbol, runStrategyComparison(rawCandles, getEnrichedCandles(rawCandles))]
        })),
    }),
  }),
})

function datasetSymbolEntry(dataset, symbol) {
  if (dataset?.rawSeriesBySymbol && typeof dataset.rawSeriesBySymbol === 'object') {
    const candles = dataset.rawSeriesBySymbol[symbol]
    if (!Array.isArray(candles)) return null
    return {
      complete: dataset.fetchResultsBySymbol?.[symbol]?.complete,
      candles,
    }
  }

  if (Array.isArray(dataset)) {
    const nativeDataset = dataset.find((entry) => entry?.symbol === symbol)
    if (!nativeDataset) return null
    return {
      status: nativeDataset.status,
      complete: nativeDataset.data?.complete ?? nativeDataset.complete,
      candles: nativeDataset.data?.candles ?? nativeDataset.candles,
      nativeDataset,
    }
  }

  const entry = dataset?.[symbol]
  if (Array.isArray(entry)) return { candles: entry }
  if (entry && typeof entry === 'object') {
    return {
      status: entry.status,
      complete: entry.complete ?? entry.data?.complete,
      candles: entry.data?.candles ?? entry.candles,
    }
  }
  return null
}

function isAvailableEntry(entry) {
  if (!entry || !Array.isArray(entry.candles) || entry.candles.length === 0) return false
  if (entry.status !== undefined && entry.status !== 'AVAILABLE') return false
  // Existing research labs do not run on fetches the provider marks incomplete.
  if (entry.complete === false) return false
  return true
}

function errorDetails(error) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(error.code !== undefined ? { code: error.code } : {}),
      ...(error.stack ? { stack: error.stack } : {}),
    }
  }
  return { name: 'NonErrorThrown', message: String(error), thrownValue: error }
}

function executionResult(experimentId, status, nativeOutput = null, error = null) {
  return { experimentId, status, nativeOutput, error }
}

/** Creates a dispatcher; the optional lookup is a narrow seam for isolated unit tests. */
export function createResearchExperimentDispatcher(executorLookup = researchExperimentExecutors) {
  return function executeResearchExperiment(experimentId, dataset, runContext) {
    const context = runContext ?? {}
    const executor = executorLookup?.[experimentId]
    if (!executor) {
      return executionResult(experimentId, 'failed', null, {
        name: 'UnknownResearchExperimentError',
        message: `No native executor registered for research experiment: ${experimentId}`,
      })
    }

    const requestedSymbols = Array.isArray(context.symbols)
      ? [...new Set(context.symbols.filter((symbol) => typeof symbol === 'string').map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))]
      : []
    const symbolsToValidate = executor.requiredSymbols ?? []
    const availableBySymbol = new Map()
    symbolsToValidate.forEach((symbol) => {
      const entry = datasetSymbolEntry(dataset, symbol)
      if (isAvailableEntry(entry)) availableBySymbol.set(symbol, entry)
    })

    if (symbolsToValidate.some((symbol) => !availableBySymbol.has(symbol))) {
      return executionResult(experimentId, 'unavailable')
    }

    const requestedAvailableSymbols = requestedSymbols.filter((symbol) => {
      const entry = datasetSymbolEntry(dataset, symbol)
      if (!isAvailableEntry(entry)) return false
      availableBySymbol.set(symbol, entry)
      return true
    })
    if (experimentId === 'strategy-comparison' && requestedAvailableSymbols.length === 0) {
      return executionResult(experimentId, 'unavailable')
    }

    try {
      const nativeOutput = executor.execute({
        dataset,
        runContext: context,
        availableBySymbol,
        requestedSymbols: experimentId === 'strategy-comparison' ? requestedAvailableSymbols : requestedSymbols,
      })
      if (nativeOutput?.incomplete === true) return executionResult(experimentId, 'incomplete', nativeOutput)
      if (nativeOutput?.available === false) return executionResult(experimentId, 'unavailable', nativeOutput)
      return executionResult(experimentId, 'succeeded', nativeOutput)
    } catch (error) {
      return executionResult(experimentId, 'failed', null, errorDetails(error))
    }
  }
}

export const executeResearchExperiment = createResearchExperimentDispatcher()