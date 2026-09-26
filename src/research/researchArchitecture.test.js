import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createResearchRecordForExperiment, getResearchExperiment, listResearchExperiments, researchRegistry } from './registry.js'
import { adaptStandardResearchOutput } from './adapters.js'
import { createFinding, createResearchRecord, COST_MODEL_STATUSES, FINDING_STATES, RESEARCH_STATUSES } from './researchRecord.js'

// --- Small fixtures shaped exactly like the real runXResearch() outputs (src/backtest/*.js). ---

function makeCandle(symbol, timeframe, timestamp) {
  return { symbol, timeframe, timestamp, open: 100, high: 101, low: 99, close: 100.5, volume: 1000 }
}

function makeOverall(overrides = {}) {
  return {
    tradeCount: 10,
    winRate: 0.6,
    profitFactor: 1.8,
    expectancy: 0.3,
    averageR: 0.3,
    totalR: 3,
    maximumDrawdown: 1.2,
    averageHoldingTime: 90,
    ...overrides,
  }
}

// Real strategy.js getMetrics() shape: no `totalR` field — gross profit is `totalPositiveR`,
// gross loss is `totalNegativeR`, and the actual net total R is `netReturn`.
function makeStrategyJsMetrics(overrides = {}) {
  return {
    totalTrades: 10,
    numberOfTrades: 10,
    winRate: 0.6,
    profitFactor: 1.8,
    expectancy: 0.3,
    averageR: 0.3,
    totalPositiveR: 5,
    totalNegativeR: -2,
    netReturn: 3,
    maximumDrawdown: 1.2,
    averageHoldingTime: 90,
    ...overrides,
  }
}

// Real strategyComparison.js calculateResearchMetrics() shape (trendMomentum): no `totalR` and
// no `totalPositiveR` at all — only grossProfit/grossLoss.
function makeTrendMomentumMetrics(overrides = {}) {
  return {
    totalTrades: 9,
    winRate: 0.55,
    profitFactor: 1.5,
    expectancy: 0.25,
    averageR: 0.25,
    grossProfit: 4,
    grossLoss: -1.5,
    maximumDrawdown: 1,
    averageHoldingTime: 80,
    ...overrides,
  }
}

test('registry identifies all existing research areas and adapter boundaries', () => {
  assert.equal(researchRegistry.length, 10)
  assert.deepEqual(listResearchExperiments().map((entry) => entry.id), [
    'robustness',
    'relative-value',
    'signal-quality',
    'frozen-score-holdout',
    'yearly-regime',
    'causal-regime',
    'walk-forward-regime',
    'volatility-aware-variants',
    'strategy-discovery',
    'strategy-comparison',
  ])
  assert.equal(getResearchExperiment('signal-quality').category, 'baseline-validation')
  researchRegistry.forEach((definition) => assert.equal(typeof definition.adapter, 'function'))
})

test('generic adaptStandardResearchOutput preserves native output and envelope fields', () => {
  const nativePayload = {
    metrics: { totalTrades: 12, averageR: 0.4 },
    aligned: { timestamps: ['a'] },
    generatedAt: 'native-generated-at',
    gitCommit: 'native-commit',
  }
  const definition = { id: 'generic', title: 'Generic', category: 'baseline-validation' }
  const record = adaptStandardResearchOutput(definition, nativePayload, {
    symbols: ['SPY'],
    provider: 'alpaca',
    actualStart: '2026-01-01',
    actualEnd: '2026-01-31',
    parameters: { lookback: 10 },
    provenance: { source: 'test', runId: 'run-test', datasetId: 'dataset-test', requestedAt: 'requested-at' },
  })

  assert.equal(record.status, 'completed')
  assert.equal(record.nativePayload, nativePayload)
  assert.deepEqual(record.metrics, { tradeCount: 12, averageR: 0.4 })
  assert.deepEqual(record.input.symbols, ['SPY'])
  assert.deepEqual(record.parameters, { lookback: 10 })
  assert.deepEqual(record.provenance, {
    generatedAt: 'native-generated-at',
    gitCommit: 'native-commit',
    source: 'test',
    runId: 'run-test',
    datasetId: 'dataset-test',
    requestedAt: 'requested-at',
  })
})

test('finding factory supports every required evidence state', () => {
  FINDING_STATES.forEach((state) => {
    const finding = createFinding({ id: `finding-${state}`, experimentId: 'signal-quality', state, title: state })
    assert.equal(finding.state, state)
  })
  assert.deepEqual(RESEARCH_STATUSES, ['loading', 'untested', 'completed', 'unavailable', 'incomplete', 'error'])
})

