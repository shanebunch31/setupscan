import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import { createPostgresPaperStore } from './postgresPaperStore.js'

class RetryablePool extends EventEmitter {
  constructor() {
    super()
    this.schemaAttempts = 0
  }

  async query(text) {
    if (text.includes('CREATE TABLE')) {
      this.schemaAttempts += 1
      if (this.schemaAttempts === 1) throw new Error('temporary connection failure')
      return { rows: [] }
    }
    if (text.includes('SELECT state')) return { rows: [] }
    throw new Error(`Unexpected query: ${text}`)
  }
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
