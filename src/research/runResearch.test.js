import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createDatasetId } from './orchestration.js'
import { listResearchExperiments } from './registry.js'
import { createResearchRunComposer } from './researchRunComposition.js'
import { runResearch } from './runResearch.js'

function makeCandles(symbol, count = 220) {
  return Array.from({ length: count }, (_, index) => {
    const close = 100 + index * 0.01 + Math.sin(index / 7)
    return {
      symbol,
      timeframe: '1Hour',
      timestamp: new Date(Date.UTC(2022, 0, 3) + index * 60 * 60 * 1000).toISOString(),
      open: close - 0.1,
      high: close + 0.5,
      low: close - 0.5,
      close,
      volume: 1000 + index,
    }
  })
}

function makeFetchResult(symbol, overrides = {}) {
  const candles = overrides.candles ?? makeCandles(symbol, 3)
  return {
    provider: 'ALPACA HISTORICAL',
    symbol,
    timeframe: '1Hour',
    start: candles[0]?.timestamp ?? '2022-01-01T00:00:00Z',
    end: candles.at(-1)?.timestamp ?? '2022-01-01T02:00:00Z',
    requestedStart: '2022-01-01T00:00:00Z',
    requestedEnd: '2026-09-26T00:00:00Z',
    candleCount: candles.length,
    complete: true,
    candles,
    ...overrides,
  }
}

function request(overrides = {}) {
  return { symbols: ['SPY'], timeframe: '1Hour', ...overrides }
}

function runOptions({ fetcher, dispatcher, composer } = {}) {
  return {
    ...(fetcher ? { fetchHistoricalMarketData: fetcher } : {}),
    ...(dispatcher ? { executeResearchExperiment: dispatcher } : {}),
    ...(composer ? { composeResearchRunResult: composer } : {}),
  }
}

function robustnessOutput() {
  const candles = makeCandles('SPY', 3)
  const metrics = { totalTrades: 0, numberOfTrades: 0, winRate: 0, netReturn: 0, maximumDrawdown: 0 }
  return {
    thresholdResults: [{ minimumScore: 75, candles, metrics, inSampleMetrics: metrics, outOfSampleMetrics: metrics }],
    periodResults: [],
  }
}

test('minimal valid request returns the complete composed result without fetching for an empty experiment list', async () => {
  let fetchCalls = 0
  const result = await runResearch(
    request({ requestedExperiments: [] }),
    runOptions({ fetcher: async () => { fetchCalls += 1 } }),
  )
  assert.equal(fetchCalls, 0)
  assert.deepEqual(Object.keys(result), [
    'runContext', 'status', 'fetchStatus', 'fetchIssues', 'dataset', 'experimentResults', 'records', 'synthesis',
  ])
  assert.equal(result.status, 'completed')
  assert.equal(result.fetchStatus, 'not-requested')
  assert.equal(result.dataset, null)
  assert.deepEqual(result.records, [])
  assert.deepEqual(result.synthesis.coverage.requested, [])
})

test('requestedExperiments defaults to every registered experiment', async () => {
  const dispatcherCalls = []
  const result = await runResearch(request(), runOptions({
    fetcher: async (symbol) => makeFetchResult(symbol),
    dispatcher: (experimentId) => {
      dispatcherCalls.push(experimentId)
      return { experimentId, status: 'unavailable', nativeOutput: null, error: null }
    },
  }))
  const experimentIds = listResearchExperiments().map(({ id }) => id)
  assert.deepEqual(result.runContext.requestedExperiments, experimentIds)
  assert.deepEqual(dispatcherCalls, experimentIds)
  assert.deepEqual(result.synthesis.coverage.requested, experimentIds)
})

test('explicit experiment subset is preserved in request and execution order', async () => {
  const calls = []
  const subset = ['strategy-comparison', 'robustness']
  const result = await runResearch(request({ requestedExperiments: subset }), runOptions({
    fetcher: async (symbol) => makeFetchResult(symbol),
    dispatcher: (experimentId) => {
      calls.push(experimentId)
      return { experimentId, status: 'unavailable', nativeOutput: null, error: null }
    },
  }))
  assert.deepEqual(result.runContext.requestedExperiments, subset)
  assert.deepEqual(calls, subset)
  assert.deepEqual(result.synthesis.coverage.requested, subset)
})

