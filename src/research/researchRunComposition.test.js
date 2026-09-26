import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createResearchRecordForExperiment } from './registry.js'
import { synthesizeResearch } from './synthesis.js'
import {
  composeResearchRunResult,
  createResearchRunComposer,
} from './researchRunComposition.js'

function makeRunContext(requestedExperiments) {
  return {
    runId: 'run-compose-test',
    requestedAt: '2026-09-26T00:00:00.000Z',
    symbols: ['SPY', 'QQQ', 'IWM'],
    timeframe: '1Hour',
    requestedStart: '2022-01-01T00:00:00Z',
    requestedEnd: '2026-09-26T00:00:00Z',
    requestedExperiments,
  }
}

function makeDataset(overrides = {}) {
  return {
    datasetId: 'dataset-compose-test',
    provider: 'ALPACA HISTORICAL',
    timeframe: '1Hour',
    requestedStart: '2022-01-01T00:00:00Z',
    requestedEnd: '2026-09-26T00:00:00Z',
    fetchResultsBySymbol: {},
    rawSeriesBySymbol: {},
    ...overrides,
  }
}

function makeRunResult({
  requestedExperiments = [],
  experimentResults = [],
  dataset = makeDataset(),
  status = 'completed',
  fetchStatus = 'complete',
  fetchIssues = [],
} = {}) {
  return {
    runContext: makeRunContext(requestedExperiments),
    status,
    fetchStatus,
    fetchIssues,
    dataset,
    experimentResults,
  }
}

function result(experimentId, status, nativeOutput = null, error = null) {
  return { experimentId, status, nativeOutput, error }
}

function candle(symbol, timestamp = `${symbol}-t0`) {
  return { symbol, timeframe: '1h', timestamp, open: 100, high: 101, low: 99, close: 100, volume: 1000 }
}

function robustnessOutput(tradeCount = 2) {
  return {
    thresholdResults: [{
      minimumScore: 75,
      candles: [candle('SPY')],
      metrics: { totalTrades: tradeCount, numberOfTrades: tradeCount, winRate: tradeCount ? 0.5 : 0, netReturn: tradeCount, maximumDrawdown: 0 },
      inSampleMetrics: { totalTrades: tradeCount },
      outOfSampleMetrics: { totalTrades: 0 },
    }],
    periodResults: [],
  }
}

function strategyComparisonOutput(symbols = ['SPY']) {
  return {
    bySymbol: Object.fromEntries(symbols.map((symbol) => [symbol, {
      control: { metrics: { totalTrades: 2, netReturn: 1, winRate: 0.5, expectancy: 0.5 } },
      trendMomentum: { metrics: { totalTrades: 1, winRate: 1, expectancy: 1 } },
    }])),
  }
}

test('full success composes one record per experiment and synthesizes once', () => {
  const runResult = makeRunResult({
    requestedExperiments: ['robustness', 'strategy-comparison'],
    experimentResults: [
      result('robustness', 'succeeded', robustnessOutput()),
      result('strategy-comparison', 'succeeded', strategyComparisonOutput(['SPY', 'QQQ'])),
    ],
  })
  const recordsSeenBySynthesis = []
  let synthesisCalls = 0
  const composer = createResearchRunComposer({
    adaptExecutionResult: (execution, context, dataset) => {
      assert.equal(context, runResult.runContext)
      assert.equal(dataset, runResult.dataset)
      return createResearchRecordForExperiment(execution.experimentId, execution.nativeOutput, {
        status: 'completed',
        provenance: { runId: context.runId, datasetId: dataset.datasetId, requestedAt: context.requestedAt },
      })
    },
    synthesize: (records, context) => {
      synthesisCalls += 1
      recordsSeenBySynthesis.push(...records)
      return { coverage: { evaluated: records.map((record) => record.id) }, provenance: context }
    },
  })

  const composed = composer(runResult)
  assert.equal(synthesisCalls, 1)
  assert.deepEqual(composed.records.map((record) => record.id), ['robustness', 'strategy-comparison'])
  assert.equal(recordsSeenBySynthesis.length, 2)
  assert.equal(composed.synthesis.coverage.evaluated.length, 2)
  assert.equal(composed.runContext, runResult.runContext)
  assert.equal(composed.dataset, runResult.dataset)
  assert.equal(composed.experimentResults, runResult.experimentResults)
  assert.equal(composed.fetchIssues, runResult.fetchIssues)
  assert.equal(composed.status, runResult.status)
  assert.equal(composed.fetchStatus, runResult.fetchStatus)
})

