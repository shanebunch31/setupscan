import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { shadowCandidate, shadowOptions, evaluateShadowDecision, resolveShadowOccurrence, summarizeShadow, shadowMilestone } from '../src/research/shadowForward.js'
import { candidateDefinition } from '../src/backtest/candidateContextRobustness.js'
import { buildTradeFromIndex, computeMetrics } from '../src/backtest/signalQualityBacktest.js'
import { createShadowObserver, prepareShadowCycle } from './shadowForwardObserver.js'
import { shadowConfiguration, runShadowCommand, shadowSourceFingerprint, validateShadowConnection } from './shadowForwardCommand.js'
import { createShadowForwardRoute } from './shadowForwardRoute.js'
import { ShadowForwardEvidence } from '../src/research/ShadowForwardPanel.js'

const bars = (symbol = 'AAPL', count = 338) => Array.from({ length: count }, (_, i) => {
  const close = 100 + i * .03 + Math.sin(i / 6)
  return { symbol, timeframe: '1Hour', timestamp: new Date(Date.UTC(2026, 9, 1) + i * 3600000).toISOString(), open: close, close, high: close + .2, low: close - .2, volume: 1000 + i }
})
const at = (index = 338, delay = 60_000) => new Date(Date.UTC(2026, 9, 1) + index * 3600000 + delay).toISOString()
const tracking = { id: 'synthetic', candidate: shadowCandidate, startedAt: at(330), frozenAt: at(329), historyStart: at(0, 0), symbols: ['AAPL'], sourceFingerprint: 'fixture', provider: 'ALPACA HISTORICAL', adjustmentMode: 'split' }
const raw = () => ({ AAPL: bars() })
const occurrence = () => evaluateShadowDecision(raw(), tracking, at()).occurrences[0]
const empty = () => ({ tracking, raw: { AAPL: [] }, occurrences: [], checkpoint: {} })
const payload = (candles = bars()) => ({ candles, complete: true, paginationComplete: true, provider: tracking.provider, adjustmentMode: tracking.adjustmentMode })
const params = (candles = bars()) => ({ fetchBars: async () => payload(candles), observedAt: at(), sourceFingerprint: 'fixture' })

test('frozen version matches existing candidate and actual arbitrary-symbol scanner qualification', () => {
  assert.deepEqual(shadowCandidate.conditions, candidateDefinition.conditions)
  assert.equal(shadowCandidate.methodologyVersion, 'candidate-context-robustness-2')
  const row = occurrence()
  assert.ok(row, 'Actual enriched AAPL fixture must qualify, not silently return no evidence')
  assert.equal(row.qualification.score, 78)
  assert.equal(row.qualification.classification, 'Potential Setup')
  assert.equal(row.qualification.researchEligible, true)
  assert.equal(row.qualification.trend, 'Uptrend')
  assert.equal(row.qualification.volatility, 'Medium')
  assert.equal(row.theoretical, null)
  assert.equal(row.provenance.regimeSourceSymbol, 'AAPL')
  assert.ok(row.provenance.contextVersion)
  assert.ok(row.provenance.tradeVersion)
  assert.ok(Object.isFrozen(shadowCandidate.conditions[0]))
})

test('symbol identities and iteration are deterministic without fixed required tickers', () => {
  const t = { ...tracking, symbols: ['AAPL', 'MSFT'] }
  const first = evaluateShadowDecision({ MSFT: bars('MSFT'), AAPL: bars() }, t, at())
  const second = evaluateShadowDecision({ AAPL: bars(), MSFT: bars('MSFT') }, t, at())
  // The production universe is sorted before calling the existing reference helper.
  assert.deepEqual(first.occurrences.map((r) => r.symbol), ['AAPL', 'MSFT'])
  assert.deepEqual(first.occurrences.map((r) => r.id), second.occurrences.map((r) => r.id))
  assert.equal(new Set(first.occurrences.map((r) => r.id)).size, 2)
})

