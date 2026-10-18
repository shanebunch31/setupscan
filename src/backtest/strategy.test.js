import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runSetupScanBacktest } from './strategy.js'
import { runThresholdResearch } from './robustness.js'

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

test('generic backtest fills a long stop gap at the open while ordinary intrabar stops use the barrier', () => {
  const makeRun = (bar) => {
    const rows = candles(12, [2])
    rows[3] = { ...rows[3], open: 100, high: 101, low: 99.5, close: 100 }
    rows[4] = { ...rows[4], ...bar }
    return runSetupScanBacktest(rows, { splitIndex: 12, maxHoldingBars: 2, stopDistance: 5, targetDistance: 10 })
  }

  const gap = makeRun({ open: 94, high: 100, low: 93, close: 96 })
  assert.equal(gap.trades[0].exitReason, 'Stop')
  assert.equal(gap.trades[0].exitPrice, 94)

  const intrabar = makeRun({ open: 100, high: 105, low: 94, close: 99 })
  assert.equal(intrabar.trades[0].exitReason, 'Stop')
  assert.equal(intrabar.trades[0].exitPrice, 95)
})

test('generic backtest keeps target gap fills conservative and resolves same-candle touches stop-first', () => {
  const makeRun = (bar) => {
    const rows = candles(12, [2])
    rows[3] = { ...rows[3], open: 100, high: 101, low: 99.5, close: 100 }
    rows[4] = { ...rows[4], ...bar }
    return runSetupScanBacktest(rows, { splitIndex: 12, maxHoldingBars: 2, stopDistance: 5, targetDistance: 10 })
  }

  const targetGap = makeRun({ open: 112, high: 114, low: 111, close: 113 })
  assert.equal(targetGap.trades[0].exitReason, 'Target')
  assert.equal(targetGap.trades[0].exitPrice, 110) // no assumed price improvement

  const intrabarTarget = makeRun({ open: 100, high: 112, low: 99.5, close: 111 })
  assert.equal(intrabarTarget.trades[0].exitReason, 'Target')
  assert.equal(intrabarTarget.trades[0].exitPrice, 110)

  const ambiguous = makeRun({ open: 100, high: 111, low: 94, close: 100 })
  assert.equal(ambiguous.trades[0].exitReason, 'Stop')
  assert.equal(ambiguous.trades[0].exitPrice, 95)
  assert.equal(ambiguous.trades[0].ambiguousCandle, true)
  assert.equal(ambiguous.metrics.ambiguousTradeCount, 1)
  assert.equal(ambiguous.metrics.ambiguityRateDenominator, 1)
  assert.equal(ambiguous.metrics.ambiguousTradeRate, 1)

  const ordinaryStop = makeRun({ open: 100, high: 104, low: 94, close: 99 })
  assert.equal(ordinaryStop.trades[0].ambiguousCandle, false)
  assert.equal(ordinaryStop.metrics.ambiguousTradeCount, 0)
  assert.equal(ordinaryStop.metrics.ambiguousTradeRate, 0)
})

test('ambiguity count is zero and percentage unavailable when there are no simulated trades', () => {
  const result = runSetupScanBacktest(candles(12), { splitIndex: 12, maxHoldingBars: 2, stopDistance: 5, targetDistance: 10 })
  assert.equal(result.metrics.ambiguousTradeCount, 0)
  assert.equal(result.metrics.ambiguityRateDenominator, 0)
  assert.equal(result.metrics.ambiguousTradeRate, null)
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

test('trailing backtest applies conservative stop and target fills when a candle opens beyond a barrier', async () => {
  const { runTrailingStopBacktest } = await import('./strategy.js')
  const makeRun = (nextCandle) => {
    const rows = candles(10, [2])
    rows[3] = { ...rows[3], open: 100, high: 100.2, low: 99.9, close: 100 }
    rows[4] = { ...rows[4], ...nextCandle }
    return runTrailingStopBacktest(rows, {
      minimumScore: 75,
      maxHoldingBars: 2,
      stopDistance: 0.5,
      targetDistance: 10,
      splitIndex: 9,
    })
  }

  const stopGap = makeRun({ open: 99, high: 100, low: 98.5, close: 99.5 })
  assert.equal(stopGap.trades[0].exitReason, 'Stop')
  assert.equal(stopGap.trades[0].exitPrice, 99)

  const targetGap = makeRun({ open: 112, high: 114, low: 111, close: 113 })
  assert.equal(targetGap.trades[0].exitReason, 'Target')
  assert.equal(targetGap.trades[0].exitPrice, 110)
})

test('trailing backtest counts a same-candle touch against the active trailing stop and target', async () => {
  const { runTrailingStopBacktest } = await import('./strategy.js')
  const rows = candles(10, [2])
  rows[3] = { ...rows[3], open: 100, high: 100.6, low: 99.9, close: 100.5 }
  rows[4] = { ...rows[4], open: 100.5, high: 101.2, low: 100.2, close: 100.5 }
  const result = runTrailingStopBacktest(rows, {
    minimumScore: 75,
    activationR: 1,
    trailDistancePercent: 0.003,
    maxHoldingBars: 2,
    stopDistance: 0.5,
    targetDistance: 1,
    splitIndex: 9,
  })
  assert.equal(result.trades[0].ambiguousCandle, true)
  assert.equal(result.trades[0].exitReason, 'Trailing Stop')
  assert.equal(result.metrics.ambiguousTradeCount, 1)
  assert.equal(result.metrics.ambiguousTradeRate, 1)
})

test('Resilience thresholds change trade eligibility for potential setups', () => {
  const rows = candles(12, [2])

  // Score 93: all confirmations except the volume qualification threshold.
  rows[2].relativeVolume = 1.1

  const results = runThresholdResearch(rows)

  assert.deepEqual(
    results.map(({ minimumScore }) => minimumScore),
    [75, 80, 85, 90, 95],
  )

  // Score 93 passes thresholds through 90, but fails threshold 95.
  assert.deepEqual(
    results.map(({ trades }) => trades.length),
    [1, 1, 1, 1, 0],
  )

  assert.ok(
    results.slice(0, 4).every(({ trades }) => trades[0]?.score === 93),
  )

  assert.ok(
    results.every(({ settings }) => settings.includePotentialSetups === true),
  )
})
