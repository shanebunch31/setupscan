import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { buildJoinedContextRecords, summarizeContextStudy, contextEvidenceStrength, contextPeriod, runJoinedContextStudy, contextStudyGroups } from './joinedContextStudy.js'
import { buildAlignedSeries, buildCatalogueBySymbol, buildTradeFromIndex, signalQualityDefaults } from './signalQualityBacktest.js'
import { computeCausalRegimeSeries, causalRegimeDefaults } from './causalRegimeBacktest.js'
import { createResearchRecordForExperiment, getResearchExperiment } from '../research/registry.js'
import { synthesizeResearch } from '../research/synthesis.js'

function series(symbol, n = 260, start = '2024-06-01T12:00:00Z') {
  return Array.from({ length: n }, (_, i) => {
    const close = 100 + i * 0.03 + Math.sin(i / 6)
    return { symbol, timeframe: '1Hour', timestamp: new Date(Date.parse(start) + i * 3600000).toISOString(), open: close, high: close + 0.2, low: close - 0.2, close, volume: 1000 + i }
  })
}
function fixture() {
  const raw = Object.fromEntries(['SPY', 'QQQ', 'IWM'].map((s) => [s, series(s)]))
  const aligned = buildAlignedSeries(raw)
  const catalogue = buildCatalogueBySymbol(aligned, signalQualityDefaults)
  // A candidate fixture isolates joins/outcomes from the already tested scanner threshold.
  for (const entries of Object.values(catalogue)) entries.forEach((entry) => { entry.researchEligible = true; entry.score = 85 })
  const regimes = computeCausalRegimeSeries(aligned.raw, causalRegimeDefaults)
  return { raw, aligned, catalogue, regimes }
}
const recordsFor = (f) => buildJoinedContextRecords(f.aligned, f.catalogue, f.regimes)

test('joined identity carries five causal contexts with membership, symbol and decision completion time', () => {
  const records = recordsFor(fixture())
  assert.equal(new Set(records.map((r) => r.id)).size, 780)
  assert.equal(Object.keys(records[0].contexts).length, 5)
  assert.equal(records[0].membershipRule, 'research-eligible-75-plus')
  assert.equal(Date.parse(records[0].decisionTimestamp) - Date.parse(records[0].timestamp), 3600000)
  assert.equal(records[0].contexts.relativeValue.value, null)
  assert.equal(records[0].contexts.firstRange.value, null)
})

test('future primary and peer mutations cannot change prior joined contexts, scores or membership', () => {
  const f = fixture()
  const before = recordsFor(f)
  const changed = Object.fromEntries(Object.entries(f.raw).map(([s, bars]) => [s, bars.map((bar, i) => i > 150 ? { ...bar, close: bar.close * 2, high: bar.high * 2, low: bar.low * 2, open: bar.open * 2, volume: 99999 } : bar)]))
  const aligned = buildAlignedSeries(changed)
  const catalogue = buildCatalogueBySymbol(aligned, signalQualityDefaults)
  const original = buildCatalogueBySymbol(f.aligned, signalQualityDefaults)
  for (const s of Object.keys(catalogue)) assert.deepEqual(catalogue[s].slice(0, 151), original[s].slice(0, 151))
  const after = buildJoinedContextRecords(aligned, f.catalogue, computeCausalRegimeSeries(aligned.raw, causalRegimeDefaults))
  const cutoff = f.raw.SPY[150].timestamp
  assert.deepEqual(before.filter((r) => r.timestamp <= cutoff).map((r) => [r.id, r.contexts]), after.filter((r) => r.timestamp <= cutoff).map((r) => [r.id, r.contexts]))
})

test('first-observed range retains symbol-local reference even when peer alignment drops that bar', () => {
  const f = fixture()
  const own = [{ ...f.raw.SPY[0], timestamp: '2024-06-01T11:00:00.000Z', high: 1000 }, ...f.raw.SPY]
  const records = buildJoinedContextRecords(f.aligned, f.catalogue, f.regimes, signalQualityDefaults, { ...f.raw, SPY: own })
  assert.equal(records.find((r) => r.symbol === 'SPY').contexts.firstRange.value, 'not-above')
  assert.equal(records.find((r) => r.symbol === 'QQQ').contexts.firstRange.value, null)
})

test('periods use decision completion with explicit 2025 holdout and 2026 follow-up only', () => {
  assert.equal(contextPeriod('2024-12-31T23:59:59Z').key, 'development')
  assert.equal(contextPeriod('2025-01-01T00:00:00Z').key, 'holdout')
  assert.equal(contextPeriod('2026-01-01T00:00:00Z').key, 'followup')
  assert.equal(contextPeriod('2027-01-01T00:00:00Z'), null)
  for (const year of [2024, 2025]) {
    const bars = series('SPY', 20, `${year}-12-31T20:00:00Z`)
    const records = buildJoinedContextRecords({ raw: { SPY: bars } }, { SPY: [{ index: 0, timestamp: bars[0].timestamp, researchEligible: true, score: 100, componentAvailability: {}, components: {} }] }, [])
    assert.equal(records[0].exclusionReason, 'outcome-crosses-period')
  }
})

