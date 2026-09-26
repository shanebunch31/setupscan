import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createDatasetId, createResearchRunContext, createRunId, executeResearchRun } from './orchestration.js'
import { listResearchExperiments } from './registry.js'

test('createRunId returns a string', () => {
  assert.equal(typeof createRunId(), 'string')
})

test('createRunId never returns an empty string', () => {
  const runId = createRunId()
  assert.ok(runId.length > 0)
})

test('createRunId produces a different id on every call, including consecutive calls', () => {
  const first = createRunId()
  const second = createRunId()
  assert.notEqual(first, second)
})

test('createRunId produces many unique ids in a tight loop (no collisions from timestamp alone)', () => {
  const ids = new Set(Array.from({ length: 200 }, () => createRunId()))
  assert.equal(ids.size, 200)
})

test('createRunId is opaque and safe to store as a provenance string (no whitespace, no embedded market-data semantics)', () => {
  const runId = createRunId()
  assert.equal(/\s/.test(runId), false)
  assert.equal(/[^a-z0-9_]/i.test(runId), false)
  // Must not encode symbol/timeframe/date-range semantics — it identifies an execution, not data.
  assert.equal(/SPY|QQQ|IWM|1Hour|1h/i.test(runId), false)
})

test('createRunId does not depend on any market-data input (it takes no arguments)', () => {
  assert.equal(createRunId.length, 0)
})

test('repeated calls that would occur against identical data still receive distinct ids', () => {
  const runsForSameHypotheticalDataset = Array.from({ length: 5 }, () => createRunId())
  assert.equal(new Set(runsForSameHypotheticalDataset).size, 5)
})

// --- createDatasetId ---

function makeFetchResult(overrides = {}) {
  return {
    provider: 'ALPACA HISTORICAL',
    symbol: 'SPY',
    timeframe: '1Hour',
    start: '2022-01-03T14:00:00Z',
    end: '2025-12-31T20:00:00Z',
    requestedStart: '2022-01-01T00:00:00Z',
    requestedEnd: '2026-01-01T00:00:00Z',
    candleCount: 8760,
    complete: true,
    minimumExpectedCandles: 1000,
    candles: [],
    ...overrides,
  }
}

function threeSymbolFetchResults() {
  return [
    makeFetchResult({ symbol: 'SPY', candleCount: 8760 }),
    makeFetchResult({ symbol: 'QQQ', candleCount: 8750 }),
    makeFetchResult({ symbol: 'IWM', candleCount: 8740 }),
  ]
}

test('createDatasetId: identical fetch results produce an identical datasetId', () => {
  assert.equal(createDatasetId(threeSymbolFetchResults()), createDatasetId(threeSymbolFetchResults()))
})

test('createDatasetId: a changed actualStart produces a different datasetId', () => {
  const base = createDatasetId([makeFetchResult()])
  const changed = createDatasetId([makeFetchResult({ start: '2022-01-04T14:00:00Z' })])
  assert.notEqual(base, changed)
})

test('createDatasetId: a changed actualEnd produces a different datasetId', () => {
  const base = createDatasetId([makeFetchResult()])
  const changed = createDatasetId([makeFetchResult({ end: '2025-12-30T20:00:00Z' })])
  assert.notEqual(base, changed)
})

test('createDatasetId: a changed candleCount produces a different datasetId', () => {
  const base = createDatasetId([makeFetchResult()])
  const changed = createDatasetId([makeFetchResult({ candleCount: 8761 })])
  assert.notEqual(base, changed)
})

test('createDatasetId: adding a symbol produces a different datasetId', () => {
  const two = createDatasetId([makeFetchResult({ symbol: 'SPY' }), makeFetchResult({ symbol: 'QQQ' })])
  const three = createDatasetId(threeSymbolFetchResults())
  assert.notEqual(two, three)
})

