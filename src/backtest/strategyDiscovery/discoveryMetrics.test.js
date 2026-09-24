import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildOccurrence,
  classifyResearchPeriod,
  computeAtr14Series,
  computeCostAdjustedR,
  computeExcursion,
  computeSessionVwapSeries,
  computeTrueRange,
  evaluateBarrierOutcome,
  summarizeOccurrences,
} from './discoveryMetrics.js'

function makeCandle({ timestamp, open = 100, high = 101, low = 99, close = 100, volume = 1000 }) {
  return { symbol: 'TEST', timeframe: '1h', timestamp, open, high, low, close, volume }
}

function makeFlatSeries(count, startHour = 0) {
  return Array.from({ length: count }, (_, index) =>
    makeCandle({ timestamp: `2023-01-01T${String(startHour + index).padStart(2, '0')}:00:00Z` }))
}

test('computeTrueRange and computeAtr14Series are causal and null before warmup', () => {
  const candles = makeFlatSeries(20)
  assert.equal(computeTrueRange(candles, 0), 2)
  const atr = computeAtr14Series(candles)
  assert.equal(atr[13], null)
  assert.equal(atr[14], 2)
  assert.equal(atr[19], 2)
})

test('computeSessionVwapSeries resets at UTC day boundaries and only uses information through the current candle', () => {
  const day1 = [
    makeCandle({ timestamp: '2023-01-01T10:00:00Z', high: 102, low: 98, close: 100, volume: 100 }),
    makeCandle({ timestamp: '2023-01-01T11:00:00Z', high: 104, low: 100, close: 102, volume: 100 }),
  ]
  const day2 = [makeCandle({ timestamp: '2023-01-02T10:00:00Z', high: 90, low: 88, close: 89, volume: 50 })]
  const vwap = computeSessionVwapSeries([...day1, ...day2])
  assert.equal(vwap[0], 100) // typical price of the first bar only
  assert.ok(vwap[1] > vwap[0]) // second bar's higher typical price pulls the cumulative VWAP up
  assert.equal(vwap[2], 89) // new day resets the accumulator
})

test('evaluateBarrierOutcome resolves Stop, Target, Ambiguous, Expired, and InsufficientData without guessing', () => {
  const stopOnly = [makeCandle({ timestamp: 't0' }), makeCandle({ timestamp: 't1', low: 90, high: 100 })]
  assert.equal(evaluateBarrierOutcome(stopOnly, 0, 95, 110, 5).status, 'Stop')

  const targetOnly = [makeCandle({ timestamp: 't0' }), makeCandle({ timestamp: 't1', low: 99, high: 120 })]
  assert.equal(evaluateBarrierOutcome(targetOnly, 0, 95, 110, 5).status, 'Target')

  const both = [makeCandle({ timestamp: 't0' }), makeCandle({ timestamp: 't1', low: 80, high: 120 })]
  const ambiguous = evaluateBarrierOutcome(both, 0, 95, 110, 5)
  assert.equal(ambiguous.status, 'Ambiguous')
  assert.equal(ambiguous.exitPrice, null)

  const neither = [makeCandle({ timestamp: 't0' }), makeCandle({ timestamp: 't1', low: 99, high: 101, close: 100 })]
  const expired = evaluateBarrierOutcome(neither, 0, 95, 110, 1)
  assert.equal(expired.status, 'Expired')
  assert.equal(expired.exitPrice, 100)

  const tooShort = [makeCandle({ timestamp: 't0' })]
  assert.equal(evaluateBarrierOutcome(tooShort, 0, 95, 110, 5).status, 'InsufficientData')
})

test('computeExcursion only reads bars within the fixed window (no leakage beyond it)', () => {
  const candles = [
    makeCandle({ timestamp: 't0' }),
    makeCandle({ timestamp: 't1', high: 105, low: 95 }),
    makeCandle({ timestamp: 't2', high: 200, low: 1 }), // outside a 1-bar window
  ]
  const within = computeExcursion(candles, 0, 100, 1, 1)
  assert.equal(within.mfeR, 5)
  assert.equal(within.maeR, -5)
})

test('computeCostAdjustedR converts basis-point costs into R using the trade risk', () => {
  const result = computeCostAdjustedR(1, 100, 2, { entryBps: 3, exitBps: 3 })
  // costPrice = 100 * (6/10000) = 0.06; costR = 0.06 / 2 = 0.03
  assert.ok(Math.abs(result - (1 - 0.03)) < 1e-9)
})

test('classifyResearchPeriod matches the committed development/out-of-sample/holdout windows', () => {
  assert.equal(classifyResearchPeriod('2023-06-01T00:00:00Z'), 'Development')
  assert.equal(classifyResearchPeriod('2025-06-01T00:00:00Z'), 'Out-of-Sample')
  assert.equal(classifyResearchPeriod('2026-02-01T00:00:00Z'), 'Holdout (2026 YTD)')
  assert.equal(classifyResearchPeriod('2021-12-31T00:00:00Z'), null)
})

test('buildOccurrence enters at the next candle open and stops at 1R below entry, and excludes a signal with no next candle', () => {
  const candles = [
    makeCandle({ timestamp: 't0', close: 100 }),
    makeCandle({ timestamp: 't1', open: 101, high: 103, low: 100, close: 101 }),
    makeCandle({ timestamp: 't2', high: 105, low: 100 }),
  ]
  const occurrence = buildOccurrence({ candles, signalIndex: 0, symbol: 'TEST', risk: 1, primaryLabel: 'test' })
  assert.equal(occurrence.entryPrice, 101)
  assert.equal(occurrence.stopPrice, 100)

  const noNextCandle = buildOccurrence({ candles, signalIndex: 2, symbol: 'TEST', risk: 1, primaryLabel: 'test' })
  assert.equal(noNextCandle, null)
})

