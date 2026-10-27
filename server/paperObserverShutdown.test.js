import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { createPaperObserver, configFromEnvironment } from './paperObserverCore.js'
import { createPaperObserverShutdown, withShutdownDeadline } from './paperObserverShutdown.js'

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const turn = () => new Promise(resolve => setImmediate(resolve))
function fixture(overrides = {}) {
  return createPaperObserver({ environment: { PAPER_SYMBOLS: 'SPY' },
    store: { load: () => ({ trades: [] }), save: async () => {} },
    now: () => new Date('2026-09-22T16:15:00Z'), onError: () => {},
    fetchBars: async () => ({ candles: [] }), ...overrides })
}

test('shutdown configuration has safe fallbacks and a finite cap', () => {
  for (const value of [undefined, '', 'bad', '0', '-1', 'Infinity', '0.5']) {
    assert.equal(configFromEnvironment({ PAPER_SHUTDOWN_TIMEOUT_MS: value }).shutdownTimeoutMs, 30000)
  }
  assert.equal(configFromEnvironment({ PAPER_SHUTDOWN_TIMEOUT_MS: '1234.9' }).shutdownTimeoutMs, 1234)
  assert.equal(configFromEnvironment({ PAPER_SHUTDOWN_TIMEOUT_MS: '999999' }).shutdownTimeoutMs, 120000)
})

test('late work cannot claim success when the deadline timer has not yet run', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 })
  const pending = deferred()
  const result = withShutdownDeadline(pending.promise, 100)
  t.mock.timers.setTime(1101)
  pending.resolve()
  await assert.rejects(result, { code: 'PAPER_SHUTDOWN_TIMEOUT' })
})

test('idle stop is prompt and idempotent; start/manual work cannot resume it', async () => {
  let calls = 0
  const observer = await fixture({ fetchBars: () => { calls++; throw new Error('must not fetch') } })
  const before = observer.getState()
  const stopped = observer.stop()
  assert.equal(observer.stop(), stopped)
  await stopped
  observer.start()
  await assert.rejects(observer.processOnce(), { code: 'PAPER_OBSERVER_STOPPED' })
  assert.equal(calls, 0)
  assert.deepEqual(observer.getState(), before)
  assert.equal(observer.status().shuttingDown, true)
  assert.equal(observer.status().status, 'IDLE')
})

test('stop drains active fetch then normal save; no timer is scheduled after stop', async () => {
  const fetch = deferred(), entered = deferred(), save = deferred(), saving = deferred()
  const scheduled = []
  let persisted, writes = 0, closed = 0
  const observer = await fixture({
    store: { load: () => ({ trades: [] }), save: async state => {
      saving.resolve(); await save.promise; persisted = structuredClone(state); writes++
    }, close: () => { closed++ } },
    fetchBars: () => { entered.resolve(); return fetch.promise },
    schedule: callback => { scheduled.push(callback); return scheduled.length },
  })
  observer.start()
  await entered.promise
  const cycle = observer.processOnce()
  let drained = false
  const stopped = observer.stop()
  stopped.then(() => { drained = true })
  assert.equal(observer.stop(), stopped)
  const closing = observer.close()
  assert.equal(observer.close(), closing)
  await turn()
  assert.equal(drained, false)
  assert.equal(observer.status().cycleActive, true)
  assert.equal(observer.status().lastCycleCompletedAt, undefined)
  fetch.resolve({ candles: [{ timestamp: '2026-09-22T15:00:00Z', open: 100, high: 101, low: 99, close: 100, volume: 100 }] })
  await saving.promise
  assert.equal(drained, false)
  assert.equal(closed, 0)
  save.resolve()
  await stopped
  await closing
  assert.equal((await cycle).status, 'RUNNING')
  assert.equal(writes, 1, 'only the normal cycle save, no shutdown snapshot')
  assert.equal(persisted.observer.processedCandles.SPY, '2026-09-22T15:00:00Z')
  assert.deepEqual(persisted.trades, [], 'baseline still cannot open historical trades')
  assert.equal(closed, 1)
  assert.equal(scheduled.length, 0)
  assert.equal(observer.status().cycleActive, false)
})

test('stop cancels an existing scheduled callback and rejects later manual cycles', async () => {
  const scheduled = [], cancelled = []
  const observer = await fixture({ schedule: fn => { scheduled.push(fn); return 42 }, cancelSchedule: id => cancelled.push(id) })
  observer.start()
  await observer.processOnce()
  await turn()
  assert.equal(scheduled.length, 1)
  await observer.stop()
  assert.deepEqual(cancelled, [42])
  scheduled[0]()
  observer.start()
  await assert.rejects(observer.processOnce(), { code: 'PAPER_OBSERVER_STOPPED' })
  assert.equal(scheduled.length, 1)
})

test('stop deadline rejects without claiming save completion or closing resources', async () => {
  const save = deferred(), saving = deferred()
  let closed = 0
  const observer = await fixture({ environment: { PAPER_SYMBOLS: 'SPY', PAPER_SHUTDOWN_TIMEOUT_MS: '20' },
    store: { load: () => ({ trades: [] }), save: () => { saving.resolve(); return save.promise }, close: () => { closed++ } },
  })
  const cycle = observer.processOnce()
  await saving.promise
  await assert.rejects(observer.stop(), { code: 'PAPER_SHUTDOWN_TIMEOUT' })
  assert.equal(observer.status().cycleActive, true)
  assert.equal(observer.status().lastCycleCompletedAt, undefined)
  await assert.rejects(observer.close(), { code: 'PAPER_SHUTDOWN_TIMEOUT' })
  assert.equal(closed, 0)
  // Release synthetic work; real process integration terminates on this path.
  save.resolve()
  await cycle
})