test('freeze boundary, incomplete bars and delayed historical bars cannot produce forward evidence', () => {
  assert.equal(evaluateShadowDecision(raw(), { ...tracking, startedAt: at(340) }, at()).occurrences.length, 0)
  assert.equal(evaluateShadowDecision(raw(), tracking, at(337)).occurrences.length, 0)
  assert.equal(evaluateShadowDecision(raw(), tracking, at(339)).occurrences.length, 0)
  assert.equal(evaluateShadowDecision(raw(), tracking, at()).occurrences.length, 1)
})

for (const [label, candle, reason] of [
  ['stop', { open: 100, low: 99, high: 100.1, close: 99.8 }, 'Stop'],
  ['target', { open: 100, low: 99.8, high: 102, close: 101 }, 'Target'],
  ['both barriers', { open: 100, low: 99, high: 102, close: 100 }, 'Stop'],
]) test(`theoretical ${label} and all costs exactly reuse the historical resolver`, () => {
  const row = occurrence(), series = bars()
  series.push({ ...series.at(-1), ...candle, timestamp: at(338, 0) })
  const frozen = structuredClone(row)
  const result = resolveShadowOccurrence(row, { AAPL: series }, at(339))
  const expected = buildTradeFromIndex(series, 337, shadowOptions, { symbol: 'AAPL' })
  assert.equal(result.state, 'resolved')
  assert.equal(result.outcome.reason, reason)
  assert.equal(result.outcome.rawR, expected.rMultiple)
  assert.equal(result.outcome.ambiguousCandle, label === 'both barriers')
  for (const tier of result.outcome.costTiers) assert.equal(tier.r, computeMetrics([expected], tier.costR).averageR)
  assert.deepEqual(row, frozen)
  assert.strictEqual(resolveShadowOccurrence(result, {}, at(400)), result)
})

test('pending preserves entry through restart, adverse gaps and target gaps match historical prices', () => {
  const row = occurrence(), series = bars()
  series.push({ ...series.at(-1), open: 100, high: 100.1, low: 99.8, close: 100, timestamp: at(338, 0) })
  const pending = resolveShadowOccurrence(row, { AAPL: series }, at(339))
  assert.equal(pending.state, 'pending')
  assert.equal(pending.theoretical.entryPrice, 100)
  for (const [open, reason, price] of [[95, 'Stop', 95], [105, 'Target', 101]]) {
    const next = [...series, { ...series.at(-1), timestamp: at(339, 0), open, high: open + .1, low: open - .1, close: open }]
    const result = resolveShadowOccurrence(JSON.parse(JSON.stringify(pending)), { AAPL: next }, at(340))
    assert.equal(result.outcome.reason, reason)
    assert.equal(result.outcome.exitPrice, price)
    assert.deepEqual(result.qualification, row.qualification)
  }
})

test('partial windows remain pending; exactly twelve observed bars expire without early guess', () => {
  const series = bars()
  for (let i = 0; i < 12; i++) series.push({ ...series[0], timestamp: at(338 + i, 0), open: 100, high: 100.1, low: 99.8, close: 100 })
  assert.equal(resolveShadowOccurrence(occurrence(), { AAPL: series.slice(0, -1) }, at(350)).state, 'pending')
  const result = resolveShadowOccurrence(occurrence(), { AAPL: series }, at(351))
  assert.equal(result.outcome.reason, 'Expired')
  assert.equal(result.outcome.holdingBars, 12)
  assert.equal(result.outcome.rawR, 0)
  assert.equal(resolveShadowOccurrence(occurrence(), {}, at(1000)).state, 'pending')
})

