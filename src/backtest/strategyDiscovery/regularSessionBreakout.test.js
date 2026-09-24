import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  filterToRegularSessionBars,
  runRegularSessionBreakoutForSymbol,
  runRegularSessionBreakoutResearch,
  compareToBatchA,
} from './regularSessionBreakout.js'
import { findMomentumBreakoutSignals, momentumBreakoutMeta } from './momentumBreakout.js'

// All timestamps below use EDT (UTC-4, summer) unless a test explicitly needs EST (UTC-5, winter).
function makeCandle(dayIndex, easternHour, overrides = {}, utcOffsetHours = 4) {
  const utcHour = easternHour + utcOffsetHours
  const day = 12 + dayIndex // 2023-06-12 .. 2023-06-xx
  const timestamp = `2023-06-${String(day).padStart(2, '0')}T${String(utcHour).padStart(2, '0')}:00:00Z`
  return { timeframe: '1h', timestamp, open: 100, high: 101, low: 99, close: 100, volume: 1000, ...overrides }
}

function baselineDay(dayIndex, hours = [9, 10, 11, 12, 13, 14, 15, 16]) {
  return hours.map((hour) => makeCandle(dayIndex, hour))
}

function buildDataset(symbol, candles, status = 'AVAILABLE') {
  return status === 'AVAILABLE' ? { symbol, status, data: { candles } } : { symbol, status }
}

test('session filtering: keeps only 10:00-15:00 ET bars and excludes 09:00, 16:00, and extended hours', () => {
  const day = [
    makeCandle(0, 6), makeCandle(0, 8), makeCandle(0, 9), // extended hours + 09:00 boundary
    makeCandle(0, 10), makeCandle(0, 11), makeCandle(0, 12), makeCandle(0, 13), makeCandle(0, 14), makeCandle(0, 15), // regular
    makeCandle(0, 16), makeCandle(0, 18), makeCandle(0, 20), // 16:00 boundary + extended hours
  ]
  const filtered = filterToRegularSessionBars(day)
  assert.equal(filtered.length, 6)
  const easternHoursKept = filtered.map((candle) => (Number(candle.timestamp.slice(11, 13)) - 4 + 24) % 24)
  assert.deepEqual(easternHoursKept, [10, 11, 12, 13, 14, 15])
})

test('session filtering handles both EDT and EST correctly', () => {
  // Winter (EST, UTC-5): 14:00 UTC = 09:00 ET (excluded), 15:00 UTC = 10:00 ET (included), 21:00 UTC = 16:00 ET (excluded).
  const winterDay = [
    { ...makeCandle(0, 9, {}, 5), timestamp: '2023-01-11T14:00:00Z' },
    { ...makeCandle(0, 10, {}, 5), timestamp: '2023-01-11T15:00:00Z' },
    { ...makeCandle(0, 16, {}, 5), timestamp: '2023-01-11T21:00:00Z' },
  ]
  const filtered = filterToRegularSessionBars(winterDay)
  assert.equal(filtered.length, 1)
  assert.equal(filtered[0].timestamp, '2023-01-11T15:00:00Z')
})

test('the 20-bar lookback, ATR, and volume average operate ONLY on the filtered regular-session series, never on excluded extended-hours candles', () => {
  const days = [0, 1, 2, 3].flatMap((dayIndex) =>
    baselineDay(dayIndex).map((candle) => {
      const easternHour = (Number(candle.timestamp.slice(11, 13)) - 4 + 24) % 24
      // Extreme values ONLY on the excluded 09:00/16:00 bars \u2014 if the code incorrectly included them
      // in the lookback, the artificially huge prior high would suppress or distort the real signal.
      return (easternHour === 9 || easternHour === 16) ? { ...candle, high: 99999, low: 1, volume: 999999 } : candle
    }))
  const signalDay = [
    { ...makeCandle(4, 9), high: 99999, low: 1, volume: 999999 },
    makeCandle(4, 10), makeCandle(4, 11), makeCandle(4, 12), makeCandle(4, 13), makeCandle(4, 14),
    makeCandle(4, 15, { high: 110, close: 105, volume: 3000 }), // the real breakout, on a kept bar
    { ...makeCandle(4, 16), high: 99999, low: 1, volume: 999999 },
  ]
  const entryDay = [
    { ...makeCandle(5, 9), high: 99999, low: 1, volume: 999999 },
    makeCandle(5, 10, { open: 106, high: 108, low: 105, close: 107 }), // the real next regular-session entry candle
    makeCandle(5, 11, { high: 1000, low: 105, close: 500 }), // guarantees +1R target regardless of exact ATR
  ]
  const raw = [...days, ...signalDay, ...entryDay]
  const filtered = filterToRegularSessionBars(raw)
  const signals = findMomentumBreakoutSignals(filtered)
  assert.equal(signals.length, 1, 'the extreme extended-hours bars must not have suppressed or altered the real breakout')

  const occurrences = runRegularSessionBreakoutForSymbol(raw, 'TEST')
  assert.equal(occurrences.length, 1)
  // Entry must be the next FILTERED (regular-session) candle's open \u2014 day5's real 10:00 ET bar \u2014
  // not the day4 16:00 postmarket bar and not the day5 09:00 boundary bar.
  assert.equal(occurrences[0].entryPrice, 106)
})

