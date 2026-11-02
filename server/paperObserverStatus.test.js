import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createPaperObserverStatusReader, paperStorageIdentity, projectPaperOperationalStatus } from './paperObserverStatus.js'
import { createPaperDashboardRoute } from './paperDashboardRoute.js'
import { paperOperationalStatus, paperStatusForSnapshot } from '../src/paper/paperOperationalStatus.js'

const now = new Date('2026-10-29T16:30:00Z')
const worker = overrides => ({ healthVersion: 1, storageIdentity: paperStorageIdentity({}), schedulerRunning: true,
  runtimeCycleCompleted: true, baselinePendingSymbols: [], status: 'RUNNING', cycleOutcome: 'NO_NEW_DATA', cycleActive: false,
  lastCycleCompletedAt: '2026-10-29T16:29:30Z', nextCycleOverdueAt: '2026-10-29T16:40:00Z',
  config: { pollIntervalMs: 60000 }, symbolResults: { XYZ: { dataStatus: 'NO_NEW_DATA' } }, ...overrides })
const probe = overrides => ({ available: true, verified: true, observer: worker(overrides) })
const journal = { trades: [{ id: 'kept', symbol: 'XYZ', status: 'open' }], symbolUniverse: { initialized: true, symbols: ['XYZ'] },
  observer: { status: 'RUNNING', processedCandles: { XYZ: '2026-10-29T15:00:00Z' }, decisionHistoryBySymbol: { XYZ: [{ completedDecisionBar: '2026-10-29T15:00:00Z', baseline: true }] } } }

test('healthy live worker waiting on a bar is independent of journal and positions', () => {
  const status = projectPaperOperationalStatus(journal, probe(), now)
  assert.equal(status.state, 'WAITING'); assert.equal(status.healthy, true)
  assert.equal(status.journal, 'AVAILABLE'); assert.equal(status.openPositions, 1)
  assert.equal(projectPaperOperationalStatus(null, probe(), now).journal, 'UNAVAILABLE')
})
test('readable historical RUNNING state never confirms stopped, unreachable, or unverified worker', () => {
  for (const [p, state] of [[{ available: false }, 'UNAVAILABLE'], [{ available: true }, 'UNVERIFIED'], [probe({ schedulerRunning: false }), 'STOPPED']]) {
    const result = projectPaperOperationalStatus(journal, p, now)
    assert.equal(result.state, state); assert.equal(result.healthy, false); assert.equal(result.journal, 'AVAILABLE')
  }
})
test('actual active-cycle and idle-cycle deadlines determine overdue, including closed sessions', () => {
  for (const cycleActive of [true, false]) {
    const result = projectPaperOperationalStatus(journal, probe({ cycleActive, cycleOutcome: 'MARKET_CLOSED', cycleDeadlineAt: '2026-10-29T16:29:00Z', nextCycleOverdueAt: '2026-10-29T16:29:00Z' }), now)
    assert.equal(result.state, 'OVERDUE'); assert.equal(result.healthy, false)
  }
  const closed = projectPaperOperationalStatus(journal, probe({ cycleOutcome: 'MARKET_CLOSED' }), now)
  assert.equal(closed.state, 'MARKET_CLOSED'); assert.equal(closed.provider, 'NOT_REQUESTED'); assert.equal(closed.healthy, true)
})
test('startup cannot inherit healthy from a prior runtime snapshot', () => {
  const status = projectPaperOperationalStatus(journal, probe({ runtimeCycleCompleted: false }), now)
  assert.equal(status.state, 'CHECKING'); assert.equal(status.healthy, false); assert.equal(status.lastCycleCompletedAt, null)
  assert.equal(projectPaperOperationalStatus(journal, probe({ failureStage: 'STARTUP', schedulerRunning: false }), now).state, 'STARTING')
})

