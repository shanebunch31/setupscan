import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runStrategyDiscoveryBatchA } from './discoveryRunner.js'

function makeCandle(symbol, index, overrides = {}) {
  const timestamp = `2023-01-01T${String(index % 24).padStart(2, '0')}:00:00Z`
  return { symbol, timeframe: '1h', timestamp, open: 100, high: 101, low: 99, close: 100, volume: 1000, ...overrides }
}

function buildDataset(symbol, count = 40) {
  return { symbol, status: 'AVAILABLE', data: { candles: Array.from({ length: count }, (_, index) => makeCandle(symbol, index)) } }
}

test('reports unavailable, without inventing results, when the SPY/QQQ/IWM universe is not fully available', () => {
  const noData = runStrategyDiscoveryBatchA([])
  assert.equal(noData.available, false)
  assert.deepEqual(noData.missingSymbols.sort(), ['IWM', 'QQQ', 'SPY'])

  const partial = runStrategyDiscoveryBatchA([buildDataset('SPY')])
  assert.equal(partial.available, false)
  assert.deepEqual(partial.missingSymbols.sort(), ['IWM', 'QQQ'])
})

test('runs all four Batch A experiments once the full universe is available, with reproducibility metadata', () => {
  const datasets = [buildDataset('SPY'), buildDataset('QQQ'), buildDataset('IWM')]
  const result = runStrategyDiscoveryBatchA(datasets)
  assert.equal(result.available, true)
  assert.equal(result.experiments.length, 4)
  result.experiments.forEach((experiment) => {
    assert.ok(experiment.experimentId)
    assert.ok(experiment.summary.overall)
    assert.equal(typeof experiment.summary.overall.occurrenceCount, 'number')
    assert.ok(Array.isArray(experiment.summary.costTiers))
  })
  assert.equal(result.datasetInfo.length, 3)
  assert.equal(result.timeframe, '1Hour')
  assert.deepEqual(result.universe, ['SPY', 'QQQ', 'IWM'])
  assert.ok(result.gitCommit)
})

test('produces deterministic results across repeated runs on the same input', () => {
  const datasets = [buildDataset('SPY'), buildDataset('QQQ'), buildDataset('IWM')]
  const first = runStrategyDiscoveryBatchA(datasets)
  const second = runStrategyDiscoveryBatchA(datasets)
  const strip = (result) => ({ ...result, generatedAt: null })
  assert.deepEqual(strip(first), strip(second))
})
