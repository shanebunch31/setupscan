import { Pool } from 'pg'

const schema = `
CREATE TABLE IF NOT EXISTS paper_observer_state (id integer PRIMARY KEY CHECK (id = 1), state jsonb NOT NULL, status text NOT NULL, last_successful_update timestamptz, last_processed_candle timestamptz, current_error text);
CREATE TABLE IF NOT EXISTS paper_trades (symbol text NOT NULL, signal_timestamp timestamptz NOT NULL, trade jsonb NOT NULL, PRIMARY KEY (symbol, signal_timestamp));
CREATE TABLE IF NOT EXISTS paper_processed_candles (symbol text NOT NULL, candle_timestamp timestamptz NOT NULL, PRIMARY KEY (symbol, candle_timestamp));
`

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

export function createPostgresPaperStore({ connectionString = process.env.DATABASE_URL, pool } = {}) {
  if (!pool) describeDatabaseUrl(connectionString)
  const clientPool = pool ?? new Pool({ connectionString, ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false } })
  let ready
  async function init() {
    if (!ready) ready = clientPool.query(schema)
    await ready
  }
  async function load() {
    await init()
    const result = await clientPool.query('SELECT state FROM paper_observer_state WHERE id = 1')
    return result.rows[0]?.state ?? { trades: [] }
  }
  async function save(state, metadata = {}) {
    await init()
    const client = await clientPool.connect()
    try {
      await client.query('BEGIN')
      await client.query('INSERT INTO paper_observer_state (id, state, status, last_successful_update, last_processed_candle, current_error) VALUES (1, $1, $2, $3, $4, $5) ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state, status = EXCLUDED.status, last_successful_update = EXCLUDED.last_successful_update, last_processed_candle = EXCLUDED.last_processed_candle, current_error = EXCLUDED.current_error', [state, metadata.status ?? 'IDLE', metadata.lastSuccessfulUpdate ?? null, metadata.lastProcessedCandle ?? null, metadata.currentError ?? null])
      for (const trade of state.trades ?? []) await client.query('INSERT INTO paper_trades (symbol, signal_timestamp, trade) VALUES ($1, $2, $3) ON CONFLICT (symbol, signal_timestamp) DO UPDATE SET trade = EXCLUDED.trade', [trade.symbol, trade.signalTimestamp, trade])
      for (const candle of metadata.processedCandles ?? []) await client.query('INSERT INTO paper_processed_candles (symbol, candle_timestamp) VALUES ($1, $2) ON CONFLICT DO NOTHING', [candle.symbol, candle.timestamp])
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally { client.release() }
  }
  async function status() {
    await init()
    const result = await clientPool.query('SELECT status, last_successful_update, last_processed_candle, current_error FROM paper_observer_state WHERE id = 1')
    return result.rows[0] ?? { status: 'IDLE', last_successful_update: null, last_processed_candle: null, current_error: null }
  }
  return { init, load, save, status, pool: clientPool }
}
