import { enrichHistoricalCandles } from '../data/marketData.js'
import { runScannerScoreStability } from '../backtest/scannerScoreRedundancyStability.js'
import { runScannerComponentAblation } from '../backtest/scannerComponentAblation.js'
import { runJoinedContextStudy } from '../backtest/joinedContextStudy.js'
import { runCandidateContextRobustness } from '../backtest/candidateContextRobustness.js'
import { runCandidateExitManagement } from '../backtest/candidateExitManagement.js'
import { runCandidateExecutionResolution } from '../backtest/candidateExecutionResolution.js'
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
import { getResearchExperiment } from './registry.js'

const MULTI_SYMBOL_UNIVERSE = ['SPY', 'QQQ', 'IWM']
const enrichedByRawCandles = new WeakMap()

function getEnrichedCandles(rawCandles) {
  let enriched = enrichedByRawCandles.get(rawCandles)
  if (!enriched) {
    enriched = enrichHistoricalCandles(rawCandles)
    enrichedByRawCandles.set(rawCandles, enriched)
  }
  return enriched
}

function freezeExecutor(experimentId, execute) {
  const definition = getResearchExperiment(experimentId)
  if (!definition) throw new Error(`No registry metadata for research experiment: ${experimentId}`)
  return Object.freeze({ requiredSymbols: definition.requiredSymbols, execute })
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
  'scanner-score-redundancy-stability': freezeExecutor('scanner-score-redundancy-stability', ({ dataset, availableBySymbol, runContext }) => {
    if (runContext.timeframe !== '1Hour') return { available: false, reason: 'Score stability requires 1Hour inputs.' }
    const raw = Object.fromEntries(MULTI_SYMBOL_UNIVERSE.map(symbol => [symbol,
      dataset.calculationSeries?.find(s => s.symbol === symbol && s.timeframe === '1Hour')?.candles ??
      dataset.fetchResultsBySymbol?.[symbol]?.calculationCandles ?? availableBySymbol.get(symbol).candles,
    ]))
    return runScannerScoreStability(raw, { requestedStart: runContext.requestedStart, requestedEnd: runContext.requestedEnd ?? runContext.requestedAt })
  }),
  'scanner-component-ablation': freezeExecutor('scanner-component-ablation', ({ availableBySymbol, runContext }) => {
    if (runContext.timeframe !== '1Hour') return { available: false, reason: 'Scanner ablation requires 1Hour inputs.' }
    return runScannerComponentAblation(rawSeriesFor(MULTI_SYMBOL_UNIVERSE, availableBySymbol), runContext)
  }),
  'candidate-execution-resolution': freezeExecutor('candidate-execution-resolution', ({ dataset, availableBySymbol, requestedSymbols, runContext }) => {
    if (runContext.timeframe !== '1Hour') return { available: false, reason: 'Execution comparison requires 1Hour decision inputs.' }
    if (dataset.adjustmentMode === 'mixed') return { available: false, reason: 'Hourly and 5Min inputs must use compatible price-adjustment modes.' }
    const execution = dataset.executionInputs
    const missing = requestedSymbols.filter((symbol) => !isAvailableEntry(execution?.fetchResultsBySymbol?.[symbol]))
    if (missing.length) return { available: false, reason: 'Complete 5Min inputs are required for every requested symbol.', missingSymbols: missing }
    const output = runCandidateExecutionResolution(rawSeriesFor([...requestedSymbols].sort(), availableBySymbol),
      Object.fromEntries(requestedSymbols.map((symbol) => [symbol, execution.fetchResultsBySymbol[symbol].candles])),
      { requestedStart: runContext.requestedStart, requestedEnd: runContext.requestedEnd ?? undefined })
    return { ...output, inputIdentity: dataset.effectiveMetadata?.executionResolution ?? null }
  }),
  'candidate-exit-management': freezeExecutor('candidate-exit-management', ({ availableBySymbol, requestedSymbols, runContext }) => runCandidateExitManagement(rawSeriesFor([...requestedSymbols].sort(), availableBySymbol), { requestedStart: runContext?.requestedStart, requestedEnd: runContext?.requestedEnd ?? undefined })),
  'candidate-context-robustness': freezeExecutor('candidate-context-robustness', ({ availableBySymbol, requestedSymbols, runContext }) => runCandidateContextRobustness(rawSeriesFor([...requestedSymbols].sort(), availableBySymbol), { requestedStart: runContext?.requestedStart, requestedEnd: runContext?.requestedEnd ?? undefined })),
  'joined-context': freezeExecutor('joined-context', ({ availableBySymbol, runContext }) => runJoinedContextStudy(rawSeriesFor(MULTI_SYMBOL_UNIVERSE, availableBySymbol), { requestedStart: runContext?.requestedStart, requestedEnd: runContext?.requestedEnd ?? undefined })),
    robustness: freezeExecutor('robustness', ({ availableBySymbol }) => {
    const thresholdResults = []
    const periodResults = []

    for (const [symbol, source] of availableBySymbol) {
      const candles = getEnrichedCandles(source.candles)

      thresholdResults.push(
        ...runThresholdResearch(candles).map((result) => ({
          ...result,
          symbol,
        })),
      )

      periodResults.push(
        ...runMarketConditionResearch(candles).map((result) => ({
          ...result,
          symbol,
        })),
      )
    }

    return { thresholdResults, periodResults }
  }),
    'relative-value': freezeExecutor('relative-value', ({ availableBySymbol, requestedSymbols }) => {
    const symbols = requestedSymbols.filter((symbol) => availableBySymbol.has(symbol))
    if (symbols.length < 2) {
      return {
        available: false,
        reason: 'Relative Value requires at least two selected symbols with available data.',
      }
    }
    return runRelativeValueResearch(rawSeriesFor(symbols, availableBySymbol))
  }),
  'signal-quality': freezeExecutor('signal-quality', ({ availableBySymbol }) => runSignalQualityResearch(rawSeriesFor(MULTI_SYMBOL_UNIVERSE, availableBySymbol))),
  'frozen-score-holdout': freezeExecutor('frozen-score-holdout', ({ availableBySymbol }) => runFrozenScoreHoldoutResearch(rawSeriesFor(MULTI_SYMBOL_UNIVERSE, availableBySymbol))),
  'yearly-regime': freezeExecutor('yearly-regime', ({ availableBySymbol }) => runYearlyRegimeResearch(rawSeriesFor(MULTI_SYMBOL_UNIVERSE, availableBySymbol))),
  'causal-regime': freezeExecutor('causal-regime', ({ availableBySymbol }) => runCausalRegimeResearch(rawSeriesFor(MULTI_SYMBOL_UNIVERSE, availableBySymbol))),
  'walk-forward-regime': freezeExecutor('walk-forward-regime', ({ availableBySymbol }) => runWalkForwardRegimeResearch(rawSeriesFor(MULTI_SYMBOL_UNIVERSE, availableBySymbol))),
  'volatility-aware-variants': freezeExecutor('volatility-aware-variants', ({ availableBySymbol }) => runVolatilityAwareVariantsResearch(rawSeriesFor(MULTI_SYMBOL_UNIVERSE, availableBySymbol))),
  'strategy-discovery': freezeExecutor('strategy-discovery', ({ availableBySymbol }) => runStrategyDiscoveryBatchA(discoveryDatasetsFor(MULTI_SYMBOL_UNIVERSE, availableBySymbol))),
  'strategy-comparison': freezeExecutor('strategy-comparison', ({ availableBySymbol, requestedSymbols }) => ({
      bySymbol: Object.fromEntries(requestedSymbols
        .filter((symbol) => availableBySymbol.has(symbol))
        .map((symbol) => {
          const rawCandles = availableBySymbol.get(symbol).candles
          return [symbol, runStrategyComparison(rawCandles, getEnrichedCandles(rawCandles))]
        })),
    })),
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
    const usesSelectedSymbols = experimentId === 'relative-value' || experimentId === 'strategy-comparison'
    const symbolsToValidate = usesSelectedSymbols ? [] : executor.requiredSymbols ?? []
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
    if (['candidate-context-robustness', 'candidate-exit-management', 'candidate-execution-resolution'].includes(experimentId) && (!requestedSymbols.length || requestedAvailableSymbols.length !== requestedSymbols.length)) {
      return executionResult(experimentId, 'unavailable', { available: false, reason: 'Every requested symbol needs complete hourly inputs; no requested symbol is silently dropped.', missingSymbols: requestedSymbols.filter((symbol) => !availableBySymbol.has(symbol)) })
    }
    if (
      (experimentId === 'strategy-comparison' && requestedAvailableSymbols.length === 0) ||
      (experimentId === 'relative-value' && requestedAvailableSymbols.length < 2)
) {
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
