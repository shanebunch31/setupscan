import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { isDeepStrictEqual } from 'node:util'
import { test } from 'node:test'
import { createPostgresPaperStore } from './postgresPaperStore.js'
import { createPaperObserver } from './paperObserverCore.js'

class RetryablePool extends EventEmitter {
  constructor() {
    super()
    this.schemaAttempts = 0
  }

  async query(text) {
    if (text.startsWith('BEGIN') || text.startsWith('COMMIT') || text.startsWith('ROLLBACK')) return { rows: [] }
    if (text.includes('pg_advisory_xact_lock')) return { rows: [] }
    if (text.includes('CREATE TABLE')) {
      this.schemaAttempts += 1
      if (this.schemaAttempts === 1) throw new Error('temporary connection failure')
      return { rows: [] }
    }
    if (text.includes('SELECT state')) return { rows: [] }
    throw new Error(`Unexpected query: ${text}`)
  }
  async connect() { return { query: this.query.bind(this), release: () => {} } }
}

test('a transient initialization failure can recover on the next store operation', async () => {
  const pool = new RetryablePool()
  const store = createPostgresPaperStore({ pool, onPoolError: () => {} })

  await assert.rejects(store.load(), /temporary connection failure/)
  assert.deepEqual(await store.load(), { trades: [] })
  assert.equal(pool.schemaAttempts, 2)
})

test('idle PostgreSQL pool errors are captured instead of becoming unhandled process errors', () => {
  const pool = new RetryablePool()
  const reported = []
  const store = createPostgresPaperStore({ pool, onPoolError: (error) => reported.push(error.message) })

  pool.emit('error', new Error('Connection terminated unexpectedly'))

  assert.deepEqual(reported, ['Connection terminated unexpectedly'])
  assert.equal(store.getLastConnectionError().message, 'Connection terminated unexpectedly')
  assert.ok(store.getLastConnectionError().at)
})

class TransactionClientPool extends EventEmitter {
  constructor() { super(); this.clients = []; this.onQuery = null }
  async query(text) {
    assert.match(text, /^SELECT state/)
    return { rows: [] }
  }
  async connect() {
    const client = new EventEmitter()
    client.queries = []
    client.releases = []
    client.query = async (text, values) => {
      client.queries.push(text)
      return this.onQuery?.(client, text, values) ?? { rows: text.startsWith('INSERT INTO paper_observer_state') ? [{ id: 1 }] : [] }
    }
    client.release = (error) => {
      assert.equal(client.listenerCount('error'), 1, 'client remains protected through release')
      client.releases.push(error)
    }
    this.clients.push(client)
    return client
  }
}

const transactionState = { trades: [{ symbol: 'SPY', signalTimestamp: '2026-01-02T15:00:00Z' }] }
const transactionMetadata = { processedCandles: [{ symbol: 'SPY', timestamp: '2026-01-02T16:00:00Z' }] }

for (const phase of ['BEGIN', 'INSERT INTO paper_observer_state', 'COMMIT']) {
  test(`checked-out connection error at ${phase} rejects save and discards the client`, { timeout: 2000 }, async () => {
    const pool = new TransactionClientPool()
    const store = createPostgresPaperStore({ pool })
    await store.load()
    const failure = new Error('Connection terminated unexpectedly')
    let finishQuery
    pool.onQuery = (client, text) => {
      if (text.startsWith(phase)) {
        // Unlike a query rejection, an unhandled EventEmitter error would crash
        // the process. Also ensure a query that never settles cannot trap save().
        queueMicrotask(() => client.emit('error', failure))
        return new Promise((resolve) => { finishQuery = resolve })
      }
    }

    await assert.rejects(store.save(transactionState, transactionMetadata), (error) => error === failure)
    const client = pool.clients.at(-1)
    assert.deepEqual(client.releases, [failure])
    assert.equal(client.listenerCount('error'), 0, 'transaction listener is removed after release')
    assert.equal(client.queries.includes('ROLLBACK'), false, 'do not query a known broken connection')
    assert.equal(store.getLastConnectionError().message, failure.message)
    const queriesAtFailure = [...client.queries]
    finishQuery({ rows: [] })
    await new Promise((resolve) => setImmediate(resolve))
    assert.deepEqual(client.queries, queriesAtFailure, 'late query completion cannot continue writes')
  })
}