test('joined outcomes reuse native fills unchanged and exclude truncated expiry tails', () => {
  const f = fixture()
  const records = recordsFor(f)
  for (const r of records.filter((r) => r.trade)) {
    const i = f.aligned.raw[r.symbol].findIndex((b) => b.timestamp === r.timestamp)
    assert.deepEqual(r.trade, buildTradeFromIndex(f.aligned.raw[r.symbol], i, signalQualityDefaults, { symbol: r.symbol }))
  }
  assert.ok(records.some((r) => r.exclusionReason === 'incomplete-holding-window'))
  assert.ok(records.some((r) => r.exclusionReason === 'no-entry-or-invalid-risk'))
})

test('interactions match the same occurrence, never unrelated group totals; unavailable is separate', () => {
  const records = recordsFor(fixture()).slice(0, 3)
  records.forEach((r, i) => {
    r.contexts.trend = { available: true, value: i === 0 ? 'Uptrend' : 'Downtrend' }
    r.contexts.volatility = { available: i !== 2, value: i === 1 ? 'Medium' : null }
  })
  const rows = summarizeContextStudy(records)
  const row = rows.find((r) => r.symbol === 'pooled' && r.period.key === 'development' && r.key === 'trend-up+medium-volatility')
  assert.equal(row.matched.candidateCount, 0)
  assert.equal(row.accounting.contextUnavailableCount, 1)
  assert.equal(row.comparison.candidateCount, 2)
  assert.equal(row.matched.metrics, null)
})

test('pooled and per-symbol counts reconcile for all ten predefined groups and all periods', () => {
  assert.equal(contextStudyGroups.length, 10)
  const rows = summarizeContextStudy(recordsFor(fixture()))
  for (const row of rows) {
    const a = row.accounting
    assert.equal(a.baselineCount, a.contextAvailableCount + a.contextUnavailableCount)
    assert.equal(a.baselineCount, a.resolvedCount + a.outcomeExcludedCount)
    assert.equal(a.contextAvailableCount, a.matchedCount + a.comparisonCount)
    assert.equal(a.reconciliationStatus, 'reconciled')
    if (row.symbol === 'pooled') assert.equal(row.matched.candidateCount, rows.filter((r) => r.symbol !== 'pooled' && r.key === row.key && r.period.key === row.period.key).reduce((sum, r) => sum + r.matched.candidateCount, 0))
  }
})

test('evidence floor is insufficient below 30, exploratory through 99, descriptive at 100', () => {
  for (const n of [0, 7, 29]) assert.equal(contextEvidenceStrength(n), 'insufficient-evidence')
  for (const n of [30, 99]) assert.equal(contextEvidenceStrength(n), 'exploratory')
  assert.equal(contextEvidenceStrength(100), 'stronger-descriptive-evidence')
})

test('unavailable data and incompatible timeframe fail safely, with quality counts retained', () => {
  assert.equal(runJoinedContextStudy({}).available, false)
  const f = fixture()
  assert.equal(runJoinedContextStudy({ ...f.raw, SPY: f.raw.SPY.map((b) => ({ ...b, timeframe: '1Day' })) }).available, false)
  const result = runJoinedContextStudy({ ...f.raw, SPY: [...f.raw.SPY, f.raw.SPY[0], { ...f.raw.SPY[1], volume: null }] })
  assert.equal(result.dataQuality.SPY.duplicateCandleCount, 1)
  assert.equal(result.dataQuality.SPY.rejectedCandleCount, 1)
})

test('normalized evidence preserves context, period, symbol, costs and methodology without changing records', () => {
  const f = fixture()
  const payload = { ...runJoinedContextStudy(f.raw), records: recordsFor(f), rows: summarizeContextStudy(recordsFor(f)) }
  const record = createResearchRecordForExperiment('joined-context', payload, { symbols: ['SPY', 'QQQ', 'IWM'], timeframe: '1Hour' })
  assert.equal(record.methodologyVersion, 'joined-context-1')
  assert.equal(record.metrics['holdout::SPY::trend-up'].membershipRule, 'research-eligible-75-plus')
  assert.equal(record.metrics['holdout::SPY::trend-up'].costTiers.length, 4)
  const evidence = synthesizeResearch([record]).strategyGroups.flatMap((g) => g.evidence)
  const single = evidence.find((e) => e.metricsKey === 'holdout::SPY::trend-up')
  assert.deepEqual(single.symbols, ['SPY'])
  assert.equal(single.outOfSampleRole, 'holdout')
  assert.equal(getResearchExperiment('joined-context').requiredSymbols.length, 3)
})

test('minimal presentation explains context availability, sample floors and repeated exploration', () => {
  const source = readFileSync(new URL('./JoinedContextStudy.jsx', import.meta.url), 'utf8')
  for (const text of ['Unavailable means', '30–99', 'no longer untouched', '<table', 'Baseline avg R', 'Comparison avg R', 'outcome excluded']) assert.ok(source.includes(text))
})

test('explicit cutoff excludes forming candles and preserves earlier context history', () => {
  const f = fixture()
  const requestedEnd = new Date(Date.parse(f.raw.SPY[150].timestamp) + 1800000).toISOString()
  const result = runJoinedContextStudy(f.raw, { requestedEnd, requestedStart: f.raw.SPY[100].timestamp })
  assert.equal(result.actualDateRange.start, f.raw.SPY[0].timestamp)
  assert.equal(result.actualDateRange.end, f.raw.SPY[149].timestamp)
  assert.equal(result.completionExcludedCounts.SPY, 110)
  assert.ok(result.records.every((r) => r.timestamp >= f.raw.SPY[100].timestamp && r.decisionTimestamp <= requestedEnd))
  assert.equal(result.options.requestedEnd, requestedEnd)
})
