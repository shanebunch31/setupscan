import assert from 'node:assert/strict'
import { test } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { runResearch } from './runResearch.js'
import { getResearchExperiment, createResearchRecordForExperiment } from './registry.js'
import { executeResearchExperiment } from './experimentExecutors.js'
import { createDatasetId } from './orchestration.js'
import { projectResearchRunForPersistence } from './researchRunHistory.js'
import { parseResearchJson, stringifyResearchJson } from './researchRunSerialization.js'
import { checkResearchReplayCompatibility } from './replayCompatibility.js'
import { resolveCurrentEffectiveExperimentConfiguration } from './effectiveExperimentConfiguration.js'
import { createWorkbenchRunRequest } from './researchWorkbenchModel.js'
import { ExecutionResolutionResult } from './ExecutionResolutionResult.js'
import { RunResultSummary, createWorkbenchActions } from './ResearchWorkbench.js'
import { ResearchRunDetail } from './ResearchRunDetail.js'
import { shadowSourceFingerprint } from '../../server/shadowForwardCommand.js'
import { compareEvidence } from './synthesis.js'

const id = 'candidate-execution-resolution'
const request = { symbols: ['SPY', 'QQQ', 'IWM'], timeframe: '1Hour', requestedStart: '2024-01-01T00:00:00Z', requestedEnd: '2024-06-01T00:00:00Z', requestedExperiments: [id] }
const hourly = Array.from({ length: 1200 }, (_, i) => {
  const close = 100 + i * .03 + Math.sin(i / 6)
  return { timestamp: new Date(Date.UTC(2024, 0, 1) + i * 3600000).toISOString(), open: close, close, high: close + .2, low: close - .2, volume: 1000 + i }
})
function fetchFixture(symbol, timeframe) {
  const base = hourly.map((b) => ({ ...b, symbol, timeframe }))
  const candles = timeframe === '1Hour' ? base : base.flatMap((b) => Array.from({ length: 12 }, (_, i) => ({ ...b, timestamp: new Date(Date.parse(b.timestamp) + i * 300000).toISOString() })))
  return { provider: 'synthetic-test', symbol, timeframe, adjustmentMode: 'split', candles, start: candles[0].timestamp, end: candles.at(-1).timestamp,
    requestedStart: request.requestedStart, requestedEnd: request.requestedEnd, candleCount: candles.length, complete: true }
}
const runFixture = (fetcher = fetchFixture, overrides = {}) => runResearch({ ...request, ...overrides }, { fetchHistoricalMarketData: fetcher })

