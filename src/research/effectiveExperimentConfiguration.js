import { robustnessThresholds } from '../backtest/robustness.js'
import { canonicalPairs } from '../backtest/relativeValueBacktest.js'
import {
  scoreBucketDefinitions,
  componentDefinitions,
  costTierDefinitions,
} from '../backtest/signalQualityBacktest.js'
import { walkForwardWindows } from '../backtest/walkForwardRegimeBacktest.js'
import { variantDefinitions } from '../backtest/volatilityAwareVariantsBacktest.js'
import { trendMomentumParameters } from '../backtest/strategyComparison.js'
import { causalRegimeDefaults, getCausalRegimeDefinitions } from '../backtest/causalRegimeBacktest.js'
import { volatilityLabels as walkForwardVolatilityLabels } from '../backtest/walkForwardRegimeBacktest.js'
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
