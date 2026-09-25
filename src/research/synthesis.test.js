import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createResearchRecordForExperiment } from './registry.js'
import { compareEvidence, EVIDENCE_FAMILIES, synthesizeResearch } from './synthesis.js'

// --- Fixtures shaped like the real native research outputs (mirrors researchArchitecture.test.js). ---

function makeCandle(symbol, timeframe, timestamp) {
  return { symbol, timeframe, timestamp, open: 100, high: 101, low: 99, close: 100.5, volume: 1000 }
}

function makeOverall(overrides = {}) {
  return { tradeCount: 10, winRate: 0.6, profitFactor: 1.8, expectancy: 0.3, averageR: 0.3, totalR: 3, maximumDrawdown: 1.2, averageHoldingTime: 90, ...overrides }
}

function makeStrategyJsMetrics(overrides = {}) {
  return { totalTrades: 10, numberOfTrades: 10, winRate: 0.6, profitFactor: 1.8, expectancy: 0.3, averageR: 0.3, totalPositiveR: 5, totalNegativeR: -2, netReturn: 3, maximumDrawdown: 1.2, averageHoldingTime: 90, ...overrides }
}

function robustnessRecord(overrides = {}) {
  const candles = [makeCandle('SPY', '1h', 't0'), makeCandle('SPY', '1h', 't1'), makeCandle('SPY', '1h', 't2')]
  const nativePayload = {
    thresholdResults: [
      { minimumScore: 75, candles, metrics: makeStrategyJsMetrics({ totalTrades: 40, netReturn: 3 }), inSampleMetrics: makeStrategyJsMetrics({ totalTrades: 28, netReturn: 2 }), outOfSampleMetrics: makeStrategyJsMetrics({ totalTrades: 12, netReturn: 1 }) },
      { minimumScore: 90, candles, metrics: makeStrategyJsMetrics({ totalTrades: 8, netReturn: 1 }) },
    ],
    periodResults: [],
    ...overrides.nativePayload,
  }
  return createResearchRecordForExperiment('robustness', nativePayload, overrides.context)
}

function relativeValueRecord(overrides = {}) {
  const raw = { SPY: [makeCandle('SPY', '1h', 't0'), makeCandle('SPY', '1h', 't1')], QQQ: [makeCandle('QQQ', '1h', 't0'), makeCandle('QQQ', '1h', 't1')] }
  const nativePayload = {
    aligned: { raw, timestamps: ['t0', 't1'] },
    options: { lookback: 20, executionCostR: 0.05 },
    summaries: {
      A: { overallBeforeCosts: makeOverall({ tradeCount: 5 }), overallAfterCosts: makeOverall({ tradeCount: 5, expectancy: 0.2 }) },
      D: { overallBeforeCosts: makeOverall({ tradeCount: 3 }), overallAfterCosts: makeOverall({ tradeCount: 3, expectancy: -0.1 }) },
    },
    ...overrides.nativePayload,
  }
  return createResearchRecordForExperiment('relative-value', nativePayload, overrides.context)
}

function signalQualityRecord(overrides = {}) {
  const raw = { SPY: [makeCandle('SPY', '1h', 't0')] }
  const nativePayload = {
    aligned: { raw, timestamps: ['t0'] },
    options: { minimumScore: 75 },
    scoreBuckets: [
      { label: '75-79', overall: makeOverall({ tradeCount: 30, expectancy: 0.2 }) },
      { label: '95-100', overall: makeOverall({ tradeCount: 2, expectancy: -0.1 }) },
    ],
    ...overrides.nativePayload,
  }
  return createResearchRecordForExperiment('signal-quality', nativePayload, overrides.context)
}

function frozenScoreHoldoutRecord(overrides = {}) {
  const nativePayload = {
    aligned: { raw: { SPY: [makeCandle('SPY', '1h', 't0')] }, timestamps: ['t0'] },
    options: {},
    developmentRange: { start: '2020-01-01', end: '2023-12-31', candleCount: 500 },
    holdoutRange: { start: '2024-01-01', end: '2025-12-31', candleCount: 200 },
    developmentBaseline: { overall: makeOverall({ tradeCount: 20, expectancy: 0.25 }) },
    developmentRvConfirmed: { overall: makeOverall({ tradeCount: 8 }) },
    holdoutBaseline: { overall: makeOverall({ tradeCount: 6, expectancy: -0.05 }) },
    holdoutRvConfirmed: { overall: makeOverall({ tradeCount: 2 }) },
    ...overrides.nativePayload,
  }
  return createResearchRecordForExperiment('frozen-score-holdout', nativePayload, overrides.context)
}

