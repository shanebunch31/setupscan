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
  assert.equal(trade.exitPrice, 99.5)
  assert.equal(trade.rMultiple, -1)
  assert.equal(trade.pnl, -100)
})

test('keeps the fixed stop first when one candle touches both stop and target', () => {
  const rows = candles('stop')
  rows[1] = { ...rows[1], open: 100, high: 101.2, low: 99.4, close: 100 }
  const engine = createPaperTradingEngine()

  engine.processCandles('SPY', rows)

  const trade = engine.getJournal().trades[0]
  assert.equal(trade.exitReason, 'Stop')
  assert.equal(trade.exitPrice, 99.5)
})

test('fills a fixed stop gap at the candle open', () => {
  const rows = candles('target').slice(0, 3)
  rows[1] = { ...rows[1], open: 100, high: 100.2, low: 99.9, close: 100 }
  rows[2] = { ...rows[2], open: 99, high: 100.2, low: 98.8, close: 99 }
  const engine = createPaperTradingEngine()

  engine.processCandles('SPY', rows)

  const trade = engine.getJournal().trades[0]
  assert.equal(trade.exitReason, 'Stop')
  assert.equal(trade.exitPrice, 99)
  assert.equal(trade.rMultiple, -2)
  assert.equal(trade.pnl, -200)
})

test('uses the target price for a favorable target gap', () => {
  const rows = candles('target').slice(0, 3)
  rows[1] = { ...rows[1], open: 100, high: 100.2, low: 99.9, close: 100 }
  rows[2] = { ...rows[2], open: 102, high: 102.4, low: 98.8, close: 100 }
  const engine = createPaperTradingEngine()

  engine.processCandles('SPY', rows)

  const trade = engine.getJournal().trades[0]
  assert.equal(trade.exitReason, 'Target')
  assert.equal(trade.exitPrice, 101)
  assert.equal(trade.rMultiple, 2)
})

test('activates and ratchets a trailing stop without ever lowering it', () => {
  const rows = candles('target').slice(0, 4)
  rows[1] = { ...rows[1], open: 100, high: 100.6, low: 100.4, close: 100.5 }
  rows[2] = { ...rows[2], open: 100.5, high: 100.9, low: 100.7, close: 100.8 }
  rows[3] = { ...rows[3], open: 100.8, high: 100.85, low: 100.55, close: 100.6 }
  const engine = createPaperTradingEngine()

  engine.processCandles('SPY', rows)

  const trade = engine.getJournal().trades[0]
  assert.equal(trade.exitReason, 'Trailing Stop')
  assert.equal(trade.trailingStopActive, true)
  assert.equal(trade.highestPrice, 100.9)
  assert.ok(trade.stopPrice > 100.5)
  assert.equal(trade.exitPrice, trade.stopPrice)
})

test('does not use a candle high to stop the same candle before the stop existed', () => {
  const rows = candles('target').slice(0, 2)
  rows[1] = { ...rows[1], open: 100, high: 100.6, low: 100.29, close: 100.4 }
  const engine = createPaperTradingEngine()

  engine.processCandles('SPY', rows)

  const trade = engine.getJournal().trades[0]
  assert.equal(trade.status, 'open')
  assert.equal(trade.trailingStopActive, true)
  assert.ok(trade.stopPrice > 100.29)
})

test('fills a gap through an active trailing stop at the candle open', () => {
  const rows = candles('target').slice(0, 3)
  rows[1] = { ...rows[1], open: 100, high: 100.6, low: 100.4, close: 100.5 }
  rows[2] = { ...rows[2], open: 100.1, high: 100.2, low: 100, close: 100.1 }
  const engine = createPaperTradingEngine()

  engine.processCandles('SPY', rows)

  const trade = engine.getJournal().trades[0]
  assert.equal(trade.exitReason, 'Trailing Stop')
  assert.equal(trade.exitPrice, 100.1)
})

test('uses the actual non-round entry risk to activate the trailing stop at +1R', () => {
  const rows = candles('target').slice(0, 2)
  const entryPrice = 137.25
  const activationPrice = entryPrice * 1.005
  rows[1] = {
    ...rows[1],
    open: entryPrice,
    high: activationPrice,
    low: 137.5,
    close: activationPrice,
  }
  const engine = createPaperTradingEngine()

  engine.processCandles('SPY', rows)

  const trade = engine.getJournal().trades[0]
  assert.equal(trade.status, 'open')
  assert.equal(trade.entryPrice, entryPrice)
  assert.equal(trade.trailingStopActive, true)
  assert.equal(trade.highestPrice, activationPrice)
})