test('createDatasetId: removing a symbol produces a different datasetId', () => {
  const three = createDatasetId(threeSymbolFetchResults())
  const two = createDatasetId([makeFetchResult({ symbol: 'SPY' }), makeFetchResult({ symbol: 'QQQ' })])
  assert.notEqual(three, two)
})

test('createDatasetId: reordering the same symbols produces the SAME datasetId', () => {
  const forward = threeSymbolFetchResults()
  const reversed = [...threeSymbolFetchResults()].reverse()
  assert.equal(createDatasetId(forward), createDatasetId(reversed))
})

test('createDatasetId: a changed provider produces a different datasetId', () => {
  const base = createDatasetId([makeFetchResult()])
  const changed = createDatasetId([makeFetchResult({ provider: 'OTHER PROVIDER' })])
  assert.notEqual(base, changed)
})

test('createDatasetId: a changed timeframe produces a different datasetId', () => {
  const base = createDatasetId([makeFetchResult()])
  const changed = createDatasetId([makeFetchResult({ timeframe: '1Day' })])
  assert.notEqual(base, changed)
})

test('createDatasetId: different runIds are irrelevant — datasetId depends only on fetch metadata', () => {
  const runA = createRunId()
  const runB = createRunId()
  assert.notEqual(runA, runB)
  assert.equal(createDatasetId(threeSymbolFetchResults()), createDatasetId(threeSymbolFetchResults()))
})

test('createDatasetId: changing requestedStart/requestedEnd only produces the SAME datasetId', () => {
  const base = createDatasetId([makeFetchResult()])
  const changed = createDatasetId([makeFetchResult({ requestedStart: '2019-01-01T00:00:00Z', requestedEnd: '2019-06-01T00:00:00Z' })])
  assert.equal(base, changed)
})

test('createDatasetId: changing `complete` only produces the SAME datasetId', () => {
  const base = createDatasetId([makeFetchResult({ complete: true })])
  const changed = createDatasetId([makeFetchResult({ complete: false })])
  assert.equal(base, changed)
})

test('createDatasetId: changing `minimumExpectedCandles` only produces the SAME datasetId', () => {
  const base = createDatasetId([makeFetchResult({ minimumExpectedCandles: 1000 })])
  const changed = createDatasetId([makeFetchResult({ minimumExpectedCandles: 20 })])
  assert.equal(base, changed)
})

test('createDatasetId: a three-symbol dataset differs from any one-symbol subset of itself', () => {
  const three = createDatasetId(threeSymbolFetchResults())
  threeSymbolFetchResults().forEach((entry) => {
    assert.notEqual(three, createDatasetId([entry]))
  })
})

test('createDatasetId: result begins with "dataset_"', () => {
  assert.ok(createDatasetId(threeSymbolFetchResults()).startsWith('dataset_'))
})

test('createDatasetId: repeated calls with the same inputs produce the same result', () => {
  const inputs = threeSymbolFetchResults()
  const first = createDatasetId(inputs)
  const second = createDatasetId(inputs)
  const third = createDatasetId(inputs)
  assert.equal(first, second)
  assert.equal(second, third)
})

test('createDatasetId rejects non-array input', () => {
  assert.throws(() => createDatasetId(undefined))
  assert.throws(() => createDatasetId({}))
  assert.throws(() => createDatasetId('SPY'))
})

test('createDatasetId rejects an empty array', () => {
  assert.throws(() => createDatasetId([]))
})

test('createDatasetId rejects a fetch result missing a required identity field', () => {
  assert.throws(() => createDatasetId([makeFetchResult({ provider: undefined })]))
  assert.throws(() => createDatasetId([makeFetchResult({ symbol: '' })]))
  assert.throws(() => createDatasetId([makeFetchResult({ timeframe: undefined })]))
  assert.throws(() => createDatasetId([{ ...makeFetchResult(), start: undefined, end: undefined }]))
  assert.throws(() => createDatasetId([makeFetchResult({ candleCount: undefined })]))
})

