import assert from 'node:assert/strict'
import { test } from 'node:test'
import { candidateDefinition, candidateTimeBuckets, candidatePeriods, summarizeCandidateRobustness, runCandidateContextRobustness, summarizeCandidateDays, candidateDaySensitivity, candidateSession } from './candidateContextRobustness.js'
import { runJoinedContextStudy, buildJoinedContextRecords, summarizeContextStudy } from './joinedContextStudy.js'
import { buildAlignedSeries, buildCatalogueBySymbol, signalQualityDefaults, computeMetrics, costTierDefinitions } from './signalQualityBacktest.js'
import { computeCausalRegimeSeries, causalRegimeDefaults } from './causalRegimeBacktest.js'

const cutoff = '2026-10-21T16:00:00Z'
function occurrence(overrides = {}) {
  const decisionTimestamp = overrides.decisionTimestamp ?? '2024-06-03T15:00:00Z'
  return {
    id: 'fixture', symbol: 'SPY', score: 85, membershipRule: 'research-eligible-75-plus',
    timestamp: new Date(Date.parse(decisionTimestamp) - 3600000).toISOString(), decisionTimestamp,
    outcomeTimestamp: new Date(Date.parse(decisionTimestamp) + 3600000).toISOString(), exclusionReason: null,
    contexts: { trend: { available: true, value: 'Uptrend' }, volatility: { available: true, value: 'Medium' } },
    trade: { rMultiple: 1, holdingTime: 60, ambiguousCandle: false }, ...overrides,
  }
}
const joined = (records) => ({ available: true, records, symbols: ['SPY', 'QQQ', 'IWM'], options: { requestedEnd: cutoff }, outsidePeriodCount: 0 })
const row = (result, period = 'development', symbol = 'SPY') => result.rows.find((r) => r.period.key === period && r.symbol === symbol)
function candles(symbol, n = 260) {
  return Array.from({ length: n }, (_, i) => {
    const close = 100 + i * .03 + Math.sin(i / 6)
    return { symbol, timeframe: '1Hour', timestamp: new Date(Date.parse('2024-06-01T12:00:00Z') + i * 3600000).toISOString(), open: close, close, high: close + .2, low: close - .2, volume: 1000 + i }
  })
}
const rawFixture = () => Object.fromEntries(['SPY', 'QQQ', 'IWM'].map((s) => [s, candles(s)]))

test('candidate is exactly the frozen Joined Context intersection; membership preserves potential and qualified', () => {
  assert.deepEqual(candidateDefinition.conditions, [['trend', 'Uptrend'], ['volatility', 'Medium']])
  const result = summarizeCandidateRobustness(joined([
    occurrence({ score: 100 }), occurrence({ score: 75 }), occurrence({ score: 74 }),
    occurrence({ membershipRule: 'qualified-only' }),
    occurrence({ contexts: { trend: { available: true, value: 'Downtrend' }, volatility: { available: true, value: 'Medium' } } }),
    occurrence({ contexts: { trend: { available: true, value: 'Uptrend' }, volatility: { available: true, value: 'High' } } }),
  ]))
  assert.equal(row(result).baseline.candidateCount, 4)
  assert.equal(row(result).matched.candidateCount, 2)
  assert.equal(row(result).comparison.candidateCount, 2)
})

test('actual Joined Context catalogue rejects noneligible observations before the study', () => {
  const raw = rawFixture(), aligned = buildAlignedSeries(raw)
  const catalogue = buildCatalogueBySymbol(aligned, signalQualityDefaults)
  for (const entries of Object.values(catalogue)) entries.forEach((entry, i) => { entry.researchEligible = i % 2 === 0; entry.score = 85 })
  const regimes = computeCausalRegimeSeries(aligned.raw, causalRegimeDefaults)
  const records = buildJoinedContextRecords(aligned, catalogue, regimes)
  assert.equal(records.length, 390)
  for (const record of records) assert.equal(catalogue[record.symbol].find((entry) => entry.timestamp === record.timestamp).researchEligible, true)
  const result = summarizeCandidateRobustness(joined(records))
  for (const symbol of ['SPY', 'QQQ', 'IWM']) {
    const native = summarizeContextStudy(records).find((r) => r.symbol === symbol && r.period.key === 'development' && r.key === candidateDefinition.key)
    assert.deepEqual(row(result, 'development', symbol).matched.metrics, native.matched.metrics)
    assert.equal(row(result, 'development', symbol).matched.candidateCount, native.matched.candidateCount)
  }
})

