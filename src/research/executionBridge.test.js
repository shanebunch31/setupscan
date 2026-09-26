import assert from 'node:assert/strict'
import { test } from 'node:test'
import { listResearchExperiments } from './registry.js'
import {
  adaptResearchExecutionResult,
  createResearchExecutionBridge,
} from './executionBridge.js'

function runContext(overrides = {}) {
  return {
    runId: 'run-bridge-test',
    requestedAt: '2026-09-26T00:00:00.000Z',
    symbols: ['SPY', 'QQQ', 'IWM'],
    timeframe: '1Hour',
    requestedStart: '2022-01-01T00:00:00Z',
    requestedEnd: '2026-09-26T00:00:00Z',
    requestedExperiments: ['robustness'],
    ...overrides,
  }
}

function dataset(overrides = {}) {
  return {
    datasetId: 'dataset-bridge-test',
    provider: 'ALPACA HISTORICAL',
    timeframe: '1Hour',
    requestedStart: '2022-01-01T00:00:00Z',
    requestedEnd: '2026-09-26T00:00:00Z',
    fetchResultsBySymbol: {},
    rawSeriesBySymbol: {},
    ...overrides,
  }
}

function execution(experimentId, status, nativeOutput = null, error = null) {
  return { experimentId, status, nativeOutput, error }
}

function strategyMetrics(tradeCount, netReturn = tradeCount) {
  return {
    totalTrades: tradeCount,
    numberOfTrades: tradeCount,
    winRate: tradeCount ? 0.5 : 0,
    profitFactor: 1,
    expectancy: 0,
    averageR: 0,
    totalPositiveR: Math.max(0, netReturn),
    totalNegativeR: Math.min(0, netReturn),
    netReturn,
    maximumDrawdown: 0,
  }
}

test('succeeded execution selects the registry adapter and supplies run/dataset context', () => {
  const nativeOutput = { aligned: { raw: {}, timestamps: [] } }
  const expectedRecord = { sentinel: true }
  let received
  const bridge = createResearchExecutionBridge((...args) => {
    received = args
    return expectedRecord
  })
  const context = runContext()
  const data = dataset()

  assert.equal(bridge(execution('signal-quality', 'succeeded', nativeOutput), context, data), expectedRecord)
  assert.equal(received[0], 'signal-quality')
  assert.equal(received[1], nativeOutput)
  assert.equal(received[2].status, 'completed')
  assert.equal(received[2].timeframe, data.timeframe)
  assert.equal(received[2].provider, data.provider)
  assert.equal(received[2].requestedStart, context.requestedStart)
  assert.equal(received[2].requestedEnd, context.requestedEnd)
  assert.deepEqual(received[2].provenance, {
    runId: context.runId,
    datasetId: data.datasetId,
    requestedAt: context.requestedAt,
  })
})

test('succeeded execution requires a native output', () => {
  assert.throws(
    () => adaptResearchExecutionResult(execution('robustness', 'succeeded'), runContext(), dataset()),
    /requires nativeOutput/,
  )
})

test('the bridge dispatches every registered experiment through the registry-backed factory', () => {
  const bridge = createResearchExecutionBridge((experimentId, nativeOutput, context) => ({
    id: experimentId,
    nativePayload: nativeOutput,
    status: context.status,
  }))
  const nativeOutput = {}
  const records = listResearchExperiments().map(({ id }) => bridge(
    execution(id, 'succeeded', nativeOutput),
    runContext(),
    dataset(),
  ))

  assert.equal(records.length, 10)
  records.forEach((record) => {
    assert.equal(record.status, 'completed')
    assert.equal(record.nativePayload, nativeOutput)
  })
})

test('every real registry adapter still produces one normalized record through the bridge', () => {
  const nativeOutput = {}
  for (const { id } of listResearchExperiments()) {
    const record = adaptResearchExecutionResult(execution(id, 'succeeded', nativeOutput), runContext(), dataset())
    assert.equal(record.id, id)
    assert.equal(record.status, 'completed')
    assert.equal(record.nativePayload, nativeOutput)
  }
})

