import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildExecutionResolutionPair, runCandidateExecutionResolution, summarizeExecutionResolution, executionResolutionConfiguration } from './candidateExecutionResolution.js'
import { runCandidateExitManagement } from './candidateExitManagement.js'
import { buildTradeFromIndex } from './signalQualityBacktest.js'
import { candidatePeriods } from './candidateContextRobustness.js'
const start = Date.parse('2024-06-03T14:00:00Z')
const iso = (t) => new Date(t).toISOString()
const bar = (time, timeframe = '1Hour', overrides = {}) => ({ symbol: 'SPY', timeframe, timestamp: iso(time), open: 100, high: 100.2, low: 99.8, close: 100, volume: 1000, ...overrides })
const fixture = () => ({
  hourly: Array.from({ length: 13 }, (_, i) => bar(start + i * 3600000)),
  five: Array.from({ length: 144 }, (_, i) => bar(start + 3600000 + i * 300000, '5Min')),
  record: { symbol: 'SPY', timestamp: iso(start), decisionTimestamp: iso(start + 3600000), exclusionReason: null },
})
const full = { key: 'full', type: 'full', label: 'Full', start: '2022-01-01T00:00:00Z', end: '2026-12-31T23:59:59Z' }
const pair = (f) => buildExecutionResolutionPair(f.record, f.hourly, 0, f.five)

test('same hourly signal, unchanged hourly builder, deterministic 5Min open at completion and 12-hour deadline', () => {
  const f = fixture()
  f.five.unshift(bar(start, '5Min', { high: 500, low: 1 }))
  const result = pair(f)
  assert.deepEqual(result.methods.hourly.trade, buildTradeFromIndex(f.hourly, 0, executionResolutionConfiguration, { symbol: 'SPY' }))
  assert.equal(result.timestamp, f.record.timestamp)
  assert.equal(result.methods.fiveMinute.entryTimestamp, f.record.decisionTimestamp)
  assert.equal(result.methods.fiveMinute.trade.holdingBars, 144)
  assert.equal(result.methods.fiveMinute.trade.holdingTime, 720)
  assert.equal(result.methods.fiveMinute.outcomeTimestamp, result.deadline)
  assert.equal(result.methods.fiveMinute.trade.exitReason, 'Expired')
  assert.deepEqual(pair(f), result)
})

test('5Min exit checks entry bar, stops first between barriers, and preserves adverse stop and target gaps', () => {
  for (const [changes, expectedReason, expectedR] of [
    [{ low: 99.4 }, 'Stop', -1], [{ high: 101.1 }, 'Target', 2], [{ low: 99.4, high: 101.1 }, 'Stop', -1],
  ]) {
    const f = fixture(); Object.assign(f.five[0], changes)
    const result = pair(f).methods.fiveMinute.trade
    assert.equal(result.exitReason, expectedReason); assert.equal(result.rMultiple, expectedR)
    assert.equal(result.holdingBars, 1)
    assert.equal(result.ambiguousCandle, changes.low != null && changes.high != null)
  }
  for (const [open, expectedPrice, reason] of [[98, 98, 'Stop'], [102, 101, 'Target']]) {
    const f = fixture(); f.five[1] = bar(start + 3900000, '5Min', { open, high: 103, low: 97 })
    const result = pair(f).methods.fiveMinute.trade
    assert.equal(result.exitPrice, expectedPrice); assert.equal(result.exitReason, reason)
  }
})

test('missing execution coverage excludes safely; no extension or 60-minute expiry is invented', () => {
  const f = fixture()
  const missing = pair({ ...f, five: [] })
  assert.equal(missing.methods.fiveMinute.exclusionReason, 'missing-5min-entry')
  for (const five of [f.five.slice(0, 12), f.five.filter((_, i) => i !== 3)]) {
    assert.equal(pair({ ...f, five }).methods.fiveMinute.exclusionReason, 'missing-5min-outcome-coverage')
  }
  const tail = pair({ ...f, hourly: f.hourly.slice(0, 10) })
  assert.equal(tail.methods.hourly.exclusionReason, 'incomplete-shared-horizon')
  assert.equal(tail.methods.fiveMinute.exclusionReason, 'incomplete-shared-horizon')
})

