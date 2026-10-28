import assert from 'node:assert/strict'
import { test } from 'node:test'
import { scanSetups, isResearchEligibleSignal } from '../logic/scanner.js'
import { buildAlignedSeries, buildTradeFromIndex, computeMetrics, signalQualityDefaults } from './signalQualityBacktest.js'
import { scoreStabilityModes, scoreStabilityVariants, scoreRedundancyObservation, runScannerScoreStability, summarizeScoreStability, scoreEvidence, scoreStabilityConclusion } from './scannerScoreRedundancyStability.js'

const full = { price: 101, vwap: 100, ema9: 101, ema21: 100, rsi: 60, relativeVolume: 1.4, breakout: true, trend: 'Bullish' }
const conditions = { ema: true, trend: true }
const signal = changes => scanSetups([{ ...full, ...changes }])[0]
const mode = (id, adjusted = false) => scoreStabilityModes.find(m => m.id === id && m.mode === (adjusted ? 'mechanical-75-percent' : 'fixed-75'))
function fixture(length = 420) {
  return Object.fromEntries(['SPY','QQQ','IWM'].map(symbol => [symbol, Array.from({ length }, (_, i) => {
    const close = 100 + i * .03 + Math.sin(i / 6)
    return { symbol, timeframe: '1Hour', timestamp: new Date(Date.UTC(2024,11,24) + i * 3600000).toISOString(), open: close, high: close + .2, low: close - .2, close, volume: 1000 + i }
  })]))
}
const bounds = { requestedStart: '2024-12-24T00:00:00Z', requestedEnd: '2025-02-01T00:00:00Z' }

test('five predeclared variants, nine modes and exact mechanical floors; scanner remains unchanged', () => {
  const s = signal(), before = structuredClone(s)
  assert.equal(s.score, 100); assert.equal(s.qualifiedSetup, true)
  assert.equal(scoreStabilityVariants.length, 5)
  assert.equal(scoreStabilityModes.length, 9)
  for (const [id, expected] of [['baseline',100],['keep-ema',85],['keep-trend',80],['combined-20',85],['combined-15',80]]) {
    assert.equal(scoreRedundancyObservation(s, conditions, mode(id)).score, expected)
    assert.equal(mode(id).threshold, 75)
    if (id !== 'baseline') assert.equal(mode(id,true).threshold, expected === 85 ? 64 : 60)
  }
  const partial = signal({ rsi: 50, relativeVolume: 1.1 })
  assert.equal(partial.score, 86); assert.equal(partial.qualifiedSetup, false)
  assert.equal(scoreRedundancyObservation(partial, conditions, mode('keep-ema')).score, 71)
  assert.equal(scoreRedundancyObservation(partial, conditions, mode('keep-trend')).score, 66)
  assert.deepEqual(s, before)
})

test('mechanical modes may admit original below-75 signals; baseline reproduces researchEligible', () => {
  for (const input of [{}, { rsi: 50 }, { ema9: 99, trend: 'Bearish' }, { vwap: null }, { breakout: false, relativeVolume: null }]) {
    const s = signal(input)
    assert.equal(scoreRedundancyObservation(s, conditions, mode('baseline')).eligible, isResearchEligibleSignal(s))
  }
  const s = signal({ ema9: 99, trend: 'Bearish' })
  assert.equal(s.score, 65)
  assert.equal(scoreRedundancyObservation(s, { ema:false,trend:false }, mode('baseline')).eligible, false)
  assert.equal(scoreRedundancyObservation(s, { ema:false,trend:false }, mode('combined-20',true)).eligible, true)
})

test('combined family disagreement gets zero, unavailable is not zero, missing reason is explicit', () => {
  const s = signal({ trend: 'Bearish' })
  const result = scoreRedundancyObservation(s, { ema:true,trend:false }, mode('combined-20'))
  assert.equal(result.score, 65); assert.equal(result.pairState, 'disagreement')
  const missing = scoreRedundancyObservation(s, { ema:null,trend:true }, mode('combined-15'))
  assert.equal(missing.score,null); assert.equal(missing.eligible,false); assert.equal(missing.pairState,'unavailable')
  assert.equal(scoreRedundancyObservation({ ...s, reasons: [] }, conditions, mode('baseline')).score,null)
})

