import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createShadowStore } from './shadowForwardStore.js'
import { createShadowObserver } from './shadowForwardObserver.js'

// Transactional fake: uses only memory and deliberately rejects unexpected SQL.
function fixture() {
  let data = { definition: { id: 'test', symbols: ['AAPL'] }, checkpoint: {}, candles: [], rows: [] }
  const calls = []
  const clients = []
  let failure = null, locked = true, owner = null, active = 0, checkedOut = 0, emitFailure = null
  function connect() {
    let pending, readOnly = false, inTransaction = false
    const client = new EventEmitter()
    clients.push(client); checkedOut++
    const finish = () => { if (inTransaction) active--; inTransaction = false; if (owner === client) owner = null }
    Object.assign(client, {
    release(error) { finish(); checkedOut--; client.releaseError = error; calls.push('RELEASE') },
    async query(sql, values = []) {
      calls.push(sql)
      if (emitFailure && sql.startsWith(emitFailure.prefix)) {
        const { stall } = emitFailure; emitFailure = null
        queueMicrotask(() => client.emit('error', new Error('synthetic client disconnect')))
        if (stall) return new Promise(() => {})
      }
      if (failure && sql.startsWith(failure)) throw new Error('synthetic storage failure')
      if (sql === 'BEGIN') { pending = structuredClone(data); active++; inTransaction = true; return { rows: [] } }
      if (sql === 'COMMIT') { if (!readOnly) data = pending; finish(); return { rows: [] } }
      if (sql === 'ROLLBACK') { finish(); return { rows: [] } }
      if (sql.startsWith('SET TRANSACTION')) { readOnly = true; return { rows: [] } }
      if (sql.startsWith('SELECT pg_try')) { const acquired = locked && (!owner || owner === client); if (acquired) owner = client; return { rows: [{ locked: acquired }] } }
      if (sql.startsWith('SELECT pg_advisory') || sql.includes('CREATE TABLE IF NOT EXISTS')) return { rows: [] }
      if (sql.startsWith('SELECT definition, checkpoint')) return { rows: [{ definition: pending.definition, checkpoint: pending.checkpoint }] }
      if (sql.startsWith('SELECT definition FROM')) return { rows: pending.definition ? [{ definition: pending.definition }] : [] }
      if (sql.startsWith('SELECT snapshot')) return { rows: pending.rows }
      if (sql.startsWith('SELECT symbol, candle')) return { rows: pending.candles }
      if (sql.startsWith('INSERT INTO research_shadow_tracking')) { pending.definition = JSON.parse(values[1]); return { rows: [] } }
      if (sql.startsWith('INSERT INTO research_shadow_candles')) {
        if (pending.candles.some((r) => r.symbol === values[1] && r.candle.timestamp === values[2])) throw new Error('duplicate candle key')
        pending.candles.push({ symbol: values[1], candle: JSON.parse(values[3]) }); return { rows: [] }
      }
      if (sql.startsWith('INSERT INTO research_shadow_occurrences')) {
        if (pending.rows.some((r) => r.snapshot.id === values[1])) throw new Error('duplicate identity')
        pending.rows.push({ snapshot: JSON.parse(values[2]), state: values[3], theoretical: JSON.parse(values[4]), outcome: JSON.parse(values[5]) }); return { rows: [] }
      }
      if (sql.startsWith('UPDATE research_shadow_occurrences')) {
        const row = pending.rows.find((r) => r.snapshot.id === values[0]); row.state = values[1]; row.theoretical = JSON.parse(values[2]); row.outcome = JSON.parse(values[3]); return { rows: [] }
      }
      if (sql.startsWith('UPDATE research_shadow_tracking')) { pending.checkpoint = JSON.parse(values[1]); return { rows: [] } }
      throw new Error(`Unexpected fake query: ${sql}`)
    },
    })
    return client
  }
  const pool = { on() {}, connect: async () => connect(), end: async () => {} }
  return { pool, calls, clients, active: () => active, checkedOut: () => checkedOut,
    data: () => structuredClone(data), mutate: (fn) => fn(data),
    disconnect: (prefix, stall = false) => { emitFailure = { prefix, stall } },
    fail: (prefix) => { failure = prefix }, lock: (value) => { locked = value }, uninitialized: () => { data.definition = null } }
}
const occurrence = { id: 'immutable-id', symbol: 'AAPL', qualification: { score: 78, researchEligible: true }, state: 'pending', theoretical: null, outcome: null }
const update = (rows = [occurrence]) => ({ newCandles: [{ symbol: 'AAPL', candle: { timestamp: '2026-10-23T14:00:00Z' } }], occurrences: rows, checkpoint: { lastSuccessfulCycle: '2026-10-23T15:01:00Z' } })

