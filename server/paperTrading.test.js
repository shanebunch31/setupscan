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
    rows[index] = { ...rows[index], price: 98, vwap: 100, ema9: 98, ema21: 99, rsi: 30, relativeVolume: 0.5, breakout: false, trend: 'Bearish', high: 100.5, low: 97.5, close: 98 }
  }
  rows[0] = { ...rows[0], close: 100, signalTimestamp: rows[0].timestamp }
  rows[1] = exitType === 'stop'
    ? { ...rows[1], low: 99.4, high: 100.1, close: 100 }
    : { ...rows[1], high: 101.1, low: 99.9, close: 100 }
  return rows
}

function processWithInitialSignal(engine, rows) {
  engine.processCandles('SPY', rows.slice(0, 2), { newEntrySignalTimestamp: rows[0].timestamp })
  if (rows.length > 2) engine.processCandles('SPY', rows)
}

test('prevents duplicate trades for the same signal candle', () => {
  const engine = createPaperTradingEngine()
  processWithInitialSignal(engine, candles())
  processWithInitialSignal(engine, candles())
  assert.equal(engine.getJournal().trades.length, 1)
})

test('reprocessing an unchanged candle does not advance an open trade twice', () => {
  const rows = candles('target').slice(0, 2)
  rows[1] = { ...rows[1], open: 100, high: 100.1, low: 99.9, close: 100 }
  const engine = createPaperTradingEngine()
  processWithInitialSignal(engine, rows)
  const firstState = engine.getJournal().trades[0]
  processWithInitialSignal(engine, rows)
  const repeatedState = engine.getJournal().trades[0]

  assert.equal(firstState.status, 'open')
  assert.equal(firstState.holdingTime, 0, 'the entry candle is not counted because entry is modeled at its close')
  assert.equal(repeatedState.holdingTime, 0)
  assert.equal(repeatedState.lastEvaluatedCandleTimestamp, rows[1].timestamp)
})

test('does not create paper entries from fetched history unless an entry signal is explicitly eligible', () => {
  const engine = createPaperTradingEngine()
  const rows = candles()
  engine.processCandles('SPY', rows)
  assert.equal(engine.getJournal().trades.length, 0)

  engine.processCandles('SPY', rows, { newEntrySignalTimestamp: rows[0].timestamp })
  assert.equal(engine.getJournal().trades.length, 0, 'an old signal cannot be authorized when its entry bar is not the newest bar')
})

test('defers when the available completed bar ended at signal detection, then enters at a later completed close', () => {
  const rows = candles('target').slice(0, 3)
  rows[1] = { ...rows[1], open: 95, high: 105, low: 90, close: 101.25 }
  rows[2] = { ...rows[2], open: 106, high: 110, low: 104, close: 107.5 }
  const engine = createPaperTradingEngine()
  const detectedAt = new Date(Date.parse(rows[1].timestamp) + 60 * 60 * 1000).toISOString()

  engine.processCandles('SPY', rows.slice(0, 2), {
    newEntrySignalTimestamp: rows[0].timestamp,
    signalDetectedAt: detectedAt,
  })
  assert.equal(engine.getJournal().trades.length, 0, 'the bar already completed by detection cannot supply an entry price')

  engine.processCandles('SPY', rows, { signalDetectedAt: detectedAt })
  const trade = engine.getJournal().trades[0]
  assert.equal(trade.entryPrice, 107.5, 'use the subsequent completed close, never the earlier open or the detection bar close')
  assert.equal(trade.entryTimestamp, new Date(Date.parse(rows[2].timestamp) + 60 * 60 * 1000).toISOString())
  assert.equal(trade.signalDetectedAt, detectedAt)
  assert.equal(trade.fillModelVersion, 'paper-first-post-signal-close-v1')
  assert.equal(trade.observedPriceSource.includes('not a first quote'), true)
  assert.equal(trade.lastEvaluatedCandleTimestamp, rows[2].timestamp)
})

test('creates an entry and calculates a target exit and R/P&L', () => {
  const engine = createPaperTradingEngine({
    trailingStop: {
      enabled: false,
      activationR: 1,
      trailDistancePercent: 0.003,
    },
  })

  const rows = candles('target')
  rows[2] = { ...rows[2], high: 102.1, low: 99.9, close: 101 }
  processWithInitialSignal(engine, rows)
  const trade = engine.getJournal().trades[0]
  assert.equal(trade.status, 'closed')
  assert.equal(trade.fillModelVersion, 'paper-first-post-signal-close-v1')
  assert.equal(trade.exitReason, 'Target')
  assert.equal(trade.rMultiple, 2)
  assert.equal(trade.pnl, 200)
  assert.equal(trade.theoreticalEntryPrice, 100)
  assert.equal(trade.entryPrice, 100)
})

