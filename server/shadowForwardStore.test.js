import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createShadowStore } from './shadowForwardStore.js'

// Transactional fake: uses only memory and deliberately rejects unexpected SQL.
function fixture() {
  let data = { definition: { id: 'test', symbols: ['AAPL'] }, checkpoint: {}, candles: [], rows: [] }, pending
  const calls = []
  let failure = null, locked = true
  const client = {
    release() { calls.push('RELEASE') },
    async query(sql, values = []) {
      calls.push(sql)
      if (failure && sql.startsWith(failure)) throw new Error('synthetic storage failure')
      if (sql === 'BEGIN') { pending = structuredClone(data); return { rows: [] } }
      if (sql === 'COMMIT') { data = pending; return { rows: [] } }
      if (sql === 'ROLLBACK' || sql.startsWith('SET TRANSACTION')) return { rows: [] }
      if (sql.startsWith('SELECT pg_try')) return { rows: [{ locked }] }
      if (sql.startsWith('SELECT pg_advisory') || sql.includes('CREATE TABLE IF NOT EXISTS')) return { rows: [] }
      if (sql.startsWith('SELECT definition, checkpoint')) return { rows: [{ definition: pending.definition, checkpoint: pending.checkpoint }] }
      if (sql.startsWith('SELECT definition FROM')) return { rows: pending.definition ? [{ definition: pending.definition }] : [] }
      if (sql.startsWith('SELECT snapshot')) return { rows: pending.rows }
      if (sql.startsWith('SELECT symbol, candle')) return { rows: pending.candles }
      if (sql.startsWith('INSERT INTO research_shadow_tracking')) { pending.definition = JSON.parse(values[1]); return { rows: [] } }
      if (sql.startsWith('INSERT INTO research_shadow_candles')) { pending.candles.push({ symbol: values[1], candle: JSON.parse(values[3]) }); return { rows: [] } }
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
  }
  const pool = { on() {}, connect: async () => client, end: async () => {} }
  return { pool, calls, data: () => structuredClone(data), fail: (prefix) => { failure = prefix }, lock: (value) => { locked = value }, uninitialized: () => { data.definition = null } }
}
const occurrence = { id: 'immutable-id', symbol: 'AAPL', qualification: { score: 78, researchEligible: true }, state: 'pending', theoretical: null, outcome: null }
const update = (rows = [occurrence]) => ({ newCandles: [{ symbol: 'AAPL', candle: { timestamp: '2026-10-23T14:00:00Z' } }], occurrences: rows, checkpoint: { lastSuccessfulCycle: '2026-10-23T15:01:00Z' } })

test('read path is a coherent read-only transaction and performs no initialization or writes', async () => {
  const f = fixture(), store = createShadowStore({ pool: f.pool })
  const snapshot = await store.read('test')
  assert.deepEqual(snapshot.occurrences, [])
  assert.ok(f.calls.includes('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY'))
  assert.ok(f.calls.indexOf('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY') < f.calls.findIndex((sql) => sql.startsWith('SELECT definition')))
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
  await assert.rejects(store.cycle('test', async () => update([{ ...occurrence, qualification: { score: 100 } }])), /immutable/)
  assert.deepEqual((await store.read('test')).occurrences, [occurrence])
  const resolved = { ...occurrence, state: 'resolved', outcome: { rawR: 2 } }
  await store.cycle('test', async () => ({ ...update([resolved]), newCandles: [] }))
  await assert.rejects(store.cycle('test', async () => update([{ ...resolved, outcome: { rawR: 10 } }])), /immutable/)
  assert.deepEqual((await store.read('test')).occurrences, [resolved])
})

test('second worker skips locked tracker without fetching or writing anything', async () => {
  const f = fixture(), store = createShadowStore({ pool: f.pool })
  f.lock(false)
  let called = false
  assert.deepEqual(await store.cycle('test', async () => { called = true }), { status: 'BUSY' })
  assert.equal(called, false)
  assert.ok(f.calls.every((s) => !/INSERT|UPDATE/.test(s)))
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
