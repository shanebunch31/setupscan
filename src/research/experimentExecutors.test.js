import assert from 'node:assert/strict'
import { test } from 'node:test'
import { listResearchExperiments } from './registry.js'
import {
  createResearchExperimentDispatcher,
  executeResearchExperiment,
  researchExperimentExecutors,
} from './experimentExecutors.js'

const requiredSymbols = ['SPY', 'QQQ', 'IWM']

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

function makeDataset(symbols = requiredSymbols, count = 220) {
  return symbols.map((symbol) => ({
    symbol,
    status: 'AVAILABLE',
    data: { candles: makeCandles(symbol, count), complete: true },
  }))
}

function makeStubExecutor(required = [], execute = () => ({ value: true })) {
  return { requiredSymbols: required, execute }
}

test('frozen lookup covers all ten registered experiments', () => {
  const expected = listResearchExperiments().map(({ id }) => id).sort()
  assert.deepEqual(Object.keys(researchExperimentExecutors).sort(), expected)
  assert.ok(Object.isFrozen(researchExperimentExecutors))
  Object.values(researchExperimentExecutors).forEach((executor) => {
    assert.ok(Object.isFrozen(executor))
    assert.equal(typeof executor.execute, 'function')
  })
})

test('unknown experiment IDs return a predictable failed result', () => {
  assert.deepEqual(executeResearchExperiment('not-registered', {}, {}), {
    experimentId: 'not-registered',
    status: 'failed',
    nativeOutput: null,
    error: {
      name: 'UnknownResearchExperimentError',
      message: 'No native executor registered for research experiment: not-registered',
    },
  })
})

test('missing required symbols are unavailable and never invoke the native executor', () => {
  let calls = 0
  const dispatch = createResearchExperimentDispatcher({
    sample: makeStubExecutor(requiredSymbols, () => { calls += 1 }),
  })
  const result = dispatch('sample', makeDataset(['SPY', 'QQQ']), {})
  assert.deepEqual(result, { experimentId: 'sample', status: 'unavailable', nativeOutput: null, error: null })
  assert.equal(calls, 0)
})

test('explicitly incomplete fetch data follows the existing unavailable-data gate', () => {
  let calls = 0
  const dispatch = createResearchExperimentDispatcher({
    sample: makeStubExecutor(['SPY'], () => { calls += 1 }),
  })
  const result = dispatch('sample', [{
    symbol: 'SPY',
    status: 'AVAILABLE',
    data: { candles: makeCandles('SPY', 3), complete: false },
  }], {})
  assert.equal(result.status, 'unavailable')
  assert.equal(calls, 0)
})

test('every registered multi-symbol executor requires SPY, QQQ, and IWM', () => {
  const expected = [
    'relative-value', 'signal-quality', 'frozen-score-holdout', 'yearly-regime',
    'causal-regime', 'walk-forward-regime', 'volatility-aware-variants', 'strategy-discovery',
  ]
  expected.forEach((experimentId) => {
    assert.deepEqual(researchExperimentExecutors[experimentId].requiredSymbols, requiredSymbols)
    const result = executeResearchExperiment(experimentId, makeDataset(['SPY', 'QQQ']), {})
    assert.equal(result.status, 'unavailable', experimentId)
  })
})

test('native dispatcher passes raw candle arrays by reference without mutating them', () => {
  const rawSeries = Object.fromEntries(requiredSymbols.map((symbol) => [symbol, makeCandles(symbol, 3)]))
  const originalSnapshots = structuredClone(rawSeries)
  let received
  const dispatch = createResearchExperimentDispatcher({
    sample: makeStubExecutor(requiredSymbols, ({ availableBySymbol }) => {
      received = Object.fromEntries(requiredSymbols.map((symbol) => [symbol, availableBySymbol.get(symbol).candles]))
      return { native: true }
    }),
  })

  const result = dispatch('sample', rawSeries, {})
  assert.equal(result.status, 'succeeded')
  requiredSymbols.forEach((symbol) => assert.equal(received[symbol], rawSeries[symbol]))
  assert.deepEqual(rawSeries, originalSnapshots)
})