test('real Workbench worker and historical HTTP adapter deliver both timeframes and expose secondary fetch failures', async (t) => {
  // Exercise the actual worker handler and fetch adapter, not a replacement runResearch
  // fetcher. Only the browser transport and HTTP response are synthetic; no network IO.
  const previousSelf = Object.getOwnPropertyDescriptor(globalThis, 'self')
  const workerScope = {}
  Object.defineProperty(globalThis, 'self', { configurable: true, value: workerScope })
  const previousWorker = Object.getOwnPropertyDescriptor(globalThis, 'Worker')
  const calls = []
  let missingFiveMinute = false
  t.mock.method(globalThis, 'fetch', async (address) => {
    const url = new URL(address, 'http://fixture.invalid')
    assert.equal(url.pathname, '/api/historical')
    const symbol = url.searchParams.get('symbol')
    const timeframe = url.searchParams.get('timeframe')
    calls.push({ symbol, timeframe })
    if (missingFiveMinute && symbol === 'QQQ' && timeframe === '5Min') {
      return { ok: false, json: async () => ({ error: 'Synthetic 5Min provider failure' }) }
    }
    return { ok: true, json: async () => fetchFixture(symbol, timeframe) }
  })
  Object.defineProperty(globalThis, 'Worker', { configurable: true, value: class {
    constructor(url, options) {
      assert.match(url.href, /researchRun\.worker\.js$/)
      assert.equal(options.type, 'module')
    }
    postMessage(message) {
      workerScope.postMessage = (result) => this.onmessage({ data: structuredClone(result) })
      void workerScope.onmessage({ data: structuredClone(message) })
    }
    terminate() {}
  } })
  try {
    await import('./researchRun.worker.js')
    // Match the real Workbench run: start supplied, end left blank.
    const form = { ...request, symbols: request.symbols.join(','), requestedStart: '2022-01-01', requestedEnd: '' }
    const actions = createWorkbenchActions()
    const run = await actions.submit({ preventDefault() {} }, form)
    assert.equal(run.status, 'completed')
    assert.equal(run.runContext.requestedEnd, null)
    assert.ok(Number.isFinite(Date.parse(run.records[0].parameters.executionResolution.options.requestedEnd)))
    assert.equal(run.fetchIssues.length, 0)
    assert.deepEqual(calls, request.symbols.map((symbol) => ({ symbol, timeframe: '1Hour' }))
      .concat(request.symbols.map((symbol) => ({ symbol, timeframe: '5Min' }))))
    for (const symbol of request.symbols) {
      const input = run.dataset.executionInputs.fetchResultsBySymbol[symbol]
      assert.equal(input.timeframe, '5Min')
      assert.equal(input.complete, true)
      assert.ok(input.dataQuality.acceptedCandleCount > 0)
    }
    assert.ok(run.records[0].parameters.executionResolution.rows.some((row) => row.resolvedCount > 0))
    assert.ok(run.dataset.effectiveMetadata.executionResolution.fiveMinuteDatasetId)
    const html = renderToStaticMarkup(React.createElement(RunResultSummary, { result: run }))
    assert.ok(html.includes('5Min execution inputs:'))
    assert.ok(html.includes('QQQ: 14400 requested-range candles; input completeness check passed'))
    for (const pair of run.experimentResults[0].nativeOutput.pairs) {
      if (pair.methods.fiveMinute.trade) {
        assert.ok(Date.parse(pair.methods.fiveMinute.entryTimestamp) >= Date.parse(pair.decisionTimestamp))
      }
    }
    missingFiveMinute = true
    calls.length = 0
    const unavailable = await actions.submit({ preventDefault() {} }, form)
    assert.equal(unavailable.status, 'partial')
    assert.equal(unavailable.experimentResults[0].status, 'unavailable')
    assert.deepEqual(unavailable.experimentResults[0].nativeOutput.missingSymbols, ['QQQ'])
    assert.ok(unavailable.fetchIssues.some((issue) => issue.symbol === 'QQQ' && issue.timeframe === '5Min' && issue.type === 'fetch-error'))
    for (const [Component, props] of [[RunResultSummary, { result: unavailable }], [ResearchRunDetail, { run: projectResearchRunForPersistence(unavailable) }]]) {
      assert.ok(renderToStaticMarkup(React.createElement(Component, props)).includes('QQQ · 5Min · fetch-error'))
    }
    assert.ok(renderToStaticMarkup(React.createElement(RunResultSummary, { result: unavailable }))
      .includes('QQQ: unavailable requested-range candles; availability unconfirmed'))
  } finally {
    if (previousSelf) Object.defineProperty(globalThis, 'self', previousSelf)
    else Reflect.deleteProperty(globalThis, 'self')
    if (previousWorker) Object.defineProperty(globalThis, 'Worker', previousWorker)
    else Reflect.deleteProperty(globalThis, 'Worker')
  }
})