function yearlyRegimeRecord(overrides = {}) {
  const nativePayload = {
    aligned: { raw: { SPY: [makeCandle('SPY', '1h', 't0')] }, timestamps: ['t0'] },
    options: {},
    years: [{ year: 2023, baseline: { overall: makeOverall({ tradeCount: 12 }) } }, { year: 2024, baseline: { overall: makeOverall({ tradeCount: 9 }) } }],
    combinedBaseline: { overall: makeOverall({ tradeCount: 21 }) },
    combinedRvConfirmed: { overall: makeOverall({ tradeCount: 5 }) },
    ...overrides.nativePayload,
  }
  return createResearchRecordForExperiment('yearly-regime', nativePayload, overrides.context)
}

function causalRegimeRecord(overrides = {}) {
  const nativePayload = {
    aligned: { raw: { SPY: [makeCandle('SPY', '1h', 't0')] }, timestamps: ['t0'] },
    options: {},
    combinedBaseline: { overall: makeOverall({ tradeCount: 30 }) },
    combinedRvConfirmed: { overall: makeOverall({ tradeCount: 10 }) },
    trendGroups: [{ label: 'Uptrend', baseline: { overall: makeOverall({ tradeCount: 18 }) } }],
    volatilityGroups: [{ label: 'High', baseline: { overall: makeOverall({ tradeCount: 4 }) } }],
    breadthGroups: [{ label: 'Strong', baseline: { overall: makeOverall({ tradeCount: 7 }) } }],
    ...overrides.nativePayload,
  }
  return createResearchRecordForExperiment('causal-regime', nativePayload, overrides.context)
}

function walkForwardRegimeRecord(overrides = {}) {
  const nativePayload = {
    aligned: { raw: { SPY: [makeCandle('SPY', '1h', 't0')] }, timestamps: ['t0'] },
    options: {},
    combinedBaseline: { overall: makeOverall({ tradeCount: 25 }) },
    combinedRvConfirmed: { overall: makeOverall({ tradeCount: 9 }) },
    windows: [
      { label: 'Window 1', testYear: 2023, trainStart: '2022-01-01', trainEnd: '2022-12-31', testStart: '2023-01-01', testEnd: '2023-12-31', baseline: { overall: makeOverall({ tradeCount: 6 }) } },
    ],
    ...overrides.nativePayload,
  }
  return createResearchRecordForExperiment('walk-forward-regime', nativePayload, overrides.context)
}

function volatilityAwareVariantsRecord(overrides = {}) {
  const nativePayload = {
    aligned: { raw: { SPY: [makeCandle('SPY', '1h', 't0')] }, timestamps: ['t0'] },
    options: {},
    pooled: [
      { key: 'control', label: 'Control', summary: { overall: makeOverall({ tradeCount: 40 }) } },
      { key: 'skipHighVol', label: 'Skip High Vol', summary: { overall: makeOverall({ tradeCount: 30 }) } },
    ],
    windows: [{ label: 'Window 1', testYear: 2023, trainRealizedStart: '2022-01-05', trainRealizedEnd: '2022-12-30', testRealizedStart: '2023-01-03', testRealizedEnd: '2023-12-29' }],
    ...overrides.nativePayload,
  }
  return createResearchRecordForExperiment('volatility-aware-variants', nativePayload, overrides.context)
}

function strategyComparisonRecord(overrides = {}) {
  const candles = [makeCandle('SPY', '1h', 't0'), makeCandle('SPY', '1h', 't1')]
  const nativePayload = {
    control: { candles, metrics: makeStrategyJsMetrics({ totalTrades: 14, netReturn: 6 }), inSampleMetrics: makeStrategyJsMetrics({ totalTrades: 10, netReturn: 4 }), outOfSampleMetrics: makeStrategyJsMetrics({ totalTrades: 4, netReturn: -1 }) },
    trendMomentum: { candles, metrics: { totalTrades: 9, winRate: 0.55, profitFactor: 1.5, expectancy: 0.25, averageR: 0.25, grossProfit: 4, grossLoss: -1.5, maximumDrawdown: 1, averageHoldingTime: 80 } },
    ...overrides.nativePayload,
  }
  return createResearchRecordForExperiment('strategy-comparison', nativePayload, overrides.context)
}