test('record factory rejects unknown statuses and finding states', () => {
  assert.throws(() => createResearchRecord({ id: 'x', title: 'X', category: 'test', status: 'validated' }), /Unknown research status/)
  assert.throws(() => createFinding({ id: 'x', experimentId: 'y', state: 'validated', title: 'X' }), /Unknown finding state/)
})

test('record factory rejects an unknown cost model status', () => {
  assert.deepEqual(COST_MODEL_STATUSES, ['modeled', 'not-modeled', 'not-applicable'])
  assert.throws(
    () => createResearchRecord({ id: 'x', title: 'X', category: 'test', costModel: { status: 'free' } }),
    /Unknown cost model status/,
  )
})

// --- robustness (runThresholdResearch + runMarketConditionResearch) ---

test('robustness normalizes per-threshold metrics and preserves the native payload', () => {
  const candles = [makeCandle('SPY', '1h', 't0'), makeCandle('SPY', '1h', 't1'), makeCandle('SPY', '1h', 't2')]
  const nativePayload = {
    thresholdResults: [
      { minimumScore: 75, candles, metrics: makeStrategyJsMetrics({ totalTrades: 40, totalPositiveR: 22, netReturn: 9 }), inSampleMetrics: makeStrategyJsMetrics({ totalTrades: 28 }), outOfSampleMetrics: makeStrategyJsMetrics({ totalTrades: 12 }) },
      { minimumScore: 90, candles, metrics: makeStrategyJsMetrics({ totalTrades: 8, totalPositiveR: 10, netReturn: 4 }), inSampleMetrics: makeStrategyJsMetrics({ totalTrades: 5 }), outOfSampleMetrics: makeStrategyJsMetrics({ totalTrades: 3 }) },
    ],
    periodResults: [{ label: 'Period 1', start: 't0', end: 't2', candleCount: 3, metrics: makeStrategyJsMetrics() }],
  }
  const record = createResearchRecordForExperiment('robustness', nativePayload)

  assert.equal(record.status, 'completed')
  assert.equal(record.nativePayload, nativePayload)
  assert.equal(record.metrics['75+'].tradeCount, 40)
  assert.equal(record.metrics['90+'].tradeCount, 8)
  // Normalized totalR must reflect net return, never the gross-profit-only totalPositiveR.
  assert.equal(record.metrics['75+'].totalR, 9)
  assert.notEqual(record.metrics['75+'].totalR, 22)
  assert.equal(record.metrics['90+'].totalR, 4)
  // Threshold variants are all the same baseline strategy; the threshold is a ruleSetVariant, not a separate strategyId.
  assert.equal(record.metrics['75+'].strategyId, 'setup-scan-baseline')
  assert.equal(record.metrics['75+'].ruleSetVariant, 'threshold-75')
  assert.equal(record.metrics['90+'].ruleSetVariant, 'threshold-90')
  // strategy.js never models execution costs — must read as "not modeled", never as zero cost.
  assert.equal(record.costModel.status, 'not-modeled')
  assert.equal(record.outOfSample.type, 'partition')
  assert.equal(record.outOfSample.inSampleMetrics.totalTrades, 28)
  assert.equal(record.input.candleCount, 3)
  assert.deepEqual(record.input.symbols, ['SPY'])
  assert.equal(record.input.timeframe, '1h')
})

test('robustness reports unavailable when no threshold results exist (e.g. SPY missing)', () => {
  const nativePayload = { thresholdResults: [], periodResults: [] }
  const record = createResearchRecordForExperiment('robustness', nativePayload)
  assert.equal(record.status, 'unavailable')
  assert.deepEqual(record.metrics, {})
})

// --- relative-value (runRelativeValueResearch) ---