test('createDatasetId accepts explicit actualStart/actualEnd field names as an alternative to start/end', () => {
  const viaStartEnd = createDatasetId([makeFetchResult({ symbol: 'SPY', start: '2022-01-03T14:00:00Z', end: '2025-12-31T20:00:00Z' })])
  const viaActual = createDatasetId([{ provider: 'ALPACA HISTORICAL', symbol: 'SPY', timeframe: '1Hour', actualStart: '2022-01-03T14:00:00Z', actualEnd: '2025-12-31T20:00:00Z', candleCount: 8760 }])
  assert.equal(viaStartEnd, viaActual)
})

// --- createResearchRunContext ---

function baseRequest(overrides = {}) {
  return { symbols: ['SPY', 'QQQ', 'IWM'], timeframe: '1Hour', ...overrides }
}

test('createResearchRunContext: a valid request produces a context', () => {
  const context = createResearchRunContext(baseRequest())
  assert.equal(typeof context, 'object')
})

test('createResearchRunContext: context contains a string runId', () => {
  const context = createResearchRunContext(baseRequest())
  assert.equal(typeof context.runId, 'string')
  assert.ok(context.runId.length > 0)
})

test('createResearchRunContext: context contains requestedAt', () => {
  const context = createResearchRunContext(baseRequest())
  assert.ok(context.requestedAt)
})

test('createResearchRunContext: requestedAt is a valid ISO timestamp', () => {
  const context = createResearchRunContext(baseRequest())
  assert.equal(new Date(context.requestedAt).toISOString(), context.requestedAt)
})

test('createResearchRunContext: two contexts receive different runIds', () => {
  const first = createResearchRunContext(baseRequest())
  const second = createResearchRunContext(baseRequest())
  assert.notEqual(first.runId, second.runId)
})

test('createResearchRunContext: symbols are uppercased', () => {
  const context = createResearchRunContext(baseRequest({ symbols: ['spy', 'qqq'] }))
  assert.deepEqual(context.symbols, ['SPY', 'QQQ'])
})

test('createResearchRunContext: duplicate symbols are removed', () => {
  const context = createResearchRunContext(baseRequest({ symbols: ['SPY', 'spy', 'QQQ'] }))
  assert.deepEqual(context.symbols, ['SPY', 'QQQ'])
})

test('createResearchRunContext: symbol order is preserved (never sorted, unlike createDatasetId)', () => {
  const context = createResearchRunContext(baseRequest({ symbols: ['IWM', 'SPY', 'QQQ'] }))
  assert.deepEqual(context.symbols, ['IWM', 'SPY', 'QQQ'])
})

test('createResearchRunContext: an empty symbols array is rejected', () => {
  assert.throws(() => createResearchRunContext(baseRequest({ symbols: [] })))
})

test('createResearchRunContext: non-string symbols are rejected', () => {
  assert.throws(() => createResearchRunContext(baseRequest({ symbols: ['SPY', 123] })))
  assert.throws(() => createResearchRunContext(baseRequest({ symbols: ['SPY', ''] })))
  assert.throws(() => createResearchRunContext(baseRequest({ symbols: [null] })))
})

test('createResearchRunContext: canonical "1Hour" timeframe is accepted', () => {
  const context = createResearchRunContext(baseRequest({ timeframe: '1Hour' }))
  assert.equal(context.timeframe, '1Hour')
})

test('createResearchRunContext: recognized "1h" alias normalizes to "1Hour"', () => {
  const context = createResearchRunContext(baseRequest({ timeframe: '1h' }))
  assert.equal(context.timeframe, '1Hour')
})

test('createResearchRunContext: an unknown timeframe is rejected', () => {
  assert.throws(() => createResearchRunContext(baseRequest({ timeframe: '5Min' })))
  assert.throws(() => createResearchRunContext(baseRequest({ timeframe: 'banana' })))
  assert.throws(() => createResearchRunContext(baseRequest({ timeframe: undefined })))
})

