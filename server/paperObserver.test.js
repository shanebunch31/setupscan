import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createPaperObserver } from './paperObserverCore.js'
import { completedHourlyCandles, isRegularSession } from './marketSession.js'

function candles() {
  return Array.from({ length: 30 }, (_, index) => ({
    symbol: 'SPY', timeframe: '1h', timestamp: new Date(Date.UTC(2026, 8, 21, 12 + index)).toISOString(), open: 100, high: index === 21 ? 101.1 : 100.5, low: 99.5, close: index === 20 ? 110 : 100, volume: index === 20 ? 1500 : 1000,
    price: index === 20 ? 110 : 100, vwap: 100, ema9: 101, ema21: 99, rsi: 60, relativeVolume: 1.5, breakout: index === 20, trend: 'Bullish',
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
  const observer = await createPaperObserver({ store: memory, now: () => new Date('2026-09-22T15:00:00Z'), fetchBars: async () => { calls += 1; return { provider: 'ALPACA HISTORICAL', candles: candles(), candleCount: 16 } } })
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
  const options = { store: memory, now: () => new Date('2026-09-22T15:00:00Z'), fetchBars: async () => ({ provider: 'ALPACA HISTORICAL', candles: candles(), candleCount: 16 }) }
  const first = await createPaperObserver(options)
  await first.processOnce()
  const second = await createPaperObserver(options)
  await second.processOnce()
  assert.equal(second.getJournal().trades.length, 3)
})

test('records an error and recovers on the next successful cycle', async () => {
  const memory = store()
  let fail = true
  const observer = await createPaperObserver({ store: memory, now: () => new Date('2026-09-22T15:00:00Z'), fetchBars: async () => { if (fail) throw new Error('temporary Alpaca failure'); return { provider: 'ALPACA HISTORICAL', candles: candles(), candleCount: 16 } } })
  const failed = await observer.processOnce()
  assert.equal(failed.status, 'ERROR')
  fail = false
  const recovered = await observer.processOnce()
  assert.equal(recovered.status, 'RUNNING')
  assert.equal(observer.getJournal().trades.length, 3)
})