test('native baseline equals unchanged scanner and Signal Quality outcomes; deterministic accounting and equivalence', () => {
  const raw = fixture(), before = structuredClone(raw), result = runScannerScoreStability(raw,bounds)
  const aligned = buildAlignedSeries(raw), trades = []
  let eligible = 0
  for (const symbol of ['SPY','QQQ','IWM']) {
    const signals = new Map(scanSetups(aligned.enriched[symbol]).map(s => [s.timestamp,s]))
    aligned.raw[symbol].forEach((c,i) => {
      if (!isResearchEligibleSignal(signals.get(c.timestamp))) return
      eligible++
      const trade = buildTradeFromIndex(aligned.raw[symbol],i,signalQualityDefaults,{symbol})
      if (trade && !(trade.exitReason === 'Expired' && trade.holdingBars < 12)) trades.push(trade)
    })
  }
  trades.sort((a,b) => a.timestamp.localeCompare(b.timestamp) || a.symbol.localeCompare(b.symbol))
  const baseline = result.rows.find(r => r.key === 'full::pooled::baseline::fixed-75')
  assert.ok(eligible > 0); assert.ok(trades.length > 0)
  assert.equal(baseline.eligibleCount,eligible)
  assert.deepEqual(baseline.metrics,computeMetrics(trades))
  assert.deepEqual(raw,before)
  assert.deepEqual(runScannerScoreStability(Object.fromEntries(Object.entries(raw).reverse()),bounds),result)
  const pair = result.equivalences.find(e => e.left === 'keep-ema::fixed-75' && e.right === 'combined-20::fixed-75')
  assert.equal(pair.scoresMatch,true); assert.equal(pair.membershipMatches,true)
  assert.equal(pair.availabilityMatches,false); assert.equal(pair.equivalent,false)
  assert.ok(result.rows.some(r => r.group === 'trend::Insufficient-History'))
  assert.ok(result.rows.some(r => r.group.startsWith('regime::')))
  for (const row of result.rows) {
    assert.equal(row.reconciliationStatus,'reconciled')
    assert.equal(row.scoreEvaluableCount + row.scoreUnavailableCount,row.evaluatedCount)
    assert.equal(row.eligibleCount + row.ineligibleCount,row.scoreEvaluableCount)
    assert.equal(row.resolvedCount + row.outcomeExcludedCount,row.eligibleCount)
    assert.equal(row.wins + row.losses + row.breakeven,row.resolvedCount)
    if (row.metrics) for (const tier of row.costTiers) {
      assert.equal(tier.metrics.tradeCount,row.resolvedCount)
      assert.ok(Math.abs(tier.metrics.totalR - (row.metrics.totalR - tier.costR * row.resolvedCount)) < 1e-8)
    }
  }
  for (const m of scoreStabilityModes) {
    const own = result.rows.filter(r => r.variant === m.id && r.mode === m.mode)
    const pooled = own.find(r => r.group === 'full::pooled')
    for (const field of ['eligibleCount','resolvedCount','evaluatedCount','scoreUnavailableCount']) {
      assert.equal(own.filter(r => ['full::SPY','full::QQQ','full::IWM'].includes(r.group)).reduce((s,r) => s+r[field],0),pooled[field])
    }
  }
})

function record(decision, outcome, rMultiple = 2) {
  return { symbol:'SPY', decisionTimestamp:decision, outcomeTimestamp:outcome, exclusionReason:null,
    conditions, scores:Object.fromEntries(scoreStabilityModes.map(m => [m.key,scoreRedundancyObservation(signal(),conditions,m)])),
    trend:'Uptrend',volatility:'Medium',regime:'Uptrend / Medium', trade:{rMultiple,exitReason:'Target',holdingTime:60,ambiguousCandle:false} }
}
test('UTC year/development/recent boundaries exclude crossing outcomes, including 2025/2026', () => {
  const records = [record('2024-12-31T23:00:00Z','2025-01-01T01:00:00Z'),record('2025-12-31T23:00:00Z','2026-01-01T01:00:00Z'),record('2026-01-02T16:00:00Z','2026-01-02T17:00:00Z',-1)]
  const result=summarizeScoreStability(records,{requestedStart:'2022-01-01',requestedEnd:'2026-10-28'})
  const row = group => result.rows.find(r=>r.group===`${group}::pooled` && r.variant==='baseline')
  assert.equal(row('full').resolvedCount,3)
  assert.equal(row('development').resolvedCount,0)
  assert.equal(row('year-2024').exclusions['outcome-crosses-period'],1)
  assert.equal(row('year-2025').exclusions['outcome-crosses-period'],1)
  assert.equal(row('recent').eligibleCount,2)
  assert.equal(row('recent').resolvedCount,2)
  assert.equal(row('year-2026').resolvedCount,1)
  assert.equal(row('year-2022').metrics,null)
  assert.equal(row('year-2022').retentionRate,null)
})

