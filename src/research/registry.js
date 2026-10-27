import {
  adaptScannerComponentAblationOutput,
  adaptExecutionResolutionOutput,
  adaptCandidateExitManagementOutput,
  adaptCandidateContextRobustnessOutput,
  adaptJoinedContextOutput,
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

const MULTI_SYMBOL_REQUIREMENTS = ['SPY', 'QQQ', 'IWM']

const STOP_FIRST_AMBIGUITY_POLICY = Object.freeze({
  label: 'Stop-first; ambiguous candles counted',
  explanation: 'When a candle opens between the active stop and target and its later high and low touch both, this simulator records the stop first and counts that trade as ambiguous. The percentage is out of simulated trades in the displayed result. This describes historical candle uncertainty, not an actual trade fill.',
  countStatus: 'reported',
})

const EXCLUDE_AMBIGUITY_POLICY = Object.freeze({
  label: 'Ambiguous outcomes excluded and counted',
  explanation: 'When a candle opens between the stop and target and its later high and low touch both, the candle does not show which barrier came first. Strategy Discovery excludes that outcome from performance statistics and reports its count and share among classifiable in-window outcomes. This is historical-candle uncertainty, not actual trade execution.',
  countStatus: 'reported',
})

const definitions = [
  {
    id: 'scanner-component-ablation', methodologyVersion: 'scanner-component-ablation-1',
    requiredSymbols: MULTI_SYMBOL_REQUIREMENTS, defaultSelected: false,
    title: 'Scanner Component Ablation', category: 'baseline-validation', ambiguityPolicy: STOP_FIRST_AMBIGUITY_POLICY,
    description: 'Ablation = temporarily remove one ingredient to see how much it really contributes. Exploratory score-subtraction study only.',
    methodology: 'Hourly SPY/QQQ/IWM; unchanged research-eligible 75+ baseline, fixed 75 floor after each score subtraction, no rescaling or production changes. EMA/Trend challenger counts the larger existing contribution once. Shared Signal Quality next-open/0.5%-risk/2R/12-observed-bar outcomes; incomplete expired and cross-year outcomes excluded. Causal SPY regimes; UTC decision years; missing inputs separate from false. Under 30 resolved insufficient, under 100 small exploratory sample. Sequential R drawdown, no portfolio/cost model. Repeated comparisons are dependent, not confirmatory or causal evidence.',
    adapter: adaptScannerComponentAblationOutput,
  },
  {
    id: 'candidate-execution-resolution', methodologyVersion: 'candidate-execution-resolution-3', requiredSymbols: [], defaultSelected: false,
    title: 'Trend Up + Medium Volatility — hourly versus five-minute execution', category: 'context-regime',
    ambiguityPolicy: STOP_FIRST_AMBIGUITY_POLICY,
    description: 'Same frozen hourly decisions, paired execution comparison. Automatically requests additional 5Min history; large ranges can be expensive.',
    methodology: 'Research-eligible 75+ causal Uptrend AND Medium volatility. Requires 1Hour decision inputs and 5Min execution history. First supplied 5Min open at or after hourly completion; shared deadline is the end of the baseline’s 12th observed hourly bar, not 12 five-minute bars. Fixed 0.5% risk, 2R target, stop-first and adverse gap fills. Paired resolved outcomes within period/cutoff only; gaps are excluded. All periods and costs are descriptive. Day removals rank the hourly baseline and use identical dates for both methods. Under 30 insufficient, 30–99 exploratory, 100+ descriptive only. No automatic winner; repeated historical exploration is not untouched evidence. Single-timeframe offline replay is unsupported for this mixed-timeframe experiment.',
    adapter: adaptExecutionResolutionOutput,
  },
  {
    id: 'candidate-exit-management', methodologyVersion: 'candidate-exit-management-1', requiredSymbols: [],
    title: 'Trend Up + Medium Volatility — fixed versus trailing exits', category: 'context-regime',
    ambiguityPolicy: STOP_FIRST_AMBIGUITY_POLICY,
    description: 'Paired historical exit comparison for each requested symbol; no automatic winner or trading promotion.',
    methodology: 'Frozen trend-up-medium-volatility-v1 / candidate-context-robustness-2: research-eligible 75+ with causal Uptrend AND Medium volatility. Same signals and next observed hourly opens; 0.5% initial risk, 2R target, 12 observed bars. Challenger activates at +1R and trails 0.3% below the highest price, effective next candle. Paired resolved samples only: both outcomes must finish inside the original Joined Context period and displayed UTC period. Full observed, development 2022–2024, recent 2025–2026 YTD and yearly 2022–2026. Costs 0/0.02/0.05/0.10R. Eastern decision-day concentration ranked separately per exit before costs. Under 30 insufficient, 30–99 exploratory, 100+ descriptive only. Repeated retrospective research, not untouched validation or account equity.',
    adapter: adaptCandidateExitManagementOutput,
  },
  {
    id: 'candidate-context-robustness',
    methodologyVersion: 'candidate-context-robustness-2',
    requiredSymbols: [],
    title: 'Trend Up + Medium Volatility — focused resilience study',
    category: 'context-regime',
    ambiguityPolicy: STOP_FIRST_AMBIGUITY_POLICY,
    description: 'One frozen Joined Context candidate, separately for every requested symbol. Day-removal and session sensitivity; no optimization or trading promotion.',
    methodology: 'Research-eligible 75+; existing causal Uptrend AND Medium volatility. The shared causal helper uses SPY when supplied, otherwise the first alphabetically sorted supplied symbol; the reference is recorded. UTC decision years 2022–2026 capped by run end; development 2022–2024 versus recent 2025–2026. Preserve Joined Context outcome exclusions and exclude outcomes crossing summary boundaries. Eastern decision-time buckets: 09:30–11:00, 11:00–14:00, 14:00–16:00 and outside regular session (clock classification, not an exchange calendar). Day aggregation uses resolved trades per Eastern decision date. Remove up to five highest/bottom days ranked by before-cost total R, date breaks ties; remove the union once and retain the same days at every existing 0/0.02/0.05/0.10R cost tier. Under 30 resolved is insufficient, 30–99 exploratory, 100+ descriptive only. Retrospective repeated exploration, not untouched validation; shadow suitability requires human review.',
    adapter: adaptCandidateContextRobustnessOutput,
  },
  {
    id: 'robustness',
    methodologyVersion: 'robustness-1',
    requiredSymbols: [],
    title: 'Strategy Resilience',
    ambiguityPolicy: STOP_FIRST_AMBIGUITY_POLICY,
    category: 'baseline-validation',
    description: 'Threshold and market-condition sensitivity of the existing setup scan backtest.',
    methodology: 'Run existing threshold and market-condition research over supplied candles.',
    adapter: adaptRobustnessOutput,
  },
  {
    id: 'relative-value',
    methodologyVersion: 'relative-value-3',
    requiredSymbols: [],
    title: 'Relative Value',
    ambiguityPolicy: STOP_FIRST_AMBIGUITY_POLICY,
    category: 'context-regime',
    description: 'Relative-value confirmation and pair diagnostics.',
    methodology: 'Compare the existing baseline with relative-value variants using native summaries.',
    adapter: adaptRelativeValueOutput,
  },
  {
    id: 'signal-quality',
    methodologyVersion: 'signal-quality-3',
    requiredSymbols: MULTI_SYMBOL_REQUIREMENTS,
    title: 'Signal Quality',
    ambiguityPolicy: STOP_FIRST_AMBIGUITY_POLICY,
    category: 'baseline-validation',
    description: 'Score buckets, component analysis, and signal decomposition.',
    methodology: 'Analyze the existing signal catalogue without changing score construction.',
    adapter: adaptSignalQualityOutput,
  },
  {
    id: 'frozen-score-holdout',
    methodologyVersion: 'frozen-score-holdout-2',
    requiredSymbols: MULTI_SYMBOL_REQUIREMENTS,
    title: 'Frozen Score Holdout',
    ambiguityPolicy: STOP_FIRST_AMBIGUITY_POLICY,
    category: 'baseline-validation',
    description: 'Retrospective comparison of the frozen score rule set across an older 2022–2024 window and later development data.',
    methodology: 'Preserve the runner-provided partitions. The older 2022–2024 window is not a forward-in-time or future-period holdout.',
    adapter: adaptFrozenScoreHoldoutOutput,
  },
  {
    id: 'yearly-regime',
    methodologyVersion: 'yearly-regime-2',
    requiredSymbols: MULTI_SYMBOL_REQUIREMENTS,
    title: 'Yearly / Regime Stability',
    ambiguityPolicy: STOP_FIRST_AMBIGUITY_POLICY,
    category: 'baseline-validation',
    description: 'Calendar-year and regime-proxy breakdowns.',
    methodology: 'Summarize the runner-provided yearly partitions and regime proxies.',
    adapter: adaptYearlyRegimeOutput,
  },
  {
    id: 'causal-regime',
    methodologyVersion: 'causal-regime-2',
    requiredSymbols: MULTI_SYMBOL_REQUIREMENTS,
    title: 'Causal Regime',
    ambiguityPolicy: STOP_FIRST_AMBIGUITY_POLICY,
    category: 'context-regime',
    description: 'Causal trend, volatility, breadth, and combined regime breakdowns.',
    methodology: 'Preserve regime-at-signal groupings and native evidence tables.',
    adapter: adaptCausalRegimeOutput,
  },
  {
    id: 'walk-forward-regime',
    methodologyVersion: 'walk-forward-regime-2',
    requiredSymbols: MULTI_SYMBOL_REQUIREMENTS,
    title: 'Walk-Forward Regime',
    ambiguityPolicy: STOP_FIRST_AMBIGUITY_POLICY,
    category: 'context-regime',
    description: 'Walk-forward training and test-window analysis.',
    methodology: 'Retain runner-defined training boundaries and test-period evidence.',
    adapter: adaptWalkForwardRegimeOutput,
  },
  {
    id: 'volatility-aware-variants',
    methodologyVersion: 'volatility-aware-variants-2',
    requiredSymbols: MULTI_SYMBOL_REQUIREMENTS,
    title: 'Volatility-Aware Variants',
    ambiguityPolicy: STOP_FIRST_AMBIGUITY_POLICY,
    category: 'context-regime',
    description: 'Volatility-aware variants, stress tests, and control differences.',
    methodology: 'Expose native variant, pooled, consistency, and stress-test outputs.',
    adapter: adaptVolatilityAwareVariantsOutput,
  },
  {
    id: 'strategy-discovery',
    methodologyVersion: 'strategy-discovery-2',
    requiredSymbols: MULTI_SYMBOL_REQUIREMENTS,
    title: 'Strategy Discovery',
    ambiguityPolicy: EXCLUDE_AMBIGUITY_POLICY,
    category: 'discovery',
    description: 'Existing discovery batches and candidate-family research outputs.',
    methodology: 'Preserve discovery occurrence semantics, exclusions, and availability state.',
    adapter: adaptStrategyDiscoveryOutput,
  },
  {
    id: 'strategy-comparison',
    methodologyVersion: 'strategy-comparison-1',
    requiredSymbols: [],
    title: 'Strategy Comparison',
    ambiguityPolicy: STOP_FIRST_AMBIGUITY_POLICY,
    category: 'baseline-validation',
    description: 'Control versus trend and momentum comparison.',
    methodology: 'Keep the two native strategy result structures side by side.',
    adapter: adaptStrategyComparisonOutput,
  },
  {
    id: 'joined-context', methodologyVersion: 'joined-context-1', requiredSymbols: MULTI_SYMBOL_REQUIREMENTS,
    title: 'Joined Context Study', category: 'context-regime', ambiguityPolicy: STOP_FIRST_AMBIGUITY_POLICY,
    description: 'Ten predefined context groups joined on the same research-eligible 75+ occurrence.',
    methodology: 'Development 2022–2024; holdout 2025; observational follow-up 2026. Hourly completed-bar contexts; no optimization. Outcomes must finish within their decision period. Discovery VWAP uses UTC dates; first-observed range uses Eastern dates. Repeatedly explored holdout data is not untouched evidence.',
    adapter: adaptJoinedContextOutput,
  },
]

export const researchRegistry = Object.freeze(definitions.map((definition) => Object.freeze({
  ...definition,
  requiredSymbols: Object.freeze([...definition.requiredSymbols]),
})))

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
