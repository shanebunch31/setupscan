import { Pool } from 'pg'
import { isDeepStrictEqual } from 'node:util'
import { stringifyResearchJson, parseResearchJson } from '../src/research/researchRunSerialization.js'

export const shadowSchema = `
CREATE TABLE IF NOT EXISTS research_shadow_tracking (
 id text PRIMARY KEY, definition jsonb NOT NULL, checkpoint jsonb NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS research_shadow_candles (
 tracking_id text NOT NULL REFERENCES research_shadow_tracking(id) ON DELETE RESTRICT,
 symbol text NOT NULL, timestamp timestamptz NOT NULL, candle jsonb NOT NULL,
 PRIMARY KEY (tracking_id, symbol, timestamp)
);
CREATE TABLE IF NOT EXISTS research_shadow_occurrences (
 tracking_id text NOT NULL REFERENCES research_shadow_tracking(id) ON DELETE RESTRICT,
 occurrence_id text PRIMARY KEY, snapshot jsonb NOT NULL,
 state text NOT NULL CHECK (state IN ('pending','resolved','excluded','unavailable')),
 theoretical jsonb, outcome jsonb
);
CREATE INDEX IF NOT EXISTS research_shadow_pending_idx ON research_shadow_occurrences(tracking_id, state);
`
const encode = stringifyResearchJson
const decode = parseResearchJson
export function createShadowStore({ connectionString, pool } = {}) {
  if (!pool && !connectionString) throw new Error('SHADOW_DATABASE_URL must be explicitly configured')
  // Connection policy is explicit; never inherit DATABASE_URL or silently disable remote TLS.
  if (!pool) validateShadowConnection(connectionString)
  const db = pool ?? new Pool({ connectionString, max: 2, connectionTimeoutMillis: 10000, idleTimeoutMillis: 30000 })
  db.on?.('error', () => { /* Active operations fail normally; never log credential-bearing driver errors. */ })
  async function transaction(action) {
    const client = await db.connect()
    try {
      await client.query('BEGIN')
      const value = await action(client)
      await client.query('COMMIT')
      return value
    } catch (error) {
      try { await client.query('ROLLBACK') } catch {}
      throw error
    } finally { client.release() }
  }
  async function readFrom(client, id, withCandles = false) {
    const result = await client.query('SELECT definition, checkpoint FROM research_shadow_tracking WHERE id=$1', [id])
    if (!result.rows.length) throw new Error('Shadow tracking is not initialized')
    const { definition, checkpoint } = result.rows[0]
    const rows = await client.query('SELECT snapshot, state, theoretical, outcome FROM research_shadow_occurrences WHERE tracking_id=$1 ORDER BY occurrence_id', [id])
    const occurrences = rows.rows.map((row) => ({ ...decode(row.snapshot), state: row.state, theoretical: decode(row.theoretical), outcome: decode(row.outcome) }))
    const candles = withCandles ? (await client.query('SELECT symbol, candle FROM research_shadow_candles WHERE tracking_id=$1 ORDER BY timestamp, symbol', [id])).rows : []
    const raw = Object.fromEntries(decode(definition).symbols.map((symbol) => [symbol, []]))
    for (const row of candles) raw[row.symbol].push(decode(row.candle))
    return { tracking: decode(definition), checkpoint: decode(checkpoint), occurrences, raw }
  }
  return {
    // Operator-only explicit initialization; never called by the API or polling cycle.
    initialize(definition) {
      return transaction(async (client) => {
        await client.query('SELECT pg_advisory_xact_lock($1)', [1741082301])
        await client.query(shadowSchema)
        const existing = await client.query('SELECT definition FROM research_shadow_tracking WHERE id=$1', [definition.id])
        if (existing.rows.length) throw new Error('Tracking identity already exists; use run without reinitializing')
        await client.query('INSERT INTO research_shadow_tracking(id, definition) VALUES($1,$2::jsonb)', [definition.id, encode(definition)])
      })
    },
    async read(id) {
      return transaction(async (client) => {
        await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
        const { tracking, checkpoint, occurrences } = await readFrom(client, id)
        return { tracking, checkpoint, occurrences }
      })
    },
    cycle(id, action) {
      return transaction(async (client) => {
        const lock = await client.query('SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked', [`setupscan-shadow:${id}`])
        if (!lock.rows[0]?.locked) return { status: 'BUSY' }
        const before = await readFrom(client, id, true)
        const old = new Map(structuredClone(before.occurrences).map((row) => [row.id, row]))
        const update = await action(before)
        for (const { symbol, candle } of update.newCandles) {
          await client.query('INSERT INTO research_shadow_candles(tracking_id,symbol,timestamp,candle) VALUES($1,$2,$3,$4::jsonb)', [id, symbol, candle.timestamp, encode(candle)])
        }
        for (const row of update.occurrences) {
          const { state, theoretical, outcome, ...snapshot } = row
          const prior = old.get(row.id)
          if (!prior) {
            await client.query('INSERT INTO research_shadow_occurrences(tracking_id,occurrence_id,snapshot,state,theoretical,outcome) VALUES($1,$2,$3::jsonb,$4,$5::jsonb,$6::jsonb)', [id, row.id, encode(snapshot), state, encode(theoretical), encode(outcome)])
          } else {
            const { state: oldState, theoretical: oldTheoretical, outcome: oldOutcome, ...oldSnapshot } = prior
            if (!isDeepStrictEqual(snapshot, oldSnapshot)) throw new Error('Qualification snapshot is immutable')
            if (oldState !== 'pending' && !isDeepStrictEqual(row, prior)) throw new Error('Terminal observation is immutable')
            if (oldTheoretical && !isDeepStrictEqual(oldTheoretical, theoretical)) throw new Error('Theoretical entry is immutable')
            if (oldState === 'pending' && !isDeepStrictEqual(row, prior)) await client.query('UPDATE research_shadow_occurrences SET state=$2,theoretical=$3::jsonb,outcome=$4::jsonb WHERE occurrence_id=$1 AND state=\'pending\'', [row.id, state, encode(theoretical), encode(outcome)])
          }
        }
        await client.query('UPDATE research_shadow_tracking SET checkpoint=$2::jsonb WHERE id=$1', [id, encode(update.checkpoint)])
        return update.checkpoint
      })
    },
    close: () => db.end(),
  }
}

export function validateShadowConnection(connectionString) {
  let url
  try { url = new URL(connectionString) } catch { throw new Error('Explicit SHADOW_DATABASE_URL required') }
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || (!local && url.searchParams.get('sslmode') !== 'verify-full')) throw new Error('Remote shadow storage requires certificate-verifying sslmode=verify-full')
}
