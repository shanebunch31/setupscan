import assert from 'node:assert/strict'
import { test } from 'node:test'
import { findPriorDayReclaimSignals, runPriorDayReclaimForSymbol } from './priorDayReclaim.js'

function makeCandle(day, hour, overrides = {}) {
  const timestamp = `2023-01-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00Z`
  return { symbol: 'TEST', timeframe: '1h', timestamp, open: 100, high: 101, low: 99, close: 100, volume: 1000, ...overrides }
}

function baselineDay(day, hours) {
  return Array.from({ length: hours }, (_, hour) => makeCandle(day, hour))
}

test('detects the trade-above -> close-below -> close-back-above reclaim sequence using the prior completed day\u2019s high', () => {
  const candles = [
    ...baselineDay(1, 20), // day 1 high = 101
    makeCandle(2, 0, { high: 105 }), // trades above 101
    makeCandle(2, 1, { close: 99 }), // closes back below
    makeCandle(2, 2, { close: 103 }), // reclaims above 101
  ]
  const signals = findPriorDayReclaimSignals(candles)
  assert.equal(signals.length, 1)
  assert.equal(signals[0].index, 22)
  assert.equal(signals[0].referenceLevel, 101)
})

test('does not signal on the very first day, since no prior completed day exists yet', () => {
  const candles = [
    makeCandle(1, 0, { high: 105 }),
    makeCandle(1, 1, { close: 99 }),
    makeCandle(1, 2, { close: 103 }),
  ]
  assert.equal(findPriorDayReclaimSignals(candles).length, 0)
})

test('does not signal if the level is never actually reclaimed after failing back below it', () => {
  const candles = [
    ...baselineDay(1, 20),
    makeCandle(2, 0, { high: 105 }),
    makeCandle(2, 1, { close: 99 }),
    makeCandle(2, 2, { close: 100 }), // still below the 101 reference level
  ]
  assert.equal(findPriorDayReclaimSignals(candles).length, 0)
})

test('signal detection is causal and deterministic: appending a later day never changes an earlier signal', () => {
  const base = [
    ...baselineDay(1, 20),
    makeCandle(2, 0, { high: 105 }),
    makeCandle(2, 1, { close: 99 }),
    makeCandle(2, 2, { close: 103 }),
  ]
  const withoutFuture = findPriorDayReclaimSignals(base)
  const withFuture = findPriorDayReclaimSignals([...base, ...baselineDay(3, 5)])
  assert.deepEqual(withoutFuture, withFuture.filter((s) => s.index <= 22))
})

test('entry occurs on the next candle open with a 1-ATR stop below entry', () => {
  const candles = [
    ...baselineDay(1, 20),
    makeCandle(2, 0, { high: 105 }),
    makeCandle(2, 1, { close: 99 }),
    makeCandle(2, 2, { close: 103 }),
    makeCandle(2, 3, { open: 104, high: 106, low: 103, close: 105 }),
  ]
  const occurrences = runPriorDayReclaimForSymbol(candles, 'TEST')
  assert.equal(occurrences.length, 1)
  assert.equal(occurrences[0].entryPrice, 104)
  assert.equal(occurrences[0].stopPrice, 104 - occurrences[0].risk)
  assert.ok(occurrences[0].risk > 0)
})
