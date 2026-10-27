import assert from 'node:assert/strict'
import { test } from 'node:test'
import { scanSetups, isResearchEligibleSignal } from '../logic/scanner.js'
import { buildAlignedSeries, buildTradeFromIndex, signalQualityDefaults, computeMetrics } from './signalQualityBacktest.js'
import { runScannerComponentAblation, ablationScore, ablationVariants, conditionOverlap } from './scannerComponentAblation.js'

export function ablationFixture(length = 420) {
  return Object.fromEntries(['SPY', 'QQQ', 'IWM'].map(symbol => [symbol, Array.from({ length }, (_, i) => {
    const close = 100 + i * .03 + Math.sin(i / 6)
    return { symbol, timeframe: '1Hour', timestamp: new Date(Date.UTC(2024, 11, 24) + i * 3600000).toISOString(),
      open: close, high: close + .2, low: close - .2, close, volume: 1000 + i }
  })]))
}
const bounds = { requestedStart: '2024-12-24T00:00:00Z', requestedEnd: '2025-02-01T00:00:00Z' }
const fullSignal = () => scanSetups([{ price: 101, vwap: 100, ema9: 101, ema21: 100, rsi: 60, relativeVolume: 1.4, breakout: true, trend: 'Bullish' }])[0]

test('each variant removes only intended production contribution; original scoring/qualification untouched', () => {
  const signal = fullSignal(), before = structuredClone(signal)
  const expected = [100, 80, 80, 85, 85, 85, 85, 65, 85]
  ablationVariants.forEach((v, i) => {
    assert.equal(ablationScore(signal, v.id).score, expected[i])
    assert.equal(ablationScore(signal, v.id).eligible, expected[i] >= 75)
  })
  assert.deepEqual(signal, before)
  assert.equal(signal.qualifiedSetup, true)
  assert.equal(signal.researchEligible, true)
  const partial = scanSetups([{ ...signal, rsi: 50, relativeVolume: 1.1 }])[0]
  assert.equal(partial.score, 86)
  assert.equal(ablationScore(partial, 'without-rsi').score, 78)
  assert.equal(ablationScore(partial, 'without-rvol').score, 78)
  assert.equal(partial.qualifiedSetup, false)
  assert.throws(() => ablationScore(signal, 'unknown'))
})

test('pairwise dependence uses available pairs only and never treats unavailable as false', () => {
  const records = [[true,true],[true,false],[false,true],[false,false],[null,true]].map(([ema,trend]) => ({ conditions: { ema, trend } }))
  assert.deepEqual(conditionOverlap(records, 'ema','trend'), { left:'ema',right:'trend',bothTrue:1,leftOnly:1,rightOnly:1,neither:1,unavailable:1,evaluatedCount:5,availableCount:4,rightGivenLeft:.5,leftGivenRight:.5,phi:0 })
  assert.equal(conditionOverlap([{ conditions: { ema:true,trend:true } }], 'ema','trend').phi, null)
  assert.equal(conditionOverlap([], 'ema','trend').rightGivenLeft, null)
})

test('baseline membership and resolved metrics reuse the unchanged scanner/outcome methodology', () => {
  const raw = ablationFixture(), before = structuredClone(raw)
  const result = runScannerComponentAblation(raw, bounds), baseline = result.rows.find(r => r.key === 'full::baseline')
  const aligned = buildAlignedSeries(raw), trades = []
  let eligible = 0
  for (const symbol of ['SPY','QQQ','IWM']) {
    const signals = new Map(scanSetups(aligned.enriched[symbol]).map(s => [s.timestamp,s]))
    aligned.raw[symbol].forEach((c,i) => {
      if (!isResearchEligibleSignal(signals.get(c.timestamp))) return
      eligible++
      const t = buildTradeFromIndex(aligned.raw[symbol],i,signalQualityDefaults,{symbol})
      if (t && !(t.exitReason === 'Expired' && t.holdingBars < 12)) trades.push(t)
    })
  }
  trades.sort((a,b) => a.timestamp.localeCompare(b.timestamp) || a.symbol.localeCompare(b.symbol))
  assert.ok(eligible > 0)
  assert.ok(baseline.resolvedCount > 0)
  assert.equal(baseline.eligibleCount, eligible)
  assert.equal(baseline.metrics.expectancy, computeMetrics(trades).expectancy)
  assert.equal(baseline.metrics.maximumDrawdown, computeMetrics(trades).maximumDrawdown)
  assert.equal(result.rows.find(r => r.key === 'full::without-ema-trend').metrics, null)
  assert.deepEqual(raw, before)
  for (const row of result.rows) {
    assert.equal(row.eligibleCount + row.removed.eligibleCount, row.baselineEligibleCount)
    assert.equal(row.resolvedCount + row.outcomeExcludedCount, row.eligibleCount)
    assert.equal(row.reconciliationStatus, 'reconciled')
  }
})