test('successful native output is returned unchanged, including zero-result output', () => {
  const nativeOutput = { trades: [], occurrences: [], summary: { tradeCount: 0, occurrenceCount: 0 } }
  const dispatch = createResearchExperimentDispatcher({
    sample: makeStubExecutor(requiredSymbols, () => nativeOutput),
  })
  const result = dispatch('sample', makeDataset(), {})
  assert.equal(result.status, 'succeeded')
  assert.equal(result.nativeOutput, nativeOutput)
  assert.equal(result.error, null)
})

test('native throws become structured failures and do not affect a later dispatch', () => {
  const dispatch = createResearchExperimentDispatcher({
    broken: makeStubExecutor([], () => { const error = new Error('native failure'); error.code = 'E_NATIVE'; throw error }),
    healthy: makeStubExecutor([], () => ({ completed: true })),
  })
  const failed = dispatch('broken', {}, {})
  const succeeded = dispatch('healthy', {}, {})
  assert.equal(failed.status, 'failed')
  assert.equal(failed.nativeOutput, null)
  assert.equal(failed.error.name, 'Error')
  assert.equal(failed.error.message, 'native failure')
  assert.equal(failed.error.code, 'E_NATIVE')
  assert.equal(succeeded.status, 'succeeded')
})

test('native incomplete and unavailable markers are preserved and classified', () => {
  const incompleteOutput = { incomplete: true, partial: [1] }
  const unavailableOutput = { available: false, missingSymbols: ['IWM'] }
  const dispatch = createResearchExperimentDispatcher({
    incomplete: makeStubExecutor([], () => incompleteOutput),
    unavailable: makeStubExecutor([], () => unavailableOutput),
  })
  const incomplete = dispatch('incomplete', {}, {})
  const unavailable = dispatch('unavailable', {}, {})
  assert.equal(incomplete.status, 'incomplete')
  assert.equal(incomplete.nativeOutput, incompleteOutput)
  assert.equal(unavailable.status, 'unavailable')
  assert.equal(unavailable.nativeOutput, unavailableOutput)
})

test('robustness uses its dedicated composite executor and preserves both native result arrays', () => {
  const result = executeResearchExperiment('robustness', makeDataset(['SPY']), {})
  assert.equal(result.status, 'succeeded')
  assert.ok(Array.isArray(result.nativeOutput.thresholdResults))
  assert.ok(Array.isArray(result.nativeOutput.periodResults))
  assert.equal(result.nativeOutput.thresholdResults.length, 5)
})

