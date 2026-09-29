import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runSetupScanBacktest } from './strategy.js'

function candles(length, signalIndices = []) {
  const signals = new Set(signalIndices)
  return Array.from({ length }, (_, index) => ({
    symbol: 'SPY',
    timeframe: '1h',
    timestamp: new Date(Date.UTC(2026, 0, 1, index)).toISOString(),
    open: 100,
    high: 101,
    low: 99.5,
    close: 100,
    price: signals.has(index) ? 110 : 100,
    vwap: signals.has(index) ? 100 : 101,
    ema9: signals.has(index) ? 102 : 100,
    ema21: 101,
    rsi: signals.has(index) ? 60 : 30,
    relativeVolume: signals.has(index) ? 1.3 : 0.5,
    breakout: signals.has(index),
    trend: signals.has(index) ? 'Bullish' : 'Bearish',
  }))
}

function run(length, signalIndices, splitIndex, maxHoldingBars = 2) {
  return runSetupScanBacktest(candles(length, signalIndices), {
    splitIndex,
    maxHoldingBars,
    stopDistance: 5,
    targetDistance: 10,
  })
}

test('a trade whose entry and observed outcome are fully in-sample stays in-sample', () => {
  const result = run(12, [2], 6)
  assert.equal(result.trades.length, 1)
  assert.equal(result.partitions.inSample.length, 1)
  assert.equal(result.partitions.outOfSample.length, 0)
  assert.equal(result.excludedCrossBoundaryTradeCount, 0)
})

test('a trade whose entry and observed outcome are fully out-of-sample stays out-of-sample', () => {
  const result = run(12, [7], 6)
  assert.equal(result.trades.length, 1)
  assert.equal(result.partitions.inSample.length, 0)
  assert.equal(result.partitions.outOfSample.length, 1)
  assert.equal(result.excludedCrossBoundaryTradeCount, 0)
})

test('a signal on the last in-sample candle enters at the first out-of-sample candle and is out-of-sample', () => {
  const result = run(12, [5], 6)
  assert.equal(result.trades[0].timestamp, result.candles[5].timestamp)
  assert.equal(result.partitions.inSample.length, 0)
  assert.deepEqual(result.partitions.outOfSample, result.trades)
  assert.equal(result.excludedCrossBoundaryTradeCount, 0)
})

test('a trade entered in-sample but resolved out-of-sample is excluded from both partitions', () => {
  const result = run(12, [4], 6, 2)
  assert.equal(result.trades.length, 1)
  assert.equal(result.trades[0].holdingBars, 2)
  assert.equal(result.partitions.inSample.length, 0)
  assert.equal(result.partitions.outOfSample.length, 0)
  assert.equal(result.excludedCrossBoundaryTradeCount, 1)
})

test('a final-data holding window remains truncated and is assigned by its observed outcome range', () => {
  const result = run(8, [6], 4, 6)
  assert.equal(result.trades.length, 1)
  assert.equal(result.trades[0].holdingBars, 1)
  assert.equal(result.trades[0].exitReason, 'Expired')
  assert.equal(result.partitions.outOfSample.length, 1)
  assert.equal(result.excludedCrossBoundaryTradeCount, 0)
})

test('partition correction preserves all trades and aggregate metrics', () => {
  const candlesForRun = candles(12, [2, 4, 8])
  const splitRun = runSetupScanBacktest(candlesForRun, { splitIndex: 6, maxHoldingBars: 2, stopDistance: 5, targetDistance: 10 })
  const unsplitRun = runSetupScanBacktest(candlesForRun, { splitIndex: 12, maxHoldingBars: 2, stopDistance: 5, targetDistance: 10 })
  assert.deepEqual(splitRun.trades, unsplitRun.trades)
  assert.deepEqual(splitRun.metrics, unsplitRun.metrics)
  assert.equal(splitRun.trades.length, 3)
  assert.equal(splitRun.excludedCrossBoundaryTradeCount, 1)
})
test('trailing stop activates after +1R and ratchets upward without same-bar optimism', async () => {
  const rows = candles(10, [2])

  // Entry at 100 on the candle after the signal.
  rows[3] = {
    ...rows[3],
    open: 100,
    high: 100.6,
    low: 99.9,
    close: 100.6,
  }

  // Trail should now be activated, but target 102 is not reached.
  rows[4] = {
    ...rows[4],
    open: 100.6,
    high: 100.8,
    low: 100.6,
    close: 100.8,
  }

  // This candle reaches below the previously ratcheted stop.
  rows[5] = {
    ...rows[5],
    open: 100.8,
    high: 100.9,
    low: 100.45,
    close: 100.5,
  }

  const { runTrailingStopBacktest } = await import('./strategy.js')

  const result = runTrailingStopBacktest(rows, {
    minimumScore: 75,
    activationR: 1,
    trailDistancePercent: 0.003,
    maxHoldingBars: 3,
    stopDistance: 0.5,
    targetDistance: 1,
    splitIndex: 9,
  })

  assert.equal(result.trades.length, 1)

  const trade = result.trades[0]

  assert.equal(trade.exitReason, 'Trailing Stop')
  assert.equal(trade.trailingStopActive, true)
  assert.ok(trade.stopPrice > 99.5)
  assert.ok(trade.exitPrice > 99.5)
  assert.ok(trade.rMultiple > -1)
})