test('relative-value normalizes all four variants before/after costs', () => {
  const raw = { SPY: [makeCandle('SPY', '1h', 't0'), makeCandle('SPY', '1h', 't1')], QQQ: [makeCandle('QQQ', '1h', 't0'), makeCandle('QQQ', '1h', 't1')] }
  const nativePayload = {
    aligned: { raw, timestamps: ['t0', 't1'] },
    options: { lookback: 20, executionCostR: 0.05 },
    summaries: {
      A: { overallBeforeCosts: makeOverall({ tradeCount: 5 }), overallAfterCosts: makeOverall({ tradeCount: 5, expectancy: 0.2 }) },
      B: { overallBeforeCosts: makeOverall({ tradeCount: 3 }), overallAfterCosts: makeOverall({ tradeCount: 3 }) },
    },
  }
  const record = createResearchRecordForExperiment('relative-value', nativePayload)

  assert.equal(record.nativePayload, nativePayload)
  assert.equal(record.metrics.A.beforeCosts.tradeCount, 5)
  assert.equal(record.metrics.A.afterCosts.expectancy, 0.2)
  assert.equal(record.metrics.B.beforeCosts.tradeCount, 3)
  // Variant A is the unmodified baseline; B is a genuinely different rule (RV-confirmation filter).
  assert.equal(record.metrics.A.strategyId, 'setup-scan-baseline')
  assert.equal(record.metrics.B.strategyId, 'rv-confirmation-filter')
  assert.equal(record.costModel.status, 'modeled')
  assert.equal(record.costModel.executionCostR, 0.05)
  assert.deepEqual(record.input.symbols, ['SPY', 'QQQ'])
  assert.equal(record.input.candleCount, 2)
  assert.deepEqual(record.parameters, { lookback: 20, executionCostR: 0.05 })
})

// --- signal-quality (runSignalQualityResearch) ---

test('signal-quality normalizes metrics per score bucket', () => {
  const raw = { SPY: [makeCandle('SPY', '1h', 't0')] }
  const nativePayload = {
    aligned: { raw, timestamps: ['t0'] },
    options: { minimumScore: 75 },
    scoreBuckets: [
      { label: '75-79', min: 75, max: 79, overall: makeOverall({ tradeCount: 6 }) },
      { label: '95-100', min: 95, max: 100, overall: makeOverall({ tradeCount: 1 }) },
    ],
    components: [],
    decomposition: [],
  }
  const record = createResearchRecordForExperiment('signal-quality', nativePayload)

  assert.equal(record.nativePayload, nativePayload)
  assert.equal(record.metrics['75-79'].tradeCount, 6)
  assert.equal(record.metrics['95-100'].tradeCount, 1)
  // Score buckets are evaluation cohorts of the same baseline strategy, not rule variants.
  assert.equal(record.metrics['75-79'].strategyId, 'setup-scan-baseline')
  assert.equal(record.metrics['75-79'].ruleSetVariant, undefined)
  assert.equal(record.costModel.status, 'modeled')
  assert.deepEqual(record.input.symbols, ['SPY'])
})

// --- frozen-score-holdout (runFrozenScoreHoldoutResearch) ---

test('frozen-score-holdout normalizes development/holdout baseline and RV-confirmed metrics, preserving native ranges', () => {
  const nativePayload = {
    aligned: { raw: { SPY: [makeCandle('SPY', '1h', 't0')] }, timestamps: ['t0'] },
    options: {},
    developmentRange: { start: '2020-01-01', end: '2023-12-31', candleCount: 500 },
    holdoutRange: { start: '2024-01-01', end: '2025-12-31', candleCount: 200 },
    developmentBaseline: { overall: makeOverall({ tradeCount: 20 }) },
    developmentRvConfirmed: { overall: makeOverall({ tradeCount: 8 }) },
    holdoutBaseline: { overall: makeOverall({ tradeCount: 6 }) },
    holdoutRvConfirmed: { overall: makeOverall({ tradeCount: 2 }) },
  }
  const record = createResearchRecordForExperiment('frozen-score-holdout', nativePayload)

  assert.equal(record.metrics.developmentBaseline.tradeCount, 20)
  assert.equal(record.metrics.holdoutBaseline.tradeCount, 6)
  // development/holdout are evaluation partitions, not rule variants — only strategyId applies here.
  assert.equal(record.metrics.developmentBaseline.strategyId, 'setup-scan-baseline')
  assert.equal(record.metrics.developmentBaseline.ruleSetVariant, undefined)
  assert.equal(record.metrics.developmentRvConfirmed.strategyId, 'rv-combined')
  assert.equal(record.metrics.holdoutBaseline.strategyId, 'setup-scan-baseline')
  assert.equal(record.metrics.holdoutRvConfirmed.strategyId, 'rv-combined')
  assert.equal(record.costModel.status, 'modeled')
  assert.deepEqual(record.outOfSample, {
    type: 'holdout',
    developmentRange: nativePayload.developmentRange,
    holdoutRange: nativePayload.holdoutRange,
  })
  assert.deepEqual(record.input.sampleCounts, { developmentCandleCount: 500, holdoutCandleCount: 200 })
})