test('all raw-map multi-symbol experiments execute without a fetch dependency', () => {
  const dataset = Object.fromEntries(requiredSymbols.map((symbol) => [symbol, makeCandles(symbol)]))
  const originalDataset = structuredClone(dataset)
  const labDataset = makeDataset()
  const originalFetch = globalThis.fetch
  globalThis.fetch = () => { throw new Error('executor attempted a market-data fetch') }
  try {
    for (const experimentId of [
      'relative-value', 'signal-quality', 'frozen-score-holdout', 'yearly-regime',
      'causal-regime', 'walk-forward-regime', 'volatility-aware-variants',
    ]) {
      const result = executeResearchExperiment(experimentId, dataset, {})
      assert.equal(result.status, 'succeeded', `${experimentId}: ${result.error?.message ?? ''}`)
      assert.ok(result.nativeOutput)
    }
    assert.equal(executeResearchExperiment('robustness', labDataset, {}).status, 'succeeded')
    assert.equal(executeResearchExperiment('strategy-discovery', labDataset, {}).status, 'succeeded')
    assert.equal(executeResearchExperiment('strategy-comparison', labDataset, { symbols: requiredSymbols }).status, 'succeeded')
    assert.deepEqual(dataset, originalDataset)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('volatility-aware variants execute from the shared dataset without walk-forward output', () => {
  const result = executeResearchExperiment('volatility-aware-variants', makeDataset(), {})
  assert.equal(result.status, 'succeeded')
  assert.ok(Array.isArray(result.nativeOutput.windows))
})

test('strategy-discovery keeps its native dataset input and generated metadata output', () => {
  const datasets = makeDataset()
  const result = executeResearchExperiment('strategy-discovery', datasets, {})
  assert.equal(result.status, 'succeeded')
  assert.equal(result.nativeOutput.available, true)
  assert.equal(typeof result.nativeOutput.generatedAt, 'string')
  assert.equal(typeof result.nativeOutput.gitCommit, 'string')
  assert.deepEqual(result.nativeOutput.universe, requiredSymbols)
})

test('strategy-comparison preserves per-symbol native branches without assigning strategy identity', () => {
  const result = executeResearchExperiment('strategy-comparison', makeDataset(), { symbols: ['SPY', 'QQQ', 'MISSING'] })
  assert.equal(result.status, 'succeeded')
  assert.deepEqual(Object.keys(result.nativeOutput.bySymbol), ['SPY', 'QQQ'])
  for (const branches of Object.values(result.nativeOutput.bySymbol)) {
    assert.ok(branches.control)
    assert.ok(branches.trendMomentum)
    assert.equal('strategyId' in branches.control, false)
    assert.equal('strategyId' in branches.trendMomentum, false)
  }
})

test('strategy-comparison is unavailable when none of the requested symbols have data', () => {
  const result = executeResearchExperiment('strategy-comparison', makeDataset(['SPY']), { symbols: ['QQQ'] })
  assert.deepEqual(result, { experimentId: 'strategy-comparison', status: 'unavailable', nativeOutput: null, error: null })
})

test('canonical datasets feed strategy-comparison and strategy-discovery without losing completeness metadata', () => {
  const labDatasets = makeDataset()
  const canonical = {
    datasetId: 'dataset_fixture',
    provider: 'ALPACA HISTORICAL',
    timeframe: '1Hour',
    requestedStart: '2022-01-01T00:00:00Z',
    requestedEnd: '2026-09-25T00:00:00Z',
    fetchResultsBySymbol: Object.fromEntries(labDatasets.map(({ symbol, data }) => [symbol, {
      provider: 'ALPACA HISTORICAL',
      symbol,
      timeframe: '1Hour',
      start: data.candles[0].timestamp,
      end: data.candles.at(-1).timestamp,
      requestedStart: '2022-01-01T00:00:00Z',
      requestedEnd: '2026-09-25T00:00:00Z',
      candleCount: data.candles.length,
      complete: symbol !== 'IWM',
      candles: data.candles,
    }])),
    rawSeriesBySymbol: Object.fromEntries(labDatasets.map(({ symbol, data }) => [symbol, data.candles])),
  }
  const comparison = executeResearchExperiment('strategy-comparison', canonical, { symbols: ['SPY', 'QQQ', 'IWM'] })
  const discovery = executeResearchExperiment('strategy-discovery', canonical, {})
  assert.equal(comparison.status, 'succeeded')
  assert.deepEqual(Object.keys(comparison.nativeOutput.bySymbol), ['SPY', 'QQQ'])
  assert.equal(discovery.status, 'unavailable')
  assert.equal(discovery.nativeOutput, null)
})

test('strategy-discovery native metadata passes through an injected executor unchanged', () => {
  const nativeOutput = { generatedAt: 'native-time', gitCommit: 'native-commit', available: true }
  const dispatch = createResearchExperimentDispatcher({
    discovery: makeStubExecutor([], () => nativeOutput),
  })
  const result = dispatch('discovery', {}, {})
  assert.equal(result.nativeOutput, nativeOutput)
  assert.deepEqual(result.nativeOutput, {
    generatedAt: 'native-time',
    gitCommit: 'native-commit',
    available: true,
  })
})