test('persistence failure while draining retains ERROR semantics and the normal error-save attempt', async () => {
  const fetch = deferred(), entered = deferred()
  let writes = 0
  const observer = await fixture({ store: { load: () => ({ trades: [] }), save: () => { writes++; throw new Error('save rejected') } },
    fetchBars: () => { entered.resolve(); return fetch.promise } })
  const cycle = observer.processOnce()
  await entered.promise
  const stopped = observer.stop()
  fetch.resolve({ candles: [] })
  await stopped
  assert.equal((await cycle).status, 'ERROR')
  assert.match(observer.status().currentError, /save rejected/)
  assert.equal(writes, 2)
})

function lifecycleFixture(overrides = {}) {
  const events = [], signals = new EventEmitter()
  const lifecycle = createPaperObserverShutdown({ signals, timeoutMs: 1000,
    getObserver: () => ({ stop: async () => { events.push('drain') }, close: async () => { events.push('store closed') } }),
    stopStartup: () => events.push('startup disabled'), waitForStartup: async () => {},
    server: { close: callback => { events.push('http closed'); callback() } },
    exit: code => events.push(`exit ${code}`), log: message => events.push(message), logError: message => events.push(message),
    ...overrides })
  return { lifecycle, events, signals }
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  test(`${signal} drains before HTTP/store close and exits once despite repeated signals`, async () => {
    const drain = deferred()
    const { lifecycle, events, signals } = lifecycleFixture({ getObserver: () => ({
      stop: () => drain.promise, close: () => { events.push('store closed') },
    }) })
    signals.emit(signal)
    assert.equal(lifecycle.isStopping(), true)
    assert.deepEqual(events, ['startup disabled'])
    const shutdown = lifecycle.shutdown()
    signals.emit(signal === 'SIGINT' ? 'SIGTERM' : 'SIGINT')
    assert.equal(lifecycle.shutdown(), shutdown)
    await turn()
    assert.deepEqual(events, ['startup disabled'])
    drain.resolve()
    await shutdown
    assert.deepEqual(events.slice(0, 3), ['startup disabled', 'http closed', 'store closed'])
    assert.match(events[3], /graceful shutdown complete/)
    assert.equal(events[4], 'exit 0')
  })
}

for (const stage of ['startup', 'drain', 'http', 'store']) {
  test(`total deadline bounds stalled ${stage}; no later clean exit or unsafe close`, async () => {
    const stalled = deferred()
    const { lifecycle, events } = lifecycleFixture({ timeoutMs: 20,
      waitForStartup: () => stage === 'startup' ? stalled.promise : undefined,
      getObserver: () => ({ stop: () => stage === 'drain' ? stalled.promise : undefined,
        close: () => { events.push('store closed'); return stage === 'store' ? stalled.promise : undefined } }),
      server: { close: callback => { events.push('http closed'); if (stage === 'http') stalled.promise.then(() => callback()); else callback() } },
    })
    await lifecycle.shutdown()
    assert.equal(events.at(-1), 'exit 1')
    assert.match(events.at(-2), /deadline exceeded/)
    if (stage !== 'store') assert.equal(events.includes('store closed'), false)
    stalled.resolve()
    await turn()
    assert.equal(events.filter(event => event.startsWith('exit')).length, 1)
    if (stage !== 'store') assert.equal(events.includes('store closed'), false)
  })
}

test('observer created during shutdown is drained/closed without starting a cycle', async () => {
  const startup = deferred()
  let observer = null
  const { lifecycle, events } = lifecycleFixture({ getObserver: () => observer, waitForStartup: () => startup.promise })
  const shutdown = lifecycle.shutdown()
  observer = { stop: async () => events.push('late observer drained'), close: async () => events.push('store closed') }
  startup.resolve()
  await shutdown
  assert.deepEqual(events.slice(0, 4), ['startup disabled', 'late observer drained', 'http closed', 'store closed'])
})

test('shutdown failures have nonzero exit and never log arbitrary error contents', async () => {
  const { lifecycle, events } = lifecycleFixture({ waitForStartup: async () => { throw new Error('sensitive fixture') } })
  await lifecycle.shutdown()
  assert.equal(events.at(-1), 'exit 1')
  assert.equal(events.some(event => event.includes('sensitive fixture')), false)
  assert.equal(events.includes('store closed'), false)
})

test('entrypoint gates startup/retries and wires the tested signal lifecycle', () => {
  const source = readFileSync(new URL('./paperObserver.js', import.meta.url), 'utf8')
  assert.match(source, /if \(observer \|\| lifecycle\.isStopping\(\)\) return/)
  assert.match(source, /if \(!lifecycle\.isStopping\(\)\) observer\.start\(\)/)
  assert.match(source, /if \(lifecycle\.isStopping\(\)\) throw error/)
  assert.match(source, /createPaperObserverShutdown\(\{/)
  assert.match(source, /waitForStartup: \(\) => startupPromise/)
})