test('createResearchRunContext: requestedStart/requestedEnd are preserved exactly as supplied', () => {
  const context = createResearchRunContext(baseRequest({ requestedStart: '2022-01-01T00:00:00Z', requestedEnd: '2025-01-01T00:00:00Z' }))
  assert.equal(context.requestedStart, '2022-01-01T00:00:00Z')
  assert.equal(context.requestedEnd, '2025-01-01T00:00:00Z')
})

test('createResearchRunContext: requestedStart/requestedEnd default to null when omitted', () => {
  const context = createResearchRunContext(baseRequest())
  assert.equal(context.requestedStart, null)
  assert.equal(context.requestedEnd, null)
})

test('createResearchRunContext: requestedStart after requestedEnd is rejected', () => {
  assert.throws(() => createResearchRunContext(baseRequest({ requestedStart: '2025-01-01T00:00:00Z', requestedEnd: '2022-01-01T00:00:00Z' })))
})

test('createResearchRunContext: omitting requestedExperiments defaults to all registry experiment ids', () => {
  const context = createResearchRunContext(baseRequest())
  assert.deepEqual(context.requestedExperiments, listResearchExperiments().map((definition) => definition.id))
})

test('createResearchRunContext: explicit requestedExperiments preserves caller order', () => {
  const context = createResearchRunContext(baseRequest({ requestedExperiments: ['signal-quality', 'robustness'] }))
  assert.deepEqual(context.requestedExperiments, ['signal-quality', 'robustness'])
})

test('createResearchRunContext: duplicate experiment ids are removed', () => {
  const context = createResearchRunContext(baseRequest({ requestedExperiments: ['robustness', 'robustness', 'signal-quality'] }))
  assert.deepEqual(context.requestedExperiments, ['robustness', 'signal-quality'])
})

test('createResearchRunContext: an unknown experiment id throws rather than being silently filtered', () => {
  assert.throws(() => createResearchRunContext(baseRequest({ requestedExperiments: ['robustness', 'not-a-real-experiment'] })))
})

test('createResearchRunContext: an explicit empty requestedExperiments array is accepted as "run nothing"', () => {
  const context = createResearchRunContext(baseRequest({ requestedExperiments: [] }))
  assert.deepEqual(context.requestedExperiments, [])
})

test('createResearchRunContext: the returned context has no datasetId', () => {
  const context = createResearchRunContext(baseRequest())
  assert.equal('datasetId' in context, false)
})

test('createResearchRunContext: the returned context has no market-data/candle field', () => {
  const context = createResearchRunContext(baseRequest())
  assert.equal('candles' in context, false)
  assert.equal('fetchResults' in context, false)
})

test('createResearchRunContext: the returned context has no native-result field', () => {
  const context = createResearchRunContext(baseRequest())
  assert.equal('records' in context, false)
  assert.equal('synthesis' in context, false)
})

test('createResearchRunContext: the returned context has no experimentParameters field', () => {
  const context = createResearchRunContext(baseRequest())
  assert.equal('experimentParameters' in context, false)
})

test('createResearchRunContext: a caller-supplied runId is never honored', () => {
  const context = createResearchRunContext(baseRequest({ runId: 'caller-supplied-run-id' }))
  assert.notEqual(context.runId, 'caller-supplied-run-id')
})

test('createResearchRunContext: a caller-supplied requestedAt is never honored', () => {
  const context = createResearchRunContext(baseRequest({ requestedAt: '1999-01-01T00:00:00Z' }))
  assert.notEqual(context.requestedAt, '1999-01-01T00:00:00Z')
})

function makeRunContext(overrides = {}) {
  return {
    runId: 'run_test',
    requestedAt: '2026-09-25T00:00:00.000Z',
    symbols: ['SPY', 'QQQ', 'IWM'],
    timeframe: '1Hour',
    requestedStart: '2022-01-01T00:00:00Z',
    requestedEnd: '2026-09-25T00:00:00Z',
    requestedExperiments: ['robustness'],
    ...overrides,
  }
}