test('read path is a coherent read-only transaction and performs no initialization or writes', async () => {
  const f = fixture(), store = createShadowStore({ pool: f.pool })
  const snapshot = await store.read('test')
  assert.deepEqual(snapshot.occurrences, [])
  assert.deepEqual(snapshot.raw, { AAPL: [] })
  assert.ok(f.calls.includes('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY'))
  assert.ok(f.calls.indexOf('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY') < f.calls.findIndex((sql) => sql.startsWith('SELECT definition')))
  assert.ok(f.calls.every((sql) => !/CREATE|INSERT|UPDATE|DELETE/.test(sql)))
})

test('fresh tracking hydrates every frozen symbol with an empty candle array', async () => {
  const f = fixture(), store = createShadowStore({ pool: f.pool })
  f.mutate((data) => { data.definition.symbols = ['QQQ', 'SPY'] })
  const snapshot = await store.read('test')
  assert.deepEqual(snapshot.tracking.symbols, ['QQQ', 'SPY'])
  assert.deepEqual(snapshot.raw, { QQQ: [], SPY: [] })
  assert.deepEqual(Object.keys(snapshot.raw), snapshot.tracking.symbols)
  assert.ok(f.calls.every((sql) => !/CREATE|INSERT|UPDATE|DELETE/.test(sql)))
})

test('read preserves populated candles while hydrating empty symbols and invents no keys', async () => {
  const f = fixture(), store = createShadowStore({ pool: f.pool })
  const candle = { timestamp: '2026-10-23T14:00:00Z', close: 100 }
  f.mutate((data) => {
    data.definition.symbols = ['QQQ', 'SPY']
    data.candles = [{ symbol: 'SPY', candle }]
  })
  const snapshot = await store.read('test')
  assert.deepEqual(snapshot.raw, { QQQ: [], SPY: [candle] })
  assert.deepEqual(Object.keys(snapshot.raw), ['QQQ', 'SPY'])
})

test('stored candles outside the frozen universe fail closed without creating a raw key', async () => {
  const f = fixture(), store = createShadowStore({ pool: f.pool })
  f.mutate((data) => { data.candles = [{ symbol: 'MSFT', candle: { timestamp: '2026-10-23T14:00:00Z' } }] })
  await assert.rejects(store.read('test'), /outside the frozen shadow universe/)
  assert.ok(f.calls.every((sql) => !/CREATE|INSERT|UPDATE|DELETE/.test(sql)))
})

test('atomic occurrence, candles and checkpoint round-trip; restart recovers pending and resolves once', async () => {
  const f = fixture(), first = createShadowStore({ pool: f.pool })
  await first.cycle('test', async () => update())
  const restarted = createShadowStore({ pool: f.pool })
  assert.deepEqual((await restarted.read('test')).occurrences, [occurrence])
  const resolved = { ...occurrence, state: 'resolved', theoretical: { entryPrice: 100 }, outcome: { rawR: -1 } }
  await restarted.cycle('test', async () => ({ ...update([resolved]), newCandles: [] }))
  await restarted.cycle('test', async (before) => ({ ...update(before.occurrences), newCandles: [] }))
  const snapshot = await restarted.read('test')
  assert.deepEqual(snapshot.occurrences, [resolved])
  assert.equal(f.calls.filter((sql) => sql.startsWith('INSERT INTO research_shadow_occurrences')).length, 1)
  assert.equal(f.calls.filter((sql) => sql.startsWith('UPDATE research_shadow_occurrences')).length, 1)
})