// --- yearly-regime (runYearlyRegimeResearch) ---

test('yearly-regime normalizes the combined summary plus one summary per calendar year', () => {
  const nativePayload = {
    aligned: { raw: { SPY: [makeCandle('SPY', '1h', 't0')] }, timestamps: ['t0'] },
    options: {},
    years: [
      { year: 2023, baseline: { overall: makeOverall({ tradeCount: 12 }) } },
      { year: 2024, baseline: { overall: makeOverall({ tradeCount: 9 }) } },
    ],
    combinedBaseline: { overall: makeOverall({ tradeCount: 21 }) },
    combinedRvConfirmed: { overall: makeOverall({ tradeCount: 5 }) },
  }
  const record = createResearchRecordForExperiment('yearly-regime', nativePayload)

  assert.equal(record.metrics.combinedBaseline.tradeCount, 21)
  assert.equal(record.metrics['year-2023'].tradeCount, 12)
  assert.equal(record.metrics['year-2024'].tradeCount, 9)
  assert.equal(record.metrics.combinedBaseline.strategyId, 'setup-scan-baseline')
  assert.equal(record.metrics.combinedRvConfirmed.strategyId, 'rv-combined')
  // Calendar year is an evaluation partition, not a rule variant — only strategyId applies here.
  assert.equal(record.metrics['year-2023'].strategyId, 'setup-scan-baseline')
  assert.equal(record.metrics['year-2023'].ruleSetVariant, undefined)
  assert.equal(record.costModel.status, 'modeled')
})

// --- causal-regime (runCausalRegimeResearch) ---

test('causal-regime normalizes the combined summary plus trend/volatility/breadth groups', () => {
  const nativePayload = {
    aligned: { raw: { SPY: [makeCandle('SPY', '1h', 't0')] }, timestamps: ['t0'] },
    options: {},
    combinedBaseline: { overall: makeOverall({ tradeCount: 30 }) },
    combinedRvConfirmed: { overall: makeOverall({ tradeCount: 10 }) },
    trendGroups: [{ label: 'Uptrend', baseline: { overall: makeOverall({ tradeCount: 18 }) } }],
    volatilityGroups: [{ label: 'High', baseline: { overall: makeOverall({ tradeCount: 4 }) } }],
    breadthGroups: [{ label: 'Strong', baseline: { overall: makeOverall({ tradeCount: 7 }) } }],
  }
  const record = createResearchRecordForExperiment('causal-regime', nativePayload)

  assert.equal(record.metrics.combinedBaseline.tradeCount, 30)
  assert.equal(record.metrics['trend-Uptrend'].tradeCount, 18)
  assert.equal(record.metrics['volatility-High'].tradeCount, 4)
  assert.equal(record.metrics['breadth-Strong'].tradeCount, 7)
  assert.equal(record.metrics.combinedRvConfirmed.strategyId, 'rv-combined')
  // Trend/volatility/breadth regimes are evaluation partitions, not rule variants — only strategyId applies here.
  assert.equal(record.metrics['trend-Uptrend'].strategyId, 'setup-scan-baseline')
  assert.equal(record.metrics['trend-Uptrend'].ruleSetVariant, undefined)
  assert.equal(record.costModel.status, 'modeled')
})

// --- walk-forward-regime (runWalkForwardRegimeResearch) ---

test('walk-forward-regime normalizes per-window metrics and retains walk-forward out-of-sample boundaries', () => {
  const nativePayload = {
    aligned: { raw: { SPY: [makeCandle('SPY', '1h', 't0')] }, timestamps: ['t0'] },
    options: {},
    combinedBaseline: { overall: makeOverall({ tradeCount: 25 }) },
    combinedRvConfirmed: { overall: makeOverall({ tradeCount: 9 }) },
    windows: [
      { label: 'Window 1', testYear: 2023, trainStart: '2022-01-01', trainEnd: '2022-12-31', testStart: '2023-01-01', testEnd: '2023-12-31', baseline: { overall: makeOverall({ tradeCount: 6 }) } },
    ],
  }
  const record = createResearchRecordForExperiment('walk-forward-regime', nativePayload)

  assert.equal(record.metrics.combinedBaseline.tradeCount, 25)
  assert.equal(record.metrics['Window 1'].tradeCount, 6)
  assert.equal(record.metrics.combinedRvConfirmed.strategyId, 'rv-combined')
  // A walk-forward window is an evaluation partition, not a rule variant — only strategyId applies here.
  assert.equal(record.metrics['Window 1'].strategyId, 'setup-scan-baseline')
  assert.equal(record.metrics['Window 1'].ruleSetVariant, undefined)
  assert.equal(record.costModel.status, 'modeled')
  assert.equal(record.outOfSample.type, 'walk-forward')
  assert.equal(record.outOfSample.windows[0].testClassification, 2023)
  assert.equal(record.outOfSample.windows[0].trainStart, '2022-01-01')
})

