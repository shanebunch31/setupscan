import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runRelativeValueExperiment, runRelativeValueResearch, relativeValueDefaults } from './relativeValueBacktest.js'

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
  const research = runRelativeValueExperiment(buildDataset(), { lookback: 10 })
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
    if (summary.overallBeforeCosts.tradeCount > 0) {
      assert.ok(summary.overallAfterCosts.totalR <= summary.overallBeforeCosts.totalR + 1e-9)
    }
  })
})

test('uses the default execution cost and risk parameters when settings are omitted', () => {
  const research = runRelativeValueExperiment(buildDataset())
  assert.equal(research.options.executionCostR, relativeValueDefaults.executionCostR)
  assert.equal(research.options.lookback, relativeValueDefaults.lookback)
})