function strategyDiscoveryRecord(overrides = {}) {
  const nativePayload = {
    available: true,
    universe: ['SPY', 'QQQ', 'IWM'],
    timeframe: '1Hour',
    datasetInfo: [{ symbol: 'SPY', provider: 'ALPACA HISTORICAL', candleCount: 500, start: 't0', end: 't1' }],
    experiments: [
      { experimentId: 'momentum-breakout-v1', label: 'Momentum Breakout', summary: { overall: makeOverall({ tradeCount: 45, occurrenceCount: 45 }) } },
      { experimentId: 'mean-reversion-v1', label: 'Mean Reversion', summary: { overall: makeOverall({ tradeCount: 20, occurrenceCount: 20 }) } },
    ],
    ...overrides.nativePayload,
  }
  return createResearchRecordForExperiment('strategy-discovery', nativePayload, overrides.context)
}

function unavailableDiscoveryRecord() {
  return createResearchRecordForExperiment('strategy-discovery', { available: false, missingSymbols: ['IWM'], universe: ['SPY', 'QQQ', 'IWM'] })
}

function findGroup(result, strategyId) {
  return result.strategyGroups.find((group) => group.strategyId === strategyId)
}

function findEvidence(group, metricsKey) {
  return group.evidence.find((entry) => entry.metricsKey === metricsKey)
}

// --- 1. empty input ---
test('synthesizeResearch tolerates an empty records array', () => {
  const result = synthesizeResearch([])
  assert.equal(result.schemaVersion, 1)
  assert.deepEqual(result.coverage, { requested: [], unavailable: [], incomplete: [], evaluated: [] })
  assert.deepEqual(result.strategyGroups, [])
  assert.deepEqual(result.conflicts, [])
  assert.deepEqual(result.costSensitivity, [])
})

// --- 2. single normalized record ---
test('synthesizeResearch handles a single normalized record', () => {
  const record = robustnessRecord()
  const result = synthesizeResearch([record])
  assert.equal(result.coverage.requested.length, 1)
  assert.equal(result.coverage.evaluated.length, 1)
  const group = findGroup(result, 'setup-scan-baseline')
  assert.ok(group)
  assert.ok(group.evidence.length > 0)
})

// --- 3. multiple records ---
test('synthesizeResearch handles multiple records together', () => {
  const result = synthesizeResearch([robustnessRecord(), signalQualityRecord()])
  assert.equal(result.coverage.requested.length, 2)
  assert.equal(result.coverage.evaluated.length, 2)
})

// --- 4. flattening multi-strategy metrics ---
test('flattening produces one evidence entry per metrics key, each with its own strategyId', () => {
  const result = synthesizeResearch([strategyComparisonRecord()])
  const baselineGroup = findGroup(result, 'setup-scan-baseline')
  const trendGroup = findGroup(result, 'trend-momentum-v1')
  assert.ok(baselineGroup)
  assert.ok(trendGroup)
  assert.ok(findEvidence(baselineGroup, 'control'))
  assert.ok(findEvidence(trendGroup, 'trendMomentum'))
})

// --- 5. grouping by strategyId ---
test('evidence from different experiments sharing a strategyId is grouped together', () => {
  const result = synthesizeResearch([robustnessRecord(), signalQualityRecord()])
  const group = findGroup(result, 'setup-scan-baseline')
  const experimentIds = new Set(group.evidence.map((entry) => entry.experimentId))
  assert.ok(experimentIds.has('robustness'))
  assert.ok(experimentIds.has('signal-quality'))
})

// --- 6. ruleSetVariant preserved ---
test('ruleSetVariant is preserved for genuine rule variants', () => {
  const result = synthesizeResearch([robustnessRecord(), signalQualityRecord()])
  const group = findGroup(result, 'setup-scan-baseline')
  assert.equal(findEvidence(group, '75+').ruleSetVariant, 'threshold-75')
  assert.equal(findEvidence(group, '75-79').ruleSetVariant, 'bucket-75-79')
})