test('connection error between transaction queries prevents the next write', async () => {
  const pool = new TransactionClientPool()
  const store = createPostgresPaperStore({ pool })
  await store.load()
  const failure = new Error('connection lost between queries')
  pool.onQuery = (client, text) => {
    if (text.startsWith('INSERT INTO paper_observer_state')) {
      queueMicrotask(() => client.emit('error', failure))
      return { rows: [] }
    }
  }
  await assert.rejects(store.save(transactionState), (error) => error === failure)
  const client = pool.clients.at(-1)
  assert.equal(client.queries.some((text) => text.startsWith('INSERT INTO paper_trades')), false)
  assert.deepEqual(client.releases, [failure])
})

for (const phase of ['BEGIN', 'INSERT INTO paper_trades', 'COMMIT']) {
  test(`query rejection at ${phase} preserves rollback and appropriate client disposal`, async () => {
    const pool = new TransactionClientPool()
    const store = createPostgresPaperStore({ pool })
    await store.load()
    const failure = new Error('query failed')
    pool.onQuery = (_, text) => { if (text.startsWith(phase)) throw failure }
    await assert.rejects(store.save(transactionState, transactionMetadata), (error) => error === failure)
    const client = pool.clients.at(-1)
    assert.equal(client.queries.includes('ROLLBACK'), phase !== 'BEGIN')
    assert.deepEqual(client.releases, [phase === 'INSERT INTO paper_trades' ? undefined : failure])
    assert.equal(client.listenerCount('error'), 0)
    if (phase !== 'COMMIT') assert.equal(client.queries.includes('COMMIT'), false)
  })
}

test('rollback failure discards the connection and preserves the original query error', async () => {
  const pool = new TransactionClientPool()
  const store = createPostgresPaperStore({ pool })
  await store.load()
  const failure = new Error('write failed')
  const rollbackFailure = new Error('rollback failed')
  pool.onQuery = (_, text) => {
    if (text.startsWith('INSERT INTO paper_trades')) throw failure
    if (text === 'ROLLBACK') throw rollbackFailure
  }
  await assert.rejects(store.save(transactionState), (error) => error === failure)
  assert.deepEqual(pool.clients.at(-1).releases, [rollbackFailure])
})

test('connection error during rollback rejects promptly and discards the client', { timeout: 2000 }, async () => {
  const pool = new TransactionClientPool()
  const store = createPostgresPaperStore({ pool })
  await store.load()
  const failure = new Error('connection lost during rollback')
  pool.onQuery = (client, text) => {
    if (text.startsWith('INSERT INTO paper_trades')) throw new Error('write failed')
    if (text === 'ROLLBACK') {
      queueMicrotask(() => client.emit('error', failure))
      return new Promise(() => {})
    }
  }
  await assert.rejects(store.save(transactionState), (error) => error === failure)
  assert.deepEqual(pool.clients.at(-1).releases, [failure])
})

test('initialization connection errors reject safely and allow a fresh-client retry', async () => {
  const pool = new TransactionClientPool()
  const store = createPostgresPaperStore({ pool })
  const failure = new Error('initialization connection lost')
  pool.onQuery = (client, text) => { if (text.includes('CREATE TABLE')) client.emit('error', failure) }
  await assert.rejects(store.init(), (error) => error === failure)
  assert.deepEqual(pool.clients[0].releases, [failure])
  pool.onQuery = null
  await store.load()
  assert.equal(pool.clients.length, 2)
  assert.deepEqual(pool.clients[1].releases, [undefined])
  assert.equal(pool.clients[1].listenerCount('error'), 0)
})

test('successful snapshot save keeps all writes inside one transaction and releases normally', async () => {
  const pool = new TransactionClientPool()
  const store = createPostgresPaperStore({ pool })
  await store.load()
  await store.save(transactionState, transactionMetadata)
  const client = pool.clients.at(-1)
  assert.equal(client.queries.length, 5)
  assert.equal(client.queries[0], 'BEGIN')
  assert.match(client.queries[1], /^INSERT INTO paper_observer_state/)
  assert.match(client.queries[2], /^INSERT INTO paper_trades/)
  assert.match(client.queries[3], /^INSERT INTO paper_processed_candles/)
  assert.equal(client.queries[4], 'COMMIT')
  assert.deepEqual(client.releases, [undefined])
  assert.equal(client.listenerCount('error'), 0)
})

