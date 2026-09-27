import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runTrendMomentumBacktest } from './strategyComparison.js'

function risingCandles(length) {
  return Array.from({ length }, (_, index) => {
    const close = 100 + index * 0.1
    return {
      symbol: 'SPY',
      timestamp: new Date(Date.UTC(2026, 0, 1, index)).toISOString(),
      open: close,
      high: close + 1,
      low: close - 1,
      close,
    }
  })
}

test('Trend/Momentum partitions by entry and observed outcome using the shared boundary rule', () => {
  const candles = risingCandles(240)
  const splitIndex = 220
  const result = runTrendMomentumBacktest(candles, { splitIndex, maxHoldingBars: 12 })
  const signalIndex = (trade) => candles.findIndex((candle) => candle.timestamp === trade.timestamp)

  assert.ok(result.trades.length > 0)
  assert.ok(result.excludedCrossBoundaryTradeCount > 0)
  assert.ok(result.partitions.inSample.every((trade) => {
    const index = signalIndex(trade)
    return index + 1 < splitIndex && index + trade.holdingBars < splitIndex
  }))
  assert.ok(result.partitions.outOfSample.every((trade) => {
    const index = signalIndex(trade)
    return index + 1 >= splitIndex && index + trade.holdingBars < candles.length
  }))

  const boundarySignal = result.trades.find((trade) => signalIndex(trade) === splitIndex - 1)
  assert.ok(boundarySignal)
  assert.ok(result.partitions.outOfSample.includes(boundarySignal))
})