// --- 7. evaluation partition remains separate from ruleSetVariant ---
test('evaluation partitions never populate ruleSetVariant', () => {
  const result = synthesizeResearch([frozenScoreHoldoutRecord(), yearlyRegimeRecord(), causalRegimeRecord(), walkForwardRegimeRecord()])
  const group = findGroup(result, 'setup-scan-baseline')
  ;['developmentBaseline', 'holdoutBaseline', 'year-2023', 'trend-Uptrend', 'Window 1'].forEach((key) => {
    const entry = findEvidence(group, key)
    assert.ok(entry, `expected evidence for ${key}`)
    assert.equal(entry.ruleSetVariant, null)
  })
})

// --- 8. year partition ---
test('year metrics keys are classified as a year partition', () => {
  const result = synthesizeResearch([yearlyRegimeRecord()])
  const group = findGroup(result, 'setup-scan-baseline')
  const entry = findEvidence(group, 'year-2023')
  assert.deepEqual(entry.partition, { type: 'year', label: 'year-2023' })
})

// --- 9. regime partition ---
test('trend/volatility/breadth metrics keys are classified as regime partitions', () => {
  const result = synthesizeResearch([causalRegimeRecord()])
  const group = findGroup(result, 'setup-scan-baseline')
  assert.deepEqual(findEvidence(group, 'trend-Uptrend').partition, { type: 'trend-regime', label: 'trend-Uptrend' })
  assert.deepEqual(findEvidence(group, 'volatility-High').partition, { type: 'volatility-regime', label: 'volatility-High' })
  assert.deepEqual(findEvidence(group, 'breadth-Strong').partition, { type: 'breadth-regime', label: 'breadth-Strong' })
})

// --- 10. development/holdout ---
test('development/holdout metrics keys are classified with the correct partition and OOS role', () => {
  const result = synthesizeResearch([frozenScoreHoldoutRecord()])
  const group = findGroup(result, 'setup-scan-baseline')
  const development = findEvidence(group, 'developmentBaseline')
  const holdout = findEvidence(group, 'holdoutBaseline')
  assert.equal(development.partition.type, 'development')
  assert.equal(development.outOfSampleRole, 'development')
  assert.equal(holdout.partition.type, 'holdout')
  assert.equal(holdout.outOfSampleRole, 'holdout')
})

// --- 11. walk-forward windows ---
test('walk-forward window metrics keys are classified as walk-forward-test evidence', () => {
  const result = synthesizeResearch([walkForwardRegimeRecord()])
  const group = findGroup(result, 'setup-scan-baseline')
  const windowEntry = findEvidence(group, 'Window 1')
  assert.equal(windowEntry.partition.type, 'walk-forward-window')
  assert.equal(windowEntry.outOfSampleRole, 'walk-forward-test')
})

// --- 12. same strategy compatible evidence ---
test('two evidence entries for the same strategy/symbol/timeframe are compatible', () => {
  const recordA = robustnessRecord()
  const recordB = signalQualityRecord()
  const result = synthesizeResearch([recordA, recordB])
  const group = findGroup(result, 'setup-scan-baseline')
  const comparison = compareEvidence(findEvidence(group, '75+'), findEvidence(group, '75-79'))
  assert.equal(comparison.hardConflicts.length, 0)
})

// --- 13. different strategyIds remain separate groups ---
test('different strategyIds produce separate strategy groups, not a global failure', () => {
  const result = synthesizeResearch([strategyComparisonRecord(), strategyDiscoveryRecord()])
  const strategyIds = result.strategyGroups.map((group) => group.strategyId)
  assert.ok(strategyIds.includes('setup-scan-baseline'))
  assert.ok(strategyIds.includes('trend-momentum-v1'))
  assert.ok(strategyIds.includes('momentum-breakout-v1'))
  assert.ok(strategyIds.includes('mean-reversion-v1'))
  assert.equal(result.strategyGroups.length, strategyIds.length)
})