test('next supplied execution open is reported as delayed; future bar highs never choose entry', () => {
  const f = fixture(); f.five = f.five.slice(2)
  f.five[1].high = 102
  const p = pair(f)
  assert.equal(p.methods.fiveMinute.entryTimestamp, f.five[0].timestamp)
  const row = summarizeExecutionResolution([p], ['SPY'], [full])[0]
  assert.equal(row.methods.fiveMinute.averageEntryDelayMinutes, 10)
  assert.equal(row.delayedFiveMinuteEntries, 1)
})

test('same absolute hourly deadline spans overnight gaps; absent later-session 5Min coverage is excluded', () => {
  const f = fixture()
  f.hourly = f.hourly.map((b, i) => i >= 4 ? { ...b, timestamp: iso(Date.parse(b.timestamp) + 18 * 3600000) } : b)
  const p = pair(f)
  assert.equal(p.deadline, iso(start + 31 * 3600000))
  assert.equal(p.methods.fiveMinute.exclusionReason, 'missing-5min-outcome-coverage')
})

function sessionFixture(opens) {
  const hourly = opens.flatMap((open) => Array.from({ length: 6 }, (_, i) => bar(Date.parse(open) + (30 + i * 60) * 60000))).slice(0, 13)
  const deadline = Date.parse(hourly[12].timestamp) + 3600000
  return {
    hourly,
    five: opens.flatMap((open) => Array.from({ length: 78 }, (_, i) => bar(Date.parse(open) + i * 300000, '5Min')))
      .filter((b) => Date.parse(b.timestamp) + 300000 <= deadline),
    record: { symbol: 'SPY', timestamp: hourly[0].timestamp, decisionTimestamp: iso(Date.parse(hourly[0].timestamp) + 3600000), exclusionReason: null },
  }
}

test('complete session coverage spans overnight and a DST weekend without synthetic bars or a changed deadline', () => {
  for (const opens of [
    ['2024-06-03T13:30:00Z', '2024-06-04T13:30:00Z', '2024-06-05T13:30:00Z'],
    ['2024-11-01T13:30:00Z', '2024-11-04T14:30:00Z', '2024-11-05T14:30:00Z'],
  ]) {
    const f = sessionFixture(opens)
    const before = structuredClone(f)
    const p = pair(f)
    assert.equal(p.methods.fiveMinute.exclusionReason, null)
    assert.equal(p.methods.fiveMinute.trade.exitReason, 'Expired')
    assert.equal(p.methods.fiveMinute.entryTimestamp, f.record.decisionTimestamp)
    assert.equal(p.deadline, iso(Date.parse(f.hourly[12].timestamp) + 3600000))
    assert.equal(p.methods.fiveMinute.outcomeTimestamp, p.deadline)
    assert.equal(p.methods.fiveMinute.trade.holdingBars, f.five.filter((b) => b.timestamp >= f.record.decisionTimestamp).length)
    assert.deepEqual(p.methods.hourly.trade, buildTradeFromIndex(f.hourly, 0, executionResolutionConfiguration, { symbol: 'SPY' }))
    assert.deepEqual(f, before)
  }
})

test('missing regular-session bars still exclude, including the open and intervals with no hourly bar', () => {
  const f = sessionFixture(['2024-06-03T13:30:00Z', '2024-06-04T13:30:00Z', '2024-06-05T13:30:00Z'])
  for (const missing of ['2024-06-04T13:30:00.000Z', '2024-06-04T13:45:00.000Z', '2024-06-04T16:00:00.000Z', f.five.at(-1).timestamp]) {
    const p = pair({ ...f, five: f.five.filter((b) => b.timestamp !== missing) })
    assert.equal(p.methods.fiveMinute.exclusionReason, 'missing-5min-outcome-coverage', missing)
  }
})

test('missing extended-hours 5Min bars do not exclude when regular-session coverage is complete', () => {
  const f = fixture()
  // 17:00 Eastern is outside regular hours. v3 allows sparse extended-hours gaps
  // and does not require a perfect 5Min grid merely because an hourly bar exists.
  const missing = '2024-06-03T21:15:00.000Z'

  const p = pair({
    ...f,
    five: f.five.filter((b) => b.timestamp !== missing),
  })

  assert.equal(p.methods.fiveMinute.exclusionReason, null)
  assert.ok(p.methods.fiveMinute.trade)
})