test('does not use the current candle high to trigger a trailing stop before its low', () => {
  const rows = candles()

  // Entry is the completed close at 100.40. The entry candle's high/low
  // cannot affect a position opened at that close.
  rows[1] = {
    ...rows[1],
    open: 100.4,
    high: 100.95,
    low: 100.29,
    close: 100.9,
    price: 100.4,
  }

  // This later candle reaches +1R. Its low crosses the trailing stop that
  // its high would create, but that stop is only active on a future candle.
  rows[2] = {
    ...rows[2],
    open: 100.9,
    high: 101.5,
    low: 100.5,
    close: 101.4,
    price: 100.7,
  }

  // Now the ratcheted trailing stop can be hit.
  rows[3] = {
    ...rows[3],
    open: 101.4,
    high: 101.5,
    low: 100.7,
    close: 100.8,
    price: 100.5,
  }

  const engine = createPaperTradingEngine({
    trailingStop: {
      enabled: true,
      activationR: 1,
      trailDistancePercent: 0.003,
    },
  })

  processWithInitialSignal(engine, rows)

  const trade = engine.getJournal().trades[0]

  assert.equal(trade.status, 'closed')
  assert.equal(trade.exitReason, 'Trailing Stop')
  assert.equal(trade.exitTimestamp, rows[3].timestamp)
})

test('persists the scanner\'s numeric score on a newly created paper trade', () => {
  const engine = createPaperTradingEngine()
  processWithInitialSignal(engine, candles())
  const trade = engine.getJournal().trades[0]
  assert.equal(typeof trade.score, 'number')
  assert.equal(trade.score, 100)
  assert.equal(trade.score, trade.signalScore)
})

test('uses the conservative stop exit when the stop is touched', () => {
  const engine = createPaperTradingEngine()
  processWithInitialSignal(engine, candles('stop'))
  const trade = engine.getJournal().trades[0]
  assert.equal(trade.exitReason, 'Stop')
  assert.equal(trade.exitPrice, 99.5)
  assert.equal(trade.rMultiple, -1)
  assert.equal(trade.pnl, -100)
})

test('fills a long stop gap at the opening price and records the resulting R and P&L', () => {
  const rows = candles('stop')
  rows[1] = { ...rows[1], open: 100, high: 100.2, low: 99.9, close: 100 }
  rows[2] = { ...rows[2], open: 99, high: 101.2, low: 98.8, close: 99 }
  const engine = createPaperTradingEngine()

  processWithInitialSignal(engine, rows)

  const trade = engine.getJournal().trades[0]
  assert.equal(trade.status, 'closed')
  assert.equal(trade.exitTimestamp, rows[2].timestamp)
  assert.equal(trade.exitReason, 'Stop')
  assert.equal(trade.exitPrice, 99)
  assert.equal(trade.rMultiple, -2)
  assert.equal(trade.pnl, -200)
})

test('missing or malformed opening bars are rejected and never used as paper fill prices', () => {
  for (const open of [undefined, Number.NaN, '99']) {
    const rows = candles('stop')
    rows[1] = { ...rows[1], open: 100, high: 100.2, low: 99.9, close: 100 }
    rows[2] = { ...rows[2], open, high: 100, low: 99.4, close: 99.8 }
    const engine = createPaperTradingEngine()

    processWithInitialSignal(engine, rows)

    const trade = engine.getJournal().trades[0]
    assert.equal(trade.exitReason, 'Stop')
    assert.equal(trade.exitPrice, 99.5)
    assert.equal(trade.exitTimestamp, rows[3].timestamp)
    assert.equal(Number.isFinite(trade.exitPrice), true)
    assert.equal(trade.rMultiple, -1)
  }
})

test('rejects a non-finite opening candle before it can create or persist an invalid trade', () => {
  const rows = candles('target')
  rows[1] = { ...rows[1], open: Number.NaN, high: 101.1, low: 99.9, close: 100.2 }
  let saved
  const engine = createPaperTradingEngine({ saveState: (state) => { saved = structuredClone(state) } })

  processWithInitialSignal(engine, rows)

  assert.equal(engine.getJournal().trades.length, 0)
  assert.deepEqual(saved.trades, [])
  for (const trade of saved.trades) {
    for (const key of ['entryPrice', 'stopPrice', 'targetPrice', 'exitPrice', 'rMultiple', 'pnl']) {
      if (trade[key] !== null) assert.equal(Number.isFinite(trade[key]), true)
    }
  }
})