test('yearly partitions use decision date and exclude outcomes crossing the yearly boundary', () => {
  const records = [2022, 2023, 2024, 2025, 2026].map((year) => occurrence({ decisionTimestamp: `${year}-06-03T15:00:00Z` }))
  records.push(occurrence({ decisionTimestamp: '2023-12-31T23:30:00Z', outcomeTimestamp: '2024-01-01T00:30:00Z' }))
  const result = summarizeCandidateRobustness(joined(records))
  for (const year of [2022, 2023, 2024, 2025, 2026]) assert.equal(row(result, `year-${year}`).matched.resolvedCount, 1)
  assert.equal(row(result, 'year-2023').matched.candidateCount, 2)
  assert.equal(row(result, 'year-2023').matched.exclusionCounts['outcome-crosses-summary-boundary'], 1)
  assert.equal(row(result).matched.resolvedCount, 4)
  assert.equal(row(result, 'recent').matched.resolvedCount, 2)
})

test('fixed major boundaries and 2026 cutoff reject later decisions and unresolved later outcomes', () => {
  const periods = candidatePeriods(cutoff)
  assert.equal(periods.find((p) => p.key === 'development').start, '2022-01-01T00:00:00Z')
  assert.equal(periods.find((p) => p.key === 'development').end, '2024-12-31T23:59:59.999Z')
  assert.equal(periods.find((p) => p.key === 'recent').start, '2025-01-01T00:00:00Z')
  assert.equal(Date.parse(periods.find((p) => p.key === 'year-2026').end), Date.parse(cutoff))
  const result = summarizeCandidateRobustness(joined([
    occurrence({ decisionTimestamp: cutoff, outcomeTimestamp: '2026-10-21T17:00:00Z' }),
    occurrence({ decisionTimestamp: '2026-10-21T17:00:00Z' }),
    occurrence({ decisionTimestamp: '2026-10-21T15:00:00Z', outcomeTimestamp: cutoff }),
    occurrence({ decisionTimestamp: '2025-12-31T23:00:00Z', exclusionReason: 'outcome-crosses-period', trade: null }),
  ]))
  assert.equal(row(result, 'recent').matched.candidateCount, 3)
  assert.equal(row(result, 'recent').matched.resolvedCount, 1)
  assert.equal(row(result, 'recent').matched.exclusionCounts['outcome-crosses-period'], 1)
})

test('SPY, QQQ and IWM are separate populations and IWM is reference only', () => {
  const result = summarizeCandidateRobustness(joined(['SPY', 'QQQ', 'IWM'].flatMap((symbol, index) => Array.from({ length: index + 1 }, () => occurrence({ symbol })))))
  assert.equal(row(result).matched.resolvedCount, 1)
  assert.equal(row(result, 'development', 'QQQ').matched.resolvedCount, 2)
  assert.equal(row(result, 'development', 'IWM').matched.resolvedCount, 3)
  assert.equal(result.conclusions.find((c) => c.symbol === 'IWM').role, 'requested symbol')
  assert.equal(result.rows.some((r) => r.symbol === 'pooled'), false)
})

test('time-of-day uses decision completion, not signal start or outcome; fixed boundaries handle DST', () => {
  const times = ['13:29', '13:30', '14:59', '15:00', '17:59', '18:00', '19:59', '20:00']
  const result = summarizeCandidateRobustness(joined(times.map((time) => occurrence({ decisionTimestamp: `2024-06-03T${time}:00Z`, outcomeTimestamp: '2024-06-04T18:00:00Z' }))))
  const buckets = result.timeOfDay.filter((r) => r.symbol === 'SPY' && r.period.key === 'development')
  assert.equal(candidateTimeBuckets.length, 4)
  for (const bucket of buckets) assert.equal(bucket.matched.candidateCount, 2)
  const winter = summarizeCandidateRobustness(joined([occurrence({ decisionTimestamp: '2024-01-03T16:00:00Z' })]))
  assert.equal(winter.timeOfDay.find((r) => r.symbol === 'SPY' && r.period.key === 'development' && r.bucket.startsWith('Midday')).matched.resolvedCount, 1)
})