test('restores a legacy open trade without trailing fields and activates it safely', () => {
  const rows = candles('target').slice(0, 2)
  rows[1] = { ...rows[1], open: 100, high: 100.6, low: 100.4, close: 100.5 }
  const legacyTrade = {
    id: `SPY:${rows[0].timestamp}`,
    symbol: 'SPY',
    status: 'open',
    signalTimestamp: rows[0].timestamp,
    entryTimestamp: rows[1].timestamp,
    entryPrice: 100,
    stopPrice: 99.5,
    targetPrice: 101,
    initialRiskDollars: 100,
    initialRiskR: 1,
    exitTimestamp: null,
    exitPrice: null,
    exitReason: null,
    rMultiple: null,
    pnl: null,
    holdingTime: null,
  }
  let saved
  const engine = createPaperTradingEngine({
    state: { trades: [legacyTrade] },
    saveState: (state) => { saved = structuredClone(state) },
  })

  engine.processCandles('SPY', rows)

  const trade = engine.getJournal().trades[0]
  assert.equal(trade.status, 'open')
  assert.equal(trade.trailingStopActive, true)
  assert.equal(trade.highestPrice, 100.6)
  assert.equal(saved.trades[0].trailingStopActive, true)
  assert.equal(saved.trades[0].highestPrice, 100.6)
})

test('keeps trailing-stop state when a trade expires on its twelfth holding candle', () => {
  const rows = candles('target').slice(0, 13)
  for (let index = 1; index < 12; index += 1) {
    rows[index] = { ...rows[index], open: 100, high: 100.4, low: 99.6, close: 100 }
  }
  rows[12] = { ...rows[12], open: 100, high: 100.6, low: 100.4, close: 100.5 }
  const engine = createPaperTradingEngine()

  engine.processCandles('SPY', rows)

  const trade = engine.getJournal().trades[0]
  assert.equal(trade.status, 'closed')
  assert.equal(trade.exitReason, 'Expired')
  assert.equal(trade.trailingStopActive, true)
  assert.equal(trade.highestPrice, 100.6)
  assert.ok(trade.stopPrice > 100)
  assert.equal(trade.holdingTime, 12 * 60)
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

test('persists trailing-stop state and leaves closed trades unchanged after restart', () => {
  const filePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'setupscan-paper-trailing-')), 'trades.json')
  const initialRows = candles('target').slice(0, 2)
  initialRows[1] = { ...initialRows[1], open: 100, high: 100.6, low: 100.4, close: 100.5 }
  const firstStore = createPaperStore(filePath)
  const first = createPaperTradingEngine({ state: firstStore.load(), saveState: firstStore.save })
  first.processCandles('SPY', initialRows)
  assert.equal(first.getJournal().trades[0].trailingStopActive, true)

  const resumedRows = [...initialRows, {
    ...initialRows[1],
    timestamp: new Date(Date.parse(initialRows[1].timestamp) + 60 * 60 * 1000).toISOString(),
    open: 100.1,
    high: 100.2,
    low: 100,
    close: 100.1,
  }]
  const secondStore = createPaperStore(filePath)
  const second = createPaperTradingEngine({ state: secondStore.load(), saveState: secondStore.save })
  second.processCandles('SPY', resumedRows)
  const closed = second.getJournal().trades[0]
  assert.equal(closed.exitReason, 'Trailing Stop')

  const third = createPaperTradingEngine({ state: secondStore.load(), saveState: secondStore.save })
  const changedRows = resumedRows.map((row, index) => index === 2 ? { ...row, open: 90, low: 89 } : row)
  third.processCandles('SPY', changedRows)
  assert.deepEqual(third.getJournal().trades[0], closed)
})

test('paper engine has no order submission dependency', async () => {
  const source = await fs.promises.readFile(new URL('./paperTrading.js', import.meta.url), 'utf8')
  assert.equal(source.includes('orders'), false)
  assert.equal(source.includes('submit'), false)
})
