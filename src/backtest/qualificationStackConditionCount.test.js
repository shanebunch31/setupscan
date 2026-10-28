import assert from 'node:assert/strict'
import { test } from 'node:test'
import { scanSetups } from '../logic/scanner.js'
import { buildAlignedSeries, buildTradeFromIndex, computeMetrics, signalQualityDefaults } from './signalQualityBacktest.js'
import { stackConditions, stackViews, stackBuckets, fullStackConditions, classifyQualificationStack, belongsToStack, runQualificationStack, summarizeQualificationStack, compareStackCounts } from './qualificationStackConditionCount.js'

const all = Object.fromEntries(stackConditions.map(c => [c.key, true]))
const bucket = key => stackBuckets.find(b => b.key === key)
function input(conditions = all) {
  return { price:101,vwap:conditions.vwap?100:102,ema9:conditions.ema?101:99,ema21:100,rsi:conditions.rsi?60:50,
    relativeVolume:conditions.rvol?1.4:1.1,relativeVolumeMethod:'prior-bars',breakout:conditions.breakout,trend:conditions.trend?'Bullish':'Bearish' }
}
function fixture(length=420) {
  return Object.fromEntries(['SPY','QQQ','IWM'].map(symbol => [symbol,Array.from({length},(_,i)=> {
    const close=100+i*.03+(i%2===0?.12:-.12)
    return {symbol,timeframe:'1Hour',timestamp:new Date(Date.UTC(2024,11,24)+i*3600000).toISOString(),open:close,high:close+.02,low:close-.02,close,volume:i%5===0?4000:1000}
  })]))
}
const bounds={requestedStart:'2024-12-24T00:00:00Z',requestedEnd:'2025-02-01T00:00:00Z'}

test('all 64 full-condition patterns match production; partial RSI/RVOL points are never passes', () => {
  for(let mask=0;mask<64;mask++) {
    const expected=Object.fromEntries(stackConditions.map((c,i)=>[c.key,Boolean(mask&(1<<i))]))
    const candle=input(expected), before=structuredClone(candle)
    const conditions=fullStackConditions(candle,30), classified=classifyQualificationStack(conditions)
    assert.deepEqual(conditions,expected)
    assert.equal(classified.six.passedCount,Object.values(expected).filter(Boolean).length)
    const signal=scanSetups([candle])[0]
    assert.equal(classified.six.passedCount===6,signal.qualifiedSetup)
    if(!expected.rsi) { assert.equal(signal.reasons.find(r=>r.label==='RSI momentum').points,8); assert.equal(conditions.rsi,false) }
    if(!expected.rvol) { assert.equal(signal.reasons.find(r=>r.label==='Relative volume').points,8); assert.equal(conditions.rvol,false) }
    assert.deepEqual(candle,before)
  }
  assert.equal(scanSetups([input()])[0].score,100)
  assert.equal(scanSetups([input({ ...all,rsi:false,rvol:false })])[0].score,86)
})

test('exact counts and exhaustive six singles / fifteen pairs classify deterministically', () => {
  assert.equal(stackBuckets.filter(b=>b.view==='six'&&b.kind==='single').length,6)
  assert.equal(stackBuckets.filter(b=>b.view==='six'&&b.kind==='pair').length,15)
  assert.ok(belongsToStack(classifyQualificationStack(all),bucket('six::count-6')))
  for(const b of stackBuckets.filter(b=>b.view==='six'&&b.kind!=='count')) {
    const state=classifyQualificationStack({...all,...Object.fromEntries(b.missing.map(k=>[k,false]))})
    assert.equal(belongsToStack(state,b),true)
    assert.equal(state.six.passedCount,b.count)
    assert.equal(stackBuckets.filter(other=>other.view==='six'&&other.kind===b.kind&&belongsToStack(state,other)).length,1)
  }
  assert.ok(belongsToStack(classifyQualificationStack({...all,vwap:false,ema:false,rsi:false,rvol:false}),bucket('six::count-le2')))
})