test('partial fetch composition keeps successful evidence and excludes unavailable evidence', () => {
  const runResult = makeRunResult({
    requestedExperiments: ['robustness', 'relative-value', 'strategy-comparison'],
    status: 'partial',
    fetchStatus: 'partial',
    fetchIssues: [{ symbol: 'QQQ', type: 'fetch-error', error: { message: 'offline' } }],
    experimentResults: [
      result('robustness', 'succeeded', robustnessOutput()),
      result('relative-value', 'unavailable'),
      result('strategy-comparison', 'succeeded', strategyComparisonOutput(['SPY', 'IWM'])),
    ],
    dataset: makeDataset({ rawSeriesBySymbol: { SPY: [candle('SPY')], IWM: [candle('IWM')] } }),
  })
  const composed = composeResearchRunResult(runResult)
  assert.deepEqual(composed.records.map((record) => record.id), ['robustness', 'relative-value', 'strategy-comparison'])
  assert.equal(composed.records[1].status, 'unavailable')
  assert.deepEqual(composed.records[1].metrics, {})
  assert.deepEqual(composed.synthesis.coverage.unavailable, ['relative-value'])
  assert.ok(composed.synthesis.coverage.evaluated.includes('robustness'))
  assert.ok(composed.synthesis.coverage.evaluated.includes('strategy-comparison'))
  assert.equal(composed.synthesis.provenance.runId, runResult.runContext.runId)
  assert.equal(composed.synthesis.provenance.datasetId, runResult.dataset.datasetId)
})

test('all-fetch failure and empty-data runs synthesize unavailable records without evidence', () => {
  const runResult = makeRunResult({
    requestedExperiments: ['robustness', 'relative-value'],
    status: 'unavailable',
    fetchStatus: 'unavailable',
    fetchIssues: [{ symbol: 'SPY', type: 'fetch-error' }, { symbol: 'QQQ', type: 'empty' }],
    dataset: null,
    experimentResults: [result('robustness', 'unavailable'), result('relative-value', 'unavailable')],
  })
  const composed = composeResearchRunResult(runResult)
  assert.equal(composed.dataset, null)
  assert.equal(composed.synthesis.provenance.datasetId, null)
  assert.deepEqual(composed.synthesis.coverage, {
    requested: ['robustness', 'relative-value'],
    unavailable: ['robustness', 'relative-value'],
    incomplete: [],
    evaluated: [],
  })
  assert.deepEqual(composed.synthesis.strategyGroups, [])
})

test('incomplete executions remain records and synthesis flags their evidence', () => {
  const runResult = makeRunResult({
    requestedExperiments: ['robustness'],
    status: 'partial',
    fetchStatus: 'partial',
    fetchIssues: [{ symbol: 'QQQ', type: 'incomplete' }],
    experimentResults: [result('robustness', 'incomplete', robustnessOutput())],
  })
  const composed = composeResearchRunResult(runResult)
  assert.equal(composed.records[0].status, 'incomplete')
  assert.equal(composed.records[0].nativePayload, runResult.experimentResults[0].nativeOutput)
  assert.deepEqual(composed.synthesis.coverage.incomplete, ['robustness'])
  assert.ok(composed.synthesis.coverage.evaluated.includes('robustness'))
  assert.ok(composed.synthesis.unresolvedQuestions.some((question) => question.includes('incomplete')))
})