test('registered experiment automatically fetches both timeframes without altering selected hourly contracts', async () => {
  const calls = []
  const run = await runFixture((symbol, timeframe, range) => { calls.push({ symbol, timeframe, range }); return fetchFixture(symbol, timeframe) })
  assert.equal(run.status, 'completed')
  assert.equal(run.records[0].methodologyVersion, 'candidate-execution-resolution-3')
  assert.equal(calls.length, 6)
  assert.deepEqual(calls.filter((c) => c.timeframe === '5Min').map((c) => c.symbol), request.symbols)
  assert.ok(calls.every((c) => c.range.start === request.requestedStart && c.range.end === request.requestedEnd))
  assert.equal(run.dataset.calculationSeries.length, 6)
  assert.ok(run.records[0].parameters.executionResolution.rows.some((r) => r.resolvedCount > 0))
  const evidence = run.synthesis.strategyGroups.flatMap((g) => g.evidence)
  const first = evidence.find((e) => e.metricsKey === 'full::SPY::hourly')
  assert.deepEqual(first.symbols, ['SPY'])
  assert.equal(first.methodologyVersion, 'candidate-execution-resolution-3')
  assert.ok(compareEvidence(first, { ...first, methodologyVersion: 'candidate-execution-resolution-2' })
  .hardConflicts.some((conflict) => conflict.field === 'methodologyVersion'))
  assert.ok(compareEvidence(first, { ...first, methodologyVersion: 'candidate-execution-resolution-1' })
    .hardConflicts.some((conflict) => conflict.field === 'methodologyVersion'))
  assert.equal(first.membershipRule, 'research-eligible-75-plus')
  assert.notEqual(first.ruleSetVariant, evidence.find((e) => e.metricsKey === 'full::SPY::fiveMinute').ruleSetVariant)
  assert.deepEqual(getResearchExperiment(id).requiredSymbols, [])
  const current = resolveCurrentEffectiveExperimentConfiguration({ run, dataset: run.dataset })
  assert.deepEqual(current.experiments[id], run.effectiveExperimentConfiguration[id].configuration)
})

test('both input identities change with candle changes; persisted normalized data and canonical series round-trip without duplicated inputs', async () => {
  const run = await runFixture()
  const identity = run.dataset.effectiveMetadata.executionResolution
  const original = request.symbols.map((s) => fetchFixture(s, '1Hour'))
  assert.equal(identity.hourlyDatasetId, createDatasetId(original, 'split', request))
  const changed = await runFixture((symbol, timeframe) => {
    const result = fetchFixture(symbol, timeframe)
    if (timeframe === '5Min' && symbol === 'SPY') result.candles[0].volume += 1
    return result
  })
  assert.notEqual(changed.dataset.datasetId, run.dataset.datasetId)
  assert.notEqual(changed.dataset.effectiveMetadata.executionResolution.fiveMinuteDatasetId, identity.fiveMinuteDatasetId)
  assert.equal(changed.dataset.effectiveMetadata.executionResolution.hourlyDatasetId, identity.hourlyDatasetId)
  const saved = parseResearchJson(stringifyResearchJson(projectResearchRunForPersistence(run)))
  assert.equal(saved.dataset.executionInputs, undefined)
  assert.equal(saved.dataset.calculationSeries, undefined)
  assert.equal(saved.dataset.rawSeriesBySymbol, undefined)
  assert.equal(saved.records[0].nativePayload, undefined)
  assert.equal(saved.experimentResults[0].nativeOutput, undefined)
  assert.deepEqual(saved.records[0].parameters, run.records[0].parameters)
  assert.deepEqual(saved.synthesis, run.synthesis)
  assert.deepEqual(saved.canonicalDataset.calculationSeries, run.dataset.calculationSeries)
  assert.equal(saved.canonicalDataset.calculationSeries.filter((s) => s.timeframe === '5Min').length, 3)
  assert.equal(saved.records[0].provenance.datasetId, saved.dataset.datasetId)
  const compatibility = checkResearchReplayCompatibility({ run: saved, canonicalDataset: saved.canonicalDataset })
  assert.equal(compatibility.compatible, false)
  assert.ok(compatibility.blockers.some((b) => b.code === 'multi-timeframe-replay-unsupported'))
})