test('clustering counts Eastern decision days and uses deterministic signed top/bottom contributions', () => {
  const records = [1, 2, 3, 4, 5, 6, 7].map((day, i) => occurrence({ decisionTimestamp: `2024-06-${String(day).padStart(2, '0')}T15:00:00Z`, trade: { rMultiple: i - 2, holdingTime: 60 } }))
  records.push(occurrence({ decisionTimestamp: '2024-06-01T16:00:00Z', trade: { rMultiple: 1, holdingTime: 60 } }))
  const result = summarizeCandidateRobustness(joined(records))
  const c = row(result).clustering
  assert.equal(c.resolvedMatchedTrades, 8)
  assert.equal(c.uniqueSignalDays, 7)
  assert.equal(c.averageTradesPerActiveDay, 8 / 7)
  assert.equal(c.maximumTradesPerDay, 2)
  assert.equal(c.multiSignalDayTradePercent, 25)
  assert.equal(c.totalR, 8)
  assert.equal(c.topFiveTotalR, 10)
  assert.equal(c.bottomFiveTotalR, 1)
  assert.equal(c.topFivePercentOfNetR, 125)
  assert.equal(c.bottomFiveLossPercentOfNetR, 0)
  assert.deepEqual(row(summarizeCandidateRobustness(joined([...records].reverse()))).clustering, c)
})

test('clustering excludes unresolved trades and does not divide by zero or negative net R', () => {
  const result = summarizeCandidateRobustness(joined([
    occurrence({ trade: { rMultiple: -1, holdingTime: 60 } }), occurrence({ trade: null, exclusionReason: 'incomplete-holding-window' }),
  ]))
  const c = row(result).clustering
  assert.equal(c.matchedCandidateCount, 2)
  assert.equal(c.resolvedMatchedTrades, 1)
  assert.equal(c.topFivePercentOfNetR, null)
  assert.equal(c.bottomFiveLossPercentOfNetR, null)
  assert.equal(c.bottomFiveTotalR, -1)
})

test('all existing costs reuse computeMetrics exactly, including zero-crossing and drawdown order', () => {
  const records = [1, -.9, .02].map((rMultiple, i) => occurrence({ decisionTimestamp: `2024-06-03T${15 + i}:00:00Z`, trade: { rMultiple, holdingTime: 60 } }))
  const summary = row(summarizeCandidateRobustness(joined(records))).matched
  assert.deepEqual(summary.costTiers.map((tier) => [tier.label, tier.costR]), costTierDefinitions)
  for (const tier of summary.costTiers) {
    assert.deepEqual(tier.metrics, computeMetrics(records.map((r) => r.trade), tier.costR))
    assert.ok(Math.abs(tier.metrics.averageR - (summary.metrics.averageR - tier.costR)) < 1e-12)
  }
  assert.equal(summary.firstNonPositiveCostR, .05)
})

test('accounting separates unavailable context and overlapping outcome exclusions', () => {
  const result = summarizeCandidateRobustness(joined([
    occurrence(), occurrence({ trade: null, exclusionReason: 'incomplete-holding-window' }),
    occurrence({ contexts: { trend: { available: true, value: 'Mixed' }, volatility: { available: true, value: 'Medium' } } }),
    occurrence({ contexts: { trend: { available: false, value: null }, volatility: { available: true, value: 'Medium' } } }),
    occurrence({ contexts: {}, trade: null }),
  ]))
  const a = row(result).accounting
  assert.equal(a.baselineCount, 5)
  assert.equal(a.matchedCount, 2)
  assert.equal(a.comparisonCount, 1)
  assert.equal(a.contextUnavailableCount, 2)
  assert.equal(a.resolvedCount, 3)
  assert.equal(a.outcomeExcludedCount, 2)
  for (const r of [...result.rows, ...result.timeOfDay]) assert.equal(r.accounting.reconciliationStatus, 'reconciled')
})