test('five-family AND rule records disagreement and unavailability; all singles/pairs are exhaustive', () => {
  assert.equal(stackBuckets.filter(b=>b.view==='five'&&b.kind==='single').length,5)
  assert.equal(stackBuckets.filter(b=>b.view==='five'&&b.kind==='pair').length,10)
  assert.equal(classifyQualificationStack(all).five.passedCount,5)
  const disagreement=classifyQualificationStack({...all,trend:false})
  assert.equal(disagreement.pairState,'disagreement'); assert.equal(disagreement.families.trendFamily,false)
  assert.equal(disagreement.five.passedCount,4)
  for(const b of stackBuckets.filter(b=>b.view==='five'&&b.kind!=='count')) {
    const conditions={...all}
    for(const key of b.missing) if(key==='trendFamily') {conditions.ema=false;conditions.trend=false} else conditions[key]=false
    const state=classifyQualificationStack(conditions)
    assert.equal(state.five.passedCount,b.count)
    assert.equal(stackBuckets.filter(other=>other.view==='five'&&other.kind===b.kind&&belongsToStack(state,other)).length,1)
    assert.ok(belongsToStack(state,b))
  }
  for(const key of ['ema','trend','vwap','rsi','rvol','breakout']) {
    const state=classifyQualificationStack({...all,[key]:null})
    assert.equal(state.six.passedCount,null); assert.equal(state.five.passedCount,null)
    assert.ok(stackBuckets.every(b=>!belongsToStack(state,b)))
  }
  assert.equal(classifyQualificationStack({...all,ema:null}).families.trendFamily,null)
})

test('input availability is distinct from a known non-pass, including warmup and missing types', () => {
  assert.equal(fullStackConditions({...input(),rsi:null},30).rsi,null)
  assert.equal(fullStackConditions({...input(),relativeVolumeMethod:'unavailable'},30).rvol,null)
  assert.equal(fullStackConditions({...input(),trend:null},30).trend,null)
  assert.equal(fullStackConditions({...input(),breakout:undefined},30).breakout,null)
  assert.equal(fullStackConditions(input(),19).breakout,null)
  assert.equal(fullStackConditions({...input(),vwap:null},30).vwap,null)
  assert.equal(fullStackConditions({...input(),vwap:101},30).vwap,false)
})

function record(conditions, decision='2025-01-02T16:00:00Z', outcome='2025-01-02T17:00:00Z', symbol='SPY', rMultiple=2) {
  return {symbol,classification:classifyQualificationStack(conditions),decisionTimestamp:decision,outcomeTimestamp:outcome,exclusionReason:null,
    trend:'Insufficient-History',volatility:'Insufficient-History',regime:'Insufficient-History / Insufficient-History',
    trade:{rMultiple,exitReason:'Target',holdingTime:60,ambiguousCandle:false}}
}
test('all populations and single/pair subgroups reconcile; unavailable rows never become low-count observations', () => {
  const records=Array.from({length:64},(_,mask)=>record(Object.fromEntries(stackConditions.map((c,i)=>[c.key,Boolean(mask&(1<<i))]))))
  records.push(record({...all,vwap:null}),record({...all,trend:null}))
  const result=summarizeQualificationStack(records,{requestedStart:'2022-01-01',requestedEnd:'2026-10-28'})
  for(const a of result.accounting) {
    assert.equal(a.reconciliationStatus,'reconciled')
    assert.equal(a.examinedCount,a.conditionEvaluableCount+a.unavailableCount)
    assert.equal(a.exactCountTotal,a.conditionEvaluableCount)
  }
  for(const row of result.rows) {
    assert.equal(row.reconciliationStatus,'reconciled')
    assert.equal(row.eligibleCount+row.otherEvaluableCount,row.conditionEvaluableCount)
    assert.equal(row.resolvedCount+row.outcomeExcludedCount,row.eligibleCount)
    assert.equal(row.wins+row.losses+row.breakeven,row.resolvedCount)
    for(const t of row.costTiers) if(t.metrics) {
      assert.equal(t.metrics.tradeCount,row.resolvedCount)
      assert.ok(Math.abs(t.metrics.totalR-(row.metrics.totalR-t.costR*row.resolvedCount))<1e-8)
    }
  }
  const accounting=result.accounting.find(a=>a.group==='full::pooled'&&a.view==='six')
  assert.equal(accounting.examinedCount,66); assert.equal(accounting.unavailableCount,2)
  assert.equal(accounting.singleMissingTotal,6); assert.equal(accounting.pairMissingTotal,15)
  assert.ok(result.rows.some(r=>r.group==='trend::Insufficient-History'))
  assert.ok(result.rows.some(r=>r.group==='regime::Insufficient-History / Insufficient-History'))
  assert.equal(result.redundancy.sameMembership,false)
})