test('a 15:00 ET signal cannot enter on the 16:00 postmarket bar; the next eligible regular-session candle is used instead', () => {
  const days = [0, 1, 2, 3].flatMap((dayIndex) => baselineDay(dayIndex))
  const signalDay = [
    makeCandle(4, 9), makeCandle(4, 10), makeCandle(4, 11), makeCandle(4, 12), makeCandle(4, 13), makeCandle(4, 14),
    makeCandle(4, 15, { high: 110, close: 105, volume: 3000 }),
    makeCandle(4, 16, { open: 9999, high: 9999, low: 9999, close: 9999 }), // would be the (wrong) entry if filtering failed
  ]
  const entryDay = [
    makeCandle(5, 9, { open: -500, high: -500, low: -500, close: -500 }), // would also be a wrong entry if not excluded
    makeCandle(5, 10, { open: 106, high: 108, low: 105, close: 107 }),
  ]
  const occurrences = runRegularSessionBreakoutForSymbol([...days, ...signalDay, ...entryDay], 'TEST')
  assert.equal(occurrences.length, 1)
  assert.equal(occurrences[0].entryPrice, 106)
})

test('classifies a genuinely ambiguous stop/target bar as excluded rather than guessing', () => {
  const days = [0, 1, 2, 3].flatMap((dayIndex) => baselineDay(dayIndex))
  const signalDay = [
    makeCandle(4, 9), makeCandle(4, 10), makeCandle(4, 11), makeCandle(4, 12), makeCandle(4, 13), makeCandle(4, 14),
    makeCandle(4, 15, { high: 110, close: 105, volume: 3000 }),
    makeCandle(4, 16),
  ]
  const entryDay = [
    makeCandle(5, 9),
    makeCandle(5, 10, { open: 106, high: 108, low: 105, close: 107 }),
    makeCandle(5, 11, { high: 500, low: 1, close: 100 }), // both stop and target fall within this bar's range
  ]
  const occurrences = runRegularSessionBreakoutForSymbol([...days, ...signalDay, ...entryDay], 'TEST')
  assert.equal(occurrences.length, 1)
  assert.equal(occurrences[0].primaryStatus, 'Ambiguous')
  assert.equal(occurrences[0].primaryR, null)
})

test('signal detection and entry are causal: appending future candles never changes an earlier signal\u2019s occurrence', () => {
  const days = [0, 1, 2, 3].flatMap((dayIndex) => baselineDay(dayIndex))
  const signalDay = [
    makeCandle(4, 9), makeCandle(4, 10), makeCandle(4, 11), makeCandle(4, 12), makeCandle(4, 13), makeCandle(4, 14),
    makeCandle(4, 15, { high: 110, close: 105, volume: 3000 }),
    makeCandle(4, 16),
  ]
  const entryDay = [
    makeCandle(5, 9),
    makeCandle(5, 10, { open: 106, high: 108, low: 105, close: 107 }),
    ...baselineDay(5).filter((c) => Number(c.timestamp.slice(11, 13)) > 15).slice(0, 0), // no-op, keeps structure explicit
    ...[11, 12, 13, 14, 15].map((hour) => makeCandle(5, hour)), // pad the outcome window with real regular-session data
  ]
  const base = [...days, ...signalDay, ...entryDay]
  const future = [...base, ...baselineDay(6), makeCandle(7, 10, { high: 99999, low: 1, close: 99999 })]
  const baseOccurrences = runRegularSessionBreakoutForSymbol(base, 'TEST')
  const futureOccurrences = runRegularSessionBreakoutForSymbol(future, 'TEST')
  assert.deepEqual(baseOccurrences, futureOccurrences)
})

test('reports unavailable, without inventing results, when the SPY/QQQ/IWM universe is not fully available', () => {
  const result = runRegularSessionBreakoutResearch([buildDataset('SPY', baselineDay(0)), buildDataset('QQQ', [], 'UNAVAILABLE')])
  assert.equal(result.available, false)
  assert.deepEqual(result.missingSymbols.sort(), ['IWM', 'QQQ'])
})

