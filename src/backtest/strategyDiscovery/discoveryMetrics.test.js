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
  outcomeToFinalR,
  summarizeOccurrences,
  summarizeSecondaryOutcome,
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

test('evaluateBarrierOutcome handles opening gaps conservatively and keeps ordinary intrabar touches at their barriers', () => {
  const stopGap = [
    makeCandle({ timestamp: 'entry', open: 100 }),
    makeCandle({ timestamp: 'gap-stop', open: 94, high: 112, low: 93 }),
  ]
  assert.deepEqual(evaluateBarrierOutcome(stopGap, 0, 95, 110, 1), {
    status: 'Stop', barsElapsed: 1, exitPrice: 94,
  })

  const targetGap = [
    makeCandle({ timestamp: 'entry', open: 100 }),
    makeCandle({ timestamp: 'gap-target', open: 112, high: 114, low: 94 }),
  ]
  assert.deepEqual(evaluateBarrierOutcome(targetGap, 0, 95, 110, 1), {
    status: 'Target', barsElapsed: 1, exitPrice: 110,
  })

  const ordinaryStop = [makeCandle({ timestamp: 'entry', open: 100 }), makeCandle({ timestamp: 'stop', open: 100, low: 94, high: 104 })]
  assert.equal(evaluateBarrierOutcome(ordinaryStop, 0, 95, 110, 1).exitPrice, 95)

  const ordinaryTarget = [makeCandle({ timestamp: 'entry', open: 100 }), makeCandle({ timestamp: 'target', open: 100, low: 99, high: 111 })]
  assert.equal(evaluateBarrierOutcome(ordinaryTarget, 0, 95, 110, 1).exitPrice, 110)

  const ambiguous = [makeCandle({ timestamp: 'entry', open: 100 }), makeCandle({ timestamp: 'both', open: 100, low: 94, high: 111 })]
  assert.equal(evaluateBarrierOutcome(ambiguous, 0, 95, 110, 1).status, 'Ambiguous')
})