test('after a closed-market gap the first supplied bar still uses adverse gap fills and stop-first ordering', () => {
  for (const open of [98, 100]) {
    const f = sessionFixture(['2024-06-03T13:30:00Z', '2024-06-04T13:30:00Z', '2024-06-05T13:30:00Z'])
    Object.assign(f.five.find((b) => b.timestamp === '2024-06-04T13:30:00.000Z'), { open, low: 97, high: 102 })
    const p = pair(f)
    assert.equal(p.methods.fiveMinute.exclusionReason, null)
    assert.equal(p.methods.fiveMinute.trade.exitReason, 'Stop')
    assert.equal(p.methods.fiveMinute.trade.exitPrice, open === 98 ? 98 : 99.5)
  }
})

test('an unverified weekday closure or shortened session is conservatively excluded without a holiday calendar', () => {
  const f = sessionFixture(['2024-06-03T13:30:00Z', '2024-06-05T13:30:00Z', '2024-06-06T13:30:00Z'])
  assert.equal(pair(f).methods.fiveMinute.exclusionReason, 'missing-5min-outcome-coverage')
  const short = sessionFixture(['2024-06-03T13:30:00Z', '2024-06-04T13:30:00Z', '2024-06-05T13:30:00Z'])
  short.five = short.five.filter((b) => b.timestamp < '2024-06-03T17:00:00.000Z' || b.timestamp >= '2024-06-04T00:00:00.000Z')
  assert.equal(pair(short).methods.fiveMinute.exclusionReason, 'missing-5min-outcome-coverage')
})

test('paired costs/differences and entry-price direction use identical resolved sample, unavailable stays null', () => {
  const f = fixture(); f.five[0] = bar(start + 3600000, '5Min', { open: 99.9, high: 101.1 })
  const p = pair(f)
  const rows = summarizeExecutionResolution([p, pair({ ...f, five: [] })], ['SPY', 'QQQ'], [full])
  const r = rows[0]
  assert.equal(r.accounting.commonSignalCount, 2); assert.equal(r.resolvedCount, 1); assert.equal(r.accounting.excludedCount, 1)
  assert.equal(r.methods.hourly.costTiers.length, 4)
  assert.deepEqual(r.methods.hourly.costTiers.map((t) => t.costR), [0, .02, .05, .1])
  assert.equal(r.differences.favorableEntryCount, 1)
  assert.ok(Math.abs(r.differences.averageEntryPriceDifference + .1) < 1e-10)
  assert.equal(r.differences.improvedRCount, 1); assert.equal(r.differences.changedOutcomePercent, 100)
  for (const t of r.differences.costTiers) assert.ok(Math.abs(t.expectancy - 2) < 1e-10)
  assert.equal(r.methods.hourly.costTiers[0].metrics.averageR, 0)
  assert.equal(rows[1].methods.hourly.costTiers[0].metrics, null)
  assert.equal(rows[1].differences.changedOutcomePercent, null)
})

test('period exclusions use both outcomes; symmetric sample strength and shared concentration dates', () => {
  const p = pair(fixture())
  const copies = Array.from({ length: 110 }, (_, i) => {
    const result = structuredClone(p)
    result.decisionTimestamp = iso(start + (i % 11) * 86400000)
    for (const method of Object.values(result.methods)) {
      method.entryTimestamp = result.decisionTimestamp
      method.outcomeTimestamp = iso(Date.parse(result.decisionTimestamp) + 3600000)
    }
    result.methods.hourly.trade.rMultiple = i % 11 - 3
    result.methods.fiveMinute.trade.rMultiple = 3 - i % 11
    return result
  })
  for (const [n, strength] of [[0, 'insufficient-evidence'], [29, 'insufficient-evidence'], [30, 'exploratory'], [99, 'exploratory'], [100, 'stronger-descriptive-evidence']]) {
    assert.equal(summarizeExecutionResolution(copies.slice(0, n), ['SPY'], [full])[0].evidenceStrength, strength)
  }
  const r = summarizeExecutionResolution(copies, ['SPY'], [full])[0]
  assert.equal(r.uniqueEasternDecisionDays, 11)
  assert.equal(r.concentration[0].removedDays.length, 5)
  assert.equal(r.concentration[1].removedDays.length, 10)
  for (const check of r.concentration) {
    assert.equal(check.summary.methods.hourly.resolvedCount, check.summary.methods.fiveMinute.resolvedCount)
    assert.ok(Math.abs(check.summary.differences.costTiers[0].totalR - (check.summary.methods.fiveMinute.costTiers[0].metrics.totalR - check.summary.methods.hourly.costTiers[0].metrics.totalR)) < 1e-10)
  }
  const crossing = structuredClone(p); crossing.methods.fiveMinute.outcomeTimestamp = '2025-01-01T00:00:00Z'
  const year = { ...full, end: '2024-12-31T23:59:59Z' }
  assert.equal(summarizeExecutionResolution([crossing], ['SPY'], [year])[0].resolvedCount, 0)
})