function makeRunFetchResult(symbol, overrides = {}) {
  const candles = overrides.candles ?? [{
    symbol,
    timeframe: '1Hour',
    timestamp: `${symbol}-actual-start`,
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 1000,
  }]
  return {
    provider: 'ALPACA HISTORICAL',
    symbol,
    timeframe: '1Hour',
    start: candles[0]?.timestamp ?? '2022-01-01T00:00:00Z',
    end: candles.at(-1)?.timestamp ?? '2026-09-25T00:00:00Z',
    requestedStart: '2022-01-01T00:00:00Z',
    requestedEnd: '2026-09-25T00:00:00Z',
    candleCount: candles.length,
    complete: true,
    candles,
    ...overrides,
  }
}

function runOptions(fetcher, dispatcher = () => ({
  experimentId: 'robustness',
  status: 'succeeded',
  nativeOutput: { complete: true },
  error: null,
})) {
  return { fetchHistoricalMarketData: fetcher, executeResearchExperiment: dispatcher }
}

test('executeResearchRun with no requested experiments performs no fetches', async () => {
  let fetchCalls = 0
  const result = await executeResearchRun(
    makeRunContext({ requestedExperiments: [] }),
    runOptions(async () => { fetchCalls += 1 }),
  )
  assert.equal(fetchCalls, 0)
  assert.equal(result.status, 'completed')
  assert.equal(result.fetchStatus, 'not-requested')
  assert.equal(result.dataset, null)
  assert.deepEqual(result.experimentResults, [])
})

test('executeResearchRun fetches one requested symbol exactly once with shared arguments', async () => {
  const calls = []
  const fetchResult = makeRunFetchResult('SPY')
  const result = await executeResearchRun(
    makeRunContext({ symbols: ['SPY'] }),
    runOptions(async (...args) => { calls.push(args); return fetchResult }),
  )
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0], ['SPY', '1Hour', { start: '2022-01-01T00:00:00Z', end: '2026-09-25T00:00:00Z' }])
  assert.equal(result.fetchStatus, 'complete')
  assert.equal(result.status, 'completed')
})

test('executeResearchRun fetches three requested symbols once each in caller order', async () => {
  const calls = []
  await executeResearchRun(
    makeRunContext({ symbols: ['IWM', 'SPY', 'QQQ'] }),
    runOptions(async (symbol) => { calls.push(symbol); return makeRunFetchResult(symbol) }),
  )
  assert.deepEqual(calls, ['IWM', 'SPY', 'QQQ'])
})

test('executeResearchRun preserves the same timeframe and requested date range for every fetch', async () => {
  const calls = []
  const context = makeRunContext({ symbols: ['QQQ', 'SPY'], requestedStart: '2024-02-01T00:00:00Z', requestedEnd: '2025-03-01T00:00:00Z' })
  await executeResearchRun(context, runOptions(async (...args) => {
    calls.push(args)
    return makeRunFetchResult(args[0], { requestedStart: args[2].start, requestedEnd: args[2].end })
  }))
  assert.deepEqual(calls.map(([, timeframe]) => timeframe), ['1Hour', '1Hour'])
  assert.deepEqual(calls.map(([, , range]) => range), [
    { start: context.requestedStart, end: context.requestedEnd },
    { start: context.requestedStart, end: context.requestedEnd },
  ])
})

