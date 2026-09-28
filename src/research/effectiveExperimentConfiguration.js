import { robustnessThresholds } from '../backtest/robustness.js'
import { canonicalPairs, relativeValueDefaults } from '../backtest/relativeValueBacktest.js'
import {
  scoreBucketDefinitions,
  componentDefinitions,
  costTierDefinitions,
  signalQualityDefaults,
} from '../backtest/signalQualityBacktest.js'
import { frozenScoreHoldoutDefaults } from '../backtest/frozenScoreHoldoutBacktest.js'
import { yearlyRegimeDefaults } from '../backtest/yearlyRegimeBacktest.js'
import { walkForwardDefaults, walkForwardWindows } from '../backtest/walkForwardRegimeBacktest.js'
import { variantDefinitions, volatilityAwareDefaults } from '../backtest/volatilityAwareVariantsBacktest.js'
import { trendMomentumParameters } from '../backtest/strategyComparison.js'
import { causalRegimeDefaults, getCausalRegimeDefinitions } from '../backtest/causalRegimeBacktest.js'
import { volatilityLabels as walkForwardVolatilityLabels } from '../backtest/walkForwardRegimeBacktest.js'
import { setupScanBacktestDefaults } from '../backtest/strategy.js'
import { strategyDiscoveryUniverse, strategyDiscoveryTimeframe } from '../backtest/strategyDiscovery/discoveryRunner.js'
import { momentumBreakoutMeta } from '../backtest/strategyDiscovery/momentumBreakout.js'
import { meanReversionMeta } from '../backtest/strategyDiscovery/meanReversion.js'
import { priorDayReclaimMeta } from '../backtest/strategyDiscovery/priorDayReclaim.js'
import { volatilityExpansionMeta } from '../backtest/strategyDiscovery/volatilityExpansion.js'
import {
  strategyDiscoveryResearchWindows,
  strategyDiscoveryCostTiers,
} from '../backtest/strategyDiscovery/discoveryMetrics.js'

function scoreQualityDefinitions() {
  return {
    scoreBuckets: scoreBucketDefinitions.map(([label, min, max]) => ({ label, min, max })),
    components: componentDefinitions.map(({ key, label }) => ({ key, label })),
    costTiers: costTierDefinitions.map(([label, costR]) => ({ label, costR })),
  }
}

function robustnessConfiguration(output) {
  return {
    thresholds: [...robustnessThresholds],
    periodCount: 4,
    thresholdRuns: (output.thresholdResults ?? []).map(({ minimumScore, settings }) => ({ minimumScore, settings })),
    periodRuns: (output.periodResults ?? []).map(({ label, start, end, candleCount, settings }) => ({ label, start, end, candleCount, settings })),
  }
}

function experimentConfiguration(experimentId, output) {
  if (!output || typeof output !== 'object') return null
  const options = output.options ?? null
  switch (experimentId) {
    case 'robustness':
      return robustnessConfiguration(output)
    case 'relative-value':
      return { options, canonicalPairs }
    case 'signal-quality':
      return { options, ...scoreQualityDefinitions() }
    case 'frozen-score-holdout':
      return { options, ...scoreQualityDefinitions() }
    case 'yearly-regime':
      return { options, ...scoreQualityDefinitions(), calendarYear: { timezone: 'UTC', annualizationTradingHours: 6.5 * 252 } }
    case 'causal-regime':
      return {
        options,
        ...scoreQualityDefinitions(),
        regimeDefinitions: {
          ...getCausalRegimeDefinitions(),
          primarySymbolRule: 'SPY when present, otherwise first aligned symbol',
          trend: { smaPeriod: 50, slopeLookback: output.options?.trendSlopeLookback ?? causalRegimeDefaults.trendSlopeLookback },
          volatility: {
            measure: '20-bar realized volatility',
            history: 'expanding through the current bar',
            tercileFractions: [1 / 3, 2 / 3],
            warmup: output.options?.volatilityHistoryWarmup ?? causalRegimeDefaults.volatilityHistoryWarmup,
          },
          breadth: { measure: 'aligned universe close versus SMA50', returnLookback: 20 },
        },
      }
    case 'walk-forward-regime':
      return {
        options,
        ...scoreQualityDefinitions(),
        windows: walkForwardWindows,
        volatilityClassification: {
          labels: walkForwardVolatilityLabels,
          measure: '20-bar realized volatility',
          boundaries: 'training-sample terciles, frozen for the test window',
          tercileFractions: [1 / 3, 2 / 3],
        },
      }
    case 'volatility-aware-variants':
      return {
        options,
        ...scoreQualityDefinitions(),
        windows: walkForwardWindows,
        variants: variantDefinitions,
        stressLags: [1, 2],
        volatilityClassification: {
          labels: walkForwardVolatilityLabels,
          measure: '20-bar realized volatility',
          boundaries: 'training-sample terciles, frozen for the test window',
          tercileFractions: [1 / 3, 2 / 3],
        },
      }
    case 'strategy-discovery':
      return {
        universe: output.universe ?? null,
        timeframe: output.timeframe ?? null,
        researchWindows: output.researchWindows ?? strategyDiscoveryResearchWindows,
        costTiers: output.costTiers ?? strategyDiscoveryCostTiers,
        experiments: (output.experiments ?? []).map(({ experimentId: id, parameters }) => ({ experimentId: id, parameters })),
        gitCommit: output.gitCommit ?? null,
      }
    case 'strategy-comparison':
      return {
        bySymbol: Object.fromEntries(Object.entries(output.bySymbol ?? {}).map(([symbol, result]) => [symbol, {
          control: result.control?.settings ?? null,
          trendMomentum: result.trendMomentum?.settings ?? trendMomentumParameters,
        }])),
      }
    default:
      return options ? { options } : null
  }
}