test('empty results retain null metrics while evidence floors remain 30 and 100; no auto promotion', () => {
  assert.equal(row(summarizeCandidateRobustness(joined([]))).matched.metrics, null)
  for (const [n, expected] of [[29, 'insufficient-evidence'], [30, 'exploratory'], [99, 'exploratory'], [100, 'stronger-descriptive-evidence']]) {
    const records = ['2024', '2025'].flatMap((year) => Array.from({ length: n }, () => occurrence({ decisionTimestamp: `${year}-06-03T15:00:00Z` })))
    const result = summarizeCandidateRobustness(joined(records))
    assert.equal(row(result).matched.evidenceStrength, expected)
    assert.equal(result.conclusions.find((c) => c.symbol === 'SPY').status, n < 30 ? 'insufficient evidence' : 'continue historical validation')
    assert.equal(result.conclusions.find((c) => c.symbol === 'SPY').developmentVsRecent[0].differenceAverageR, 0)
  }
})

test('runner reuses Joined Context without mutating records or fills; future bars after cutoff cannot affect results', () => {
  const raw = rawFixture()
  const options = { requestedEnd: '2024-06-08T12:00:00Z' }
  const native = runJoinedContextStudy(raw, options)
  const original = structuredClone(native)
  const result = runCandidateContextRobustness(raw, options)
  assert.deepEqual(result, summarizeCandidateRobustness(native))
  assert.deepEqual(native, original)
  const future = Object.fromEntries(Object.entries(raw).map(([symbol, bars]) => [symbol, bars.map((bar) => bar.timestamp > options.requestedEnd ? { ...bar, open: 999, high: 1001, low: 998, close: 1000 } : bar)]))
  assert.deepEqual(runCandidateContextRobustness(future, options), result)
  assert.deepEqual(runJoinedContextStudy(raw, options), native)
})

test('unavailable or incompatible inputs do not fabricate results', () => {
  assert.equal(runCandidateContextRobustness({}).available, false)
  assert.equal(runCandidateContextRobustness(rawFixture(), { requestedEnd: 'invalid' }).available, false)
  assert.equal(summarizeCandidateRobustness({ available: true, records: [], options: {} }).available, false)
})

test('arbitrary requested symbols run without a fixed universe and preserve deterministic identities', () => {
  const aapl = candles('AAPL'), msft = candles('MSFT')
  const options = { requestedEnd: cutoff }
  const single = runCandidateContextRobustness({ AAPL: aapl }, options)
  assert.equal(single.available, true)
  assert.deepEqual(single.symbols, ['AAPL'])
  assert.equal(single.regimeSourceSymbol, 'AAPL')
  assert.ok(single.rows.every((r) => r.symbol === 'AAPL'))
  const first = runCandidateContextRobustness({ MSFT: msft, AAPL: aapl }, options)
  const reversed = runCandidateContextRobustness({ AAPL: aapl, MSFT: msft }, options)
  assert.deepEqual(first, reversed)
  assert.deepEqual(first.symbols, ['AAPL', 'MSFT'])
  assert.deepEqual([...new Set(first.sessions.map((r) => r.symbol))], ['AAPL', 'MSFT'])
})

test('day-level results aggregate multiple trades by Eastern decision date and reject cutoff-crossing outcomes', () => {
  const period = { start: '2024-06-01T00:00:00Z', end: '2024-06-05T00:00:00Z' }
  const records = [
    occurrence({ decisionTimestamp: '2024-06-03T23:00:00Z', trade: { rMultiple: 2 } }),
    occurrence({ decisionTimestamp: '2024-06-04T01:00:00Z', trade: { rMultiple: -1 } }),
    occurrence({ decisionTimestamp: '2024-06-04T15:00:00Z', trade: { rMultiple: -3 } }),
    occurrence({ decisionTimestamp: '2024-06-04T23:30:00Z', trade: { rMultiple: 100 } }),
  ]
  assert.deepEqual(summarizeCandidateDays(records, period), {
    activeDays: 2, resolvedCount: 3, averageDayR: -1, medianDayR: -1, positiveDayPercent: 50, negativeDayPercent: 50,
    totalR: -2, maximumPositiveDayR: 1, maximumNegativeDayR: -3,
  })
})

