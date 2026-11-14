import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  analyzeVwapReactionSession, VWAP_REACTION_METHODOLOGY, VWAP_REACTION_LONG,
  VWAP_REACTION_SHORT, VWAP_REACTION_COSTS_R,
} from './vwapReactionResearch.js'

const DAY = '2026-11-16' // Standard time: 09:30 America/New_York = 14:30 UTC.
const base = Date.parse('2026-11-16T14:30:00Z')
function bars(count = 28, overrides = {}, start = base) {
  return Array.from({ length: count }, (_, i) => ({
    timestamp: new Date(start + i * 300_000).toISOString(),
    open: 100, high: 100.4, low: 99.6, close: 100, volume: 1000,
    ...(overrides[i] || {}),
  }))
}
function setup(direction = 'long') {
  return {
    13: { open: 100, high: 100, low: 98.8, close: 99 },
    14: { open: 100, high: 100, low: 98.8, close: 99 },
    15: direction === 'long'
      ? { open: 99.5, high: 100.8, low: 99.3, close: 100.6 }
      : { open: 100.1, high: 100.3, low: 99.2, close: 99.4 },
    16: direction === 'long'
      ? { open: 100.1, high: 103, low: 100, close: 102.5 }
      : { open: 99.35, high: 99.6, low: 97.5, close: 98 },
  }
}
function run(candles, options = {}) {
  return analyzeVwapReactionSession(candles, {
    symbol: 'SPY', sessionDate: DAY, sessionClose: '16:00',
    completedThrough: new Date(base + candles.length * 300_000).toISOString(),
    ...options,
  })
}
const near = (x, y) => assert.ok(Math.abs(x-y) < 1e-8, `${x} != ${y}`)

test('bullish: two completed below-VWAP closes, then confirmed reclaim; next-open target', () => {
  const r = run(bars(28, setup('long')))
  assert.equal(r.status, 'AVAILABLE')
  assert.equal(r.methodologyId, VWAP_REACTION_METHODOLOGY)
  assert.equal(r.signals.length, 1)
  assert.equal(r.signals[0].candidateId, VWAP_REACTION_LONG)
  assert.equal(r.signals[0].decisionTimestamp, '2026-11-16T15:50:00.000Z')
  assert.equal(r.trades.length, 1)
  const t = r.trades[0]
  assert.equal(t.entryTimestamp, '2026-11-16T15:50:00.000Z')
  assert.equal(t.entryPrice, 100.1)
  assert.equal(t.exitReason, 'Target')
  near(t.grossR, 1.5)
  const primary = r.costTiers.find(x => x.costR === 0.05).byCandidate[VWAP_REACTION_LONG]
  near(primary.expectancyR, 1.45)
})

test('bearish rejection uses touch from below and an independently bearish candle', () => {
  const r = run(bars(28, setup('short')))
  assert.equal(r.status, 'AVAILABLE')
  assert.equal(r.signals[0].candidateId, VWAP_REACTION_SHORT)
  assert.ok(r.trades.length >= 1)
  assert.equal(r.trades[0].entryPrice, 99.35)
  assert.equal(r.trades[0].exitReason, 'Target')
  near(r.trades[0].grossR, 1.5)
})

test('invalid reclaim and non-bearish rejection are not accepted as signals', () => {
  const long = setup('long')
  long[15] = { open: 99.5, high: 100, low: 99.3, close: 99.7 }
  const short = setup('short')
  short[15] = { open: 99.1, high: 100.3, low: 99, close: 99.4 }
  assert.equal(run(bars(16, long)).signals.length, 0)
  assert.equal(run(bars(16, short)).signals.length, 0)
})

test('signal candle not complete at cutoff cannot signal or fill using future data', () => {
  const candles = bars(28, setup('long'))
  const r = run(candles, { completedThrough: candles[15].timestamp })
  assert.equal(r.status, 'AVAILABLE')
  assert.equal(r.signals.length, 0)
  assert.equal(r.completedBars, 15)
  assert.equal(r.incompleteBarsExcluded, 13)
})

test('missing session-open candle refuses to invent cumulative VWAP', () => {
  const r = run(bars(28).slice(1))
  assert.equal(r.status, 'UNAVAILABLE')
  assert.equal(r.reason, 'MISSING_SESSION_OPEN')
})

test('missing, duplicate and out-of-order five-minute bars are unavailable, not negative signals', () => {
  const original = bars(28)
  const absent = run(original.filter((_, i) => i !== 7))
  const duplicated = run([...original.slice(0, 2), original[1], ...original.slice(2)])
  const swapped = [...original]; [swapped[4], swapped[5]] = [swapped[5], swapped[4]]
  assert.equal(absent.reason, 'MISSING_OR_MISALIGNED_BAR')
  assert.equal(duplicated.reason, 'DUPLICATE_BAR')
  assert.equal(run(swapped).reason, 'MISSING_OR_MISALIGNED_BAR')
  assert.equal(absent.trades.length, 0)
})

test('zero volume, invalid OHLCV and a mismatched session are unavailable', () => {
  const invalidVolume = bars(28); invalidVolume[9].volume = 0
  const invalidPrice = bars(28); invalidPrice[9].high = 99
  assert.equal(run(invalidVolume).reason, 'INVALID_OHLCV_OR_TIMESTAMP')
  assert.equal(run(invalidPrice).reason, 'INVALID_OHLCV_OR_TIMESTAMP')
  assert.equal(run(bars(28), { sessionDate: '2026-11-17' }).reason, 'BAR_OUTSIDE_DECLARED_SESSION')
})