test('a target gap is resolved at the open and later intrabar stop movement cannot override it', () => {
  const rows = candles('target')
  rows[1] = { ...rows[1], open: 100, high: 100.2, low: 99.9, close: 100 }
  rows[2] = { ...rows[2], open: 102, high: 102.4, low: 98.8, close: 100 }
  const engine = createPaperTradingEngine()

  processWithInitialSignal(engine, rows)

  const trade = engine.getJournal().trades[0]
  assert.equal(trade.exitReason, 'Target')
  assert.equal(trade.exitPrice, 101)
  assert.equal(trade.rMultiple, 2)
  assert.equal(trade.pnl, 200)
})

test('a candle touching both barriers with an open between them remains stop-first', () => {
  const rows = candles('stop')
  rows[1] = { ...rows[1], open: 100, high: 100.2, low: 99.9, close: 100 }
  rows[2] = { ...rows[2], open: 100, high: 102.2, low: 99, close: 100.5 }
  const engine = createPaperTradingEngine()

  processWithInitialSignal(engine, rows)

  const trade = engine.getJournal().trades[0]
  assert.equal(trade.exitReason, 'Stop')
  assert.equal(trade.exitPrice, 99.5)
  assert.equal(trade.rMultiple, -1)
})

test('a gap through an active trailing stop fills at the open and keeps the trailing-stop reason', () => {
  const rows = candles()
  rows[1] = { ...rows[1], open: 100, high: 100.2, low: 99.9, close: 100 }
  rows[2] = { ...rows[2], open: 100, high: 100.6, low: 99.9, close: 100.5 }
  rows[3] = { ...rows[3], open: 100.2, high: 100.4, low: 100.1, close: 100.2 }
  const engine = createPaperTradingEngine({
    trailingStop: {
      enabled: true,
      activationR: 1,
      trailDistancePercent: 0.003,
    },
  })

  processWithInitialSignal(engine, rows)

  const trade = engine.getJournal().trades[0]
  assert.equal(trade.exitReason, 'Trailing Stop')
  assert.equal(trade.exitPrice, 100.2)
  assert.ok(Math.abs(trade.rMultiple - 0.4) < 1e-9)
  assert.ok(Math.abs(trade.pnl - 40) < 1e-9)
})

test('persists and reloads paper trades across engine restarts', () => {
  const filePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'setupscan-paper-')), 'trades.json')
  const firstStore = createPaperStore(filePath)
  const first = createPaperTradingEngine({ state: firstStore.load(), saveState: firstStore.save })
  processWithInitialSignal(first, candles())
  const secondStore = createPaperStore(filePath)
  const second = createPaperTradingEngine({ state: secondStore.load(), saveState: secondStore.save })
  assert.equal(second.getJournal().trades.length, 1)
  assert.equal(second.getJournal().trades[0].id, 'SPY:2026-01-01T00:00:00.000Z')
})

test('an open trade resumes after its saved evaluation candle following restart', () => {
  const filePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'setupscan-paper-open-')), 'trades.json')
  const initial = candles('target').slice(0, 2)
  initial[1] = { ...initial[1], open: 100, high: 100.1, low: 99.9, close: 100 }
  const firstStore = createPaperStore(filePath)
  const first = createPaperTradingEngine({ state: firstStore.load(), saveState: firstStore.save })
  processWithInitialSignal(first, initial)
  assert.equal(first.getJournal().trades[0].status, 'open')

  const resumedBars = [...initial, { ...initial[1], timestamp: new Date(Date.parse(initial[1].timestamp) + 60 * 60 * 1000).toISOString(), open: 99, high: 99.2, low: 98.8, close: 99 }]
  const secondStore = createPaperStore(filePath)
  const second = createPaperTradingEngine({ state: secondStore.load(), saveState: secondStore.save })
  processWithInitialSignal(second, resumedBars)
  const resumedTrade = second.getJournal().trades[0]

  assert.equal(resumedTrade.status, 'closed')
  assert.equal(resumedTrade.exitReason, 'Stop')
  assert.equal(resumedTrade.exitPrice, 99)
  assert.equal(resumedTrade.holdingTime, 60)
})

