import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createStrategyDiscoveryLiveSummary } from './strategyDiscoveryLiveSummary.js'
import { createDatasetId } from './orchestration.js'
import { EMA_CONTRACT_VERSION } from '../data/marketData.js'
import { runStrategyDiscoveryBatchA } from '../backtest/strategyDiscovery/discoveryRunner.js'
import { strategyDiscoveryCostTiers } from '../backtest/strategyDiscovery/discoveryMetrics.js'

function datasets() {
  return ['SPY', 'QQQ', 'IWM'].map((symbol, i) => {
    const candles = ['2022-01-03T15:00:00Z', '2026-09-30T15:00:00Z'].map((timestamp, j) => ({
      symbol, timeframe: '1Hour', timestamp, open: 100, high: 101, low: 99, close: 100 + j / 10, volume: 1000,
    }))
    // Distinct per-symbol bounds: the pooled research uses their union.
    if (i === 1) candles[0].timestamp = '2022-01-04T15:00:00Z'
    if (i === 2) candles[1].timestamp = '2026-09-29T15:00:00Z'
    const data = {
      symbol, timeframe: '1Hour', provider: 'ALPACA HISTORICAL', adjustmentMode: 'split',
      requestedStart: '2022-01-01T00:00:00Z', requestedEnd: '2026-10-01T00:00:00Z',
      start: candles[0].timestamp, end: candles.at(-1).timestamp, candleCount: candles.length,
      complete: true, candles,
    }
    // fetchHistoricalMarketData keeps pre-roll non-enumerable. Fingerprint the
    // exact result object, not a spread that accidentally loses this property.
    Object.defineProperty(data, 'calculationCandles', { value: [
      { ...candles[0], timestamp: '2021-12-30T15:00:00Z' }, ...candles,
    ] })
    return { symbol, status: 'AVAILABLE', data }
  })
}
const metric = (expectancy, occurrenceCount) => ({ expectancy, occurrenceCount, profitFactor: 1 })
const row = (label, expectancy, count) => ({ label, ...metric(expectancy, count) })
function batchFor(source) {
  const batch = runStrategyDiscoveryBatchA(source)
  // Saved summary fixture: the live bridge must carry these observations without
  // running the experiment again or changing its calculations.
  const momentum = batch.experiments.find(item => item.experimentId === 'momentum-breakout-v1')
  Object.assign(momentum.summary, {
    overall: metric(.06, 500),
    byYear: [row('2022', -.13, 100), row('2023', .15, 100), row('2024', .18, 100), row('2025', -.07, 100), row('2026', .20, 100)],
    bySymbol: [row('IWM', -.09, 170), row('QQQ', .11, 165), row('SPY', .16, 165)],
    byPeriod: [row('Development', .07, 300), row('Out-of-Sample', -.07, 100), row('Holdout (2026 YTD)', .20, 100)],
    costTiers: strategyDiscoveryCostTiers.map((tier, i) => ({ ...tier, metrics: metric([.06, .01, -.09, -.34][i], 500) })),
  })
  const mean = batch.experiments.find(item => item.experimentId === 'mean-reversion-v1')
  mean.summary = structuredClone(momentum.summary)
  mean.summary.overall.occurrenceCount = 7
  mean.summary.byYear.forEach((item, i) => { item.occurrenceCount = i < 2 ? 2 : 1 })
  for (const field of ['bySymbol', 'byPeriod']) mean.summary[field].forEach((item, i) => { item.occurrenceCount = i === 0 ? 3 : 2 })
  mean.summary.costTiers.forEach(tier => { tier.metrics.occurrenceCount = 7 })
  return batch
}