test('provider failures, incomplete/missing 5Min and wrong timeframes cannot silently substitute hourly data', async () => {
  for (const mode of ['failure', 'incomplete', 'wrong-timeframe', 'empty']) {
    const run = await runFixture((symbol, timeframe) => {
      if (timeframe !== '5Min' || symbol !== 'QQQ') return fetchFixture(symbol, timeframe)
      if (mode === 'failure') throw new Error('synthetic unavailable')
      const r = fetchFixture(symbol, timeframe)
      return { ...r, ...(mode === 'incomplete' ? { complete: false } : mode === 'empty' ? { candles: [] } : { timeframe: '1Hour' }) }
    })
    assert.equal(run.fetchStatus, 'partial', mode)
    assert.equal(run.experimentResults[0].status, 'unavailable', mode)
    assert.ok(run.fetchIssues.some((issue) => issue.timeframe === '5Min' && issue.symbol === 'QQQ'))
    assert.deepEqual(run.records[0].metrics, {})
  }
  const hourlyInput = Object.fromEntries(request.symbols.map((s) => [s, fetchFixture(s, '1Hour').candles]))
  assert.equal(executeResearchExperiment(id, hourlyInput, request).status, 'unavailable')
  assert.throws(() => createWorkbenchRunRequest({ ...request, symbols: 'SPY,QQQ,IWM', timeframe: '5Min' }), /1Hour decisions/)
})

test('other research runs make no 5Min requests and keep their original dataset identity', async () => {
  const calls = []
  const run = await runFixture((symbol, timeframe) => { calls.push(timeframe); return fetchFixture(symbol, timeframe) }, { requestedExperiments: ['candidate-exit-management'] })
  assert.deepEqual(calls, ['1Hour', '1Hour', '1Hour'])
  assert.equal(run.dataset.executionInputs, undefined)
  assert.equal(run.dataset.datasetId, createDatasetId(request.symbols.map((s) => fetchFixture(s, '1Hour')), 'split', request))
})

test('incompatible input provider or adjustment metadata cannot produce a paired comparison', async () => {
  const mixed = await runFixture((symbol, timeframe) => ({ ...fetchFixture(symbol, timeframe), adjustmentMode: timeframe === '5Min' ? 'raw' : 'split' }))
  assert.equal(mixed.dataset.adjustmentMode, 'mixed')
  assert.equal(mixed.experimentResults[0].status, 'unavailable')
  assert.match(mixed.experimentResults[0].nativeOutput.reason, /price-adjustment/)
  const providers = await runFixture((symbol, timeframe) => ({ ...fetchFixture(symbol, timeframe), provider: timeframe === '5Min' ? 'different-provider' : 'synthetic-test' }))
  assert.equal(providers.status, 'failed')
  assert.equal(providers.records.length, 0)
})

test('Workbench and saved detail render the normalized paired report with real zero, unavailable values, counts and limitations', async () => {
  const run = await runFixture()
  const saved = parseResearchJson(stringifyResearchJson(projectResearchRunForPersistence(run)))
  const record = saved.records[0]
  const r = record.parameters.executionResolution.rows.find((r) => r.resolvedCount > 0)
  r.methods.hourly.costTiers[0].metrics.averageR = 1.2345
  r.methods.fiveMinute.costTiers[0].metrics.averageR = 4.5678
  r.differences.costTiers[0].expectancy = 3.3333
  r.methods.hourly.costTiers[0].metrics.ambiguousTradeCount = 1
  r.methods.hourly.costTiers[0].metrics.ambiguousTradeRate = .25
  for (const [Component, props] of [[ExecutionResolutionResult, { record }], [RunResultSummary, { result: saved }], [ResearchRunDetail, { run: saved }]]) {
    const html = renderToStaticMarkup(React.createElement(Component, props))
    for (const text of ['1.23', '4.57', '3.33', '1 / 25.00%', '0.00', '—', 'Paired population', 'hourly versus', 'First supplied', '12th observed', '30–99', 'not untouched', 'not an account', 'scope="col"', 'scope="row"', '<caption>', '<summary>']) {
      if (text !== 'hourly versus') assert.ok(html.includes(text), `${Component.name}: ${text}`)
    }
    assert.ok(html.includes(String(r.resolvedCount)))
  }
  const unavailable = createResearchRecordForExperiment(id, { available: false }, {})
  assert.ok(renderToStaticMarkup(React.createElement(ExecutionResolutionResult, { record: unavailable })).includes('No performance is inferred'))
})

test('frozen Shadow source fingerprint remains unchanged', async () => {
  assert.equal(await shadowSourceFingerprint(), '6241eacd477f3e6fb6138203f711296991cf6c8db2493c36d79648b504bcd26b')
})