test('executeResearchRun preserves fetch response references and creates the exact canonical dataset shape', async () => {
  const responses = ['SPY', 'QQQ'].map((symbol) => makeRunFetchResult(symbol))
  const result = await executeResearchRun(
    makeRunContext({ symbols: ['SPY', 'QQQ'] }),
    runOptions(async (symbol) => responses.find((response) => response.symbol === symbol)),
  )
  assert.deepEqual(Object.keys(result.dataset), [
    'datasetId', 'provider', 'timeframe', 'requestedStart', 'requestedEnd', 'fetchResultsBySymbol', 'rawSeriesBySymbol',
  ])
  assert.equal(result.dataset.fetchResultsBySymbol.SPY, responses[0])
  assert.equal(result.dataset.fetchResultsBySymbol.QQQ, responses[1])
  assert.equal(result.dataset.rawSeriesBySymbol.SPY, responses[0].candles)
  assert.equal(result.dataset.rawSeriesBySymbol.QQQ, responses[1].candles)
  assert.equal(result.dataset.provider, 'ALPACA HISTORICAL')
  assert.equal(result.dataset.timeframe, '1Hour')
  assert.equal(result.dataset.requestedStart, result.runContext.requestedStart)
  assert.equal(result.dataset.requestedEnd, result.runContext.requestedEnd)
  assert.equal('actualStart' in result.dataset, false)
  assert.equal('actualEnd' in result.dataset, false)
  assert.equal('candleCount' in result.dataset, false)
})

test('executeResearchRun preserves raw candles unchanged', async () => {
  const response = makeRunFetchResult('SPY')
  const snapshot = structuredClone(response.candles)
  await executeResearchRun(
    makeRunContext({ symbols: ['SPY'] }),
    runOptions(async () => response),
  )
  assert.deepEqual(response.candles, snapshot)
})

test('partial fetch success retains good data and continues fetching after a failure', async () => {
  const calls = []
  const spyResult = makeRunFetchResult('SPY')
  const result = await executeResearchRun(makeRunContext(), runOptions(async (symbol) => {
    calls.push(symbol)
    if (symbol === 'QQQ') throw Object.assign(new Error('provider unavailable'), { code: 'UPSTREAM_DOWN' })
    if (symbol === 'IWM') return makeRunFetchResult('IWM')
    return spyResult
  }))
  assert.deepEqual(calls, ['SPY', 'QQQ', 'IWM'])
  assert.equal(result.fetchStatus, 'partial')
  assert.equal(result.status, 'partial')
  assert.equal(result.dataset.rawSeriesBySymbol.SPY, spyResult.candles)
  assert.deepEqual(result.fetchIssues.find((issue) => issue.symbol === 'QQQ').error.code, 'UPSTREAM_DOWN')
  assert.equal(result.dataset.rawSeriesBySymbol.QQQ, undefined)
})

test('zero-candle results are reported but excluded from identity and raw series', async () => {
  const spyResult = makeRunFetchResult('SPY')
  const emptyResult = makeRunFetchResult('QQQ', { candles: [], candleCount: 0, complete: false })
  const result = await executeResearchRun(makeRunContext({ symbols: ['SPY', 'QQQ'] }), runOptions(async (symbol) => (
    symbol === 'SPY' ? spyResult : emptyResult
  )))
  assert.equal(result.fetchIssues[0].type, 'empty')
  assert.equal(result.fetchIssues[0].fetchResult, emptyResult)
  assert.equal(result.dataset.fetchResultsBySymbol.QQQ, emptyResult)
  assert.equal(result.dataset.rawSeriesBySymbol.QQQ, undefined)
  assert.equal(result.dataset.datasetId, createDatasetId([spyResult]))
  assert.equal(result.fetchStatus, 'partial')
})

test('incomplete non-empty responses remain in the dataset and contribute to identity', async () => {
  const spyResult = makeRunFetchResult('SPY')
  const incompleteQqq = makeRunFetchResult('QQQ', { complete: false })
  let receivedDataset
  const result = await executeResearchRun(makeRunContext({ symbols: ['SPY', 'QQQ'] }), runOptions(
    async (symbol) => symbol === 'SPY' ? spyResult : incompleteQqq,
    (experimentId, dataset) => {
      receivedDataset = dataset
      return { experimentId, status: 'succeeded', nativeOutput: {}, error: null }
    },
  ))
  assert.equal(result.dataset.fetchResultsBySymbol.QQQ, incompleteQqq)
  assert.equal(result.dataset.rawSeriesBySymbol.QQQ, incompleteQqq.candles)
  assert.equal(result.dataset.datasetId, createDatasetId([spyResult, incompleteQqq]))
  assert.equal(result.fetchIssues.find((issue) => issue.symbol === 'QQQ').type, 'incomplete')
  assert.equal(result.fetchStatus, 'partial')
  assert.equal(result.status, 'partial')
  assert.equal(receivedDataset, result.dataset)
})

