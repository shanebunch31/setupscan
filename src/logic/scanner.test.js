import assert from 'node:assert/strict'
import { test } from 'node:test'
import { scanSetups } from './scanner.js'

test('VWAP reason describes the regular-session volume-weighted reference', () => {
  const result = scanSetups([{
    symbol: 'SPY',
    price: 101,
    vwap: 100,
    ema9: 101,
    ema21: 100,
    rsi: 60,
    relativeVolume: 1.2,
    breakout: true,
    trend: 'Bullish',
  }])[0]

  const reason = result.reasons.find(
    ({ label }) => label === 'Price vs VWAP',
  )

  assert.match(reason.detail, /regular-session VWAP/i)
  assert.match(reason.detail, /volume-weighted average/i)
})