test('baseline suppresses historical entries; fresh cycle detects once and repeated/restarted polls dedupe', async () => {
  const initial = await prepareShadowCycle(empty(), params())
  assert.equal(initial.occurrences.length, 0)
  const before = { ...empty(), checkpoint: { lastSuccessfulCycle: at(338, -60_000), latestDecisionBar: at(336, 0) } }
  const update = await prepareShadowCycle(before, params())
  assert.equal(update.occurrences.length, 1)
  const restart = { ...before, raw: { AAPL: update.newCandles.map((r) => r.candle) }, occurrences: update.occurrences, checkpoint: update.checkpoint }
  const repeated = await prepareShadowCycle(JSON.parse(JSON.stringify(restart)), params())
  assert.equal(repeated.newCandles.length, 0)
  assert.deepEqual(repeated.occurrences, update.occurrences)
  const downtime = await prepareShadowCycle({ ...before, checkpoint: { ...before.checkpoint, lastSuccessfulCycle: at(335) } }, params())
  assert.equal(downtime.occurrences.length, 0)
})

test('invalid, conflicting, unavailable and changed-version inputs fail without mutating state', async () => {
  const before = empty(), original = structuredClone(before)
  const invalid = bars(); invalid[0].volume = null
  await assert.rejects(prepareShadowCycle(before, params(invalid)), /Invalid/)
  const duplicate = [...bars(), { ...bars()[0], close: 100.1 }]
  await assert.rejects(prepareShadowCycle(before, params(duplicate)), /revised/)
  await assert.rejects(prepareShadowCycle(before, { ...params(), sourceFingerprint: 'changed' }), /Frozen/)
  await assert.rejects(prepareShadowCycle(before, { ...params(), fetchBars: async () => ({ ...payload(), complete: false }) }), /Incomplete/)
  await assert.rejects(prepareShadowCycle(before, { ...params(), fetchBars: async () => { throw new Error('unsupported') } }), /unsupported/)
  assert.deepEqual(before, original)
})

test('incremental one-bar polls accept exhausted pagination despite the old minimum-count heuristic', async () => {
  const initial = await prepareShadowCycle(empty(), params())
  const before = { ...empty(), raw: { AAPL: initial.newCandles.map((r) => r.candle) }, occurrences: [], checkpoint: initial.checkpoint }
  const result = await prepareShadowCycle(before, { ...params(), fetchBars: async () => ({ ...payload([bars().at(-1)]), complete: false, minimumExpectedCandles: 20 }) })
  assert.equal(result.newCandles.length, 0)
  await assert.rejects(prepareShadowCycle(before, { ...params(), fetchBars: async () => ({ ...payload(), paginationComplete: false }) }), /Incomplete/)
})

test('JSONB key ordering does not look like a correction, and slow responses cannot create timely observations', async () => {
  const initial = await prepareShadowCycle(empty(), params())
  const reversed = (object) => Object.fromEntries(Object.entries(object).reverse())
  const before = { ...empty(), raw: { AAPL: initial.newCandles.map((r) => reversed(r.candle)) }, checkpoint: initial.checkpoint }
  assert.equal((await prepareShadowCycle(before, params())).newCandles.length, 0)
  const fresh = { ...empty(), checkpoint: { lastSuccessfulCycle: at(338, -60_000), latestDecisionBar: at(336, 0) } }
  const slow = await prepareShadowCycle(fresh, { ...params(), clock: () => at(339) })
  assert.equal(slow.occurrences.length, 0)
  const row = occurrence(), series = bars()
  series.push({ ...series.at(-1), timestamp: at(338, 0), open: 100, high: 100.1, low: 99.8, close: 100 })
  const pending = resolveShadowOccurrence(row, { AAPL: series }, at(339))
  pending.theoretical = reversed(pending.theoretical)
  assert.doesNotThrow(() => resolveShadowOccurrence(pending, { AAPL: series }, at(339)))
})

test('slightly delayed current bars may qualify, but a resumed baseline cannot backfill them', async () => {
  const before = { ...empty(), checkpoint: { baselineEstablishedAt: at(330), detectionBoundary: at(330), lastSuccessfulCycle: at(338), latestDecisionBar: at(336, 0) } }
  const result = await prepareShadowCycle(before, { ...params(), observedAt: at(338, 120_000) })
  assert.equal(result.occurrences.length, 1)
  const resumed = { ...before, checkpoint: { ...before.checkpoint, detectionBoundary: at(338) } }
  assert.equal((await prepareShadowCycle(resumed, { ...params(), observedAt: at(338, 120_000) })).occurrences.length, 0)
})