test('unavailable execution creates an empty record without invoking a specialized adapter', () => {
  let adapterCalls = 0
  const bridge = createResearchExecutionBridge(() => { adapterCalls += 1 })
  const nativeOutput = { available: false, missingSymbols: ['QQQ'] }
  const record = bridge(execution('relative-value', 'unavailable', nativeOutput), runContext(), dataset())

  assert.equal(adapterCalls, 0)
  assert.equal(record.id, 'relative-value')
  assert.equal(record.status, 'unavailable')
  assert.deepEqual(record.metrics, {})
  assert.equal(record.nativePayload, nativeOutput)
  assert.equal(record.provenance.runId, 'run-bridge-test')
  assert.equal(record.provenance.datasetId, 'dataset-bridge-test')
  assert.equal(record.provenance.requestedAt, '2026-09-26T00:00:00.000Z')
})

test('failed and skipped executions return null without invoking adapters', () => {
  let adapterCalls = 0
  const bridge = createResearchExecutionBridge(() => { adapterCalls += 1 })
  assert.equal(bridge(execution('robustness', 'failed', null, { message: 'failure' }), runContext(), dataset()), null)
  assert.equal(bridge(execution('robustness', 'skipped'), runContext(), dataset()), null)
  assert.equal(adapterCalls, 0)
})

test('incomplete native output is adapted with explicit incomplete status and preserved payload', () => {
  const nativeOutput = {
    thresholdResults: [{ minimumScore: 75, candles: [{ symbol: 'SPY', timeframe: '1h', timestamp: 't0' }], metrics: strategyMetrics(2) }],
    periodResults: [],
  }
  const record = adaptResearchExecutionResult(execution('robustness', 'incomplete', nativeOutput), runContext(), dataset())
  assert.equal(record.status, 'incomplete')
  assert.equal(record.input.complete, false)
  assert.equal(record.nativePayload, nativeOutput)
  assert.equal(record.metrics['75+'].tradeCount, 2)
})

test('incomplete execution without native output creates an empty incomplete record', () => {
  let adapterCalls = 0
  const bridge = createResearchExecutionBridge(() => { adapterCalls += 1 })
  const record = bridge(execution('causal-regime', 'incomplete'), runContext(), dataset())
  assert.equal(adapterCalls, 0)
  assert.equal(record.status, 'incomplete')
  assert.deepEqual(record.metrics, {})
  assert.equal(record.nativePayload, null)
  assert.equal(record.input.complete, false)
})

test('unknown execution status throws a clear validation error', () => {
  assert.throws(
    () => adaptResearchExecutionResult(execution('robustness', 'cancelled'), runContext(), dataset()),
    /Unknown experiment execution status: cancelled/,
  )
})

test('all registered adapter shapes still produce one normalized record each', () => {
  const nativeOutput = {}
  for (const { id } of listResearchExperiments()) {
    const record = adaptResearchExecutionResult(execution(id, 'succeeded', nativeOutput), runContext(), dataset())
    assert.equal(record.id, id)
    assert.equal(record.status, 'completed')
    assert.equal(record.nativePayload, nativeOutput)
  }
})

test('Strategy Discovery native provenance survives orchestration provenance overlay', () => {
  const nativeOutput = {
    available: true,
    universe: ['SPY', 'QQQ', 'IWM'],
    timeframe: '1Hour',
    datasetInfo: [{ symbol: 'SPY', provider: 'ALPACA HISTORICAL', candleCount: 5 }],
    generatedAt: 'native-generated-at',
    gitCommit: 'native-commit',
    experiments: [],
  }
  const record = adaptResearchExecutionResult(
    execution('strategy-discovery', 'succeeded', nativeOutput),
    runContext(),
    dataset(),
  )
  assert.deepEqual(record.provenance, {
    generatedAt: 'native-generated-at',
    gitCommit: 'native-commit',
    runId: 'run-bridge-test',
    datasetId: 'dataset-bridge-test',
    requestedAt: '2026-09-26T00:00:00.000Z',
  })
  assert.equal(record.nativePayload, nativeOutput)
})

