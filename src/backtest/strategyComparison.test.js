import assert from 'node:assert/strict'
import { test } from 'node:test'
import { calculateResearchMetrics, createTrendMomentumTrade, runTrendMomentumBacktest } from './strategyComparison.js'

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
  assert.equal(result.metrics.ambiguityRateDenominator, result.metrics.totalTrades)
  assert.ok(Number.isFinite(result.metrics.ambiguousTradeCount))
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

test('Trend/Momentum long trades fill stop gaps at the open and retain conservative target limits', () => {
  const signal = { symbol: 'SPY', timestamp: 'signal' }
  const entry = { timestamp: 'entry', open: 100, high: 100.5, low: 99.5, close: 100 }
  const settings = { stopAtrMultiple: 2, targetRMultiple: 2, maxHoldingBars: 2 }
  const stopGapCandles = [signal, entry, { timestamp: 'gap', open: 97, high: 100, low: 96, close: 98 }]
  const stopGap = createTrendMomentumTrade(signal, entry, stopGapCandles, 0, 1, settings)
  assert.equal(stopGap.exitReason, 'Stop')
  assert.equal(stopGap.exitPrice, 97)

  const targetGapCandles = [signal, entry, { timestamp: 'gap', open: 105, high: 106, low: 104, close: 105 }]
  const targetGap = createTrendMomentumTrade(signal, entry, targetGapCandles, 0, 1, settings)
  assert.equal(targetGap.exitReason, 'Target')
  assert.equal(targetGap.exitPrice, 104)
})

test('Trend/Momentum counts same-candle barrier touches while preserving stop-first fills', () => {
  const signal = { symbol: 'SPY', timestamp: 'signal' }
  const entry = { timestamp: 'entry', open: 100, high: 100.5, low: 99.5, close: 100 }
  const candles = [signal, entry, { timestamp: 'both', open: 100, high: 105, low: 97, close: 100 }]
  const trade = createTrendMomentumTrade(signal, entry, candles, 0, 1, { stopAtrMultiple: 2, targetRMultiple: 2, maxHoldingBars: 2 })
  assert.equal(trade.ambiguousCandle, true)
  assert.equal(trade.exitReason, 'Stop')
  assert.equal(trade.exitPrice, 98)
  const metrics = calculateResearchMetrics([trade])
  assert.equal(metrics.ambiguousTradeCount, 1)
  assert.equal(metrics.ambiguityRateDenominator, 1)
  assert.equal(metrics.ambiguousTradeRate, 1)
})