test('failed persistence rolls back observations, candle writes and checkpoint together', async () => {
  const f = fixture(), before = f.data(), store = createShadowStore({ pool: f.pool })
  f.fail('UPDATE research_shadow_tracking')
  await assert.rejects(store.cycle('test', async () => update()), /synthetic/)
  assert.deepEqual(f.data(), before)
  assert.ok(f.calls.includes('ROLLBACK'))
  assert.equal(f.calls.at(-1), 'RELEASE')
})

test('qualification and terminal outcomes cannot be silently overwritten', async () => {
  const f = fixture(), store = createShadowStore({ pool: f.pool })
  await store.cycle('test', async () => update())
  await assert.rejects(store.cycle('test', async () => ({ ...update([{ ...occurrence, qualification: { score: 100 } }]), newCandles: [] })), /immutable/)
  assert.deepEqual((await store.read('test')).occurrences, [occurrence])
  const resolved = { ...occurrence, state: 'resolved', outcome: { rawR: 2 } }
  await store.cycle('test', async () => ({ ...update([resolved]), newCandles: [] }))
  await assert.rejects(store.cycle('test', async () => ({ ...update([{ ...resolved, outcome: { rawR: 10 } }]), newCandles: [] })), /immutable/)
  assert.deepEqual((await store.read('test')).occurrences, [resolved])
})

test('write-lock contention skips persistence after disconnected preparation', async () => {
  const f = fixture(), store = createShadowStore({ pool: f.pool })
  f.lock(false)
  let called = false
  assert.deepEqual(await store.cycle('test', async () => { called = true }), { status: 'BUSY' })
  assert.equal(called, true)
  assert.ok(f.calls.every((s) => !/INSERT|UPDATE/.test(s)))
})

test('provider work runs after the read transaction commits and releases its connection', async () => {
  const f = fixture(), store = createShadowStore({ pool: f.pool })
  await store.cycle('test', async () => {
    assert.equal(f.active(), 0); assert.equal(f.checkedOut(), 0)
    assert.deepEqual(f.calls.slice(-2), ['COMMIT', 'RELEASE'])
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(f.checkedOut(), 0)
    return update()
  })
  assert.equal(f.data().candles.length, 1)
  assert.equal(f.data().rows.length, 1)
  assert.deepEqual(f.data().checkpoint, update().checkpoint)
  assert.equal(f.active(), 0); assert.equal(f.checkedOut(), 0)
})

for (const field of ['definition', 'checkpoint', 'candles', 'rows']) test(`changed persisted ${field} prevents stale writes`, async () => {
  const f = fixture(), store = createShadowStore({ pool: f.pool })
  const result = await store.cycle('test', async () => {
    f.mutate((data) => {
      if (field === 'definition') data.definition.version = 2
      if (field === 'checkpoint') data.checkpoint.winner = true
      if (field === 'candles') data.candles.push({ symbol: 'AAPL', candle: { timestamp: 'new' } })
      if (field === 'rows') data.rows.push({ snapshot: { id: 'other' }, state: 'pending', theoretical: null, outcome: null })
    })
    return update()
  })
  assert.deepEqual(result, { status: 'BUSY' })
  assert.ok(f.calls.every((sql) => !/INSERT|UPDATE/.test(sql)))
})

test('two stores preparing the same snapshot allow only the first commit', async () => {
  const f = fixture(), first = createShadowStore({ pool: f.pool }), second = createShadowStore({ pool: f.pool })
  let release, entered
  const gate = new Promise((resolve) => { release = resolve })
  const ready = new Promise((resolve) => { entered = resolve })
  const slow = first.cycle('test', async () => { entered(); await gate; return update() })
  await ready
  try { await second.cycle('test', async () => update()) } finally { release() }
  assert.deepEqual(await slow, { status: 'BUSY' })
  assert.equal(f.data().rows.length, 1); assert.equal(f.data().candles.length, 1)
  assert.equal(f.calls.filter((sql) => sql.startsWith('UPDATE research_shadow_tracking')).length, 1)
})