test('Strategy Discovery preserves native strategy IDs without conflating trend momentum', () => {
  const nativeOutput = {
    available: true,
    universe: ['SPY', 'QQQ', 'IWM'],
    timeframe: '1Hour',
    datasetInfo: [],
    experiments: [{
      experimentId: 'momentum-breakout-v1',
      summary: { overall: { occurrenceCount: 0, tradeCount: 0 } },
    }],
  }
  const record = adaptResearchExecutionResult(
    execution('strategy-discovery', 'succeeded', nativeOutput),
    runContext(),
    dataset(),
  )
  assert.equal(record.metrics['momentum-breakout-v1'].strategyId, 'momentum-breakout-v1')
  assert.equal(record.metrics['momentum-breakout-v1'].occurrenceCount, 0)
  assert.equal('trend-momentum-v1' in record.metrics, false)
})

test('zero-trade successful output remains completed with native zero metrics', () => {
  const nativeOutput = {
    thresholdResults: [{ minimumScore: 75, candles: [{ symbol: 'SPY', timeframe: '1h', timestamp: 't0' }], metrics: strategyMetrics(0, 0) }],
    periodResults: [],
  }
  const record = adaptResearchExecutionResult(execution('robustness', 'succeeded', nativeOutput), runContext(), dataset())
  assert.equal(record.status, 'completed')
  assert.equal(record.metrics['75+'].tradeCount, 0)
  assert.equal(record.nativePayload, nativeOutput)
})

test('Strategy Comparison normalizes per-symbol branches with unique keys and separate identities', () => {
  const nativeOutput = {
    bySymbol: {
      SPY: {
        control: { metrics: strategyMetrics(10, 4), inSampleMetrics: strategyMetrics(7), outOfSampleMetrics: strategyMetrics(3) },
        trendMomentum: { metrics: { totalTrades: 5, winRate: 0.4, profitFactor: 1.2, expectancy: 0.1 }, inSampleMetrics: {}, outOfSampleMetrics: {} },
      },
      QQQ: {
        control: { metrics: strategyMetrics(8, 2), inSampleMetrics: {}, outOfSampleMetrics: {} },
        trendMomentum: { metrics: { totalTrades: 4, winRate: 0.5, profitFactor: 1.4, expectancy: 0.2 }, inSampleMetrics: {}, outOfSampleMetrics: {} },
      },
    },
  }
  const record = adaptResearchExecutionResult(
    execution('strategy-comparison', 'succeeded', nativeOutput),
    runContext(),
    dataset(),
  )

  assert.equal(record.id, 'strategy-comparison')
  assert.deepEqual(Object.keys(record.metrics), [
    'SPY::control', 'SPY::trendMomentum', 'QQQ::control', 'QQQ::trendMomentum',
  ])
  assert.equal(new Set(Object.keys(record.metrics)).size, 4)
  assert.equal(record.metrics['SPY::control'].strategyId, 'setup-scan-baseline')
  assert.equal(record.metrics['SPY::trendMomentum'].strategyId, 'trend-momentum-v1')
  assert.equal(record.metrics['QQQ::control'].strategyId, 'setup-scan-baseline')
  assert.equal(record.metrics['QQQ::trendMomentum'].strategyId, 'trend-momentum-v1')
  assert.equal(record.metrics['SPY::control'].totalR, 4)
  assert.equal('totalR' in record.metrics['SPY::trendMomentum'], false)
  assert.equal(record.nativePayload, nativeOutput)
  assert.deepEqual(record.input.symbols, ['SPY', 'QQQ'])
  assert.equal(record.input.actualStart, null)
  assert.equal(record.input.actualEnd, null)
  assert.equal(record.input.candleCount, null)
  assert.equal(record.outOfSample, null)
  assert.equal(record.costModel.status, 'not-modeled')
})

test('bridge does not call synthesis or fetch and returns one record object per execution', () => {
  const nativeOutput = { summaries: {} }
  const record = adaptResearchExecutionResult(execution('relative-value', 'succeeded', nativeOutput), runContext(), dataset())
  assert.equal(record.id, 'relative-value')
  assert.equal('records' in record, false)
  assert.equal('synthesis' in record, false)
  assert.equal(record.nativePayload, nativeOutput)
})