// --- volatility-aware-variants (runVolatilityAwareVariantsResearch) ---

test('volatility-aware-variants normalizes pooled metrics per variant and falls back to realized window boundaries', () => {
  const nativePayload = {
    aligned: { raw: { SPY: [makeCandle('SPY', '1h', 't0')] }, timestamps: ['t0'] },
    options: {},
    pooled: [
      { key: 'control', label: 'Control', summary: { overall: makeOverall({ tradeCount: 40 }) } },
      { key: 'skipHighVol', label: 'Skip High Vol', summary: { overall: makeOverall({ tradeCount: 30 }) } },
    ],
    windows: [
      { label: 'Window 1', testYear: 2023, trainRealizedStart: '2022-01-05', trainRealizedEnd: '2022-12-30', testRealizedStart: '2023-01-03', testRealizedEnd: '2023-12-29' },
    ],
  }
  const record = createResearchRecordForExperiment('volatility-aware-variants', nativePayload)

  assert.equal(record.metrics.control.tradeCount, 40)
  assert.equal(record.metrics.skipHighVol.tradeCount, 30)
  // 'control' is the same strategy as the frozen baseline, not a fifth independent strategy.
  assert.equal(record.metrics.control.strategyId, 'setup-scan-baseline')
  assert.equal(record.metrics.skipHighVol.strategyId, 'vol-aware-skip-high')
  assert.equal(record.costModel.status, 'modeled')
  assert.equal(record.outOfSample.type, 'walk-forward')
  assert.equal(record.outOfSample.windows[0].trainStart, '2022-01-05')
  assert.equal(record.outOfSample.windows[0].testClassification, 2023)
})

// --- strategy-comparison (runStrategyComparison) ---

test('strategy-comparison normalizes control vs. trend/momentum metrics using each side\'s real native shape', () => {
  const candles = [makeCandle('SPY', '1h', 't0'), makeCandle('SPY', '1h', 't1')]
  const nativePayload = {
    control: { candles, settings: {}, trades: [], partitions: { inSample: [], outOfSample: [] }, metrics: makeStrategyJsMetrics({ totalTrades: 14, totalPositiveR: 20, netReturn: 6 }), inSampleMetrics: makeStrategyJsMetrics({ totalTrades: 10 }), outOfSampleMetrics: makeStrategyJsMetrics({ totalTrades: 4 }) },
    trendMomentum: { candles, settings: {}, trades: [], partitions: { inSample: [], outOfSample: [] }, metrics: makeTrendMomentumMetrics({ totalTrades: 9 }), inSampleMetrics: makeTrendMomentumMetrics({ totalTrades: 6 }), outOfSampleMetrics: makeTrendMomentumMetrics({ totalTrades: 3 }) },
  }
  const record = createResearchRecordForExperiment('strategy-comparison', nativePayload)

  assert.equal(record.nativePayload, nativePayload)
  assert.equal(record.metrics.control.tradeCount, 14)
  // Control's normalized return must be the real net return, not the gross-profit-only totalPositiveR.
  assert.equal(record.metrics.control.totalR, 6)
  assert.notEqual(record.metrics.control.totalR, 20)
  // trendMomentum's native metrics have neither totalR nor totalPositiveR/netReturn — none should be invented.
  assert.equal(record.metrics.trendMomentum.tradeCount, 9)
  assert.equal('totalR' in record.metrics.trendMomentum, false)
  // control is the frozen baseline; trend-momentum-v1 is strategyComparison.js's own construction —
  // must never be confused with strategy-discovery's independently-implemented momentum-breakout-v1.
  assert.equal(record.metrics.control.strategyId, 'setup-scan-baseline')
  assert.equal(record.metrics.trendMomentum.strategyId, 'trend-momentum-v1')
  // Neither side of strategy-comparison models execution costs.
  assert.equal(record.costModel.status, 'not-modeled')
  assert.equal(record.outOfSample.type, 'partition')
  assert.equal(record.outOfSample.inSampleMetrics.totalTrades, 10)
  assert.deepEqual(record.input.symbols, ['SPY'])
  assert.equal(record.input.candleCount, 2)
})