test('empty EMA/Trend single-missing buckets are structural emptiness, not two confirmations', () => {
  const result=summarizeQualificationStack([record(all),record({...all,ema:false,trend:false})],{requestedStart:'2022-01-01',requestedEnd:'2026-10-28'})
  assert.equal(result.redundancy.emaMissingCount,0); assert.equal(result.redundancy.trendMissingCount,0)
  assert.match(result.redundancy.interpretation,/Both single-missing buckets are empty/)
  const missing=result.rows.find(r=>r.group==='full::pooled'&&r.view==='six'&&r.bucket==='missing-ema')
  assert.equal(missing.metrics,null); assert.equal(missing.evidenceStrength,'insufficient')
})

test('period-contained outcomes exclude 2024/2025 and 2025/2026 crossings, without changing full-range evidence', () => {
  const records=[record(all,'2024-12-31T23:00:00Z','2025-01-01T01:00:00Z'),record(all,'2025-12-31T23:00:00Z','2026-01-01T01:00:00Z'),record(all,'2026-01-02T16:00:00Z','2026-01-02T17:00:00Z')]
  const result=summarizeQualificationStack(records,{requestedStart:'2022-01-01',requestedEnd:'2026-10-28'})
  const row=period=>result.rows.find(r=>r.group===`${period}::pooled`&&r.view==='six'&&r.bucket==='count-6')
  assert.equal(row('full').resolvedCount,3); assert.equal(row('recent').resolvedCount,2)
  for(const period of ['year-2024','year-2025','development']) { assert.equal(row(period).resolvedCount,0); assert.equal(row(period).exclusions['outcome-crosses-period'],1) }
  assert.equal(row('year-2026').resolvedCount,1)
})

test('Qualified baseline matches unchanged scanner/outcome helpers; symbols reconcile, history is not mutated', () => {
  const raw=fixture(), before=structuredClone(raw), aligned=buildAlignedSeries(raw)
  const result=runQualificationStack(raw,bounds), trades=[]
  let qualified=0
  for(const symbol of ['SPY','QQQ','IWM']) {
    const signals=new Map(scanSetups(aligned.enriched[symbol]).map(s=>[s.timestamp,s]))
    aligned.raw[symbol].forEach((c,i)=> {
      if(!signals.get(c.timestamp).qualifiedSetup) return
      qualified++
      const trade=buildTradeFromIndex(aligned.raw[symbol],i,signalQualityDefaults,{symbol})
      if(trade&&!(trade.exitReason==='Expired'&&trade.holdingBars<12)) trades.push(trade)
    })
  }
  trades.sort((a,b)=>a.timestamp.localeCompare(b.timestamp)||a.symbol.localeCompare(b.symbol))
  const baseline=result.rows.find(r=>r.group==='full::pooled'&&r.view==='six'&&r.bucket==='count-6')
  assert.ok(qualified>0,'fixture must contain Qualified observations')
  assert.ok(trades.length>0)
  assert.equal(baseline.eligibleCount,qualified); assert.deepEqual(baseline.metrics,computeMetrics(trades))
  for(const b of stackBuckets) for(const field of ['eligibleCount','resolvedCount','unavailableCount','examinedCount']) {
    const rows=result.rows.filter(r=>r.view===b.view&&r.bucket===b.id)
    assert.equal(rows.filter(r=>['full::SPY','full::QQQ','full::IWM'].includes(r.group)).reduce((s,r)=>s+r[field],0),rows.find(r=>r.group==='full::pooled')[field])
  }
  assert.deepEqual(raw,before)
  assert.deepEqual(runQualificationStack(Object.fromEntries(Object.entries(raw).reverse()),bounds),result)
})