test('development/recent/year boundaries contain both outcomes and all cost tiers; elapsed reporting uses the same convention', () => {
  const base = pair(fixture())
  const samples = ['2024-12-30T15:00:00Z', '2025-06-02T15:00:00Z', '2026-02-02T15:00:00Z'].map((timestamp) => {
    const p = structuredClone(base); p.decisionTimestamp = timestamp
    for (const m of Object.values(p.methods)) { m.entryTimestamp = timestamp; m.outcomeTimestamp = iso(Date.parse(timestamp) + 3600000) }
    return p
  })
  const crossing = structuredClone(samples[0]); crossing.methods.fiveMinute.outcomeTimestamp = '2025-01-01T01:00:00Z'
  crossing.methods.fiveMinute.exclusionReason = 'outcome-crosses-period'
  const rows = summarizeExecutionResolution([...samples, crossing], ['SPY'], [full, ...candidatePeriods('2026-06-01T00:00:00Z')])
  for (const [key, n] of [['full', 3], ['development', 1], ['recent', 2], ['year-2024', 1], ['year-2025', 1], ['year-2026', 1], ['year-2022', 0]]) {
    const r = rows.find((r) => r.period.key === key)
    assert.equal(r.resolvedCount, n)
    assert.equal(r.differences.costTiers.length, 4)
    if (n) assert.equal(r.methods.hourly.costTiers[0].metrics.averageHoldingTime, r.methods.hourly.averageHoldingMinutes)
  }
})

test('SPY/QQQ/IWM and arbitrary symbols preserve actual frozen hourly population independent of execution prices', () => {
  const symbols = ['SPY', 'QQQ', 'IWM', 'XYZ']
  const options = { requestedStart: '2024-01-01T00:00:00Z', requestedEnd: '2024-06-01T00:00:00Z' }
  const raw = Object.fromEntries(symbols.map((symbol) => [symbol, Array.from({ length: 1200 }, (_, i) => {
    const close = 100 + i * .03 + Math.sin(i / 6)
    return bar(Date.UTC(2024, 0, 1) + i * 3600000, '1Hour', { symbol, open: close, close, high: close + .2, low: close - .2, volume: 1000 + i })
  })]))
  const five = Object.fromEntries(symbols.map((symbol) => [symbol, raw[symbol].flatMap((b) => Array.from({ length: 12 }, (_, i) => ({ ...b, timeframe: '5Min', timestamp: iso(Date.parse(b.timestamp) + i * 300000) })))]))
  const result = runCandidateExecutionResolution(raw, five, options)
  const baseline = runCandidateExitManagement(raw, options)
  assert.ok(result.pairs.length > 0)
  assert.deepEqual(result.pairs.map((p) => [p.symbol, p.timestamp]), baseline.pairs.map((p) => [p.symbol, p.timestamp]))
  result.pairs.forEach((p, i) => assert.deepEqual(p.methods.hourly.trade, (({ entryTimestamp, ...trade }) => trade)(baseline.pairs[i].exits.fixed.trade)))
  assert.ok(result.rows.find((r) => r.key === 'full::SPY').resolvedCount > 0)
  assert.deepEqual(result.periods.map((p) => p.key), ['full', 'year-2022', 'year-2023', 'year-2024', 'year-2025', 'year-2026', 'development', 'recent'])
  const absent = runCandidateExecutionResolution(raw, {}, options)
  assert.deepEqual(absent.pairs.map((p) => p.timestamp), result.pairs.map((p) => p.timestamp))
  assert.ok(absent.rows.every((r) => r.resolvedCount === 0))
  five.SPY.push({ ...five.SPY[0] }, { ...five.SPY[1], volume: null }, bar(Date.UTC(2025, 0, 1), '5Min'))
  five.SPY.reverse()
  const checked = runCandidateExecutionResolution(raw, five, options)
  assert.equal(checked.coverage.fiveMinute.SPY.duplicateCandleCount, 1)
  assert.equal(checked.coverage.fiveMinute.SPY.rejectedCandleCount, 1)
  assert.equal(checked.coverage.fiveMinute.SPY.timeframeSymbolOrCutoffExcluded, 1)
})