// --- 14. different symbols hard conflict ---
test('different symbols produce a hard conflict for the same strategy', () => {
  const recordA = robustnessRecord()
  const recordB = robustnessRecord({ context: { symbols: ['QQQ'] } })
  const groupA = flattenViaSynthesis(recordA)
  const groupB = flattenViaSynthesis(recordB)
  const comparison = compareEvidence(groupA[0], groupB[0])
  assert.equal(comparison.compatible, false)
  assert.ok(comparison.hardConflicts.some((entry) => entry.field === 'symbols'))
})

// --- 15. different timeframe hard conflict ---
test('different timeframe produces a hard conflict', () => {
  const recordA = robustnessRecord()
  const recordB = robustnessRecord({ context: { timeframe: '1D' } })
  const comparison = compareEvidence(flattenViaSynthesis(recordA)[0], flattenViaSynthesis(recordB)[0])
  assert.equal(comparison.compatible, false)
  assert.ok(comparison.hardConflicts.some((entry) => entry.field === 'timeframe'))
})

// --- 16. different known providers hard conflict ---
test('different known providers produce a hard conflict', () => {
  const recordA = robustnessRecord({ context: { provider: 'ALPACA HISTORICAL' } })
  const recordB = robustnessRecord({ context: { provider: 'OTHER PROVIDER' } })
  const comparison = compareEvidence(flattenViaSynthesis(recordA)[0], flattenViaSynthesis(recordB)[0])
  assert.equal(comparison.compatible, false)
  assert.ok(comparison.hardConflicts.some((entry) => entry.field === 'provider'))
})

// --- 17. unknown provider ---
test('missing provider on both sides is reported as unknown, not a hard conflict', () => {
  const recordA = robustnessRecord()
  const recordB = signalQualityRecord()
  const comparison = compareEvidence(flattenViaSynthesis(recordA)[0], flattenViaSynthesis(recordB)[0])
  assert.equal(comparison.compatible, 'unknown')
  assert.ok(comparison.unknowns.some((entry) => entry.field === 'provider'))
  assert.ok(!comparison.hardConflicts.some((entry) => entry.field === 'provider'))
})

// --- 18. missing runId/datasetId ---
test('missing runId/datasetId is surfaced as an unresolved question, never fabricated', () => {
  const result = synthesizeResearch([robustnessRecord()])
  assert.equal(result.provenance.runId, null)
  assert.equal(result.provenance.datasetId, null)
  assert.ok(result.unresolvedQuestions.some((question) => question.includes('runId/datasetId')))
})

test('supplied runId/datasetId are passed through unchanged', () => {
  const result = synthesizeResearch([robustnessRecord()], { runId: 'run-1', datasetId: 'dataset-1' })
  assert.equal(result.provenance.runId, 'run-1')
  assert.equal(result.provenance.datasetId, 'dataset-1')
  assert.ok(!result.unresolvedQuestions.some((question) => question.includes('runId/datasetId')))
})

// --- 19. different ruleSetVariant soft mismatch ---
test('different ruleSetVariant within the same strategy is a soft mismatch, not a hard conflict', () => {
  const record = robustnessRecord()
  const evidence = flattenViaSynthesis(record)
  const comparison = compareEvidence(evidence.find((e) => e.metricsKey === '75+'), evidence.find((e) => e.metricsKey === '90+'))
  assert.notEqual(comparison.compatible, false)
  assert.ok(comparison.softMismatches.some((entry) => entry.field === 'ruleSetVariant'))
})

// --- 20. modeled vs not-modeled cost ---
test('mixing modeled and not-modeled cost status within a strategy group produces a costSensitivity note', () => {
  const result = synthesizeResearch([robustnessRecord(), signalQualityRecord()])
  assert.ok(result.costSensitivity.some((entry) => entry.strategyId === 'setup-scan-baseline'))
})

// --- 21. unavailable record excluded from evidence ---
test('unavailable records contribute zero evidence and are never treated as negative evidence', () => {
  const result = synthesizeResearch([unavailableDiscoveryRecord()])
  assert.deepEqual(result.coverage.unavailable, ['strategy-discovery'])
  assert.deepEqual(result.coverage.evaluated, [])
  assert.deepEqual(result.strategyGroups, [])
})

// --- 22. incomplete record retained but flagged ---
test('incomplete records are retained in evidence but flagged in coverage and unresolved questions', () => {
  const record = robustnessRecord({ context: { complete: false } })
  assert.equal(record.status, 'incomplete')
  const result = synthesizeResearch([record])
  assert.deepEqual(result.coverage.incomplete, ['robustness'])
  assert.ok(result.coverage.evaluated.includes('robustness'))
  assert.ok(result.unresolvedQuestions.some((question) => question.includes('incomplete')))
})