test('outcomeToFinalR uses the adverse opening fill for a stop gap', () => {
  assert.equal(outcomeToFinalR({ status: 'Stop', exitPrice: 94 }, 100, 1, 1), -6)
  assert.equal(outcomeToFinalR({ status: 'Stop', exitPrice: 99 }, 100, 1, 1), -1)
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

test('buildOccurrence counts an entry-candle-only stop as the first holding bar', () => {
  const occurrence = buildOccurrence({
    candles: [
      makeCandle({ timestamp: 'signal' }),
      makeCandle({ timestamp: 'entry', open: 100, high: 100.5, low: 98, close: 100 }),
      makeCandle({ timestamp: 'later', high: 105, low: 100 }),
    ],
    signalIndex: 0,
    symbol: 'TEST',
    risk: 1,
    primaryMaxBars: 1,
    primaryLabel: 'test',
  })

  assert.equal(occurrence.primaryStatus, 'Stop')
  assert.equal(occurrence.primaryR, -1)
  assert.equal(occurrence.holdingBars, 1)
})

test('buildOccurrence reports the full loss when a later candle gaps through its stop', () => {
  const occurrence = buildOccurrence({
    candles: [
      makeCandle({ timestamp: 'signal' }),
      makeCandle({ timestamp: 'entry', open: 100, high: 100.5, low: 99.5, close: 100 }),
      makeCandle({ timestamp: 'gap-stop', open: 94, high: 96, low: 93, close: 95 }),
      makeCandle({ timestamp: 'later', high: 110, low: 90 }),
    ],
    signalIndex: 0,
    symbol: 'TEST',
    risk: 1,
    primaryMaxBars: 2,
    primaryLabel: 'test',
  })

  assert.equal(occurrence.primaryStatus, 'Stop')
  assert.equal(occurrence.primaryR, -6)
  assert.equal(occurrence.holdingBars, 2)
})

test('buildOccurrence counts an entry-candle-only target as the first holding bar', () => {
  const occurrence = buildOccurrence({
    candles: [
      makeCandle({ timestamp: 'signal' }),
      makeCandle({ timestamp: 'entry', open: 100, high: 102, low: 99.5, close: 101 }),
      makeCandle({ timestamp: 'later', high: 105, low: 100 }),
    ],
    signalIndex: 0,
    symbol: 'TEST',
    risk: 1,
    primaryMaxBars: 1,
    primaryLabel: 'test',
  })

  assert.equal(occurrence.primaryStatus, 'Target')
  assert.equal(occurrence.primaryR, 1)
  assert.equal(occurrence.holdingBars, 1)
})

test('buildOccurrence keeps an entry-candle stop and target conflict ambiguous', () => {
  const occurrence = buildOccurrence({
    candles: [
      makeCandle({ timestamp: 'signal' }),
      makeCandle({ timestamp: 'entry', open: 100, high: 102, low: 98, close: 100 }),
      makeCandle({ timestamp: 'later', high: 105, low: 100 }),
    ],
    signalIndex: 0,
    symbol: 'TEST',
    risk: 1,
    primaryMaxBars: 1,
    primaryLabel: 'test',
  })

  assert.equal(occurrence.primaryStatus, 'Ambiguous')
  assert.equal(occurrence.primaryR, null)
  assert.equal(occurrence.holdingBars, 1)
})

test('buildOccurrence includes entry-candle high and low in excursion but ignores signal-candle hits', () => {
  const excursion = buildOccurrence({
    candles: [
      makeCandle({ timestamp: 'signal', high: 500, low: 1 }),
      makeCandle({ timestamp: 'entry', open: 100, high: 105, low: 95, close: 100 }),
      makeCandle({ timestamp: 'later', high: 101, low: 99 }),
    ],
    signalIndex: 0,
    symbol: 'TEST',
    risk: 1,
    primaryMaxBars: 1,
    primaryLabel: 'test',
  })

  assert.equal(excursion.primaryStatus, 'Ambiguous')
  assert.equal(excursion.mfeR, 5)
  assert.equal(excursion.maeR, -5)

  const signalCandleOnlyHit = buildOccurrence({
    candles: [
      makeCandle({ timestamp: 'signal', high: 500, low: 1 }),
      makeCandle({ timestamp: 'entry', open: 100, high: 100.5, low: 99.5, close: 100 }),
      makeCandle({ timestamp: 'later', high: 105, low: 100 }),
    ],
    signalIndex: 0,
    symbol: 'TEST',
    risk: 1,
    primaryMaxBars: 1,
    primaryLabel: 'test',
  })

  assert.equal(signalCandleOnlyHit.primaryStatus, 'Expired')
  assert.equal(signalCandleOnlyHit.holdingBars, 1)
})

test('period summaries exclude a 2024 outcome candle that extends into 2025 and report it', () => {
  const occurrence = buildOccurrence({
    candles: [
      makeCandle({ timestamp: '2024-12-31T22:00:00Z' }),
      makeCandle({ timestamp: '2024-12-31T23:00:00Z', open: 100, high: 102, low: 99.5, close: 101 }),
      makeCandle({ timestamp: '2025-01-01T00:00:00Z' }),
    ],
    signalIndex: 0,
    symbol: 'TEST',
    risk: 1,
    primaryMaxBars: 1,
  })
  const summary = summarizeOccurrences([occurrence])

  assert.equal(occurrence.period, 'Development')
  assert.equal(occurrence.primaryR, 1)
  assert.equal(occurrence.primaryPeriodBoundaryExcluded, true)
  assert.equal(summary.overall.occurrenceCount, 0)
  assert.equal(summary.excluded.periodBoundaryCount, 1)
  assert.deepEqual(summary.excluded.periodBoundaryByPeriod.find((entry) => entry.period === 'Development'), { period: 'Development', count: 1 })
})

test('primary and secondary horizons are checked separately across the 2025/2026 boundary', () => {
  const candles = Array.from({ length: 12 }, (_, index) => {
    const time = Date.parse('2025-12-31T21:00:00Z') + index * 60 * 60 * 1000
    return makeCandle({ timestamp: new Date(time).toISOString(), open: 100, high: 100.5, low: 99.5, close: 100 })
  })
  const occurrence = buildOccurrence({
    candles,
    signalIndex: 0,
    symbol: 'TEST',
    risk: 1,
    getPrimaryUpperPrice: (entryPrice, risk) => entryPrice + 3 * risk,
    primaryMaxBars: 1,
  })
  const secondary = summarizeSecondaryOutcome([occurrence], 'secondary1R5')
  const secondaryLong = summarizeSecondaryOutcome([occurrence], 'secondary2R10')
  const summary = summarizeOccurrences([occurrence])

  assert.equal(occurrence.period, 'Out-of-Sample')
  assert.equal(occurrence.primaryStatus, 'Expired')
  assert.equal(occurrence.primaryPeriodBoundaryExcluded, false)
  assert.equal(summary.overall.occurrenceCount, 1)
  assert.equal(occurrence.secondary1R5.periodBoundaryExcluded, true)
  assert.equal(occurrence.secondary2R10.periodBoundaryExcluded, true)
  assert.equal(secondary.occurrenceCount, 0)
  assert.equal(secondary.periodBoundaryExcludedCount, 1)
  assert.equal(secondaryLong.periodBoundaryExcludedCount, 1)
  assert.equal(occurrence.excursionPeriodBoundaryExcluded, true)
  assert.equal(summary.excluded.excursionPeriodBoundaryCount, 1)
  assert.equal(summary.overall.excursionObservationCount, 0)
  assert.equal(summary.overall.averageMfeR, null)
  assert.equal(summary.overall.averageMaeR, null)
})

test('an outcome whose last candle completes exactly before a period boundary remains eligible', () => {
  const occurrence = buildOccurrence({
    candles: [
      makeCandle({ timestamp: '2024-12-31T21:00:00Z' }),
      makeCandle({ timestamp: '2024-12-31T22:00:00Z', open: 100, high: 102, low: 99.5, close: 101 }),
      makeCandle({ timestamp: '2024-12-31T23:00:00Z' }),
    ],
    signalIndex: 0,
    symbol: 'TEST',
    risk: 1,
    primaryMaxBars: 1,
  })
  const summary = summarizeOccurrences([occurrence])
  assert.equal(occurrence.primaryPeriodBoundaryExcluded, false)
  assert.equal(summary.overall.occurrenceCount, 1)
  assert.equal(summary.excluded.periodBoundaryCount, 0)
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

test('summarizeOccurrences keeps empty cost-tier metrics at zero for the display layer to mark unavailable', () => {
  const summary = summarizeOccurrences([])

  assert.equal(summary.overall.occurrenceCount, 0)
  assert.ok(summary.costTiers.length > 0)
  summary.costTiers.forEach((tier) => {
    assert.equal(tier.metrics.occurrenceCount, 0)
    assert.equal(tier.metrics.winRate, 0)
    assert.equal(tier.metrics.profitFactor, 0)
    assert.equal(tier.metrics.averageR, 0)
  })
})

test('summarizeOccurrences reports ambiguous count and rate against classifiable in-window outcomes only', () => {
  const summary = summarizeOccurrences([
    { symbol: 'A', timestamp: '2023-01-01T00:00:00Z', period: 'Development', primaryStatus: 'Target', primaryR: 1, holdingBars: 1, mfeR: 1, maeR: 0 },
    { symbol: 'A', timestamp: '2023-01-02T00:00:00Z', period: 'Development', primaryStatus: 'Ambiguous', primaryR: null, holdingBars: 1, mfeR: null, maeR: null },
    { symbol: 'A', timestamp: '2021-01-01T00:00:00Z', period: null, primaryStatus: 'Ambiguous', primaryR: null, holdingBars: 1, mfeR: null, maeR: null },
    { symbol: 'A', timestamp: '2023-01-03T00:00:00Z', period: 'Development', primaryStatus: 'InsufficientData', primaryR: null, holdingBars: 0, mfeR: null, maeR: null },
  ])

  assert.equal(summary.excluded.ambiguousCount, 2)
  assert.equal(summary.excluded.ambiguousInResearchWindowCount, 1)
  assert.equal(summary.excluded.classifiableInResearchWindowCount, 2)
  assert.equal(summary.excluded.ambiguousInResearchWindowRate, 0.5)
  assert.equal(summarizeOccurrences([]).excluded.ambiguousInResearchWindowRate, null)
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

test('summarizeOccurrences uses deterministic ordering when entry timestamps tie', () => {
  const simultaneous = [
    makeOccurrence({ symbol: 'A', timestamp: '2023-01-02T00:00:00Z', primaryR: 5 }),
    makeOccurrence({ symbol: 'B', timestamp: '2023-01-02T00:00:00Z', primaryR: -2 }),
    makeOccurrence({ symbol: 'C', timestamp: '2023-01-02T00:00:00Z', primaryR: -2 }),
  ]

  assert.deepEqual(
    summarizeOccurrences(simultaneous),
    summarizeOccurrences([...simultaneous].reverse()),
  )
})