test('live bridge supplies canonical identity and matching provenance from the exact existing fetch results', t => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('no refetch is permitted'))
  const source = datasets(), batch = batchFor(source), before = structuredClone(batch)
  const { context, record, synthesis, interpretation } = createStrategyDiscoveryLiveSummary(batch, source)
  assert.match(context.runId, /^run_/)
  assert.equal(context.datasetId, createDatasetId(source.map(item => item.data), 'split', context))
  assert.notEqual(context.datasetId, createDatasetId(source.map(item => ({ ...item.data })), 'split', context), 'pre-roll is part of the fingerprint')
  assert.deepEqual(context.symbols, ['SPY', 'QQQ', 'IWM'])
  assert.deepEqual(context.requestedExperiments, ['strategy-discovery'])
  for (const key of ['timeframe', 'provider', 'requestedStart', 'requestedEnd', 'adjustmentMode']) assert.equal(context[key], source[0].data[key])
  assert.equal(context.actualStart, '2022-01-03T15:00:00Z')
  assert.equal(context.actualEnd, '2026-09-30T15:00:00Z')
  assert.equal(context.emaContractVersion, EMA_CONTRACT_VERSION)
  assert.equal(context.codeRevision, import.meta.env?.VITE_GIT_COMMIT?.trim() || null, 'no invented code revision')
  for (const key of ['runId', 'datasetId', 'codeRevision', 'emaContractVersion', 'adjustmentMode']) {
    assert.equal(record.provenance[key], context[key])
    assert.equal(synthesis.provenance[key], context[key])
  }
  for (const key of ['actualStart', 'actualEnd', 'requestedStart', 'requestedEnd', 'provider', 'timeframe', 'emaContractVersion']) assert.equal(record.input[key], context[key])
  const momentum = interpretation.stabilityObservations.filter(item => item.reference.strategyId === 'momentum-breakout-v1')
  assert.deepEqual(momentum.map(item => item.status), ['mixed', 'mixed', 'mixed'])
  const cost = interpretation.costSensitivityObservations.find(item => item.reference.strategyId === 'momentum-breakout-v1')
  assert.equal(cost.status, 'cost-sensitive')
  assert.equal(cost.positiveToNegative, true)
  const mean = interpretation.stabilityObservations.filter(item => item.reference.strategyId === 'mean-reversion-v1')
  assert.ok(mean.every(item => item.status === 'insufficient-evidence'))
  assert.equal(interpretation.costSensitivityObservations.find(item => item.reference.strategyId === 'mean-reversion-v1').status, 'insufficient-evidence')
  assert.deepEqual(record.costModel.costTiers, batch.costTiers)
  assert.deepEqual(batch, before)
  assert.strictEqual(record.nativePayload, batch)
})

test('same in-memory batch retains its identity; a new execution has a new run ID but the same dataset ID', () => {
  const source = datasets(), batch = batchFor(source)
  const first = createStrategyDiscoveryLiveSummary(batch, source)
  const repeated = createStrategyDiscoveryLiveSummary(batch, source)
  assert.strictEqual(first, repeated)
  const next = createStrategyDiscoveryLiveSummary(batchFor(source), source)
  assert.notEqual(next.context.runId, first.context.runId)
  assert.equal(next.context.datasetId, first.context.datasetId)
})

test('missing, incomplete and incompatible metadata stays unavailable without defaults or fabricated scope', () => {
  for (const mutate of [
    input => { delete input[0].data.provider },
    input => { input[0].data.provider = 'OTHER' },
    input => { delete input[0].data.timeframe },
    input => { input[0].data.timeframe = '5Min' },
    input => { delete input[0].data.requestedStart },
    input => { input[0].data.requestedEnd = null },
    input => { input[0].data.requestedStart = '2023-01-01' },
    input => { input[0].data.requestedEnd = '2026-09-01' },
    input => { input[0].data.requestedStart = 'bad-date' },
    input => { delete input[0].data.adjustmentMode },
    input => { input[0].data.adjustmentMode = 'raw' },
    input => { input[0].data.start = null },
    input => { input[0].data.end = '2020-01-01' },
    input => { input[0].data.complete = false },
    input => { input[0].data.symbol = 'WRONG' },
    input => { input[0].data.candleCount = 999 },
    input => { input[0].status = 'UNAVAILABLE' },
    input => { input.push(input[0]) },
    input => { input.pop() },
  ]) {
    const source = datasets(), batch = batchFor(source)
    mutate(source)
    const result = createStrategyDiscoveryLiveSummary(batch, source)
    assert.equal(result.context, null)
    assert.equal(result.record.provenance.runId, undefined)
    assert.equal(result.synthesis.provenance.datasetId, null)
    assert.ok(result.interpretation.stabilityObservations.every(item => item.status === 'unavailable'))
    assert.ok(result.interpretation.costSensitivityObservations.every(item => item.status === 'unavailable'))
  }
})

test('unavailable batch is not assigned a successful live research identity', () => {
  assert.equal(createStrategyDiscoveryLiveSummary(runStrategyDiscoveryBatchA([]), []), null)
})

test('live page reuses memoized Batch A and the provenance bridge without changing the data-loading path', () => {
  const source = readFileSync(new URL('../backtest/StrategyDiscoveryLab.jsx', import.meta.url), 'utf8')
  assert.match(source, /const batch = useMemo\(\(\) => runStrategyDiscoveryBatchA\(datasets\), \[datasets\]\)/)
  assert.match(source, /const discoveryInterpretation = useMemo\([\s\S]*?createStrategyDiscoveryLiveSummary\(batch, datasets\)\?\.interpretation \?\? null,[\s\S]*?\[batch, datasets\]/)
  assert.doesNotMatch(source, /executeResearchRun\(|fetchHistoricalMarketData\(/)
})