// Models PostgreSQL's conflicting-row wait followed by predicate recheck. All
// state, trade and checkpoint writes are staged until COMMIT, never real SQL.
class SnapshotPool extends EventEmitter {
  constructor(state = null) {
    super()
    this.persisted = { state: structuredClone(state), trades: {}, checkpoints: [] }
    this.tail = Promise.resolve()
    this.failTrade = false
    this.loseCommitReply = false
  }
  async query(text) {
    assert.match(text, /^SELECT state/)
    return { rows: this.persisted.state === null ? [] : [{ state: structuredClone(this.persisted.state) }] }
  }
  async connect() {
    const client = new EventEmitter()
    let staged
    let unlock
    const finish = () => { staged = undefined; unlock?.(); unlock = undefined }
    client.query = async (text, values = []) => {
      if (text === 'BEGIN' || text.includes('CREATE TABLE') || text.includes('pg_advisory_xact_lock')) return { rows: [] }
      if (text === 'ROLLBACK') { finish(); return { rows: [] } }
      if (text === 'COMMIT') {
        if (staged) this.persisted = staged
        finish()
        if (this.loseCommitReply) { this.loseCommitReply = false; throw new Error('commit acknowledgement lost') }
        return { rows: [] }
      }
      if (text.startsWith('INSERT INTO paper_observer_state') || text.startsWith('UPDATE paper_observer_state')) {
        const previous = this.tail
        this.tail = new Promise((resolve) => { unlock = resolve })
        await previous
        staged = structuredClone(this.persisted)
        let matches
        if (text.startsWith('INSERT')) {
          assert.match(text, /ON CONFLICT \(id\) DO NOTHING RETURNING id/)
          matches = staged.state === null
        } else {
          assert.match(text, /WHERE id = 1 AND state = \$6::jsonb RETURNING id/)
          matches = staged.state !== null && isDeepStrictEqual(staged.state, JSON.parse(values[5]))
        }
        if (!matches) return { rows: [] }
        staged.state = JSON.parse(values[0])
        return { rows: [{ id: 1 }] }
      }
      if (text.startsWith('INSERT INTO paper_trades')) {
        if (this.failTrade) throw new Error('trade write failed')
        staged.trades[`${values[0]}:${values[1]}`] = structuredClone(values[2])
        return { rows: [] }
      }
      if (text.startsWith('INSERT INTO paper_processed_candles')) {
        staged.checkpoints.push(values)
        return { rows: [] }
      }
      throw new Error(`Unexpected query: ${text}`)
    }
    client.release = () => finish()
    return client
  }
}

const openSnapshot = {
  trades: [{ id: 'SPY:2026-01-02T15:00:00Z', symbol: 'SPY', signalTimestamp: '2026-01-02T15:00:00Z', status: 'open', entryPrice: 100, stopPrice: 99.5, highestPrice: 100, trailingStopActive: false, holdingBars: 0 }],
  observer: { processedCandles: { SPY: '2026-01-02T16:00:00Z' } },
}

test('save requires an explicit load; read-only dashboard reads cannot authorize a writer', async () => {
  const pool = new SnapshotPool(openSnapshot)
  const store = createPostgresPaperStore({ pool })
  await store.read()
  await assert.rejects(store.save(openSnapshot), { code: 'PAPER_STATE_NOT_LOADED' })
  assert.deepEqual(pool.persisted.state, openSnapshot)
})

test('two first writers contend atomically and the loser cannot replace the winning snapshot', async () => {
  const pool = new SnapshotPool()
  const first = createPostgresPaperStore({ pool })
  const second = createPostgresPaperStore({ pool })
  await Promise.all([first.load(), second.load()])
  const results = await Promise.allSettled([first.save(openSnapshot), second.save({ trades: [] })])
  assert.equal(results[0].status, 'fulfilled')
  assert.equal(results[1].reason.code, 'PAPER_STATE_CONFLICT')
  assert.deepEqual(pool.persisted.state, openSnapshot)
})