test('all-failed and all-empty runs have no dataset and execute no experiments', async (t) => {
  for (const mode of ['failed', 'empty']) {
    await t.test(mode, async () => {
      let dispatchCalls = 0
      const result = await executeResearchRun(makeRunContext({ symbols: ['SPY', 'QQQ'] }), runOptions(
        async (symbol) => {
          if (mode === 'failed') throw new Error(`${symbol} failed`)
          return makeRunFetchResult(symbol, { candles: [], candleCount: 0, complete: false })
        },
        () => { dispatchCalls += 1 },
      ))
      assert.equal(result.dataset, null)
      assert.equal(result.fetchStatus, 'unavailable')
      assert.equal(result.status, 'unavailable')
      assert.equal(result.experimentResults[0].status, 'unavailable')
      assert.equal(dispatchCalls, 0)
      assert.equal(result.fetchIssues.length, 2)
    })
  }
})

test('partial data dispatches requested experiments sequentially in request order', async () => {
  const callOrder = []
  const exactResults = ['yearly-regime', 'robustness'].map((experimentId) => ({
    experimentId, status: 'succeeded', nativeOutput: { experimentId }, error: null,
  }))
  const result = await executeResearchRun(makeRunContext({
    symbols: ['SPY'],
    requestedExperiments: ['yearly-regime', 'robustness'],
  }), runOptions(async () => makeRunFetchResult('SPY'), (experimentId, dataset, runContext) => {
    callOrder.push([experimentId, dataset, runContext])
    return exactResults[callOrder.length - 1]
  }))
  assert.deepEqual(callOrder.map(([experimentId]) => experimentId), ['yearly-regime', 'robustness'])
  assert.equal(callOrder[0][1], result.dataset)
  assert.equal(callOrder[1][1], result.dataset)
  assert.equal(callOrder[0][2], result.runContext)
  assert.equal(result.experimentResults[0], exactResults[0])
  assert.equal(result.experimentResults[1], exactResults[1])
})

test('a failed experiment result does not prevent later requested experiments', async () => {
  const calls = []
  const failedResult = { experimentId: 'robustness', status: 'failed', nativeOutput: null, error: { message: 'native failed' } }
  const succeededResult = { experimentId: 'signal-quality', status: 'succeeded', nativeOutput: {}, error: null }
  const result = await executeResearchRun(makeRunContext({
    symbols: ['SPY'],
    requestedExperiments: ['robustness', 'signal-quality'],
  }), runOptions(async () => makeRunFetchResult('SPY'), (experimentId) => {
    calls.push(experimentId)
    return experimentId === 'robustness' ? failedResult : succeededResult
  }))
  assert.deepEqual(calls, ['robustness', 'signal-quality'])
  assert.equal(result.experimentResults[0], failedResult)
  assert.equal(result.experimentResults[1], succeededResult)
  assert.equal(result.status, 'partial')
})

test('an unexpected dispatcher throw is isolated and later experiments still run', async () => {
  const calls = []
  const result = await executeResearchRun(makeRunContext({
    symbols: ['SPY'],
    requestedExperiments: ['robustness', 'signal-quality'],
  }), runOptions(async () => makeRunFetchResult('SPY'), (experimentId) => {
    calls.push(experimentId)
    if (experimentId === 'robustness') throw new Error('dispatcher fault')
    return { experimentId, status: 'succeeded', nativeOutput: {}, error: null }
  }))
  assert.deepEqual(calls, ['robustness', 'signal-quality'])
  assert.equal(result.experimentResults[0].status, 'failed')
  assert.equal(result.experimentResults[0].error.message, 'dispatcher fault')
  assert.equal(result.experimentResults[1].status, 'succeeded')
})