// --- 23. shared evidence family retained without deleting evidence ---
test('shared evidence family retains every source record and every metric, only annotating non-independence', () => {
  const result = synthesizeResearch([signalQualityRecord(), frozenScoreHoldoutRecord(), yearlyRegimeRecord(), causalRegimeRecord(), walkForwardRegimeRecord()])
  const group = findGroup(result, 'setup-scan-baseline')
  const family = group.evidenceFamilies.find((entry) => entry.id === 'signal-quality-catalogue')
  assert.ok(family)
  assert.equal(family.experimentIds.length, 5)
  assert.equal(family.sourceRecordIds.length, 5)
  // Every underlying evidence entry from the five family members must still be present, untouched.
  assert.ok(findEvidence(group, '75-79'))
  assert.ok(findEvidence(group, 'developmentBaseline'))
  assert.ok(findEvidence(group, 'year-2023'))
  assert.ok(findEvidence(group, 'trend-Uptrend'))
  assert.ok(findEvidence(group, 'Window 1'))
})

test('EVIDENCE_FAMILIES matches the approved Phase 3C design', () => {
  assert.deepEqual(EVIDENCE_FAMILIES['signal-quality-catalogue'].experimentIds, ['signal-quality', 'frozen-score-holdout', 'yearly-regime', 'causal-regime', 'walk-forward-regime'])
  assert.deepEqual(EVIDENCE_FAMILIES['walk-forward-windows'].experimentIds, ['walk-forward-regime', 'volatility-aware-variants'])
})

// --- 24. conflict detection for clear sign disagreement ---
test('sign disagreement in comparable expectancy across evidence for the same strategy is detected as a conflict', () => {
  const result = synthesizeResearch([frozenScoreHoldoutRecord()])
  const group = findGroup(result, 'setup-scan-baseline')
  const conflict = result.conflicts.find((entry) => entry.strategyId === 'setup-scan-baseline' && entry.dimension === 'expectancy-sign-disagreement'
    && entry.sides.some((side) => side.metricsKey === 'developmentBaseline') && entry.sides.some((side) => side.metricsKey === 'holdoutBaseline'))
  assert.ok(conflict, 'expected a conflict between development (positive expectancy) and holdout (negative expectancy)')
  assert.ok(!('winner' in conflict))
  assert.ok(!('resolution' in conflict))
  assert.ok(group.evidence.length > 0)
})

// --- 25. no conflict when comparison is unsafe ---
test('no conflict is manufactured when the underlying evidence cannot be safely compared', () => {
  const recordA = robustnessRecord()
  const recordB = robustnessRecord({ context: { symbols: ['QQQ'] } })
  const result = synthesizeResearch([recordA, recordB])
  // recordA and recordB share strategyId but have incompatible symbols — must not produce a conflict.
  const cross = result.conflicts.filter((entry) => entry.sides.some((side) => side.sourceRecordId === recordA.id) && entry.sides.some((side) => side.sourceRecordId === recordB.id))
  assert.equal(cross.length, 0)
})

test('relative-value metrics nested under beforeCosts/afterCosts never produce a manufactured conflict', () => {
  const result = synthesizeResearch([relativeValueRecord()])
  assert.equal(result.conflicts.length, 0)
})

// --- 26. sourceRecordId + metricsKey traceability ---
test('every evidence entry is traceable back to its source record and metrics key', () => {
  const record = signalQualityRecord()
  const result = synthesizeResearch([record])
  const group = findGroup(result, 'setup-scan-baseline')
  group.evidence.forEach((entry) => {
    assert.equal(entry.sourceRecordId, record.id)
    assert.ok(entry.metricsKey)
    assert.equal(entry.id, `${entry.sourceRecordId}::${entry.metricsKey}`)
  })
})

