import assert from 'node:assert/strict'
import { test } from 'node:test'
import { scanSetups } from './scanner.js'

test('VWAP reason describes SetupScan running price reference rather than session VWAP', () => {
  const [result] = scanSetups([{
    symbol: 'SPY', price: 101, vwap: 100, ema9: 101, ema21: 100,
    rsi: 60, relativeVolume: 1.3, breakout: true, trend: 'Bullish',
  }])
  const reason = result.reasons.find(({ label }) => label === 'Price vs VWAP')
  assert.match(reason.detail, /SetupScan's running price reference/)
  assert.doesNotMatch(reason.detail, /session VWAP/)
})