test('stale writer cannot undo newer trailing state or reopen a closed trade, even after dashboard reads', async () => {
  const pool = new SnapshotPool(openSnapshot)
  const current = createPostgresPaperStore({ pool })
  const stale = createPostgresPaperStore({ pool })
  const updated = await current.load()
  const old = await stale.load()
  Object.assign(updated.trades[0], { highestPrice: 102, stopPrice: 101.694, trailingStopActive: true, holdingBars: 5 })
  updated.observer.processedCandles.SPY = '2026-01-02T21:00:00Z'
  await current.save(updated, transactionMetadata)
  const trailing = structuredClone(pool.persisted)
  await assert.rejects(stale.save(old), { code: 'PAPER_STATE_CONFLICT' })
  assert.deepEqual(pool.persisted, trailing)
  Object.assign(updated.trades[0], { status: 'closed', exitReason: 'Trailing Stop', exitPrice: 101.694 })
  await current.save(updated)
  const closed = structuredClone(pool.persisted)
  assert.equal((await stale.read()).trades[0].status, 'closed')
  await assert.rejects(stale.save(old, transactionMetadata), { code: 'PAPER_STATE_CONFLICT' })
  assert.deepEqual(pool.persisted, closed, 'neither snapshot, trade rows nor checkpoint rows change')
  const restarted = createPostgresPaperStore({ pool })
  const recovered = await restarted.load()
  assert.deepEqual(recovered, updated)
  recovered.observer.status = 'IDLE'
  await restarted.save(recovered)
  assert.equal(pool.persisted.state.trades[0].status, 'closed')
})

test('simultaneous updates from the same loaded state admit only one changed snapshot', async () => {
  const pool = new SnapshotPool(openSnapshot)
  const stores = [createPostgresPaperStore({ pool }), createPostgresPaperStore({ pool })]
  const states = await Promise.all(stores.map((store) => store.load()))
  states[0].trades[0].holdingBars = 1
  states[1].trades[0].holdingBars = 2
  const results = await Promise.allSettled(stores.map((store, i) => store.save(states[i])))
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
  assert.equal(results.find((result) => result.status === 'rejected').reason.code, 'PAPER_STATE_CONFLICT')
  assert.deepEqual(pool.persisted.state, states[0])
})

test('failed trade persistence rolls back the comparison write and permits a valid retry', async () => {
  const pool = new SnapshotPool(openSnapshot)
  const store = createPostgresPaperStore({ pool })
  const state = await store.load()
  state.trades[0].holdingBars = 1
  pool.failTrade = true
  await assert.rejects(store.save(state, transactionMetadata), /trade write failed/)
  assert.deepEqual(pool.persisted, { state: openSnapshot, trades: {}, checkpoints: [] })
  pool.failTrade = false
  await store.save(state, transactionMetadata)
  assert.deepEqual(pool.persisted.state, state)
})

test('an uncertain commit does not rebase the writer or let it overwrite persisted progress', async () => {
  const pool = new SnapshotPool(openSnapshot)
  const store = createPostgresPaperStore({ pool })
  const state = await store.load()
  state.trades[0].holdingBars = 1
  pool.loseCommitReply = true
  await assert.rejects(store.save(state), /commit acknowledgement lost/)
  const committed = structuredClone(pool.persisted)
  await assert.rejects(store.save(openSnapshot), { code: 'PAPER_STATE_CONFLICT' })
  assert.deepEqual(pool.persisted, committed)
})

test('two observer instances surface contention as ERROR and restart from the winner safely', async () => {
  const pool = new SnapshotPool()
  const errors = []
  const options = {
    environment: {},
    now: () => new Date('2026-09-20T14:30:00Z'),
    symbolUniverse: { getSymbols: async () => ['SPY'] },
    fetchBars: async () => { throw new Error('closed-session fixture must not fetch') },
    onError: (error) => errors.push(error),
  }
  const first = await createPaperObserver({ ...options, store: createPostgresPaperStore({ pool }) })
  const second = await createPaperObserver({ ...options, store: createPostgresPaperStore({ pool }) })
  const [winner, loser] = await Promise.all([first.processOnce(), second.processOnce()])
  assert.equal(winner.status, 'IDLE')
  assert.equal(loser.status, 'ERROR')
  assert.match(loser.currentError, /state changed in another writer/)
  assert.equal(errors.length, 1)
  const persisted = structuredClone(pool.persisted)
  assert.equal((await second.processOnce()).status, 'ERROR', 'error recording/retries cannot overwrite the winner')
  assert.deepEqual(pool.persisted, persisted)
  const restarted = await createPaperObserver({ ...options, store: createPostgresPaperStore({ pool }) })
  assert.equal((await restarted.processOnce()).status, 'IDLE')
  assert.deepEqual(restarted.getState().trades, persisted.state.trades)
})