// --- 27. nativePayload is not mutated ---
test('nativePayload is never copied into evidence and the original record is never mutated', () => {
  const record = signalQualityRecord()
  const nativePayloadBefore = record.nativePayload
  const metricsBefore = JSON.stringify(record.metrics)
  const result = synthesizeResearch([record])
  const group = findGroup(result, 'setup-scan-baseline')
  group.evidence.forEach((entry) => assert.equal('nativePayload' in entry, false))
  assert.equal(record.nativePayload, nativePayloadBefore)
  assert.equal(JSON.stringify(record.metrics), metricsBefore)
})

// --- 28. output has schemaVersion === 1 ---
test('output always carries schemaVersion 1', () => {
  assert.equal(synthesizeResearch([]).schemaVersion, 1)
  assert.equal(synthesizeResearch([robustnessRecord()]).schemaVersion, 1)
})

// --- 29. output contains no score/rank/winner/recommendation/confidence/verdict keys ---
function assertNoForbiddenKeys(value, path = 'result') {
  const forbidden = ['score', 'scores', 'rank', 'ranking', 'winner', 'winningStrategy', 'recommendation', 'confidence', 'verdict', 'probability', 'buy', 'sell']
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenKeys(item, `${path}[${index}]`))
    return
  }
  if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, nested]) => {
      assert.ok(!forbidden.includes(key), `forbidden key "${key}" found at ${path}.${key}`)
      assertNoForbiddenKeys(nested, `${path}.${key}`)
    })
  }
}

test('the synthesis output never contains a ranking/scoring/recommendation key anywhere', () => {
  const result = synthesizeResearch([
    robustnessRecord(), relativeValueRecord(), signalQualityRecord(), frozenScoreHoldoutRecord(),
    yearlyRegimeRecord(), causalRegimeRecord(), walkForwardRegimeRecord(), volatilityAwareVariantsRecord(),
    strategyComparisonRecord(), strategyDiscoveryRecord(), unavailableDiscoveryRecord(),
  ])
  assertNoForbiddenKeys(result)
})

// --- 30. multiple strategies in one record produce separate evidence entries ---
test('a single multi-strategy record (relative-value) produces one evidence entry per strategy', () => {
  const result = synthesizeResearch([relativeValueRecord()])
  assert.ok(findGroup(result, 'setup-scan-baseline'))
  assert.ok(findGroup(result, 'rv-combined'))
  assert.equal(findGroup(result, 'setup-scan-baseline').evidence.length, 1)
  assert.equal(findGroup(result, 'rv-combined').evidence.length, 1)
})

test('volatility-aware-variants control shares the baseline strategyId, not a fifth independent strategy', () => {
  const result = synthesizeResearch([volatilityAwareVariantsRecord()])
  const group = findGroup(result, 'setup-scan-baseline')
  assert.ok(findEvidence(group, 'control'))
  assert.ok(findGroup(result, 'vol-aware-skip-high'))
})

test('partition-style in-sample/out-of-sample evidence is generated for robustness without inventing a strategyId', () => {
  const result = synthesizeResearch([robustnessRecord()])
  const group = findGroup(result, 'setup-scan-baseline')
  const inSample = group.evidence.find((entry) => entry.outOfSampleRole === 'in-sample')
  const outOfSample = group.evidence.find((entry) => entry.outOfSampleRole === 'out-of-sample')
  assert.ok(inSample)
  assert.ok(outOfSample)
  assert.equal(inSample.strategyId, 'setup-scan-baseline')
  assert.equal(outOfSample.strategyId, 'setup-scan-baseline')
})

// --- Robustness partition OOS association: every threshold shares one strategyId, so the split's
// strategy is deterministically recoverable — but which threshold it came from is not, so
// ruleSetVariant must stay null rather than borrowing the first threshold's variant. ---
test('robustness partition OOS association is inferred from strategy-id uniformity, not order, and never invents a ruleSetVariant', () => {
  const result = synthesizeResearch([robustnessRecord()])
  const group = findGroup(result, 'setup-scan-baseline')
  const inSample = group.evidence.find((entry) => entry.outOfSampleRole === 'in-sample')
  const outOfSample = group.evidence.find((entry) => entry.outOfSampleRole === 'out-of-sample')
  assert.equal(inSample.strategyAssociation, 'inferred-uniform')
  assert.equal(outOfSample.strategyAssociation, 'inferred-uniform')
  assert.equal(inSample.ruleSetVariant, null)
  assert.equal(outOfSample.ruleSetVariant, null)
  // Every non-synthetic robustness evidence entry is 'explicit' — only the OOS split is inferred.
  group.evidence.filter((entry) => entry.outOfSampleRole === 'not-partitioned').forEach((entry) => {
    assert.equal(entry.strategyAssociation, 'explicit')
  })
})

