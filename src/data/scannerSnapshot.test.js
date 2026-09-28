import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fetchScannerSnapshot, isSuccessfulScannerRefresh } from './scannerSnapshot.js'

const range = { start: '2026-09-01T00:00:00.000Z', end: '2026-09-02T00:00:00.000Z' }
const fixedNow = () => new Date('2026-09-03T12:00:00.000Z')

function candle(symbol, timestamp, close, volume = 100) {
  return { symbol, timestamp, open: close, high: close + 1, low: close - 1, close, volume }
}

test('scanner refresh fetches each requested symbol through the historical-data path', async () => {
  const calls = []
  const entries = await fetchScannerSnapshot(['SPY', 'QQQ'], range, async (...args) => {
    calls.push(args)
    return { candles: [candle(args[0], '2026-09-01T14:00:00.000Z', 100)] }
  }, fixedNow)

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
  }, fixedNow)

  assert.deepEqual(entries.map(({ symbol, available }) => ({ symbol, available })), [
    { symbol: 'SPY', available: true },
    { symbol: 'QQQ', available: false },
  ])
  assert.equal(isSuccessfulScannerRefresh(entries), true)
  assert.equal(isSuccessfulScannerRefresh([{ symbol: 'SPY', available: false }]), false)
})

test('scanner uses the previous completed candle when the newest candle is still forming', async () => {
  const entries = await fetchScannerSnapshot(['SPY'], range, async () => ({
    candles: [
      candle('SPY', '2026-09-03T09:00:00.000Z', 100),
      candle('SPY', '2026-09-03T10:00:00.000Z', 110),
    ],
  }), () => new Date('2026-09-03T10:30:00.000Z'))

  assert.equal(entries[0].available, true)
  assert.equal(entries[0].snapshot.price, 100)
})

test('scanner uses the newest candle when its hourly interval has completed', async () => {
  const entries = await fetchScannerSnapshot(['SPY'], range, async () => ({
    candles: [candle('SPY', '2026-09-03T10:00:00.000Z', 110)],
  }), () => new Date('2026-09-03T11:00:00.000Z'))

  assert.equal(entries[0].available, true)
  assert.equal(entries[0].snapshot.price, 110)
})

test('scanner reports unavailable when all supplied hourly candles are still forming', async () => {
  const entries = await fetchScannerSnapshot(['SPY'], range, async () => ({
    candles: [
      candle('SPY', '2026-09-03T10:00:00.000Z', 100),
      candle('SPY', '2026-09-03T11:00:00.000Z', 110),
    ],
  }), () => new Date('2026-09-03T10:30:00.000Z'))

  assert.deepEqual(entries, [{ symbol: 'SPY', available: false }])
})