test('Eastern baseline day stress ranks once, uses stable tie breaks, and shares dates across variants/costs', () => {
  const records=Array.from({length:12},(_,i)=>record(new Date(Date.UTC(2025,0,1+i,1)).toISOString(),new Date(Date.UTC(2025,0,1+i,2)).toISOString(),i%2?2:-1))
  const report=summarizeScoreStability(records,{requestedStart:'2022-01-01',requestedEnd:'2026-10-28'})
  assert.ok(report.equivalences.some(e=>e.left==='keep-ema::fixed-75' && e.right==='combined-20::fixed-75' && e.equivalent))
  const rows=report.rows.filter(r=>r.group==='full::pooled')
  const dates=rows[0].daySensitivity[0].removedDays
  assert.deepEqual(dates,['2025-01-01','2025-01-03','2025-01-05','2025-01-07','2025-01-09'])
  for(const row of rows) {
    assert.deepEqual(row.daySensitivity[0].removedDays,dates)
    assert.equal(row.daySensitivity[0].resolvedCount,7)
    assert.ok(row.daySensitivity[0].costTiers.every(t=>t.metrics.tradeCount===7))
  }
})

test('sample floors and conservative stability flags are deterministic and symmetric', () => {
  assert.deepEqual([0,29,30,99,100].map(scoreEvidence),['insufficient','insufficient','small-exploratory-sample','small-exploratory-sample','descriptive-only'])
  const row=(group,n,differenceR,expectancy=.2)=>({group,variant:'keep-ema',mode:'fixed-75',variantLabel:'Keep EMA',threshold:75,maximumScore:85,eligibleCount:n,resolvedCount:n,baselineResolvedCount:n,daySensitivity:[],costTiers:[0,.02,.05,.1].map(costR=>({costR,differenceR,metrics:{expectancy:expectancy-costR}}))})
  const rows=[row('full::pooled',200,.1),row('development::pooled',100,.1),row('recent::pooled',100,.1)]
  assert.equal(scoreStabilityConclusion(rows).status,'DESCRIPTIVELY STABLE')
  assert.equal(scoreStabilityConclusion([...rows.slice(0,2),row('recent::pooled',29,.1)]).status,'INSUFFICIENT')
  assert.equal(scoreStabilityConclusion([...rows.slice(0,2),row('recent::pooled',50,.1)]).status,'DIRECTIONALLY CONSISTENT BUT EXPLORATORY')
  const mixed=scoreStabilityConclusion([...rows.slice(0,2),row('recent::pooled',100,-.1)])
  assert.equal(mixed.status,'MIXED / UNSTABLE'); assert.equal(mixed.flags.olderImprovementNotPersistent,true)
  assert.equal(scoreStabilityConclusion(rows.map(r=>({...r,costTiers:r.costTiers.map(t=>({...t,differenceR:-t.differenceR}))}))).status,'DESCRIPTIVELY STABLE')
  assert.equal(scoreStabilityConclusion([...rows,row('full::QQQ',100,.1,.04)]).flags.costDependence,true)
})

test('cutoff and pre-roll are causal; invalid, missing and wrong-timeframe input is explicit', () => {
  const raw=fixture(), cutoff='2025-01-03T00:00:00Z'
  const result=runScannerScoreStability(raw,{...bounds,requestedStart:'2025-01-01',requestedEnd:cutoff})
  const changed=structuredClone(raw)
  for(const candles of Object.values(changed)) for(const c of candles) if(Date.parse(c.timestamp)>=Date.parse(cutoff)) Object.assign(c,{open:999,high:1000,low:998,close:999})
  assert.deepEqual(runScannerScoreStability(changed,{...bounds,requestedStart:'2025-01-01',requestedEnd:cutoff}),result)
  assert.ok(result.rows.find(r=>r.group==='full::pooled').evaluatedCount < raw.SPY.length*3)
  assert.equal(runScannerScoreStability({...raw,SPY:[]},bounds).available,false)
  assert.equal(runScannerScoreStability(raw,{}).available,false)
  changed.SPY[0].volume=null
  assert.equal(runScannerScoreStability(changed,bounds).incomplete,true)
  assert.equal(runScannerScoreStability({...raw,SPY:raw.SPY.map(c=>({...c,timeframe:'5Min'}))},bounds).available,false)
})