test('day stress ranks Qualified Eastern days once and keeps removals identical for populations and costs', () => {
  const records=Array.from({length:12},(_,i)=> {
    const decision=new Date(Date.UTC(2025,0,1+i,1)).toISOString(),outcome=new Date(Date.UTC(2025,0,1+i,2)).toISOString()
    return [record(all,decision,outcome,'SPY',i%2?2:-1),record({...all,rvol:false},decision,outcome,'QQQ',i%2?-1:2)]
  }).flat()
  const result=summarizeQualificationStack(records,{requestedStart:'2022-01-01',requestedEnd:'2026-10-28'})
  const rows=result.rows.filter(r=>r.group==='full::pooled')
  const dates=['2025-01-01','2025-01-03','2025-01-05','2025-01-07','2025-01-09']
  for(const row of rows) {
    assert.deepEqual(row.daySensitivity[0].removedDays,dates)
    for(const tier of row.daySensitivity[0].costTiers) if(tier.metrics) assert.equal(tier.metrics.tradeCount,row.daySensitivity[0].resolvedCount)
  }
})

test('comparison evidence floors and symmetric negligible handling never assign direction to tiny samples', () => {
  function row(n,count,averageR) { return {group:'full::pooled',bucket:`count-${count}`,fullPassCount:count,resolvedCount:n,costTiers:[0,.02,.05,.1].map(costR=>({costR,metrics:n?{expectancy:averageR-costR}:null}))} }
  for(const [n,expected] of [[0,'insufficient'],[29,'insufficient'],[30,'small-exploratory-sample'],[99,'small-exploratory-sample'],[100,'descriptive-only']]) {
    const result=compareStackCounts([row(n,5,.1),row(n,6,.3)],stackViews[0])
    assert.equal(result.pairs[0].evidence,expected)
    assert.equal(result.pairs[0].costTiers[0].direction,n<30?'insufficient':'positive')
  }
  for(const delta of [-.01,.01]) assert.equal(compareStackCounts([row(100,5,.1),row(100,6,.1+delta)],stackViews[0]).pairs[0].costTiers[0].direction,'negligible')
  assert.equal(compareStackCounts([row(100,5,.2),row(100,6,-.2)],stackViews[0]).monotonicity,'not-monotonic')
})

test('cutoff is causal and invalid/missing source data cannot fabricate observations', () => {
  const raw=fixture(),cutoff='2025-01-03T00:00:00Z'
  const first=runQualificationStack(raw,{...bounds,requestedEnd:cutoff}),changed=structuredClone(raw)
  for(const series of Object.values(changed)) for(const c of series) if(Date.parse(c.timestamp)>=Date.parse(cutoff)) Object.assign(c,{open:999,high:1000,low:998,close:999})
  assert.deepEqual(runQualificationStack(changed,{...bounds,requestedEnd:cutoff}),first)
  assert.equal(runQualificationStack(raw,{}).available,false)
  assert.equal(runQualificationStack({...raw,SPY:[]},bounds).available,false)
  changed.SPY[10].volume=null
  assert.equal(runQualificationStack(changed,bounds).incomplete,true)
})

test('conclusions flag development/recent reversals for the same contrast and retain single-missing caveats', () => {
  const records=[]
  for(const year of [2024,2025]) for(const passes of [3,4,5,6]) for(let i=0;i<35;i++) {
    const conditions={...all}
    for(const key of ['rvol','breakout','rsi'].slice(0,6-passes)) conditions[key]=false
    const decision=new Date(Date.UTC(year,0,1+i%28,16)).toISOString()
    const outcome=new Date(Date.UTC(year,0,1+i%28,17)).toISOString()
    records.push(record(conditions,decision,outcome,'SPY',(year===2024?1:-1)*passes*.1))
  }
  const report=summarizeQualificationStack(records,{requestedStart:'2022-01-01',requestedEnd:'2026-10-28'})
  for(const conclusion of report.conclusions) {
    assert.equal(conclusion.status,'MIXED / UNSTABLE')
    assert.ok(conclusion.olderImprovementNotPersistent.some(p=>p.result===true))
    assert.ok(conclusion.reversals.some(c=>c.evidence.some(e=>e.group==='development::pooled')&&c.evidence.some(e=>e.group==='recent::pooled')))
    assert.match(conclusion.summary.limitation,/subgroups/)
    assert.ok(conclusion.missingConditionFindings.some(c=>c.missing==='rvol'&&c.group==='recent::pooled'))
    assert.ok(conclusion.missingConditionFindings.some(c=>c.missing==='breakout'&&c.evidence==='insufficient'))
  }
})