test('summarizeOccurrences excludes ambiguous/insufficient/out-of-window occurrences from the R statistics but still counts them', () => {
  const occurrences = [
    { symbol: 'A', timestamp: '2023-01-01T00:00:00Z', period: 'Development', primaryStatus: 'Target', primaryR: 1, holdingBars: 2, mfeR: 1, maeR: -0.2, entryPrice: 100, risk: 1 },
    { symbol: 'A', timestamp: '2023-01-02T00:00:00Z', period: 'Development', primaryStatus: 'Stop', primaryR: -1, holdingBars: 1, mfeR: 0.1, maeR: -1, entryPrice: 100, risk: 1 },
    { symbol: 'A', timestamp: '2023-01-03T00:00:00Z', period: 'Development', primaryStatus: 'Ambiguous', primaryR: null, holdingBars: 1, mfeR: null, maeR: null, entryPrice: 100, risk: 1 },
    { symbol: 'A', timestamp: '2021-12-01T00:00:00Z', period: null, primaryStatus: 'Target', primaryR: 1, holdingBars: 1, mfeR: 1, maeR: 0, entryPrice: 100, risk: 1 },
  ]
  const summary = summarizeOccurrences(occurrences)
  assert.equal(summary.overall.occurrenceCount, 2)
  assert.equal(summary.excluded.ambiguousCount, 1)
  assert.equal(summary.excluded.outsideResearchWindowCount, 1)
  assert.equal(summary.overall.winRate, 0.5)
})

function makeOccurrence({ symbol, timestamp, primaryR }) {
  return { symbol, timestamp, period: 'Development', primaryStatus: primaryR >= 0 ? 'Target' : 'Stop', primaryR, holdingBars: 1, mfeR: Math.max(primaryR, 0), maeR: Math.min(primaryR, 0), entryPrice: 100, risk: 1 }
}

test('summarizeOccurrences interleaves multiple symbols by actual entry timestamp rather than symbol-by-symbol insertion order', () => {
  // Passed in symbol-by-symbol (as the runner produces them: all of A, then all of B, then all of
  // C) but chronologically the true entry order is t1 (B) -> t2 (C) -> t3 (A).
  const occurrences = [
    makeOccurrence({ symbol: 'A', timestamp: '2023-01-03T00:00:00Z', primaryR: -1 }),
    makeOccurrence({ symbol: 'B', timestamp: '2023-01-01T00:00:00Z', primaryR: 2 }),
    makeOccurrence({ symbol: 'C', timestamp: '2023-01-02T00:00:00Z', primaryR: -1 }),
  ]
  const summary = summarizeOccurrences(occurrences)
  // The true chronological equity path is +2 -> +1 -> 0, so the worst drawdown (2) happens at the
  // end, from the peak of 2 down to 0 \u2014 not the 1 you would get from the symbol-concatenated order.
  assert.equal(summary.overall.maximumDrawdown, 2)
  assert.equal(summary.overall.totalR, 0)
})

test('cost-tier drawdown is computed from the same interleaved chronological sequence as overall drawdown', () => {
  const occurrences = [
    makeOccurrence({ symbol: 'A', timestamp: '2023-01-03T00:00:00Z', primaryR: -1 }),
    makeOccurrence({ symbol: 'B', timestamp: '2023-01-01T00:00:00Z', primaryR: 2 }),
    makeOccurrence({ symbol: 'C', timestamp: '2023-01-02T00:00:00Z', primaryR: -1 }),
  ]
  const summary = summarizeOccurrences(occurrences)
  const beforeCosts = summary.costTiers.find((tier) => tier.label === 'Before execution costs')
  const lowFriction = summary.costTiers.find((tier) => tier.label === 'Low friction (1bp / 1bp)')
  // Before-costs tier applies zero cost, so it must exactly match the overall (already-chronological) drawdown.
  assert.equal(beforeCosts.metrics.maximumDrawdown, summary.overall.maximumDrawdown)
  // With entryPrice=100/risk=1, the 1bp/1bp tier subtracts a constant 0.02R from every occurrence.
  // Chronological equity: 1.98 -> 0.96 -> -0.06, so drawdown from the peak (1.98) down to -0.06 is 2.04.
  assert.ok(Math.abs(lowFriction.metrics.maximumDrawdown - 2.04) < 1e-9)
})

test('summarizeOccurrences produces deterministic results regardless of input insertion order', () => {
  const chronological = [
    makeOccurrence({ symbol: 'B', timestamp: '2023-01-01T00:00:00Z', primaryR: 2 }),
    makeOccurrence({ symbol: 'C', timestamp: '2023-01-02T00:00:00Z', primaryR: -1 }),
    makeOccurrence({ symbol: 'A', timestamp: '2023-01-03T00:00:00Z', primaryR: -1 }),
  ]
  const symbolConcatenated = [chronological[2], chronological[0], chronological[1]]
  const first = summarizeOccurrences(chronological)
  const second = summarizeOccurrences(symbolConcatenated)
  assert.deepEqual(first, second)
})