test('mutating action input cannot bypass qualification or theoretical-entry immutability', async () => {
  const f = fixture(), store = createShadowStore({ pool: f.pool })
  const pending = { ...occurrence, theoretical: { entryPrice: 100 } }
  await store.cycle('test', async () => update([pending]))
  for (const change of [(row) => { row.qualification.score = 100 }, (row) => { row.theoretical.entryPrice = 99 }]) {
    await assert.rejects(store.cycle('test', async (before) => {
      change(before.occurrences[0]); return { ...update(before.occurrences), newCandles: [] }
    }), /immutable/)
    assert.deepEqual((await store.read('test')).occurrences, [pending])
  }
})

for (const stall of [false, true]) test(`checked-out client error rejects safely (query stalled: ${stall})`, { timeout: 2000 }, async () => {
  const f = fixture(), store = createShadowStore({ pool: f.pool })
  f.disconnect('SELECT definition, checkpoint', stall)
  await assert.rejects(store.read('test'), /synthetic client disconnect/)
  assert.ok(f.clients[0].releaseError)
  assert.equal(f.clients[0].listenerCount('error'), 0)
  assert.equal(f.checkedOut(), 0)
  assert.deepEqual((await store.read('test')).occurrences, [])
})

test('client loss during persistence discards the connection and preserves committed state', async () => {
  const f = fixture(), before = f.data(), store = createShadowStore({ pool: f.pool })
  f.disconnect('UPDATE research_shadow_tracking', true)
  await assert.rejects(store.cycle('test', async () => update()), /synthetic client disconnect/)
  assert.deepEqual(f.data(), before)
  assert.ok(f.clients.at(-1).releaseError)
  await store.cycle('test', async () => update())
  assert.equal(f.data().rows.length, 1)
})

test('client errors reach the existing observer ERROR path and a later cycle can recover', async () => {
  const f = fixture(), store = createShadowStore({ pool: f.pool })
  f.disconnect('SELECT definition, checkpoint', true)
  const observer = createShadowObserver({ store, trackingId: 'test' })
  assert.equal((await observer.processOnce()).status, 'ERROR')
  assert.equal(observer.status().consecutiveFailures, 1)
  assert.doesNotMatch(observer.status().message, /synthetic client disconnect/)
  await store.cycle('test', async () => update())
  assert.equal(f.data().rows.length, 1)
})

test('provider failure opens no write transaction and preserves persisted state', async () => {
  const f = fixture(), before = f.data(), store = createShadowStore({ pool: f.pool })
  await assert.rejects(store.cycle('test', async () => { throw new Error('synthetic provider failure') }), /provider failure/)
  assert.equal(f.calls.filter((sql) => sql === 'BEGIN').length, 1)
  assert.equal(f.checkedOut(), 0)
  assert.deepEqual(f.data(), before)
})

test('duplicate source candle cannot replace a frozen candle or advance checkpoint', async () => {
  const f = fixture(), store = createShadowStore({ pool: f.pool })
  await store.cycle('test', async () => update())
  const before = f.data()
  await assert.rejects(store.cycle('test', async () => ({ ...update(), checkpoint: { changed: true } })), /duplicate candle key/)
  assert.deepEqual(f.data(), before)
})

test('initialization client error rejects and releases instead of emitting unhandled error', async () => {
  const f = fixture(), store = createShadowStore({ pool: f.pool })
  f.uninitialized(); f.disconnect('INSERT INTO research_shadow_tracking', true)
  await assert.rejects(store.initialize({ id: 'test', symbols: ['AAPL'] }), /synthetic client disconnect/)
  assert.equal(f.data().definition, null)
  assert.equal(f.checkedOut(), 0)
  await store.initialize({ id: 'test', symbols: ['AAPL'] })
  assert.equal(f.data().definition.id, 'test')
})

test('explicit initialization is transactional and refuses redefinition of existing identity', async () => {
  const f = fixture(), store = createShadowStore({ pool: f.pool })
  await assert.rejects(store.initialize({ id: 'test' }), /already exists/)
  f.uninitialized(); f.fail('INSERT INTO research_shadow_tracking')
  await assert.rejects(store.initialize({ id: 'test' }), /synthetic/)
  assert.equal(f.data().definition, null)
  f.fail(null)
  await store.initialize({ id: 'test', symbols: ['MSFT'] })
  assert.deepEqual(f.data().definition, { id: 'test', symbols: ['MSFT'] })
  assert.ok(f.calls.some((s) => s.includes('pg_advisory_xact_lock')))
})