/** Snapshot only resolved inputs/definitions, not experiment outputs or candle data. */
export function createEffectiveExperimentConfiguration(experimentResults = []) {
  return Object.fromEntries(experimentResults.map(({ experimentId, status, nativeOutput }) => [experimentId, {
    status,
    configuration: experimentConfiguration(experimentId, nativeOutput),
  }]))
}

function settingsForLength(defaults, length) {
  return { ...defaults, splitIndex: Math.floor(length * defaults.splitRatio) }
}

function expectedRobustnessConfiguration(candles) {
  const thresholds = [...robustnessThresholds]
  const thresholdRuns = thresholds.map((minimumScore) => ({
    minimumScore,
    settings: settingsForLength({ ...setupScanBacktestDefaults, minimumScore }, candles.length),
  }))
  const periodCount = 4
  const periodSize = Math.ceil(candles.length / periodCount)
  const periodRuns = []
  for (let index = 0; index < periodCount; index += 1) {
    const periodCandles = candles.slice(index * periodSize, (index + 1) * periodSize)
    if (!periodCandles.length) continue
    periodRuns.push({
      label: `Period ${index + 1}`,
      start: periodCandles[0].timestamp,
      end: periodCandles.at(-1).timestamp,
      candleCount: periodCandles.length,
      settings: settingsForLength({ ...setupScanBacktestDefaults, minimumScore: 75 }, periodCandles.length),
    })
  }
  return { thresholds, periodCount, thresholdRuns, periodRuns }
}

const strategyDiscoveryMetas = [momentumBreakoutMeta, meanReversionMeta, priorDayReclaimMeta, volatilityExpansionMeta]

function currentConfigurationFor(experimentId, dataset, codeRevision) {
  let output
  if (experimentId === 'robustness') {
    const candles = dataset?.rawSeriesBySymbol?.SPY ?? []
    const expected = expectedRobustnessConfiguration(candles)
    output = {
      thresholdResults: expected.thresholdRuns,
      periodResults: expected.periodRuns,
    }
  } else if (experimentId === 'relative-value') output = { options: relativeValueDefaults }
  else if (experimentId === 'signal-quality') output = { options: signalQualityDefaults }
  else if (experimentId === 'frozen-score-holdout') output = { options: frozenScoreHoldoutDefaults }
  else if (experimentId === 'yearly-regime') output = { options: yearlyRegimeDefaults }
  else if (experimentId === 'causal-regime') output = { options: causalRegimeDefaults }
  else if (experimentId === 'walk-forward-regime') output = { options: walkForwardDefaults }
  else if (experimentId === 'volatility-aware-variants') output = { options: volatilityAwareDefaults }
  else if (experimentId === 'strategy-discovery') output = {
    universe: strategyDiscoveryUniverse,
    timeframe: strategyDiscoveryTimeframe,
    researchWindows: strategyDiscoveryResearchWindows,
    costTiers: strategyDiscoveryCostTiers,
    experiments: strategyDiscoveryMetas,
    gitCommit: codeRevision,
  }
  else if (experimentId === 'strategy-comparison') {
    const symbols = dataset?.requestedSymbols ?? []
    const bySymbol = {}
    symbols.forEach((symbol) => {
      const candles = dataset?.rawSeriesBySymbol?.[symbol] ?? []
      const fetchResult = dataset?.fetchResultsBySymbol?.[symbol]
      if (!candles.length || fetchResult?.complete === false) return
      bySymbol[symbol] = {
        control: { settings: settingsForLength({ ...setupScanBacktestDefaults, minimumScore: 75 }, candles.length) },
        trendMomentum: { settings: settingsForLength(trendMomentumParameters, candles.length) },
      }
    })
    output = { bySymbol }
  }
  // Use the same projection as persisted runs so the preflight cannot drift from that contract.
  const configuration = experimentConfiguration(experimentId, output)
  return configuration === null ? null : structuredClone(configuration)
}

/**
 * Resolves current code-defined experiment configuration without calling any experiment runner.
 * The dataset must already be reconstructed offline from persisted canonical candles.
 */
export function resolveCurrentEffectiveExperimentConfiguration({ run, dataset, codeRevision } = {}) {
  const context = run?.runContext ?? run ?? {}
  const experimentResults = run?.experimentResults ?? []
  const statusById = new Map(experimentResults.map((result) => [result.experimentId, result.status]))
  const datasetForConfiguration = {
    ...dataset,
    requestedSymbols: context.symbols ?? [],
  }
  const experiments = Object.fromEntries((context.requestedExperiments ?? []).map((experimentId) => [experimentId,
    statusById.get(experimentId) === 'unavailable'
      ? null
      : currentConfigurationFor(experimentId, datasetForConfiguration, codeRevision ?? null),
  ]))
  return {
    input: {
      symbols: [...(context.symbols ?? [])],
      timeframe: context.timeframe ?? null,
      requestedStart: context.requestedStart ?? null,
      requestedEnd: context.requestedEnd ?? null,
      requestedExperiments: [...(context.requestedExperiments ?? [])],
    },
    experiments,
  }
}