test('full regular-session boundaries work in summer DST and winter standard time', () => {
  const summerBase = Date.parse('2026-07-06T13:30:00Z')
  const r = run(bars(28, setup('long'), summerBase), {
    sessionDate: '2026-07-06', completedThrough: new Date(summerBase + 28*300_000).toISOString(),
  })
  assert.equal(r.status, 'AVAILABLE')
  assert.equal(r.signals.length, 1)
  assert.equal(r.trades.length, 1)
})

test('short opening gap beyond stop is filled adversely, not at a perfect stop', () => {
  const s = setup('short')
  s[16] = { open: 99.35, high: 99.6, low: 99.1, close: 99.4 }
  s[17] = { open: 101, high: 101.4, low: 100.7, close: 101.1 }
  const r = run(bars(28, s))
  assert.equal(r.trades[0].exitReason, 'Stop')
  assert.equal(r.trades[0].exitPrice, 101)
  assert.ok(r.trades[0].grossR < -1)
})

test('long stop/target collision is stop first with an ambiguity flag', () => {
  const s = setup('long')
  s[16] = { open: 100.1, low: 98, high: 104, close: 100 }
  const r = run(bars(28, s))
  assert.equal(r.trades[0].exitReason, 'Stop')
  assert.equal(r.trades[0].ambiguousStopTarget, true)
  near(r.trades[0].grossR, -1)
})

test('missing next-open and unresolved 12-bar hold are explicit skips', () => {
  const r = run(bars(16, setup('long')))
  assert.equal(r.signals.length, 1)
  assert.equal(r.trades.length, 0)
  assert.equal(r.skips[0].reason, 'NEXT_OPEN_UNAVAILABLE')
  const slower = setup('long')
  slower[16] = { open: 100.1, high: 100.2, low: 99.9, close: 100 }
  const r2 = run(bars(19, slower))
  assert.equal(r2.signals.length, 1)
  assert.equal(r2.skips[0].reason, 'HOLD_WINDOW_UNAVAILABLE')
})

test('60-minute expiration is at the twelfth exit-window candle close, no fabricated bar', () => {
  const slow = setup('long')
  slow[16] = { open: 100.1, high: 100.2, low: 99.9, close: 100 }
  const r = run(bars(28, slow))
  assert.equal(r.trades.length, 1)
  assert.equal(r.trades[0].exitReason, 'Time')
  assert.equal(r.trades[0].holdingBars, 12)
  assert.equal(r.trades[0].exitTimestamp, new Date(base + 27*300_000).toISOString())
})

test('13:00 early-close schedule is honored, not forced to 16:00', () => {
  const early = run(bars(28, setup('long')), { sessionClose: '13:00' })
  assert.equal(early.status, 'AVAILABLE')
  const afterClose = bars(45)
  assert.equal(run(afterClose, { sessionClose: '13:00' }).reason, 'BAR_OUTSIDE_DECLARED_SESSION')
})

test('cost tiers are fixed, include 0.20 R and charged exactly once per trade', () => {
  const r = run(bars(28, setup('long')))
  assert.deepEqual(r.costTiers.map(x => x.costR), VWAP_REACTION_COSTS_R)
  for (const tier of r.costTiers) near(tier.byCandidate[VWAP_REACTION_LONG].expectancyR, 1.5-tier.costR)
})

test('signal bar cannot change the prior-14-candle ATR used to size its own stop', () => {
  const ordinary = setup('long')
  const expanded = setup('long')
  expanded[15] = { open: 99.5, high: 104, low: 99.3, close: 100.6 }
  const first = run(bars(16, ordinary)).signals[0]
  const second = run(bars(16, expanded)).signals[0]
  near(first.atrPrior, second.atrPrior)
})

test('risk outside predeclared ATR bounds is skipped, not counted as resolved outcome', () => {
  const s = setup('long')
  s[16] = { open: 108, high: 108.3, low: 107.8, close: 108.1 }
  const r = run(bars(28, s))
  assert.equal(r.trades.length, 0)
  assert.equal(r.skips[0].reason, 'INVALID_RISK_GEOMETRY')
})

test('second same-direction reclaim in one session is not re-entered', () => {
  const s = setup('long')
  s[20] = { open: 100, high: 100, low: 98.8, close: 99 }
  s[21] = { open: 100, high: 100, low: 98.8, close: 99 }
  s[22] = { open: 99.5, high: 101, low: 99.3, close: 100.6 }
  s[23] = { open: 100.1, high: 103, low: 100, close: 102.5 }
  const r = run(bars(35, s))
  assert.equal(r.signals.filter(x => x.candidateId === VWAP_REACTION_LONG).length, 1)
})

test('verified 13:00 early close exits at final actual candle rather than inventing a 12th bar', () => {
  const s = {
    37: { open: 100, high: 100, low: 98.8, close: 99 },
    38: { open: 100, high: 100, low: 98.8, close: 99 },
    39: { open: 99.5, high: 100.8, low: 99.3, close: 100.6 },
    40: { open: 100.1, high: 100.2, low: 99.9, close: 100 },
    41: { open: 100, high: 100.2, low: 99.9, close: 100 },
  }
  const r = run(bars(42, s), { sessionClose: '13:00' })
  assert.equal(r.trades.length, 1)
  assert.equal(r.trades[0].exitReason, 'Time')
  assert.equal(r.trades[0].holdingBars, 2)
  assert.equal(r.trades[0].exitTimestamp, new Date(base + 41*300_000).toISOString())
})