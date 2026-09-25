import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createResearchRecordForExperiment, getResearchExperiment, listResearchExperiments, researchRegistry } from './registry.js'
import { createFinding, createResearchRecord, FINDING_STATES, RESEARCH_STATUSES } from './researchRecord.js'

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
  assert.equal(typeof getResearchExperiment('signal-quality').adapter, 'function')
})

test('record factory preserves native output and envelope fields', () => {
  const nativePayload = { metrics: { totalTrades: 12, averageR: 0.4 }, aligned: { timestamps: ['a'] } }
  const record = createResearchRecordForExperiment('signal-quality', nativePayload, {
    symbols: ['SPY'],
    provider: 'alpaca',
    actualStart: '2026-01-01',
    actualEnd: '2026-01-31',
    parameters: { lookback: 10 },
    provenance: { source: 'test' },
  })

  assert.equal(record.status, 'completed')
  assert.equal(record.nativePayload, nativePayload)
  assert.deepEqual(record.metrics, { tradeCount: 12, averageR: 0.4 })
  assert.deepEqual(record.input.symbols, ['SPY'])
  assert.deepEqual(record.parameters, { lookback: 10 })
  assert.deepEqual(record.provenance, { source: 'test' })
})

test('unavailable discovery output remains unavailable without invented metrics', () => {
  const nativePayload = { available: false, missingSymbols: ['IWM'], universe: ['SPY', 'QQQ', 'IWM'] }
  const record = createResearchRecordForExperiment('strategy-discovery', nativePayload)

  assert.equal(record.status, 'unavailable')
  assert.deepEqual(record.metrics, {})
  assert.deepEqual(record.nativePayload, nativePayload)
})

test('adapters retain holdout and walk-forward out-of-sample boundaries', () => {
  const holdout = createResearchRecordForExperiment('frozen-score-holdout', {
    developmentRange: ['2020-01-01', '2023-12-31'],
    holdoutRange: ['2024-01-01', '2025-12-31'],
  })
  assert.deepEqual(holdout.outOfSample, {
    type: 'holdout',
    developmentRange: ['2020-01-01', '2023-12-31'],
    holdoutRange: ['2024-01-01', '2025-12-31'],
  })

  const walkForward = createResearchRecordForExperiment('walk-forward-regime', {
    windows: [{ trainStart: '2020', trainEnd: '2022', testStart: '2023', testEnd: '2023', testClassification: 'test' }],
  })
  assert.equal(walkForward.outOfSample.type, 'walk-forward')
  assert.equal(walkForward.outOfSample.windows[0].testClassification, 'test')
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