test('pending or unavailable recovered baselines prevent healthy status without hiding liveness or session outcome', () => {
  for (const cycleOutcome of ['MARKET_CLOSED', 'NO_NEW_DATA']) {
    const pending = ['XYZ']
    const result = projectPaperOperationalStatus(journal, probe({ cycleOutcome, baselinePendingSymbols: pending, runtimeStartedAt: now.toISOString() }), now)
    assert.equal(result.healthy, false)
    assert.equal(result.worker, 'ALIVE')
    assert.equal(result.state, 'BASELINE_PENDING')
    assert.equal(result.cycleOutcome, cycleOutcome)
    assert.equal(result.runtimeStartedAt, now.toISOString())
    assert.deepEqual(result.baselinePendingSymbols, ['XYZ'])
    result.baselinePendingSymbols.push('not-persisted')
    assert.deepEqual(pending, ['XYZ'])
  }
  for (const baselinePendingSymbols of [undefined, null, 'unknown']) {
    const unknown = projectPaperOperationalStatus(journal, probe({ baselinePendingSymbols }), now)
    assert.equal(unknown.state, 'RECOVERY_UNVERIFIED')
    assert.equal(unknown.healthy, false)
    assert.equal(unknown.baselinePendingSymbols, null)
  }
  const invalidRecovery = projectPaperOperationalStatus(journal, probe({ symbolResults: { XYZ: { dataStatus: 'PROCESSING_ERROR', errorCode: 'PAPER_TRADE_RECOVERY_INVALID' } } }), now)
  assert.equal(invalidRecovery.state, 'PROCESSING_FAILED')
  assert.equal(invalidRecovery.healthy, false)
})
test('provider, processing and persistence failures keep worker liveness distinct', () => {
  for (const [overrides, state] of [
    [{ symbolResults: { XYZ: { dataStatus: 'TIMEOUT' } } }, 'PROVIDER_FAILED'],
    [{ symbolResults: { XYZ: { dataStatus: 'PROCESSING_ERROR' } } }, 'PROCESSING_FAILED'],
    [{ cycleOutcome: 'ERROR', failureStage: 'PERSISTENCE', failureCode: 'PAPER_STATE_CONFLICT', currentError: 'secret password' }, 'PERSISTENCE_FAILED'],
  ]) {
    const result = projectPaperOperationalStatus(journal, probe(overrides), now)
    assert.equal(result.worker, 'ALIVE'); assert.equal(result.state, state); assert.equal(result.healthy, false)
    assert.ok(!JSON.stringify(result).includes('secret password'))
  }
})
test('durable arbitrary-symbol checkpoints are not overwritten by uncommitted runtime progress', () => {
  const before = structuredClone(journal)
  const result = projectPaperOperationalStatus(journal, probe({ processedCandles: { XYZ: '2026-10-29T16:00:00Z' } }), now)
  assert.equal(result.checkpoints[0].timestamp, journal.observer.processedCandles.XYZ)
  assert.equal(result.checkpoints[0].enabled, true); assert.equal(result.checkpoints[0].decisions[0].baseline, true)
  assert.deepEqual(journal, before)
})
test('status reader accepts error HTTP health, rejects wrong store/legacy and suppresses endpoint secrets', async () => {
  for (const [body, expected] of [[worker(), true], [{ ...worker(), storageIdentity: 'wrong' }, false], [{ status: 'RUNNING' }, false]]) {
    const read = createPaperObserverStatusReader({ environment: {}, fetchStatus: async () => ({ status: 503, json: async () => body }) })
    assert.equal((await read()).verified, expected)
  }
  const read = createPaperObserverStatusReader({ environment: { PAPER_OBSERVER_STATUS_URL: 'http://private-host' }, fetchStatus: async () => { throw new Error('secret') } })
  assert.deepEqual(await read(), { available: false, verified: false })
})
test('bounded status probe aborts even when fetch ignores cancellation', async () => {
  let signal
  const read = createPaperObserverStatusReader({ environment: {}, timeoutMs: 5, fetchStatus: async (_url, options) => { signal = options.signal; return new Promise(() => {}) } })
  assert.equal((await read()).available, false); assert.equal(signal.aborted, true)
})
test('store identity excludes credentials but separates database targets', () => {
  assert.equal(paperStorageIdentity({ DATABASE_URL: 'postgres://alice:secret@host/db' }), paperStorageIdentity({ DATABASE_URL: 'postgres://bob:other@host:5432/db' }))
  assert.notEqual(paperStorageIdentity({ DATABASE_URL: 'postgres://host/db' }), paperStorageIdentity({ DATABASE_URL: 'postgres://host/other' }))
})
test('journal cache never caches a live healthy claim and failed reads still report worker state', async () => {
  let reads = 0, probes = 0, payload, http
  const handler = createPaperDashboardRoute({ now: () => now.getTime(), paperService: { readSnapshot: async () => { reads++; return journal } }, readWorkerStatus: async () => ++probes === 1 ? probe() : { available: false } })
  const request = { request: { method: 'GET' }, response: {}, sendJson: (_response, status, data) => { payload = data; http = status } }
  await handler(request); assert.equal(payload.operational.healthy, true)
  await handler(request); assert.equal(payload.operational.state, 'UNAVAILABLE'); assert.equal(reads, 1)
  assert.deepEqual(payload.trades, journal.trades)
  const failed = createPaperDashboardRoute({ now: () => now.getTime(), paperService: { readSnapshot: async () => { throw new Error('secret') } }, readWorkerStatus: async () => probe() })
  await failed(request); assert.equal(http, 502); assert.equal(payload.operational.journal, 'UNAVAILABLE'); assert.equal(payload.operational.worker, 'ALIVE'); assert.ok(!JSON.stringify(payload).includes('secret'))
})
test('browser cannot retain an all-clear beyond the server deadline', () => {
  const status = projectPaperOperationalStatus(journal, probe(), now)
  assert.equal(paperOperationalStatus(status, Date.parse('2026-10-29T16:41:00Z')).healthy, false)
  assert.equal(paperOperationalStatus(null).healthy, false)
})
test('legacy API history remains available without inventing worker health', () => {
  const result = paperStatusForSnapshot(journal, null, null, now.getTime())
  assert.equal(result.journal, 'AVAILABLE'); assert.equal(result.openPositions, 1)
  assert.equal(result.healthy, false); assert.equal(result.checkpoints[0].symbol, 'XYZ')
  const failed = paperStatusForSnapshot(journal, null, 'request failed', now.getTime())
  assert.equal(failed.journal, 'UNAVAILABLE'); assert.equal(failed.openPositions, null); assert.equal(failed.healthy, false)
})