test('closed paper records remain unchanged after reload and later candle processing', () => {
  const filePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'setupscan-paper-')), 'trades.json')
  const firstStore = createPaperStore(filePath)
  const first = createPaperTradingEngine({ state: firstStore.load(), saveState: firstStore.save })
  const originalCandles = candles('stop')
  processWithInitialSignal(first, originalCandles)
  const closedRecord = first.getJournal().trades[0]

  const secondStore = createPaperStore(filePath)
  const second = createPaperTradingEngine({ state: secondStore.load(), saveState: secondStore.save })
  const laterCandles = candles('stop')
  laterCandles[2] = { ...laterCandles[2], open: 98, high: 99, low: 97.5, close: 98 }
  processWithInitialSignal(second, laterCandles)

  assert.deepEqual(second.getJournal().trades[0], closedRecord)
  assert.deepEqual(secondStore.load().trades[0], closedRecord)
})

test('closing a legacy open record does not relabel its entry fill model', () => {
  const rows = candles('stop')
  const legacyTrade = {
    id: `SPY:${rows[0].timestamp}`, symbol: 'SPY', status: 'open',
    signalTimestamp: rows[0].timestamp, entryTimestamp: rows[1].timestamp,
    entryPrice: 100, stopPrice: 99.5, targetPrice: 102,
    lastEvaluatedCandleTimestamp: rows[1].timestamp, holdingTime: 0, holdingBars: 0,
  }
  const olderVersionTrade = { ...legacyTrade, id: 'SPY:older-version', fillModelVersion: 'paper-ohlc-gap-aware-v1' }
  rows[2] = { ...rows[2], open: 100, high: 100.2, low: 99, close: 99.5 }
  const engine = createPaperTradingEngine({ state: { trades: [legacyTrade, olderVersionTrade] } })

  engine.processCandles('SPY', rows)

  const closed = engine.getJournal().trades[0]
  assert.equal(closed.status, 'closed')
  assert.equal(Object.hasOwn(closed, 'fillModelVersion'), false)
  assert.equal(engine.getJournal().trades[1].fillModelVersion, 'paper-ohlc-gap-aware-v1')
})

test('paper engine has no order submission dependency', async () => {
  const source = await fs.promises.readFile(new URL('./paperTrading.js', import.meta.url), 'utf8')
  assert.equal(source.includes('orders'), false)
  assert.equal(source.includes('submit'), false)
})
test('trailing stop ratchets upward after activation and protects a winning trade', () => {
  const rows = candles()

  // Entry is modeled at this completed close (100.60).
  // The entry candle's high is unavailable for trade management after that close.
  rows[1] = {
    ...rows[1],
    open: 100,
    high: 100.6,
    low: 99.9,
    close: 100.6,
    price: 100.6,
  }

  // A later candle reaches +1R but remains below the 2R target.
  rows[2] = {
    ...rows[2],
    open: 100.6,
    high: 101.2,
    low: 100.5,
    close: 101.1,
    price: 101.1,
  }

  // Reverse and hit the trailing stop.
  rows[3] = {
    ...rows[3],
    open: 101.1,
    high: 101.2,
    low: 100.7,
    close: 100.9,
    price: 100.9,
  }

  const engine = createPaperTradingEngine({
    trailingStop: {
      enabled: true,
      activationR: 1,
      trailDistancePercent: 0.003,
    },
  })

  processWithInitialSignal(engine, rows)

  const trade = engine.getJournal().trades[0]

  assert.equal(trade.status, 'closed')
  assert.equal(trade.exitReason, 'Trailing Stop')
  assert.ok(trade.stopPrice > 99.5)
  assert.ok(trade.exitPrice > 99.5)
})

test('removing a symbol cancels its pending entry even without new candles to process', () => {
  const rows = candles().slice(0, 3)
  const engine = createPaperTradingEngine()
  const detectedAt = new Date(Date.parse(rows[1].timestamp) + 3600000).toISOString()
  engine.processCandles('SPY', rows.slice(0, 2), { newEntrySignalTimestamp: rows[0].timestamp, signalDetectedAt: detectedAt })
  assert.equal(engine.getJournal().trades.length, 0)
  engine.retainPendingEntrySymbols([])
  engine.retainPendingEntrySymbols(['SPY'])
  engine.processCandles('SPY', rows)
  assert.equal(engine.getJournal().trades.length, 0, 're-enabling cannot revive a pending entry cancelled at removal')
})