test('explicit initialization creates only a frozen definition and closes without fetching or starting', async () => {
  let initialized = null, closed = 0, fetched = 0
  const environment = { SHADOW_TRACKING_ID: 'fixture', SHADOW_SYMBOLS: 'AAPL', SHADOW_START_AT: at(400), SHADOW_HISTORY_START: at(0), SHADOW_DATABASE_URL: 'postgres://localhost/isolated_fixture', SHADOW_CONFIRM_INITIALIZE: 'create-separate-shadow-tables' }
  assert.equal(await runShadowCommand(['init'], { environment, now: () => new Date(at(350)), fingerprint: async () => 'fixture',
    storeFactory: () => ({ initialize: async (definition) => { initialized = definition }, close: async () => { closed++ } }),
    fetchBars: async () => { fetched++ }, log: () => {} }), null)
  assert.equal(initialized.id, 'fixture'); assert.equal(closed, 1); assert.equal(fetched, 0)
})

test('overlap is prevented and persistent errors use capped backoff with visible failure status', async () => {
  let release, calls = 0, callback, delay
  const store = { cycle: async () => { calls++; await new Promise((resolve) => { release = resolve }); throw new Error('secret must not be logged') } }
  const observer = createShadowObserver({ store, schedule: (cb, ms) => { callback = cb; delay = ms }, cancel: () => {} })
  const one = observer.processOnce(), two = observer.processOnce()
  assert.strictEqual(one, two)
  release(); await one
  assert.equal(calls, 1)
  assert.equal(observer.status().status, 'ERROR')
  assert.doesNotMatch(JSON.stringify(observer.status()), /secret/)
  observer.start(); release(); await new Promise((resolve) => setImmediate(resolve))
  assert.equal(delay, 240000)
  for (let i = 0; i < 5; i++) { const next = callback(); release(); await next }
  assert.equal(delay, 900000)
  await observer.stop()
})

test('per-symbol summary distinguishes unavailable from zero and milestones never authorize trading', () => {
  for (const [n, label] of [[0, 'Early / insufficient'], [29, 'Early / insufficient'], [30, 'Early review only'], [49, 'Early review only'], [50, 'Meaningful'], [99, 'Meaningful'], [100, 'Stronger descriptive']]) assert.ok(shadowMilestone(n).startsWith(label))
  const row = occurrence()
  const rows = [{ ...row, state: 'resolved', outcome: { rawR: 0, holdingBars: 1, ambiguousCandle: true } }, { ...row, id: 'other' }]
  const summaries = summarizeShadow({ ...tracking, symbols: ['AAPL', 'MSFT'] }, rows)
  assert.equal(summaries[0].resolved, 1)
  assert.equal(summaries[0].pending, 1)
  assert.equal(summaries[0].costTiers[0].metrics.averageR, 0)
  assert.equal(summaries[0].costTiers[0].metrics.ambiguousTradeRate, 1)
  assert.equal(summaries[1].costTiers[0].metrics, null)
  const html = renderToStaticMarkup(React.createElement(ShadowForwardEvidence, { snapshot: { tracking, checkpoint: {}, occurrences: [row], summaries, freshness: 'No successful cycle' } }))
  for (const text of ['AAPL', 'MSFT', '—', '0.00', 'Frozen definition', 'no early expiry', 'No automatic promotion', 'Theoretical entry']) assert.ok(html.includes(text), text)
})

test('evidence shows both persisted versions without guessing missing provenance', () => {
  const render = (candidate) => renderToStaticMarkup(React.createElement(ShadowForwardEvidence, {
    snapshot: { tracking: { ...tracking, candidate }, checkpoint: {}, occurrences: [], summaries: [] },
  }))
  const html = render(shadowCandidate)
  assert.ok(html.includes('Historical methodology: candidate-context-robustness-2'))
  assert.ok(html.includes('Forward protocol: shadow-forward-1'))
  const legacy = render({ name: shadowCandidate.name })
  assert.ok(legacy.includes('Historical methodology: Unavailable'))
  assert.ok(legacy.includes('Forward protocol: Unavailable'))
  assert.ok(!legacy.includes('shadow-forward-1'))
})