test('read-only observer snapshot access does not initialize or modify the schema', async () => {
  const queries = []
  const pool = new RetryablePool()
  pool.query = async (text) => {
    queries.push(text)
    if (text.includes('SELECT state')) return { rows: [{ state: { trades: [] } }] }
    throw new Error(`Unexpected query: ${text}`)
  }
  const store = createPostgresPaperStore({ pool, onPoolError: () => {} })

  assert.deepEqual(await store.read(), { trades: [] })
  assert.equal(queries.length, 1)
  assert.match(queries[0], /^SELECT state/)
})

test('a read-only observer-symbol check reports an uninitialized database when the new table is absent', async () => {
  const pool = new RetryablePool()
  pool.query = async () => {
    const error = new Error('relation does not exist')
    error.code = '42P01'
    throw error
  }
  const store = createPostgresPaperStore({ pool, onPoolError: () => {} })

  assert.deepEqual(await store.readObserverSymbols(), { initialized: false, symbols: [] })
})

class SymbolPool extends EventEmitter {
  constructor() { super(); this.initialized = false; this.symbols = new Set(); this.queries = [] }
  async query(text, values = []) {
    this.queries.push({ text, values })
    if (text.includes('CREATE TABLE')) return { rows: [] }
    if (text.startsWith('BEGIN') || text.startsWith('COMMIT') || text.startsWith('ROLLBACK')) return { rows: [] }
    if (text.includes('pg_advisory_xact_lock')) return { rows: [] }
    if (text.includes('SELECT initialized_at')) return { rows: this.initialized ? [{ initialized_at: '2026-01-01T00:00:00.000Z' }] : [] }
    if (text.includes('INSERT INTO paper_observer_symbol_universe')) { this.initialized = true; return { rows: [] } }
    if (text.includes('SELECT symbol FROM paper_observer_symbols')) return { rows: [...this.symbols].sort().map((symbol) => ({ symbol })) }
    if (text.includes('INSERT INTO paper_observer_symbols')) { this.symbols.add(values[0]); return { rows: [] } }
    if (text.includes('DELETE FROM paper_observer_symbols')) { this.symbols.delete(values[0]); return { rows: [] } }
    throw new Error(`Unexpected query: ${text}`)
  }
  async connect() { return { query: this.query.bind(this), release: () => {} } }
}

test('persisted observer symbols seed once, remain authoritative when empty, and support normalized add/remove', async () => {
  const pool = new SymbolPool()
  const store = createPostgresPaperStore({ pool, onPoolError: () => {} })
  assert.deepEqual(await store.ensureObserverSymbols(['spy', 'QQQ'], 3), ['QQQ', 'SPY'])
  assert.deepEqual(await store.removeObserverSymbol('spy', { seedSymbols: ['IWM'], cap: 3 }), ['QQQ'])
  assert.deepEqual(await store.removeObserverSymbol('QQQ', { seedSymbols: ['IWM'], cap: 3 }), [])
  assert.deepEqual(await store.ensureObserverSymbols(['IWM'], 3), [], 'an initialized empty list remains intentionally empty')
  assert.deepEqual(await store.addObserverSymbol(' amzn ', { seedSymbols: ['IWM'], cap: 3 }), ['AMZN'])
  await assert.rejects(store.addObserverSymbol('bad/symbol', { seedSymbols: [], cap: 3 }), { code: 'INVALID_PAPER_SYMBOL' })
})

test('observer symbol cap blocks additional symbols without changing the persisted list', async () => {
  const pool = new SymbolPool()
  const store = createPostgresPaperStore({ pool, onPoolError: () => {} })
  await store.ensureObserverSymbols(['SPY'], 1)
  await assert.rejects(store.addObserverSymbol('QQQ', { seedSymbols: [], cap: 1 }), { code: 'PAPER_SYMBOL_CAP_EXCEEDED' })
  assert.deepEqual((await store.readObserverSymbols()).symbols, ['SPY'])
})

class TransactionalSymbolPool extends EventEmitter {
  constructor({ initialized = false, symbols = [], fail } = {}) {
    super()
    this.persisted = { schema: initialized, initialized, symbols: new Set(symbols) }
    this.fail = fail
    this.lockTail = Promise.resolve()
  }