test('explicit empty requestedExperiments remains valid and causes no fetch', async () => {
  let fetchCalls = 0
  const result = await runResearch(request({ requestedExperiments: [] }), runOptions({
    fetcher: async () => { fetchCalls += 1 },
  }))
  assert.equal(fetchCalls, 0)
  assert.deepEqual(result.runContext.requestedExperiments, [])
  assert.equal(result.fetchStatus, 'not-requested')
})

test('symbols and timeframe use existing normalization before fetch', async () => {
  const calls = []
  const result = await runResearch(request({
    symbols: ['spy', 'QQQ', 'SPY'],
    timeframe: '1h',
    requestedExperiments: [],
  }), runOptions({ fetcher: async (...args) => { calls.push(args) } }))
  assert.deepEqual(result.runContext.symbols, ['SPY', 'QQQ'])
  assert.equal(result.runContext.timeframe, '1Hour')
  assert.equal(calls.length, 0)
})

test('invalid symbols and timeframe reject before any fetch', async () => {
  let fetchCalls = 0
  const options = runOptions({ fetcher: async () => { fetchCalls += 1 } })
  await assert.rejects(runResearch(request({ symbols: ['SPY', ''] }), options), /symbol/)
  await assert.rejects(runResearch(request({ timeframe: '5Min' }), options), /timeframe/)
  assert.equal(fetchCalls, 0)
})

test('invalid single date bounds and non-increasing ranges reject before any fetch', async () => {
  let fetchCalls = 0
  const options = runOptions({ fetcher: async () => { fetchCalls += 1 } })
  await assert.rejects(runResearch(request({ requestedStart: 'not-a-date' }), options), /requestedStart must be a valid date/)
  await assert.rejects(runResearch(request({ requestedEnd: 'not-a-date' }), options), /requestedEnd must be a valid date/)
  await assert.rejects(runResearch(request({
    requestedStart: '2026-01-01T00:00:00Z',
    requestedEnd: '2025-01-01T00:00:00Z',
  }), options), /strictly before/)
  assert.equal(fetchCalls, 0)
})

test('unknown experiment rejects before any fetch', async () => {
  let fetchCalls = 0
  await assert.rejects(
    runResearch(request({ requestedExperiments: ['not-registered'] }), runOptions({
      fetcher: async () => { fetchCalls += 1 },
    })),
    /unknown experiment id/,
  )
  assert.equal(fetchCalls, 0)
})

test('successful request returns the complete result with records and synthesis', async () => {
  const calls = []
  const fetched = makeFetchResult('SPY')
  const result = await runResearch(request({ requestedExperiments: ['robustness'] }), runOptions({
    fetcher: async (symbol, timeframe, range) => {
      calls.push([symbol, timeframe, range])
      return fetched
    },
    dispatcher: (experimentId) => ({ experimentId, status: 'succeeded', nativeOutput: robustnessOutput(), error: null }),
  }))
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0], ['SPY', '1Hour', { start: null, end: null }])
  assert.equal(result.status, 'completed')
  assert.equal(result.fetchStatus, 'complete')
  assert.equal(result.dataset.datasetId, createDatasetId([fetched]))
  assert.equal(result.records.length, 1)
  assert.equal(result.records[0].status, 'completed')
  assert.deepEqual(result.synthesis.coverage.requested, ['robustness'])
})

test('partial run retains fetch diagnostics and successful records', async () => {
  const result = await runResearch(request({
    symbols: ['SPY', 'QQQ'],
    requestedExperiments: ['robustness', 'relative-value'],
  }), runOptions({
    fetcher: async (symbol) => {
      if (symbol === 'QQQ') throw new Error('offline')
      return makeFetchResult(symbol)
    },
    dispatcher: (experimentId) => experimentId === 'robustness'
      ? { experimentId, status: 'succeeded', nativeOutput: robustnessOutput(), error: null }
      : { experimentId, status: 'unavailable', nativeOutput: null, error: null },
  }))
  assert.equal(result.status, 'partial')
  assert.equal(result.fetchStatus, 'partial')
  assert.equal(result.fetchIssues[0].symbol, 'QQQ')
  assert.deepEqual(result.records.map((record) => record.id), ['robustness', 'relative-value'])
  assert.equal(result.records[0].status, 'completed')
  assert.equal(result.records[1].status, 'unavailable')
})