test('provider inconsistency is a run-level failure and prevents experiment dispatch', async () => {
  let dispatchCalls = 0
  const result = await executeResearchRun(makeRunContext({ symbols: ['SPY', 'QQQ'] }), runOptions(
    async (symbol) => makeRunFetchResult(symbol, { provider: symbol === 'SPY' ? 'ALPACA HISTORICAL' : 'OTHER' }),
    () => { dispatchCalls += 1 },
  ))
  assert.equal(result.status, 'failed')
  assert.equal(result.dataset, null)
  assert.equal(result.fetchIssues[0].type, 'provider-inconsistent')
  assert.equal(dispatchCalls, 0)
})

test('run and fetch statuses classify complete, partial, and unavailable outcomes', async () => {
  const complete = await executeResearchRun(makeRunContext({ symbols: ['SPY'] }), runOptions(async () => makeRunFetchResult('SPY')))
  const partial = await executeResearchRun(makeRunContext({ symbols: ['SPY', 'QQQ'] }), runOptions(async (symbol) => (
    symbol === 'SPY' ? makeRunFetchResult('SPY') : makeRunFetchResult('QQQ', { complete: false })
  )))
  const unavailable = await executeResearchRun(makeRunContext({ symbols: ['SPY'] }), runOptions(async () => {
    throw new Error('offline')
  }))
  assert.deepEqual([complete.status, complete.fetchStatus], ['completed', 'complete'])
  assert.deepEqual([partial.status, partial.fetchStatus], ['partial', 'partial'])
  assert.deepEqual([unavailable.status, unavailable.fetchStatus], ['unavailable', 'unavailable'])
})

test('fetch errors remain associated with the requested symbol and preserve error details', async () => {
  const error = Object.assign(new Error('network down'), { code: 'ECONNRESET' })
  const result = await executeResearchRun(makeRunContext({ symbols: ['SPY'] }), runOptions(() => { throw error }))
  assert.equal(result.fetchIssues[0].symbol, 'SPY')
  assert.equal(result.fetchIssues[0].error.message, 'network down')
  assert.equal(result.fetchIssues[0].error.code, 'ECONNRESET')
})

test('orchestration returns native dispatcher results without records or synthesis', async () => {
  const nativeOutput = { untouched: true }
  const dispatcherResult = { experimentId: 'robustness', status: 'succeeded', nativeOutput, error: null }
  const result = await executeResearchRun(makeRunContext({ symbols: ['SPY'] }), runOptions(
    async () => makeRunFetchResult('SPY'),
    () => dispatcherResult,
  ))
  assert.equal(result.experimentResults[0], dispatcherResult)
  assert.equal(result.experimentResults[0].nativeOutput, nativeOutput)
  assert.equal('records' in result, false)
  assert.equal('synthesis' in result, false)
})

test('strategy-comparison and strategy-discovery dispatch receive only canonical dataset objects', async () => {
  const requestedExperiments = ['strategy-comparison', 'strategy-discovery']
  const datasets = []
  await executeResearchRun(makeRunContext({ symbols: ['SPY'], requestedExperiments }), runOptions(
    async () => makeRunFetchResult('SPY'),
    (experimentId, dataset) => {
      datasets.push([experimentId, dataset])
      return { experimentId, status: 'succeeded', nativeOutput: {}, error: null }
    },
  ))
  assert.deepEqual(datasets.map(([experimentId]) => experimentId), requestedExperiments)
  for (const [, dataset] of datasets) {
    assert.deepEqual(Object.keys(dataset), [
      'datasetId', 'provider', 'timeframe', 'requestedStart', 'requestedEnd', 'fetchResultsBySymbol', 'rawSeriesBySymbol',
    ])
    assert.equal(Array.isArray(dataset.rawSeriesBySymbol.SPY), true)
  }
})