test('deterministic symbol/year/causal-regime grouping, overlap and missing-input accounting', () => {
  const raw = ablationFixture(), report = runScannerComponentAblation(raw,bounds)
  assert.deepEqual(runScannerComponentAblation(Object.fromEntries(Object.entries(raw).reverse()),bounds), report)
  const pair = report.overlap.allEvaluated.find(p => p.left === 'ema' && p.right === 'trend')
  assert.equal(pair.leftOnly,0); assert.equal(pair.rightOnly,0)
  assert.ok(pair.unavailable > 0); assert.equal(pair.phi,1)
  for (const c of report.components) assert.equal(c.present+c.absent+c.unavailable,report.evaluatedCount)
  for (const group of ['symbol-SPY','symbol-QQQ','symbol-IWM','year-2024','year-2025','trend-Insufficient-History']) assert.ok(report.rows.some(r => r.group === group))
  const base = report.rows.find(r => r.key === 'full::baseline')
  assert.equal(Object.values(base.symbolConcentration).reduce((s,c)=>s+c.resolvedCount,0),base.resolvedCount)
  assert.equal(Object.values(base.regimeConcentration).reduce((s,c)=>s+c.count,0),base.eligibleCount)
  assert.deepEqual(report.rows.find(r => r.key === 'full::ema-trend-max').metrics, report.rows.find(r => r.key === 'full::without-trend').metrics)
})

test('cutoff prevents future data affecting earlier output; malformed and absent sources are explicit', () => {
  const raw = ablationFixture(), cutoff = '2025-01-03T00:00:00Z'
  const earlier = runScannerComponentAblation(raw,{...bounds,requestedEnd:cutoff})
  const changed = structuredClone(raw)
  for (const bars of Object.values(changed)) for (const c of bars) if (Date.parse(c.timestamp)>=Date.parse(cutoff)) { c.open=999;c.close=999;c.high=1000;c.low=998 }
  assert.deepEqual(runScannerComponentAblation(changed,{...bounds,requestedEnd:cutoff}),earlier)
  assert.equal(runScannerComponentAblation({...raw,SPY:[]},bounds).available,false)
  changed.SPY[50].volume=null
  assert.equal(runScannerComponentAblation(changed,bounds).incomplete,true)
  assert.equal(runScannerComponentAblation(raw,{requestedEnd:'bad'}).available,false)
  assert.equal(runScannerComponentAblation({ ...raw, SPY: raw.SPY.map(c=>({...c,timeframe:'5Min'})) },bounds).available,false)
})

test('yearly outcomes cannot borrow the next year; sparse outcomes remain insufficient', () => {
  const report = runScannerComponentAblation(ablationFixture(),bounds)
  const year = report.rows.find(r => r.key === 'year-2024::baseline')
  assert.ok(year.exclusions['outcome-crosses-period'] > 0)
  const sparse = runScannerComponentAblation(ablationFixture(22),bounds)
  const base = sparse.rows.find(r => r.key === 'full::baseline')
  assert.equal(base.evidenceStrength,'insufficient')
})