test('failed execution remains in experimentResults but contributes no record', () => {
  const failed = result('robustness', 'failed', null, { name: 'Error', message: 'native fault' })
  const runResult = makeRunResult({ requestedExperiments: ['robustness'], experimentResults: [failed] })
  const composed = composeResearchRunResult(runResult)
  assert.deepEqual(composed.records, [])
  assert.equal(composed.experimentResults[0], failed)
  assert.deepEqual(composed.synthesis.coverage, {
    requested: ['robustness'],
    unavailable: [],
    incomplete: [],
    evaluated: [],
  })
})

test('unavailable execution creates a record that synthesis excludes from evidence', () => {
  const runResult = makeRunResult({
    requestedExperiments: ['relative-value'],
    experimentResults: [result('relative-value', 'unavailable')],
  })
  const composed = composeResearchRunResult(runResult)
  assert.equal(composed.records.length, 1)
  assert.equal(composed.records[0].status, 'unavailable')
  assert.deepEqual(composed.records[0].metrics, {})
  assert.deepEqual(composed.synthesis.coverage.unavailable, ['relative-value'])
  assert.deepEqual(composed.synthesis.strategyGroups, [])
})

test('skipped execution remains in experimentResults but is omitted from records', () => {
  const skipped = result('signal-quality', 'skipped', null, { message: 'policy skip' })
  const runResult = makeRunResult({ requestedExperiments: ['signal-quality'], experimentResults: [skipped] })
  const composed = composeResearchRunResult(runResult)
  assert.deepEqual(composed.records, [])
  assert.equal(composed.experimentResults[0], skipped)
  assert.deepEqual(composed.synthesis.coverage.requested, ['signal-quality'])
  assert.deepEqual(composed.synthesis.coverage.evaluated, [])
})

test('empty requested experiments synthesize an empty run with exact requested coverage', () => {
  const runResult = makeRunResult({
    requestedExperiments: [],
    status: 'completed',
    fetchStatus: 'not-requested',
    dataset: null,
    experimentResults: [],
  })
  const composed = composeResearchRunResult(runResult)
  assert.deepEqual(composed.records, [])
  assert.deepEqual(composed.synthesis.coverage.requested, [])
  assert.equal(composed.synthesis.provenance.runId, runResult.runContext.runId)
  assert.equal(composed.synthesis.provenance.datasetId, null)
})

test('synthesis receives only the approved context and is called exactly once', () => {
  const runResult = makeRunResult({
    requestedExperiments: ['robustness'],
    experimentResults: [result('robustness', 'failed', null, { message: 'failure' })],
  })
  let callCount = 0
  let receivedRecords
  let receivedContext
  const composer = createResearchRunComposer({
    adaptExecutionResult: () => null,
    synthesize: (records, context) => {
      callCount += 1
      receivedRecords = records
      receivedContext = context
      return { done: true }
    },
  })

  const composed = composer(runResult)
  assert.equal(callCount, 1)
  assert.deepEqual(receivedRecords, [])
  assert.deepEqual(receivedContext, {
    runId: 'run-compose-test',
    datasetId: 'dataset-compose-test',
    requestedExperiments: ['robustness'],
  })
  assert.deepEqual(Object.keys(receivedContext), ['runId', 'datasetId', 'requestedExperiments'])
  assert.deepEqual(composed.synthesis, { done: true })
})

test('records preserve runId and datasetId traceability without duplicate top-level IDs', () => {
  const runResult = makeRunResult({
    requestedExperiments: ['robustness'],
    experimentResults: [result('robustness', 'succeeded', robustnessOutput())],
  })
  const composed = composeResearchRunResult(runResult)
  assert.equal(composed.records[0].provenance.runId, runResult.runContext.runId)
  assert.equal(composed.records[0].provenance.datasetId, runResult.dataset.datasetId)
  assert.equal(composed.records[0].provenance.requestedAt, runResult.runContext.requestedAt)
  assert.equal('runId' in composed, false)
  assert.equal('datasetId' in composed, false)
})

