import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fetchScannerSnapshot, isSuccessfulScannerRefresh } from './scannerSnapshot.js'

const range = { start: '2026-09-01T00:00:00.000Z', end: '2026-09-02T00:00:00.000Z' }

function candle(symbol, timestamp, close, volume = 100) {
  return { symbol, timestamp, open: close, high: close + 1, low: close - 1, close, volume }
}

test('scanner refresh fetches each requested symbol through the historical-data path', async () => {
  const calls = []
  const entries = await fetchScannerSnapshot(['SPY', 'QQQ'], range, async (...args) => {
    calls.push(args)
    return { candles: [candle(args[0], '2026-09-01T14:00:00.000Z', 100)] }
  })

  assert.deepEqual(calls, [['SPY', '1Hour', range], ['QQQ', '1Hour', range]])
  assert.deepEqual(entries.map(({ symbol, available }) => ({ symbol, available })), [
    { symbol: 'SPY', available: true },
    { symbol: 'QQQ', available: true },
  ])
  assert.equal(entries[0].snapshot.price, 100)
  assert.equal(isSuccessfulScannerRefresh(entries), true)
})

test('scanner refresh retains per-symbol unavailability when a historical request fails', async () => {
  const entries = await fetchScannerSnapshot(['SPY', 'QQQ'], range, async (symbol) => {
    if (symbol === 'QQQ') throw new Error('provider unavailable')
    return { candles: [candle(symbol, '2026-09-01T14:00:00.000Z', 100)] }
  })

  assert.deepEqual(entries.map(({ symbol, available }) => ({ symbol, available })), [
    { symbol: 'SPY', available: true },
    { symbol: 'QQQ', available: false },
  ])
  assert.equal(isSuccessfulScannerRefresh(entries), true)
  assert.equal(isSuccessfulScannerRefresh([{ symbol: 'SPY', available: false }]), false)
})
