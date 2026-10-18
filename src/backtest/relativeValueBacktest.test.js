import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildTradeFromIndex, runRelativeValueExperiment, runRelativeValueResearch, relativeValueDefaults } from './relativeValueBacktest.js'

function makeHourlySeries(symbol, count, waveShift = 0, seed = 1) {
  return Array.from({ length: count }, (_, index) => {
    const wave = Math.sin((index + waveShift) / 6) * 2 + Math.sin((index + waveShift) / 17) * 1.3
    const close = 100 * seed + wave + index * 0.01
    const open = close - 0.1
    const high = Math.max(open, close) + 0.6
    const low = Math.min(open, close) - 0.6
    return {
      symbol,
      timeframe: '1h',
      timestamp: new Date(Date.UTC(2026, 0, 1, index)).toISOString(),
      open, high, low, close,
      volume: 1000000 + (index % 5) * 5000,
    }
  })
}

function buildDataset() {
  return {
    SPY: makeHourlySeries('SPY', 400, 0, 5.75),
    QQQ: makeHourlySeries('QQQ', 400, 3, 4.9),
    IWM: makeHourlySeries('IWM', 400, 7, 2.25),
  }
}

function buildQualifiedDataset() {
  const makeQualifiedSeries = (symbol, trendRate, phase = 0) => Array.from({ length: 300 }, (_, index) => {
    const close = 100 + index * trendRate + 0.4 * Math.sin(index * 2 * Math.PI / 3 + phase)
    return {
      symbol,
      timeframe: '1h',
      timestamp: new Date(Date.UTC(2024, 0, 1 + index, 16)).toISOString(),
      open: close - 0.1,
      high: close + 0.02,
      low: close - 0.2,
      close,
      volume: index % 17 === 0 ? 500 : 100,
    }
  })
  return {
    SPY: makeQualifiedSeries('SPY', 0.05),
    QQQ: makeQualifiedSeries('QQQ', 0.02, 1),
    IWM: makeQualifiedSeries('IWM', 0.03, 2),
  }
}

test('relative-value long trades fill stop gaps at the open and retain conservative target limits', () => {
  const candles = [
    { timestamp: 'signal', open: 100, high: 101, low: 99, close: 100 },
    { timestamp: 'entry', open: 100, high: 100.5, low: 99.5, close: 100 },
    { timestamp: 'gap', open: 94, high: 100, low: 93, close: 96 },
  ]
  const options = { stopDistancePercent: 0.01, targetR: 2, maxHoldingBars: 2, executionCostR: 0.05 }
  const stopGap = buildTradeFromIndex(candles, 0, options, { symbol: 'SPY' })
  assert.equal(stopGap.exitReason, 'Stop')
  assert.equal(stopGap.exitPrice, 94)

  candles[2] = { ...candles[2], open: 105, high: 106, low: 104, close: 105 }
  const targetGap = buildTradeFromIndex(candles, 0, options, { symbol: 'SPY' })
  assert.equal(targetGap.exitReason, 'Target')
  assert.equal(targetGap.exitPrice, 102)
})

test('relative-value simulator counts a same-candle stop/target touch without changing its stop-first outcome', () => {
  const candles = [
    { timestamp: 'signal', open: 100, high: 101, low: 99, close: 100 },
    { timestamp: 'entry', open: 100, high: 100.5, low: 99.5, close: 100 },
    { timestamp: 'both', open: 100, high: 103, low: 98, close: 100 },
  ]
  const trade = buildTradeFromIndex(candles, 0, { stopDistancePercent: 0.01, targetR: 2, maxHoldingBars: 2 }, { symbol: 'SPY' })
  assert.equal(trade.ambiguousCandle, true)
  assert.equal(trade.exitReason, 'Stop')
  assert.equal(trade.exitPrice, 99)
})

test('every generated trade enters strictly after its signal candle (no look-ahead)', () => {
  const research = runRelativeValueExperiment(buildDataset(), { lookback: 10, forwardHorizon: 5 })
  Object.values(research.variants).forEach((entries) => {
    entries.forEach(({ trades }) => {
      trades.forEach((trade) => {
        const signalIndex = research.aligned.timestamps.indexOf(trade.timestamp)
        assert.ok(signalIndex >= 0, 'trade timestamp should exist in the synchronized timeline')
        assert.ok(signalIndex < research.aligned.timestamps.length - 1, 'signal candle must have a following candle for entry')
      })
    })
  })
})

test('variant D trades are a subset of candles that also qualify for variant A (combined confirmation)', () => {
  const research = runRelativeValueExperiment(buildQualifiedDataset(), { lookback: 10 })
  assert.ok(research.variants.D.reduce((sum, entry) => sum + entry.trades.length, 0) > 0, 'combined baseline plus relative-value membership must produce observations')
  const symbolATimestamps = new Map(research.variants.A.map((entry) => [entry.symbol, new Set(entry.trades.map((trade) => trade.timestamp))]))
  research.variants.D.forEach((entry) => {
    const baselineTimestamps = symbolATimestamps.get(entry.symbol)
    entry.trades.forEach((trade) => {
      assert.ok(baselineTimestamps.has(trade.timestamp), 'variant D signal must also be a baseline bullish signal')
    })
  })
})

test('runRelativeValueResearch reports before/after execution cost metrics and never picks a winner', () => {
  const research = runRelativeValueResearch(buildDataset(), { lookback: 10, executionCostR: 0.05 })
  ;['A', 'B', 'C', 'D'].forEach((key) => {
    const summary = research.summaries[key]
    assert.ok('overallBeforeCosts' in summary)
    assert.ok('overallAfterCosts' in summary)
    assert.ok(Array.isArray(summary.bySymbol))
    assert.ok(Array.isArray(summary.byPeriod))
    assert.equal(summary.overallBeforeCosts.ambiguityRateDenominator, summary.overallBeforeCosts.tradeCount)
    assert.equal(summary.overallAfterCosts.ambiguousTradeCount, summary.overallBeforeCosts.ambiguousTradeCount)
    if (summary.overallBeforeCosts.tradeCount > 0) {
      assert.ok(summary.overallAfterCosts.totalR <= summary.overallBeforeCosts.totalR + 1e-9)
    }
  })
})

test('pooled relative-value drawdown is invariant to symbol input order', () => {
  const dataset = buildDataset()
  const forward = runRelativeValueResearch(dataset, { lookback: 10, executionCostR: 0.05 })
  const reversed = runRelativeValueResearch({ IWM: dataset.IWM, QQQ: dataset.QQQ, SPY: dataset.SPY }, { lookback: 10, executionCostR: 0.05 })

  ;['A', 'B', 'C', 'D'].forEach((key) => {
    const first = forward.summaries[key]
    const second = reversed.summaries[key]
    assert.equal(first.overallBeforeCosts.maximumDrawdown, second.overallBeforeCosts.maximumDrawdown)
    assert.equal(first.overallAfterCosts.maximumDrawdown, second.overallAfterCosts.maximumDrawdown)
    assert.deepEqual(
      first.trades.map((trade) => [trade.timestamp, trade.symbol, trade.pair, trade.rMultiple]),
      second.trades.map((trade) => [trade.timestamp, trade.symbol, trade.pair, trade.rMultiple]),
    )
  })
})

test('uses the default execution cost and risk parameters when settings are omitted', () => {
  const research = runRelativeValueExperiment(buildDataset())
  assert.equal(research.options.executionCostR, relativeValueDefaults.executionCostR)
  assert.equal(research.options.lookback, relativeValueDefaults.lookback)
})
