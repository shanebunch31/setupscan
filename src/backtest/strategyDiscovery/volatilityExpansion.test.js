import assert from 'node:assert/strict'
import { test } from 'node:test'
import { findVolatilityExpansionSignals, runVolatilityExpansionForSymbol } from './volatilityExpansion.js'

function makeCandle(index, overrides = {}) {
  const timestamp = `2023-01-${String(1 + Math.floor(index / 24)).padStart(2, '0')}T${String(index % 24).padStart(2, '0')}:00:00Z`
  return { symbol: 'TEST', timeframe: '1h', timestamp, open: 100, high: 101, low: 99, close: 100, volume: 1000, ...overrides }
}

function buildCompressionThenExpansionSeries() {
  const baseline = Array.from({ length: 24 }, (_, index) => makeCandle(index))
  const compressed = Array.from({ length: 14 }, (_, offset) => makeCandle(24 + offset, { open: 100, high: 100.2, low: 100, close: 100.1 }))
  const expansion = makeCandle(38, { open: 100.1, high: 105, low: 100, close: 104 })
  return [...baseline, ...compressed, expansion]
}

test('detects compression followed by a bullish range-expansion candle', () => {
  const candles = buildCompressionThenExpansionSeries()
  const signals = findVolatilityExpansionSignals(candles)
  assert.equal(signals.length, 1)
  assert.equal(signals[0].index, 38)
})

test('does not signal on a large-range candle without a prior compression reading', () => {
  const baseline = Array.from({ length: 38 }, (_, index) => makeCandle(index))
  const expansion = makeCandle(38, { open: 100, high: 105, low: 100, close: 104 })
  assert.equal(findVolatilityExpansionSignals([...baseline, expansion]).length, 0)
})

test('does not signal an expansion candle that closes in the lower half of its own range', () => {
  const candles = buildCompressionThenExpansionSeries()
  candles[38] = makeCandle(38, { open: 100.1, high: 105, low: 100, close: 100.5 }) // closes in the lower half
  assert.equal(findVolatilityExpansionSignals(candles).length, 0)
})

test('signal detection is causal: a later candle never changes an earlier signal', () => {
  const base = buildCompressionThenExpansionSeries()
  const withoutFuture = findVolatilityExpansionSignals(base)
  const withFuture = findVolatilityExpansionSignals([...base, makeCandle(39, { high: 500, low: 1, close: 500 })])
  assert.deepEqual(withoutFuture.map((s) => s.index), withFuture.filter((s) => s.index <= 38).map((s) => s.index))
})

test('entry occurs on the next candle open with a 1-ATR stop below entry', () => {
  const candles = buildCompressionThenExpansionSeries()
  candles.push(makeCandle(39, { open: 104.5, high: 106, low: 104, close: 105 }))
  const occurrences = runVolatilityExpansionForSymbol(candles, 'TEST')
  assert.equal(occurrences.length, 1)
  assert.equal(occurrences[0].entryPrice, 104.5)
  assert.equal(occurrences[0].stopPrice, 104.5 - occurrences[0].risk)
})
