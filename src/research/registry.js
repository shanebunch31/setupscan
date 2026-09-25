import {
  adaptCausalRegimeOutput,
  adaptFrozenScoreHoldoutOutput,
  adaptRelativeValueOutput,
  adaptRobustnessOutput,
  adaptSignalQualityOutput,
  adaptStrategyComparisonOutput,
  adaptStrategyDiscoveryOutput,
  adaptVolatilityAwareVariantsOutput,
  adaptWalkForwardRegimeOutput,
  adaptYearlyRegimeOutput,
} from './adapters.js'

const definitions = [
  {
    id: 'robustness',
    title: 'Robustness',
    category: 'baseline-validation',
    description: 'Threshold and market-condition sensitivity of the existing setup scan backtest.',
    methodology: 'Run existing threshold and market-condition research over supplied candles.',
    adapter: adaptRobustnessOutput,
  },
  {
    id: 'relative-value',
    title: 'Relative Value',
    category: 'context-regime',
    description: 'Relative-value confirmation and pair diagnostics.',
    methodology: 'Compare the existing baseline with relative-value variants using native summaries.',
    adapter: adaptRelativeValueOutput,
  },
  {
    id: 'signal-quality',
    title: 'Signal Quality',
    category: 'baseline-validation',
    description: 'Score buckets, component analysis, and signal decomposition.',
    methodology: 'Analyze the existing signal catalogue without changing score construction.',
    adapter: adaptSignalQualityOutput,
  },
  {
    id: 'frozen-score-holdout',
    title: 'Frozen Score Holdout',
    category: 'baseline-validation',
    description: 'Development and holdout comparison for the frozen score rule set.',
    methodology: 'Preserve the runner-provided development and holdout partitions.',
    adapter: adaptFrozenScoreHoldoutOutput,
  },
  {
    id: 'yearly-regime',
    title: 'Yearly / Regime Stability',
    category: 'baseline-validation',
    description: 'Calendar-year and regime-proxy breakdowns.',
    methodology: 'Summarize the runner-provided yearly partitions and regime proxies.',
    adapter: adaptYearlyRegimeOutput,
  },
  {
    id: 'causal-regime',
    title: 'Causal Regime',
    category: 'context-regime',
    description: 'Causal trend, volatility, breadth, and combined regime breakdowns.',
    methodology: 'Preserve regime-at-signal groupings and native evidence tables.',
    adapter: adaptCausalRegimeOutput,
  },
  {
    id: 'walk-forward-regime',
    title: 'Walk-Forward Regime',
    category: 'context-regime',
    description: 'Walk-forward training and test-window analysis.',
    methodology: 'Retain runner-defined training boundaries and test-period evidence.',
    adapter: adaptWalkForwardRegimeOutput,
  },
  {
    id: 'volatility-aware-variants',
    title: 'Volatility-Aware Variants',
    category: 'context-regime',
    description: 'Volatility-aware variants, stress tests, and control differences.',
    methodology: 'Expose native variant, pooled, consistency, and stress-test outputs.',
    adapter: adaptVolatilityAwareVariantsOutput,
  },
  {
    id: 'strategy-discovery',
    title: 'Strategy Discovery',
    category: 'discovery',
    description: 'Existing discovery batches and candidate-family research outputs.',
    methodology: 'Preserve discovery occurrence semantics, exclusions, and availability state.',
    adapter: adaptStrategyDiscoveryOutput,
  },
  {
    id: 'strategy-comparison',
    title: 'Strategy Comparison',
    category: 'baseline-validation',
    description: 'Control versus trend and momentum comparison.',
    methodology: 'Keep the two native strategy result structures side by side.',
    adapter: adaptStrategyComparisonOutput,
  },
]

export const researchRegistry = Object.freeze(definitions.map((definition) => Object.freeze({ ...definition })))

export function listResearchExperiments() {
  return researchRegistry.map((definition) => ({ ...definition }))
}

export function getResearchExperiment(id) {
  return researchRegistry.find((definition) => definition.id === id) ?? null
}

export function createResearchRecordForExperiment(id, nativePayload, context = {}) {
  const definition = getResearchExperiment(id)
  if (!definition) throw new Error(`Unknown research experiment: ${id}`)
  return definition.adapter(definition, nativePayload, context)
}