// --- Strategy-comparison partition OOS association: control and trendMomentum are two different
// strategies, and nothing in the normalized record ties the split to either one specifically. ---
test('strategy-comparison partition OOS association is unknown, never guessed from control being listed first', () => {
  const result = synthesizeResearch([strategyComparisonRecord()])
  const allEvidence = result.strategyGroups.flatMap((group) => group.evidence)
  const inSample = allEvidence.find((entry) => entry.outOfSampleRole === 'in-sample')
  const outOfSample = allEvidence.find((entry) => entry.outOfSampleRole === 'out-of-sample')
  assert.ok(inSample)
  assert.ok(outOfSample)
  assert.equal(inSample.strategyId, null)
  assert.equal(outOfSample.strategyId, null)
  assert.equal(inSample.strategyAssociation, 'unknown')
  assert.equal(outOfSample.strategyAssociation, 'unknown')
  assert.equal(inSample.ruleSetVariant, null)
  // The split evidence is still preserved (not discarded) — just grouped under an unknown strategy.
  const unknownGroup = findGroup(result, null)
  assert.ok(unknownGroup)
  assert.ok(unknownGroup.evidence.includes(inSample))
  assert.ok(unknownGroup.evidence.includes(outOfSample))
})

// --- Multiple strategy entries + insertion-order independence proof. ---
test('reordering a multi-strategy record\'s metrics keys does not change the OOS association (order is never the mechanism)', () => {
  const candles = [makeCandle('SPY', '1h', 't0'), makeCandle('SPY', '1h', 't1')]
  const nativePayload = {
    // trendMomentum is listed BEFORE control here, the reverse of the real adapter's key order.
    trendMomentum: { candles, metrics: { totalTrades: 9, winRate: 0.55, profitFactor: 1.5, expectancy: 0.25, averageR: 0.25, grossProfit: 4, grossLoss: -1.5, maximumDrawdown: 1, averageHoldingTime: 80 } },
    control: { candles, metrics: makeStrategyJsMetrics({ totalTrades: 14, netReturn: 6 }), inSampleMetrics: makeStrategyJsMetrics({ totalTrades: 10, netReturn: 4 }), outOfSampleMetrics: makeStrategyJsMetrics({ totalTrades: 4, netReturn: -1 }) },
  }
  const record = createResearchRecordForExperiment('strategy-comparison', nativePayload)
  const result = synthesizeResearch([record])
  const allEvidence = result.strategyGroups.flatMap((group) => group.evidence)
  const inSample = allEvidence.find((entry) => entry.outOfSampleRole === 'in-sample')
  // Still unknown — reordering the native keys must never flip this to whichever key is now first.
  assert.equal(inSample.strategyId, null)
  assert.equal(inSample.strategyAssociation, 'unknown')
})

// --- Unknown association behavior when the native structure provides no explicit mapping at all. ---
test('unknown strategy association evidence is preserved as real evidence, not dropped', () => {
  const result = synthesizeResearch([strategyComparisonRecord()])
  const unknownGroup = findGroup(result, null)
  assert.equal(unknownGroup.evidence.length, 2)
  assert.deepEqual(unknownGroup.evidence.map((entry) => entry.outOfSampleRole).sort(), ['in-sample', 'out-of-sample'])
  // Every original control/trendMomentum evidence entry is still present and untouched elsewhere.
  const controlGroup = findGroup(result, 'setup-scan-baseline')
  const trendGroup = findGroup(result, 'trend-momentum-v1')
  assert.ok(findEvidence(controlGroup, 'control'))
  assert.ok(findEvidence(trendGroup, 'trendMomentum'))
})

// Helper used by several compareEvidence-focused tests above: flattens a single record via a
// throwaway synthesis call and returns its evidence array (keeps fixtures DRY without exporting
// flattenRecord as new public architecture).
function flattenViaSynthesis(record) {
  const result = synthesizeResearch([record])
  return result.strategyGroups.flatMap((group) => group.evidence).filter((entry) => entry.sourceRecordId === record.id)
}