test('merges occurrences from multiple symbols into one chronologically-ordered sequence (reuses summarizeOccurrences unchanged)', () => {
  function buildSignalSeries(dayOffset, outcomeR) {
    const days = [0, 1, 2, 3].map((d) => baselineDay(d + dayOffset)).flat()
    const signalDay = [
      makeCandle(4 + dayOffset, 9), makeCandle(4 + dayOffset, 10), makeCandle(4 + dayOffset, 11), makeCandle(4 + dayOffset, 12),
      makeCandle(4 + dayOffset, 13), makeCandle(4 + dayOffset, 14), makeCandle(4 + dayOffset, 15, { high: 110, close: 105, volume: 3000 }),
      makeCandle(4 + dayOffset, 16),
    ]
    const outcomeCandle = outcomeR === 'win'
      ? makeCandle(5 + dayOffset, 11, { high: 1000, low: 105, close: 500 })
      : makeCandle(5 + dayOffset, 11, { high: 108, low: 1, close: 2 })
    const entryDay = [makeCandle(5 + dayOffset, 9), makeCandle(5 + dayOffset, 10, { open: 106, high: 108, low: 105, close: 107 }), outcomeCandle]
    return [...days, ...signalDay, ...entryDay]
  }
  const datasets = [
    buildDataset('SPY', buildSignalSeries(10, 'loss')), // later calendar time
    buildDataset('QQQ', baselineDay(0)),
    buildDataset('IWM', buildSignalSeries(0, 'win')), // earlier calendar time
  ]
  const result = runRegularSessionBreakoutResearch(datasets)
  assert.equal(result.available, true)
  assert.equal(result.summary.overall.occurrenceCount, 2)
  const symbolsRepresented = result.summary.bySymbol.map((row) => row.label).sort()
  assert.deepEqual(symbolsRepresented, ['IWM', 'SPY'])
})

test('produces deterministic results across repeated runs on the same input', () => {
  const datasets = [
    buildDataset('SPY', baselineDay(0)),
    buildDataset('QQQ', baselineDay(0)),
    buildDataset('IWM', baselineDay(0)),
  ]
  const strip = (result) => ({ ...result, generatedAt: null })
  assert.deepEqual(strip(runRegularSessionBreakoutResearch(datasets)), strip(runRegularSessionBreakoutResearch(datasets)))
})

test('compareToBatchA reports numeric diffs only, without labeling either version', () => {
  const summaryA = { overall: { occurrenceCount: 10, winRate: 0.5, profitFactor: 1.2, expectancy: 0.1, medianR: 0.2, totalR: 1, maximumDrawdown: 2, averageHoldingBars: 2, averageMfeR: 1, averageMaeR: -1 }, byPeriod: [{ label: 'Development', occurrenceCount: 10, expectancy: 0.1, winRate: 0.5 }], bySymbol: [{ label: 'SPY', occurrenceCount: 10, expectancy: 0.1, winRate: 0.5 }], costTiers: [{ label: 'Before execution costs', metrics: { occurrenceCount: 10, expectancy: 0.1, winRate: 0.5 } }] }
  const summaryC = { overall: { occurrenceCount: 6, winRate: 0.6, profitFactor: 1.4, expectancy: 0.2, medianR: 0.3, totalR: 1.2, maximumDrawdown: 1.5, averageHoldingBars: 2.2, averageMfeR: 1.1, averageMaeR: -0.9 }, byPeriod: [{ label: 'Development', occurrenceCount: 6, expectancy: 0.2, winRate: 0.6 }], bySymbol: [{ label: 'SPY', occurrenceCount: 6, expectancy: 0.2, winRate: 0.6 }], costTiers: [{ label: 'Before execution costs', metrics: { occurrenceCount: 6, expectancy: 0.2, winRate: 0.6 } }] }
  const diff = compareToBatchA(summaryA, summaryC)
  assert.equal(diff.overall.occurrenceCount.diff, -4)
  assert.ok(Math.abs(diff.overall.expectancy.diff - 0.1) < 1e-9)
  const json = JSON.stringify(diff).toLowerCase()
  ;['better', 'best', 'superior', 'validated', 'profitable', 'winner', 'the edge'].forEach((word) => assert.ok(!json.includes(word)))
})

test('regression: the frozen Batch A momentum-breakout definition and detection function are unchanged by Batch C', () => {
  assert.equal(momentumBreakoutMeta.parameters.lookbackBars, 20)
  assert.equal(momentumBreakoutMeta.parameters.volumeMultiple, 1.2)
  assert.equal(momentumBreakoutMeta.parameters.primaryOutcome, '+1R before -1R within 5 completed candles')
  // findMomentumBreakoutSignals itself remains session-agnostic (Batch A never filtered by session) \u2014
  // a breakout on an extended-hours (16:00 ET) bar is still detected when the FULL, unfiltered series is used.
  const days = [0, 1, 2, 3].flatMap((dayIndex) => baselineDay(dayIndex))
  const fullSessionSignalDay = [...baselineDay(4).slice(0, 7), makeCandle(4, 16, { high: 110, close: 105, volume: 3000 })]
  const fullSessionSignals = findMomentumBreakoutSignals([...days, ...fullSessionSignalDay])
  assert.equal(fullSessionSignals.length, 1)
})
