import assert from 'node:assert/strict'
import { test } from 'node:test'
import { findMomentumBreakoutSignals, runMomentumBreakoutForSymbol } from './momentumBreakout.js'

function makeCandle(timestampIndex, overrides = {}) {
  const timestamp = `2023-01-01T${String(timestampIndex % 24).padStart(2, '0')}:00:00Z`
  return { symbol: 'TEST', timeframe: '1h', timestamp, open: 100, high: 101, low: 99, close: 100, volume: 1000, ...overrides }
}

function baselineSeries(count) {
  return Array.from({ length: count }, (_, index) => makeCandle(index))
}

test('detects a breakout signal only when high, close, and volume confirmation all qualify', () => {
  const candles = baselineSeries(20)
  candles.push(makeCandle(20, { high: 110, close: 105, volume: 2000 }))
  const signals = findMomentumBreakoutSignals(candles)
  assert.equal(signals.length, 1)
  assert.equal(signals[0].index, 20)
})

test('does not signal without volume confirmation, even with a qualifying breakout close', () => {
  const candles = baselineSeries(20)
  candles.push(makeCandle(20, { high: 110, close: 105, volume: 1000 })) // exactly 1.0x average, below the 1.2x requirement
  assert.equal(findMomentumBreakoutSignals(candles).length, 0)
})

test('does not signal when the close fails to hold above the breakout level', () => {
  const candles = baselineSeries(20)
  candles.push(makeCandle(20, { high: 110, close: 100, volume: 2000 })) // wicks through but closes back inside the range
  assert.equal(findMomentumBreakoutSignals(candles).length, 0)
})

test('signal detection is causal: later candles never change an earlier signal', () => {
  const base = baselineSeries(20)
  base.push(makeCandle(20, { high: 110, close: 105, volume: 2000 }))
  const withoutFuture = findMomentumBreakoutSignals(base)
  const withFuture = findMomentumBreakoutSignals([...base, makeCandle(21, { high: 500, close: 500, volume: 50000 })])
  assert.deepEqual(withoutFuture.map((s) => s.index), withFuture.filter((s) => s.index <= 20).map((s) => s.index))
})

test('entry occurs on the next candle open, and the occurrence is deterministic across repeated runs', () => {
  const candles = baselineSeries(20)
  candles.push(makeCandle(20, { high: 110, close: 105, volume: 2000 }))
  candles.push(makeCandle(21, { open: 106, high: 108, low: 105, close: 107 }))
  candles.push(makeCandle(22, { high: 112, low: 106, close: 110 }))
  const runOnce = runMomentumBreakoutForSymbol(candles, 'TEST')
  const runTwice = runMomentumBreakoutForSymbol(candles, 'TEST')
  assert.equal(runOnce.length, 1)
  assert.equal(runOnce[0].entryPrice, 106)
  assert.deepEqual(runOnce, runTwice)
})