test('read API never initializes or mutates; unsupported methods and missing storage fail safely', async () => {
  let reads = 0
  const route = createShadowForwardRoute({ trackingId: 'test', store: { read: async () => { reads++; return { tracking, checkpoint: {}, occurrences: [] } } } })
  const response = () => ({ setHeader() {}, writeHead(code) { this.code = code }, end(body) { this.body = JSON.parse(body) } })
  const rejected = response(); await route({ method: 'POST' }, rejected)
  assert.equal(rejected.code, 405); assert.equal(reads, 0)
  const success = response(); await route({ method: 'GET' }, success)
  assert.equal(success.code, 200); assert.equal(reads, 1)
  assert.equal(Object.hasOwn(success.body, 'raw'), false)
  const missing = response(); await createShadowForwardRoute()({ method: 'GET' }, missing)
  assert.equal(missing.code, 503)
  const failed = response(); await createShadowForwardRoute({ trackingId: 'test', store: { read: async () => { throw new Error('credentials') } } })({ method: 'GET' }, failed)
  assert.equal(failed.code, 503); assert.doesNotMatch(JSON.stringify(failed.body), /credentials/)
})

test('read API never exposes stored candle history from the store snapshot', async () => {
  const route = createShadowForwardRoute({ trackingId: 'test', store: { read: async () => ({ tracking, checkpoint: {}, occurrences: [], raw: { AAPL: [{ timestamp: at(0) }] } }) } })
  const response = { setHeader() {}, writeHead(code) { this.code = code }, end(body) { this.body = JSON.parse(body) } }
  await route({ method: 'GET' }, response)
  assert.equal(response.code, 200)
  assert.equal(Object.hasOwn(response.body, 'raw'), false)
  assert.equal(JSON.stringify(response.body).includes(at(0)), false)
})

test('operator configuration is explicit, generic, bounded, future-only and source-locked', async () => {
  const environment = { SHADOW_TRACKING_ID: 'test', SHADOW_SYMBOLS: 'msft,AAPL,aapl', SHADOW_START_AT: at(400), SHADOW_HISTORY_START: at(0) }
  const result = shadowConfiguration(environment, new Date(at(350)), 'hash')
  assert.deepEqual(result.symbols, ['AAPL', 'MSFT'])
  assert.throws(() => shadowConfiguration({ ...environment, SHADOW_START_AT: at(300) }, new Date(at(350)), 'hash'))
  assert.throws(() => shadowConfiguration({ ...environment, SHADOW_SYMBOLS: '!!!' }, new Date(at(350)), 'hash'))
  assert.throws(() => validateShadowConnection('postgres://example.invalid/test'))
  assert.doesNotThrow(() => validateShadowConnection('postgres://example.invalid/test?sslmode=verify-full'))
  let created = 0
  await assert.rejects(runShadowCommand(['init'], { environment: { ...environment, SHADOW_DATABASE_URL: 'postgres://localhost/test' }, now: () => new Date(at(350)), fingerprint: async () => 'hash', storeFactory: () => { created++; throw new Error('must not connect') } }))
  assert.equal(created, 0)
  assert.match(await shadowSourceFingerprint(), /^[a-f0-9]{64}$/)
})

test('shadow modules have no paper engine, order calls or paper store dependencies; existing worker is separate', async () => {
  for (const file of ['shadowForwardObserver.js', 'shadowForwardStore.js', 'shadowForwardCommand.js']) {
    const text = await readFile(new URL(file, import.meta.url), 'utf8')
    assert.doesNotMatch(text, /paperTrading|paperObserverCore|postgresPaperStore|submitPaperOrder|alpacaTrading|createPaperTradingEngine/)
  }
  const worker = await readFile(new URL('paperObserver.js', import.meta.url), 'utf8')
  assert.doesNotMatch(worker, /shadowForward/)
})
