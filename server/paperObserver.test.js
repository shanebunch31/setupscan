import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createPaperObserver } from './paperObserverCore.js'
import { completedHourlyCandles, isRegularSession } from './marketSession.js'

function candles() {
  const closes = [
    100.0,
    100.25,
    100.2,
    100.15,
    99.95,
    100.0,
    99.9,
    100.15,
    100.1,
    100.3,
    100.2,
    100.05,
    100.3,
    100.2,
    100.15,
    99.95,
    100.15,
    100.0,
    99.85,
    100.1,
    101.0,
    101.0,
    100.5,
    100.5,
    100.5,
    100.5,
    100.5,
    100.5,
    100.5,
    100.5,
  ]

  return closes.map((close, index) => ({
    symbol: 'SPY',
    timeframe: '1h',
    timestamp: new Date(
      Date.UTC(2026, 8, 21, 18 + index),
    ).toISOString(),
    open: index === 20 ? 100.5 : 100,
    high: index === 20 ? 101.1 : close + 0.2,
    low: close - 0.2,
    close,
    volume: index === 20 ? 1500 : 1000,
  }))
}

function store() {
  let state = { trades: [] }
  return { load: () => state, save: (next) => { state = next }, get: () => state }
}

test('only processes completed candles during the regular session', () => {
  const now = new Date('2026-09-22T14:30:00Z')
  assert.equal(isRegularSession(now), true)
  assert.equal(completedHourlyCandles([{ timestamp: '2026-09-22T13:00:00Z' }, { timestamp: '2026-09-22T14:00:00Z' }, { timestamp: '2026-09-22T14:30:00Z' }], now).length, 1)
  assert.equal(isRegularSession(new Date('2026-09-22T21:00:00Z')), false)
  assert.equal(isRegularSession(new Date('2026-09-20T14:30:00Z')), false)
})

test('scheduled processing creates once, persists checkpoint, and skips unchanged candles', async () => {
  const memory = store()
  let calls = 0
  const observer = await createPaperObserver({ store: memory, now: () => new Date('2026-09-22T16:00:00Z'), fetchBars: async () => { calls += 1; return { provider: 'ALPACA HISTORICAL', candles: candles(), candleCount: 30 } } })
  const first = await observer.processOnce()
  const second = await observer.processOnce()
  assert.equal(first.processed, 3)
  assert.equal(second.processed, 0)
  assert.equal(observer.getJournal().trades.length, 3)
  assert.equal(Object.keys(memory.get().observer.processedCandles).length, 3)
  assert.equal(calls, 6)
})

test('restart recovers persisted trades and checkpoints without duplicates', async () => {
  const memory = store()
  const options = { store: memory, now: () => new Date('2026-09-22T16:00:00Z'), fetchBars: async () => ({ provider: 'ALPACA HISTORICAL', candles: candles(), candleCount: 30 }) }
  const first = await createPaperObserver(options)
  await first.processOnce()
  const second = await createPaperObserver(options)
  await second.processOnce()
  assert.equal(second.getJournal().trades.length, 3)
})

test('records an error and recovers on the next successful cycle', async () => {
  const memory = store()
  let fail = true
  const observer = await createPaperObserver({ store: memory, now: () => new Date('2026-09-22T16:00:00Z'), fetchBars: async () => { if (fail) throw new Error('temporary Alpaca failure'); return { provider: 'ALPACA HISTORICAL', candles: candles(), candleCount: 30 } } })
  const failed = await observer.processOnce()
  assert.equal(failed.status, 'ERROR')
  fail = false
  const recovered = await observer.processOnce()
  assert.equal(recovered.status, 'RUNNING')
  assert.equal(observer.getJournal().trades.length, 3)
})