test('top-five and top/bottom removal uses before-cost day totals, removes all trades and breaks ties by date', () => {
  const period = candidatePeriods(cutoff).find((p) => p.key === 'development')
  const records = Array.from({ length: 12 }, (_, i) => occurrence({ decisionTimestamp: `2024-06-${String(i + 1).padStart(2, '0')}T15:00:00Z`, trade: { rMultiple: i - 4, holdingTime: 60 } }))
  records.push(occurrence({ decisionTimestamp: '2024-06-12T16:00:00Z', trade: { rMultiple: 1, holdingTime: 60 } }))
  const [top, both] = candidateDaySensitivity(records, period)
  assert.deepEqual(top.removedDays, ['2024-06-12', '2024-06-11', '2024-06-10', '2024-06-09', '2024-06-08'])
  assert.equal(top.summary.resolvedCount, 7)
  assert.equal(top.remainingDays, 7)
  assert.equal(both.remainingDays, 2)
  assert.equal(both.summary.resolvedCount, 2)
  for (const check of [top, both]) {
    assert.deepEqual(check.summary.costTiers.map((t) => [t.label, t.costR]), costTierDefinitions)
    for (const tier of check.summary.costTiers) assert.ok(Math.abs(tier.metrics.averageR - (check.summary.metrics.averageR - tier.costR)) < 1e-12)
  }
  const ties = records.slice(0, 6).map((r) => ({ ...r, trade: { rMultiple: 1 } }))
  assert.deepEqual(candidateDaySensitivity(ties, period)[0].removedDays, ties.slice(0, 5).map((r) => r.decisionTimestamp.slice(0, 10)))
  assert.deepEqual(candidateDaySensitivity(ties, period).map((c) => c.removedDays), candidateDaySensitivity([...ties].reverse(), period).map((c) => c.removedDays))
})

test('small-sample top and bottom sets remove each day once and report empty performance as unavailable', () => {
  const period = candidatePeriods(cutoff)[0]
  const records = Array.from({ length: 3 }, (_, i) => occurrence({ decisionTimestamp: `2022-06-0${i + 1}T15:00:00Z` }))
  const both = candidateDaySensitivity(records, period)[1]
  assert.equal(both.removedDays.length, 3)
  assert.equal(both.remainingDays, 0)
  assert.equal(both.summary.resolvedCount, 0)
  assert.ok(both.summary.costTiers.every((tier) => tier.metrics === null && tier.positiveExpectancy === null))
})

test('session split applies to arbitrary symbols using decision time; unknown time never becomes regular', () => {
  const records = [occurrence({ symbol: 'AAPL', decisionTimestamp: '2024-06-03T15:00:00Z', outcomeTimestamp: '2024-06-03T22:00:00Z' }), occurrence({ symbol: 'AAPL', decisionTimestamp: '2024-06-03T21:00:00Z', outcomeTimestamp: '2024-06-04T15:00:00Z' }), { ...occurrence({ symbol: 'AAPL' }), decisionTimestamp: 'invalid' }]
  const result = summarizeCandidateRobustness({ ...joined(records), symbols: ['AAPL'] })
  const sessions = result.sessions.filter((r) => r.period.key === 'development')
  assert.equal(sessions.find((r) => r.session === 'regular').matched.resolvedCount, 1)
  assert.equal(sessions.find((r) => r.session === 'outside').matched.resolvedCount, 1)
  assert.equal(result.coverage.unavailableDecisionTimestampCount, 1)
  assert.equal(candidateSession(null), 'unavailable')
  assert.equal(candidateSession('invalid'), 'unavailable')
  assert.equal(candidateSession('2024-06-03T20:00:00Z'), 'outside')
})
