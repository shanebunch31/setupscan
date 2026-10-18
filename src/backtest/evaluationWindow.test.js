import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildTradeWithinEvaluationWindow } from './evaluationWindow.js'

test('bounded evaluation excludes out-of-window and unresolved outcomes but keeps complete in-window outcomes', () => {
  const options = { stopDistancePercent: 0.01, targetR: 2, maxHoldingBars: 3 }
  const candles = [
    { timestamp: 't0', open: 100, high: 101, low: 99, close: 100 },
    { timestamp: 't1', open: 100, high: 100.5, low: 99.5, close: 100 },
    { timestamp: 't2', open: 100, high: 100.5, low: 99.5, close: 100 },
    { timestamp: 't3', open: 100, high: 103, low: 99.5, close: 102 },
  ]

  // A target reached after the evaluation end cannot count, even though later candles are present.
  assert.equal(buildTradeWithinEvaluationWindow(candles, 0, options, 2, { symbol: 'SPY' }), null)

  const resolvedEarly = buildTradeWithinEvaluationWindow(
    [candles[0], candles[1], { ...candles[2], low: 98 }, candles[3]],
    0,
    options,
    2,
    { symbol: 'SPY' },
  )
  assert.equal(resolvedEarly.exitReason, 'Stop')
  assert.equal(resolvedEarly.holdingBars, 2)

  // Reaching the data/window end before the configured horizon is unresolved, not an Expired loss/win.
  assert.equal(buildTradeWithinEvaluationWindow(candles.slice(0, 3), 0, options, 2, { symbol: 'SPY' }), null)

  const fullHorizonExpiry = buildTradeWithinEvaluationWindow(
    candles.map((candle) => ({ ...candle, high: 100.5, low: 99.5, close: 100 })),
    0,
    options,
    3,
    { symbol: 'SPY' },
  )
  assert.equal(fullHorizonExpiry.exitReason, 'Expired')
  assert.equal(fullHorizonExpiry.holdingBars, options.maxHoldingBars)
})
