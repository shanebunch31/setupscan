import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createPaperTradingEngine } from './paperTrading.js'
import { createPaperStore } from './paperStore.js'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

function candles(exitType = 'target') {
  const rows = Array.from({ length: 16 }, (_, index) => ({
    symbol: 'SPY', timeframe: '1h', timestamp: new Date(Date.UTC(2026, 0, 1, index)).toISOString(),
    open: 100, high: 100.5, low: 99.5, close: 100, volume: 1000,
    price: 100, vwap: 99, ema9: 101, ema21: 99, rsi: 60, relativeVolume: 1.5, breakout: true, trend: 'Bullish',
  }))
  for (let index = 1; index < rows.length; index += 1) {
    rows[index] = { ...rows[index], price: 98, vwap: 100, ema9: 98, ema21: 99, rsi: 30, relativeVolume: 0.5, breakout: false, trend: 'Bearish', close: 98 }
  }
  rows[0] = { ...rows[0], close: 100, signalTimestamp: rows[0].timestamp }
  rows[1] = exitType === 'stop' ? { ...rows[1], low: 99.4, high: 100.1 } : { ...rows[1], high: 101.1, low: 99.9 }
  return rows
}

test('prevents duplicate trades for the same signal candle', () => {
  const engine = createPaperTradingEngine()
  engine.processCandles('SPY', candles())
  engine.processCandles('SPY', candles())
  assert.equal(engine.getJournal().trades.length, 1)
})

test('creates an entry and calculates a target exit and R/P&L', () => {
  const engine = createPaperTradingEngine()
  engine.processCandles('SPY', candles('target'))
  const trade = engine.getJournal().trades[0]
  assert.equal(trade.status, 'closed')
  assert.equal(trade.exitReason, 'Target')
  assert.equal(trade.rMultiple, 2)
  assert.equal(trade.pnl, 200)
  assert.equal(trade.theoreticalEntryPrice, 100)
})

test('persists the scanner\'s numeric score on a newly created paper trade', () => {
  const engine = createPaperTradingEngine()
  engine.processCandles('SPY', candles())
  const trade = engine.getJournal().trades[0]
  assert.equal(typeof trade.score, 'number')
  assert.equal(trade.score, 100)
  assert.equal(trade.score, trade.signalScore)
})

test('uses the conservative stop exit when the stop is touched', () => {
  const engine = createPaperTradingEngine()
  engine.processCandles('SPY', candles('stop'))
  const trade = engine.getJournal().trades[0]
  assert.equal(trade.exitReason, 'Stop')
  assert.equal(trade.rMultiple, -1)
  assert.equal(trade.pnl, -100)
})

test('persists and reloads paper trades across engine restarts', () => {
  const filePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'setupscan-paper-')), 'trades.json')
  const firstStore = createPaperStore(filePath)
  const first = createPaperTradingEngine({ state: firstStore.load(), saveState: firstStore.save })
  first.processCandles('SPY', candles())
  const secondStore = createPaperStore(filePath)
  const second = createPaperTradingEngine({ state: secondStore.load(), saveState: secondStore.save })
  assert.equal(second.getJournal().trades.length, 1)
  assert.equal(second.getJournal().trades[0].id, 'SPY:2026-01-01T00:00:00.000Z')
})

test('paper engine has no order submission dependency', async () => {
  const source = await fs.promises.readFile(new URL('./paperTrading.js', import.meta.url), 'utf8')
  assert.equal(source.includes('orders'), false)
  assert.equal(source.includes('submit'), false)
})
