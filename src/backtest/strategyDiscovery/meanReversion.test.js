import assert from 'node:assert/strict'
import { test } from 'node:test'
import { findMeanReversionSignals, runMeanReversionForSymbol } from './meanReversion.js'

function makeCandle(index, overrides = {}) {
  const timestamp = `2023-01-01T${String(index % 24).padStart(2, '0')}:00:00Z`
  return { symbol: 'TEST', timeframe: '1h', timestamp, open: 100, high: 101, low: 99, close: 100, volume: 1000, ...overrides }
}

function baselineSeries(count) {
  return Array.from({ length: count }, (_, index) => makeCandle(index))
}

test('detects an extreme-deviation-below-VWAP-then-reversal signal, and requires the reversal close', () => {
  const candles = baselineSeries(15)
  // Deviation from VWAP (~100) is roughly 56, far beyond 2x the trailing ATR (~13) even after this
  // bar's own large range inflates its own ATR(14) reading.
  candles.push(makeCandle(15, { open: 35, close: 40, high: 41, low: 34 }))
  const signals = findMeanReversionSignals(candles)
  assert.equal(signals.length, 1)
  assert.equal(signals[0].index, 15)
})

test('does not signal when the candle closes downward, even if it is extended below VWAP', () => {
  const candles = baselineSeries(15)
  candles.push(makeCandle(15, { open: 40, close: 35, high: 41, low: 34 })) // closes down, not up
  assert.equal(findMeanReversionSignals(candles).length, 0)
})

test('does not signal for a mild deviation that does not clear the 2xATR bar', () => {
  const candles = baselineSeries(15)
  candles.push(makeCandle(15, { open: 98, close: 99, high: 100, low: 97 }))
  assert.equal(findMeanReversionSignals(candles).length, 0)
})

test('signal detection is causal: a later extreme candle never changes an earlier bar\u2019s classification', () => {
  const base = baselineSeries(15)
  base.push(makeCandle(15, { open: 35, close: 40, high: 41, low: 34 }))
  const withoutFuture = findMeanReversionSignals(base)
  const withFuture = findMeanReversionSignals([...base, makeCandle(16, { open: 1, close: 200, high: 300, low: 1 })])
  assert.deepEqual(withoutFuture.map((s) => s.index), withFuture.filter((s) => s.index <= 15).map((s) => s.index))
})

test('the primary barrier is the VWAP level (not a fixed R-multiple), and entry occurs on the next candle open', () => {
  const candles = baselineSeries(15)
  candles.push(makeCandle(15, { open: 35, close: 40, high: 41, low: 34 }))
  candles.push(makeCandle(16, { open: 41, high: 45, low: 40, close: 44 }))
  const occurrences = runMeanReversionForSymbol(candles, 'TEST')
  assert.equal(occurrences.length, 1)
  assert.equal(occurrences[0].entryPrice, 41)
  assert.equal(occurrences[0].primaryLabel, 'Reaches VWAP before -1R within 10 completed candles')
})