  snapshot() {
    return {
      schema: this.persisted.schema,
      initialized: this.persisted.initialized,
      symbols: [...this.persisted.symbols].sort(),
    }
  }

  async query(text) {
    if (text.includes('SELECT initialized_at')) {
      if (!this.persisted.schema) {
        const error = new Error('relation does not exist')
        error.code = '42P01'
        throw error
      }
      return { rows: this.persisted.initialized ? [{ initialized_at: '2026-01-01T00:00:00.000Z' }] : [] }
    }
    if (text.includes('SELECT symbol FROM paper_observer_symbols')) {
      return { rows: [...this.persisted.symbols].sort().map((symbol) => ({ symbol })) }
    }
    throw new Error(`Unexpected pool query: ${text}`)
  }

  async connect() {
    let transaction = null
    let releaseLock = null
    const acquireLock = async () => {
      let unlock
      const next = new Promise((resolve) => { unlock = resolve })
      const previous = this.lockTail
      this.lockTail = next
      await previous
      releaseLock = unlock
      transaction = {
        schema: this.persisted.schema,
        initialized: this.persisted.initialized,
        symbols: new Set(this.persisted.symbols),
      }
    }
    const finish = () => {
      releaseLock?.()
      releaseLock = null
      transaction = null
    }
    return {
      query: async (text, values = []) => {
        if (text === 'BEGIN') {
          transaction = {
            schema: this.persisted.schema,
            initialized: this.persisted.initialized,
            symbols: new Set(this.persisted.symbols),
          }
          return { rows: [] }
        }
        if (text.includes('pg_advisory_xact_lock')) {
          await acquireLock()
          return { rows: [] }
        }
        if (text === 'COMMIT') {
          this.persisted = transaction
          finish()
          return { rows: [] }
        }
        if (text === 'ROLLBACK') {
          finish()
          return { rows: [] }
        }
        if (text.includes('CREATE TABLE')) {
          transaction.schema = true
          return { rows: [] }
        }
        if (text.includes('SELECT initialized_at')) {
          assert.equal(transaction.schema, true, 'schema must exist in this transaction before marker inspection')
          return { rows: transaction.initialized ? [{ initialized_at: '2026-01-01T00:00:00.000Z' }] : [] }
        }
        if (text.includes('SELECT symbol FROM paper_observer_symbols')) {
          return { rows: [...transaction.symbols].sort().map((symbol) => ({ symbol })) }
        }
        if (text.includes('INSERT INTO paper_observer_symbols')) {
          if (this.fail?.({ operation: 'insert', symbol: values[0] })) throw new Error(`insert failed for ${values[0]}`)
          transaction.symbols.add(values[0])
          return { rows: [] }
        }
        if (text.includes('INSERT INTO paper_observer_symbol_universe')) {
          transaction.initialized = true
          return { rows: [] }
        }
        if (text.includes('DELETE FROM paper_observer_symbols')) {
          if (this.fail?.({ operation: 'delete', symbol: values[0] })) throw new Error(`delete failed for ${values[0]}`)
          if (values.length) transaction.symbols.delete(values[0])
          else transaction.symbols.clear()
          return { rows: [] }
        }
        throw new Error(`Unexpected client query: ${text}`)
      },
      release: () => { if (releaseLock) finish() },
    }
  }
}

test('first-time add failure rolls back schema, initial seed, and requested symbol', async () => {
  const pool = new TransactionalSymbolPool({ fail: ({ operation, symbol }) => operation === 'insert' && symbol === 'AMZN' })
  const store = createPostgresPaperStore({ pool, onPoolError: () => {} })

  await assert.rejects(store.addObserverSymbol('AMZN', { seedSymbols: ['SPY', 'QQQ'], cap: 5 }), /insert failed for AMZN/)

  assert.deepEqual(pool.snapshot(), { schema: false, initialized: false, symbols: [] })
})

test('first-time remove failure rolls back schema and initial seed', async () => {
  const pool = new TransactionalSymbolPool({ fail: ({ operation, symbol }) => operation === 'delete' && symbol === 'SPY' })
  const store = createPostgresPaperStore({ pool, onPoolError: () => {} })

  await assert.rejects(store.removeObserverSymbol('SPY', { seedSymbols: ['SPY', 'QQQ'], cap: 5 }), /delete failed for SPY/)

  assert.deepEqual(pool.snapshot(), { schema: false, initialized: false, symbols: [] })
})