test('strategy-comparison normalizes the per-symbol composite without shared ranges or counts', () => {
  const nativePayload = {
    bySymbol: {
      SPY: {
        control: { metrics: makeStrategyJsMetrics({ totalTrades: 14, netReturn: 6 }) },
        trendMomentum: { metrics: makeTrendMomentumMetrics({ totalTrades: 9 }) },
      },
      QQQ: {
        control: { metrics: makeStrategyJsMetrics({ totalTrades: 8, netReturn: 3 }) },
        trendMomentum: { metrics: makeTrendMomentumMetrics({ totalTrades: 4 }) },
      },
    },
  }
  const record = createResearchRecordForExperiment('strategy-comparison', nativePayload)

  assert.equal(record.nativePayload, nativePayload)
  assert.deepEqual(Object.keys(record.metrics), [
    'SPY::control', 'SPY::trendMomentum', 'QQQ::control', 'QQQ::trendMomentum',
  ])
  assert.equal(record.metrics['SPY::control'].strategyId, 'setup-scan-baseline')
  assert.equal(record.metrics['SPY::trendMomentum'].strategyId, 'trend-momentum-v1')
  assert.equal(record.metrics['QQQ::control'].strategyId, 'setup-scan-baseline')
  assert.equal(record.metrics['QQQ::trendMomentum'].strategyId, 'trend-momentum-v1')
  assert.deepEqual(record.input.symbols, ['SPY', 'QQQ'])
  assert.equal(record.input.actualStart, null)
  assert.equal(record.input.actualEnd, null)
  assert.equal(record.input.candleCount, null)
  assert.equal(record.outOfSample, null)
})

// --- strategy-discovery (runStrategyDiscoveryBatchA) ---

test('strategy-discovery normalizes per-experiment metrics and surfaces universe/timeframe/provenance metadata', () => {
  const nativePayload = {
    available: true,
    universe: ['SPY', 'QQQ', 'IWM'],
    timeframe: '1Hour',
    datasetInfo: [
      { symbol: 'SPY', provider: 'ALPACA HISTORICAL', candleCount: 500, start: 't0', end: 't1', duplicatesRemoved: 0 },
      { symbol: 'QQQ', provider: 'ALPACA HISTORICAL', candleCount: 500, start: 't0', end: 't1', duplicatesRemoved: 0 },
    ],
    generatedAt: '2026-01-01T00:00:00Z',
    gitCommit: 'abc123',
    costTiers: [{ label: 'Before execution costs', entryBps: 0, exitBps: 0 }],
    experiments: [
      { experimentId: 'momentum-breakout', label: 'Momentum Breakout', summary: { overall: makeOverall({ tradeCount: 45, occurrenceCount: 45 }) } },
    ],
  }
  const record = createResearchRecordForExperiment('strategy-discovery', nativePayload)

  assert.equal(record.nativePayload, nativePayload)
  assert.equal(record.metrics['momentum-breakout'].tradeCount, 45)
  // Strategy Discovery already versions its own native identity — reuse it as-is.
  assert.equal(record.metrics['momentum-breakout'].strategyId, 'momentum-breakout')
  assert.equal(record.costModel.status, 'modeled')
  assert.deepEqual(record.costModel.costTiers, nativePayload.costTiers)
  assert.deepEqual(record.input.symbols, ['SPY', 'QQQ', 'IWM'])
  assert.equal(record.input.timeframe, '1Hour')
  assert.equal(record.input.candleCount, 1000)
  assert.deepEqual(record.provenance, { generatedAt: '2026-01-01T00:00:00Z', gitCommit: 'abc123' })
})

test('unavailable discovery output remains unavailable without invented metrics', () => {
  const nativePayload = { available: false, missingSymbols: ['IWM'], universe: ['SPY', 'QQQ', 'IWM'] }
  const record = createResearchRecordForExperiment('strategy-discovery', nativePayload)

  assert.equal(record.status, 'unavailable')
  assert.deepEqual(record.metrics, {})
  assert.deepEqual(record.nativePayload, nativePayload)
})