test('all-fetch-failure run retains unavailable status and no dataset', async () => {
  const result = await runResearch(request({ requestedExperiments: ['robustness'] }), runOptions({
    fetcher: async () => { throw new Error('offline') },
  }))
  assert.equal(result.status, 'unavailable')
  assert.equal(result.fetchStatus, 'unavailable')
  assert.equal(result.dataset, null)
  assert.equal(result.experimentResults[0].status, 'unavailable')
  assert.equal(result.records[0].status, 'unavailable')
  assert.deepEqual(result.synthesis.strategyGroups, [])
})

test('native experiment failure remains in experimentResults and runResearch does not relabel it', async () => {
  const nativeFailure = { experimentId: 'robustness', status: 'failed', nativeOutput: null, error: { message: 'native failure' } }
  const result = await runResearch(request({ requestedExperiments: ['robustness'] }), runOptions({
    fetcher: async (symbol) => makeFetchResult(symbol),
    dispatcher: () => nativeFailure,
  }))
  assert.equal(result.status, 'partial')
  assert.equal(result.experimentResults[0], nativeFailure)
  assert.deepEqual(result.records, [])
})

test('bridge errors propagate through the public runner', async () => {
  await assert.rejects(runResearch(request({ requestedExperiments: ['robustness'] }), runOptions({
    fetcher: async (symbol) => makeFetchResult(symbol),
    dispatcher: (experimentId) => ({ experimentId, status: 'unknown-status', nativeOutput: {}, error: null }),
  })), /Unknown experiment execution status/)
})

test('synthesis errors propagate through the public runner', async () => {
  const failingComposer = createResearchRunComposer({
    synthesize: () => { throw new Error('synthesis fault') },
  })
  await assert.rejects(runResearch(request({ requestedExperiments: ['robustness'] }), runOptions({
    fetcher: async (symbol) => makeFetchResult(symbol),
    dispatcher: (experimentId) => ({ experimentId, status: 'failed', nativeOutput: null, error: { message: 'native fault' } }),
    composer: failingComposer,
  })), /synthesis fault/)
})

test('one context is created and dataset identity is passed through unchanged', async () => {
  const originalDateNow = Date.now
  let dateNowCalls = 0
  Date.now = () => {
    dateNowCalls += 1
    return 123456789
  }
  let composedInput
  const fetched = makeFetchResult('SPY')
  try {
    const result = await runResearch(request({ requestedExperiments: ['robustness'] }), runOptions({
      fetcher: async () => fetched,
      dispatcher: (experimentId) => ({ experimentId, status: 'failed', nativeOutput: null, error: {} }),
      composer: (executionRunResult) => {
        composedInput = executionRunResult
        return executionRunResult
      },
    }))
    assert.equal(dateNowCalls, 1)
    assert.equal(result, composedInput)
    assert.equal(result.dataset.datasetId, createDatasetId([fetched]))
    assert.equal(result.runContext.runId, composedInput.runContext.runId)
  } finally {
    Date.now = originalDateNow
  }
})

test('normalized records and synthesis are returned unchanged from composition', async () => {
  const sentinel = { records: [{ id: 'sentinel' }], synthesis: { provenance: { runId: 'r', datasetId: 'd' } } }
  const result = await runResearch(request({ requestedExperiments: [] }), runOptions({
    composer: () => sentinel,
  }))
  assert.equal(result, sentinel)
})

test('default production dependencies remain wired to the browser historical helper and Phase 4 dispatcher', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  const fetchResult = makeFetchResult('SPY', { candles: makeCandles('SPY') })
  globalThis.fetch = async (url) => {
    calls.push(String(url))
    return { ok: true, json: async () => fetchResult }
  }
  try {
    const result = await runResearch(request({ requestedExperiments: ['robustness'] }))
    assert.equal(result.status, 'completed')
    assert.equal(result.experimentResults[0].status, 'succeeded')
    assert.equal(calls.length, 1)
    assert.match(calls[0], /\/api\/historical\?/)
  } finally {
    globalThis.fetch = originalFetch
  }
})