test('concurrent first-time initializers converge on one authoritative seed', async () => {
  const pool = new TransactionalSymbolPool()
  const first = createPostgresPaperStore({ pool, onPoolError: () => {} })
  const second = createPostgresPaperStore({ pool, onPoolError: () => {} })

  const results = await Promise.all([
    first.ensureObserverSymbols(['SPY', 'QQQ'], 5),
    second.ensureObserverSymbols(['IWM'], 5),
  ])

  assert.deepEqual(results[0], ['QQQ', 'SPY'])
  assert.deepEqual(results[1], ['QQQ', 'SPY'])
  assert.deepEqual(pool.snapshot(), { schema: true, initialized: true, symbols: ['QQQ', 'SPY'] })
})

test('failed mutation leaves an existing initialized universe unchanged', async () => {
  const pool = new TransactionalSymbolPool({
    initialized: true,
    symbols: ['SPY'],
    fail: ({ operation, symbol }) => operation === 'insert' && symbol === 'AMZN',
  })
  const store = createPostgresPaperStore({ pool, onPoolError: () => {} })

  await assert.rejects(store.addObserverSymbol('AMZN', { seedSymbols: ['QQQ'], cap: 5 }), /insert failed for AMZN/)

  assert.deepEqual(pool.snapshot(), { schema: true, initialized: true, symbols: ['SPY'] })
})


test('PostgreSQL replace is atomic, supports initialized empty, and does not write trade history', async () => {
  const pool = new TransactionalSymbolPool({ initialized: true, symbols: ['SPY'] })
  const store = createPostgresPaperStore({ pool, onPoolError: () => {} })
  // This mock rejects any trade/state/research query; universe operations use only its tables.
  assert.deepEqual(await store.setObserverSymbols([' xyz ', 'ABC', 'XYZ'], { cap: 2 }), ['ABC', 'XYZ'])
  pool.fail = ({ operation, symbol }) => operation === 'insert' && symbol === 'QQQ'
  await assert.rejects(store.setObserverSymbols(['IWM', 'QQQ']), /insert failed/)
  assert.deepEqual((await store.readObserverSymbols()).symbols, ['ABC', 'XYZ'])
  await assert.rejects(store.setObserverSymbols(['IWM', 'SPY'], { cap: 1 }), { code: 'PAPER_SYMBOL_CAP_EXCEEDED' })
  assert.deepEqual((await store.readObserverSymbols()).symbols, ['ABC', 'XYZ'])
  assert.deepEqual(await store.setObserverSymbols([]), [])
  const restarted = createPostgresPaperStore({ pool, onPoolError: () => {} })
  assert.deepEqual(await restarted.readObserverSymbols(), { initialized: true, symbols: [] })
  assert.deepEqual(await restarted.ensureObserverSymbols(() => { throw Error('obsolete seed must not be parsed') }), [])
})

test('PostgreSQL validates legacy seed only before first initialization', async () => {
  const pool = new TransactionalSymbolPool()
  const store = createPostgresPaperStore({ pool, onPoolError: () => {} })
  await assert.rejects(store.ensureObserverSymbols(['SPY', '']), { code: 'INVALID_PAPER_SYMBOL' })
  assert.deepEqual(pool.snapshot(), { schema: false, initialized: false, symbols: [] })
  assert.deepEqual(await store.ensureObserverSymbols(['spy']), ['SPY'])
  assert.deepEqual(await store.ensureObserverSymbols(['QQQ', 'IWM'], 1), ['SPY'])
  assert.deepEqual(await store.addObserverSymbol('XYZ', { seedSymbols: [''], cap: 2 }), ['SPY', 'XYZ'])
  assert.deepEqual(await store.removeObserverSymbol('XYZ', { seedSymbols: [''] }), ['SPY'])
})

test('a universe mutation racing with init on the same store creates schema before inspecting its marker', async () => {
  const pool = new TransactionalSymbolPool()
  const store = createPostgresPaperStore({ pool, onPoolError: () => {} })
  const [symbols] = await Promise.all([
    store.ensureObserverSymbols(['XYZ'], 10),
    store.init(),
  ])
  assert.deepEqual(symbols, ['XYZ'])
  assert.deepEqual(pool.snapshot(), { schema: true, initialized: true, symbols: ['XYZ'] })
})