test('native metric entries do not create duplicate normalized records or records per partition', () => {
  const runResult = makeRunResult({
    requestedExperiments: ['robustness'],
    experimentResults: [result('robustness', 'succeeded', robustnessOutput())],
  })
  const composed = composeResearchRunResult(runResult)
  assert.equal(composed.records.length, 1)
  assert.equal(composed.records[0].id, 'robustness')
  assert.deepEqual(Object.keys(composed.records[0].metrics), ['75+'])
  assert.equal(composed.records[0].nativePayload, runResult.experimentResults[0].nativeOutput)
})

test('Strategy Comparison and Strategy Discovery native payloads and identities survive composition', () => {
  const comparisonPayload = strategyComparisonOutput(['SPY', 'QQQ'])
  const discoveryPayload = {
    available: true,
    universe: ['SPY', 'QQQ', 'IWM'],
    timeframe: '1Hour',
    datasetInfo: [],
    generatedAt: 'native-generated-at',
    gitCommit: 'native-commit',
    experiments: [{
      experimentId: 'momentum-breakout-v1',
      summary: { overall: { occurrenceCount: 0, tradeCount: 0 } },
    }],
  }
  const runResult = makeRunResult({
    requestedExperiments: ['strategy-comparison', 'strategy-discovery'],
    experimentResults: [
      result('strategy-comparison', 'succeeded', comparisonPayload),
      result('strategy-discovery', 'succeeded', discoveryPayload),
    ],
  })
  const composed = composeResearchRunResult(runResult)
  const comparison = composed.records[0]
  const discovery = composed.records[1]
  assert.equal(comparison.nativePayload, comparisonPayload)
  assert.deepEqual(Object.keys(comparison.metrics), [
    'SPY::control', 'SPY::trendMomentum', 'QQQ::control', 'QQQ::trendMomentum',
  ])
  assert.equal(comparison.metrics['SPY::control'].strategyId, 'setup-scan-baseline')
  assert.equal(comparison.metrics['SPY::trendMomentum'].strategyId, 'trend-momentum-v1')
  assert.equal(discovery.nativePayload, discoveryPayload)
  assert.equal(discovery.metrics['momentum-breakout-v1'].strategyId, 'momentum-breakout-v1')
  assert.equal('trend-momentum-v1' in discovery.metrics, false)
  assert.equal(discovery.provenance.generatedAt, 'native-generated-at')
  assert.equal(discovery.provenance.gitCommit, 'native-commit')
})

test('composition propagates bridge and synthesis errors instead of relabeling executions', () => {
  const runResult = makeRunResult({
    requestedExperiments: ['robustness'],
    experimentResults: [result('robustness', 'succeeded', robustnessOutput())],
  })
  const bridgeFailure = createResearchRunComposer({
    adaptExecutionResult: () => { throw new Error('bridge bug') },
    synthesize: () => ({ unreachable: true }),
  })
  const synthesisFailure = createResearchRunComposer({
    adaptExecutionResult: () => ({ id: 'robustness', status: 'completed', metrics: {} }),
    synthesize: () => { throw new Error('synthesis bug') },
  })
  assert.throws(() => bridgeFailure(runResult), /bridge bug/)
  assert.throws(() => synthesisFailure(runResult), /synthesis bug/)
  assert.equal(runResult.experimentResults[0].status, 'succeeded')
})

test('composed synthesis remains neutral and does not add verdicts or rankings', () => {
  const runResult = makeRunResult({
    requestedExperiments: ['robustness', 'strategy-comparison'],
    experimentResults: [
      result('robustness', 'succeeded', robustnessOutput()),
      result('strategy-comparison', 'succeeded', strategyComparisonOutput(['SPY'])),
    ],
  })
  const composed = composeResearchRunResult(runResult)
  const forbiddenKeys = new Set(['rank', 'ranking', 'winner', 'recommendation', 'confidence', 'verdict', 'probability', 'buy', 'sell'])
  function check(value) {
    if (Array.isArray(value)) return value.forEach(check)
    if (!value || typeof value !== 'object') return
    Object.entries(value).forEach(([key, nested]) => {
      assert.equal(forbiddenKeys.has(key), false, `unexpected synthesis key: ${key}`)
      check(nested)
    })
  }
  check(composed.synthesis)
})
