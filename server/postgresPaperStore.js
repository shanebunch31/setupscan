import { Pool } from 'pg'
import { assertPaperSymbolCap, normalizePaperSymbol, normalizePaperSymbols, resolvePaperSymbolCap } from './paperSymbols.js'

const schema = `
CREATE TABLE IF NOT EXISTS paper_observer_state (id integer PRIMARY KEY CHECK (id = 1), state jsonb NOT NULL, status text NOT NULL, last_successful_update timestamptz, last_processed_candle timestamptz, current_error text);
CREATE TABLE IF NOT EXISTS paper_trades (symbol text NOT NULL, signal_timestamp timestamptz NOT NULL, trade jsonb NOT NULL, PRIMARY KEY (symbol, signal_timestamp));
CREATE TABLE IF NOT EXISTS paper_processed_candles (symbol text NOT NULL, candle_timestamp timestamptz NOT NULL, PRIMARY KEY (symbol, candle_timestamp));
CREATE TABLE IF NOT EXISTS paper_observer_symbol_universe (id integer PRIMARY KEY CHECK (id = 1), initialized_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS paper_observer_symbols (symbol text PRIMARY KEY, enabled boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
`
const PAPER_SYMBOL_UNIVERSE_LOCK_KEY = 1_397_961_558

// Validates DATABASE_URL shape and surfaces a redacted summary; never returns or logs the password itself.
export function describeDatabaseUrl(connectionString) {
  if (!connectionString) throw new Error('DATABASE_URL is not set')
  let parsed
  try {
    parsed = new URL(connectionString)
  } catch {
    throw new Error('DATABASE_URL is not a valid connection URL (expected postgres://user:password@host:port/database)')
  }
  if (!/^postgres(ql)?:$/.test(parsed.protocol)) throw new Error(`DATABASE_URL has an unexpected protocol "${parsed.protocol}" (expected postgres:// or postgresql://)`)
  if (!parsed.hostname) throw new Error('DATABASE_URL is missing a host')
  if (!parsed.username) throw new Error('DATABASE_URL is missing a username')
  const database = parsed.pathname.replace(/^\//, '')
  if (!database) throw new Error('DATABASE_URL is missing a database name')
  const rawPassword = decodeURIComponent(parsed.password || '')
  if (!rawPassword) throw new Error('DATABASE_URL is missing a password')
  if (/^\[.*\]$/.test(rawPassword) || /YOUR-PASSWORD/i.test(rawPassword)) {
    throw new Error('DATABASE_URL password still contains a placeholder (e.g. "[YOUR-PASSWORD]") — replace it with the actual database password')
  }
  return { username: parsed.username, host: parsed.hostname, port: parsed.port || '5432', database }
}

export function createPostgresPaperStore({ connectionString = process.env.DATABASE_URL, pool, onPoolError = (error) => console.error('Paper observer PostgreSQL pool error:', error.message) } = {}) {
  if (!pool) describeDatabaseUrl(connectionString)
  const clientPool = pool ?? new Pool({ connectionString, ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false }, max: 1, idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000 })
  let ready
  let lastConnectionError = null
  if (typeof clientPool.on === 'function') {
    clientPool.on('error', (error) => {
      lastConnectionError = { message: error.message, at: new Date().toISOString() }
      try { onPoolError(error) } catch {}
    })
  }
  async function init() {
    if (!ready) ready = withTransaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock($1)', [PAPER_SYMBOL_UNIVERSE_LOCK_KEY])
      await client.query(schema)
    })
    try {
      await ready
    } catch (error) {
      ready = undefined
      throw error
    }
  }
  async function load() {
    await init()
    return read()
  }
  async function read() {
    const result = await clientPool.query('SELECT state FROM paper_observer_state WHERE id = 1')
    return result.rows[0]?.state ?? { trades: [] }
  }
  async function withTransaction(action) {
    const client = await clientPool.connect()
    let begun = false
    let committing = false
    let connectionError
    let discardError
    let rejectConnection
    const connectionFailed = new Promise((_, reject) => { rejectConnection = reject })
    // Errors can arrive between queries, when no query is awaiting this promise.
    connectionFailed.catch(() => {})
    const onClientError = (error) => {
      connectionError ??= error
      lastConnectionError = { message: connectionError.message, at: new Date().toISOString() }
      rejectConnection(connectionError)
    }
    client.on?.('error', onClientError)
    const query = async (...args) => {
      if (connectionError) throw connectionError
      const result = await Promise.race([client.query(...args), connectionFailed])
      if (connectionError) throw connectionError
      return result
    }
    try {
      await query('BEGIN')
      begun = true
      const result = await action({ query })
      committing = true
      await query('COMMIT')
      return result
    } catch (error) {
      // A failed BEGIN/COMMIT leaves the connection's transaction state uncertain.
      if (!begun || committing) discardError = error
      if (begun && !connectionError) {
        try { await query('ROLLBACK') } catch (rollbackError) { discardError = rollbackError }
      }
      throw connectionError ?? error
    } finally {
      // Keep our listener until pg has installed its idle listener or discarded
      // the client. Passing an error to release prevents reuse of a damaged client.
      try { client.release(connectionError ?? discardError) }
      finally { client.removeListener?.('error', onClientError) }
    }
  }
  async function symbolsFrom(client) {
    const result = await client.query('SELECT symbol FROM paper_observer_symbols WHERE enabled = true ORDER BY symbol')
    return result.rows.map((row) => row.symbol)
  }
  async function withSymbolUniverseTransaction(action) {
    const schemaWasReady = Boolean(ready)
    if (schemaWasReady) await init()
    const result = await withTransaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock($1)', [PAPER_SYMBOL_UNIVERSE_LOCK_KEY])
      // Another init() may start while connect()/the lock is pending. Its promise
      // is not proof that schema exists inside this transaction yet.
      if (!schemaWasReady) await client.query(schema)
      return action(client)
    })
    if (!ready) ready = Promise.resolve()
    return result
  }
  async function initializeObserverSymbols(client, seedSymbols, cap) {
    const marker = await client.query('SELECT initialized_at FROM paper_observer_symbol_universe WHERE id = 1')
    if (!marker.rows[0]) {
      const seed = typeof seedSymbols === 'function' ? seedSymbols() : seedSymbols
      const normalizedSeedSymbols = assertPaperSymbolCap(normalizePaperSymbols(seed), resolvePaperSymbolCap(cap))
      for (const symbol of normalizedSeedSymbols) await client.query('INSERT INTO paper_observer_symbols (symbol, enabled) VALUES ($1, true) ON CONFLICT (symbol) DO UPDATE SET enabled = true, updated_at = now()', [symbol])
      await client.query('INSERT INTO paper_observer_symbol_universe (id) VALUES (1)')
    }
  }
  async function readObserverSymbols() {
    let marker
    try {
      marker = await clientPool.query('SELECT initialized_at FROM paper_observer_symbol_universe WHERE id = 1')
    } catch (error) {
      // Reads before rollout must not create the new tables or seed a universe.
      if (error?.code === '42P01') return { initialized: false, symbols: [] }
      throw error
    }
    if (!marker.rows[0]) return { initialized: false, symbols: [] }
    return { initialized: true, symbols: await symbolsFrom(clientPool) }
  }
  async function ensureObserverSymbols(seedSymbols, cap) {
    return withSymbolUniverseTransaction(async (client) => {
      await initializeObserverSymbols(client, seedSymbols, cap)
      return symbolsFrom(client)
    })
  }
  async function addObserverSymbol(symbol, { seedSymbols = [], cap } = {}) {
    const normalized = normalizePaperSymbol(symbol)
    const effectiveCap = resolvePaperSymbolCap(cap)
    return withSymbolUniverseTransaction(async (client) => {
      await initializeObserverSymbols(client, seedSymbols, effectiveCap)
      const symbols = await symbolsFrom(client)
      if (symbols.includes(normalized)) return symbols
      assertPaperSymbolCap([...symbols, normalized], effectiveCap)
      await client.query('INSERT INTO paper_observer_symbols (symbol, enabled) VALUES ($1, true) ON CONFLICT (symbol) DO UPDATE SET enabled = true, updated_at = now()', [normalized])
      return symbolsFrom(client)
    })
  }
  async function removeObserverSymbol(symbol, { seedSymbols = [], cap } = {}) {
    const normalized = normalizePaperSymbol(symbol)
    const effectiveCap = resolvePaperSymbolCap(cap)
    return withSymbolUniverseTransaction(async (client) => {
      await initializeObserverSymbols(client, seedSymbols, effectiveCap)
      await client.query('DELETE FROM paper_observer_symbols WHERE symbol = $1', [normalized])
      return symbolsFrom(client)
    })
  }
  async function setObserverSymbols(symbols, { cap } = {}) {
    const normalized = assertPaperSymbolCap(normalizePaperSymbols(symbols), resolvePaperSymbolCap(cap))
    return withSymbolUniverseTransaction(async (client) => {
      await initializeObserverSymbols(client, [], cap)
      await client.query('DELETE FROM paper_observer_symbols')
      for (const symbol of normalized) await client.query('INSERT INTO paper_observer_symbols (symbol, enabled) VALUES ($1, true) ON CONFLICT (symbol) DO UPDATE SET enabled = true, updated_at = now()', [symbol])
      return symbolsFrom(client)
    })
  }
  async function save(state, metadata = {}) {
    await init()
    await withTransaction(async (client) => {
      await client.query('INSERT INTO paper_observer_state (id, state, status, last_successful_update, last_processed_candle, current_error) VALUES (1, $1, $2, $3, $4, $5) ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state, status = EXCLUDED.status, last_successful_update = EXCLUDED.last_successful_update, last_processed_candle = EXCLUDED.last_processed_candle, current_error = EXCLUDED.current_error', [state, metadata.status ?? 'IDLE', metadata.lastSuccessfulUpdate ?? null, metadata.lastProcessedCandle ?? null, metadata.currentError ?? null])
      for (const trade of state.trades ?? []) await client.query('INSERT INTO paper_trades (symbol, signal_timestamp, trade) VALUES ($1, $2, $3) ON CONFLICT (symbol, signal_timestamp) DO UPDATE SET trade = EXCLUDED.trade', [trade.symbol, trade.signalTimestamp, trade])
      for (const candle of metadata.processedCandles ?? []) await client.query('INSERT INTO paper_processed_candles (symbol, candle_timestamp) VALUES ($1, $2) ON CONFLICT DO NOTHING', [candle.symbol, candle.timestamp])
    })
  }
  async function status() {
    await init()
    const result = await clientPool.query('SELECT status, last_successful_update, last_processed_candle, current_error FROM paper_observer_state WHERE id = 1')
    return result.rows[0] ?? { status: 'IDLE', last_successful_update: null, last_processed_candle: null, current_error: null }
  }
  return { init, load, read, save, status, readObserverSymbols, ensureObserverSymbols, setObserverSymbols, addObserverSymbol, removeObserverSymbol, getLastConnectionError: () => lastConnectionError, close: () => clientPool.end?.(), pool: clientPool }
}
