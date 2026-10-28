import assert from 'node:assert/strict'
import { test } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createResearchRecordForExperiment, getResearchExperiment } from './registry.js'
import { executeResearchExperiment } from './experimentExecutors.js'
import { projectResearchRunForPersistence } from './researchRunHistory.js'
import { parseResearchJson, stringifyResearchJson } from './researchRunSerialization.js'
import { createEffectiveExperimentConfiguration, resolveCurrentEffectiveExperimentConfiguration } from './effectiveExperimentConfiguration.js'
import { synthesizeResearch, EVIDENCE_FAMILIES } from './synthesis.js'
import { QualificationStackResult } from './QualificationStackResult.js'
import { runQualificationStack, qualificationStackConfiguration } from '../backtest/qualificationStackConditionCount.js'

const id='qualification-stack-condition-count'
const context={symbols:['SPY','QQQ','IWM'],timeframe:'1Hour',requestedStart:'2024-12-30T00:00:00Z',requestedEnd:'2025-02-01T00:00:00Z',requestedAt:'2025-02-01T00:00:00Z',
  provenance:{runId:'stack-test',datasetId:'synthetic-v2',codeRevision:'fixture'}}
const raw=Object.fromEntries(context.symbols.map(symbol=>[symbol,Array.from({length:420},(_,i)=> {
  const close=100+i*.03+(i%2===0?.12:-.12)
  return {symbol,timeframe:'1Hour',timestamp:new Date(Date.UTC(2024,11,24)+i*3600000).toISOString(),open:close,high:close+.02,low:close-.02,close,volume:i%5===0?4000:1000}
})]))

test('stack dispatch is opt-in, requires complete hourly inputs and preserves pre-roll/frozen cutoff', () => {
  assert.equal(getResearchExperiment(id).defaultSelected,false)
  const dataset={rawSeriesBySymbol:Object.fromEntries(context.symbols.map(s=>[s,raw[s].filter(c=>c.timestamp>=context.requestedStart)])),
    calculationSeries:context.symbols.map(symbol=>({symbol,timeframe:'1Hour',candles:raw[symbol]}))}
  const before=structuredClone(dataset)
  const result=executeResearchExperiment(id,dataset,context)
  assert.equal(result.status,'succeeded')
  assert.deepEqual(result.nativeOutput,runQualificationStack(raw,context))
  assert.deepEqual(executeResearchExperiment(id,dataset,{...context,requestedEnd:null}).nativeOutput,result.nativeOutput)
  assert.deepEqual(dataset,before)
  assert.equal(executeResearchExperiment(id,dataset,{...context,timeframe:'5Min'}).status,'unavailable')
  assert.equal(executeResearchExperiment(id,{...raw,QQQ:[]},context).status,'unavailable')
  assert.equal(executeResearchExperiment('fake-stack-study',raw,context).status,'failed')
})

test('normalized stack/subgroup evidence, provenance and methodology survive compact persistence projection', () => {
  const payload=runQualificationStack(raw,context)
  const record=createResearchRecordForExperiment(id,payload,context)
  const experimentResults=[{experimentId:id,status:'succeeded',nativeOutput:payload}]
  const run={records:[record],experimentResults,synthesis:synthesizeResearch([record])}
  const saved=parseResearchJson(stringifyResearchJson(projectResearchRunForPersistence(run)))
  assert.equal(saved.records[0].methodologyVersion,'qualification-stack-condition-count-1')
  assert.deepEqual(saved.records[0].parameters,record.parameters)
  assert.deepEqual(saved.records[0].metrics,record.metrics)
  assert.deepEqual(saved.records[0].provenance,record.provenance)
  assert.deepEqual(saved.synthesis,run.synthesis)
  assert.equal(saved.records[0].nativePayload,undefined)
  assert.equal(saved.experimentResults[0].nativeOutput,undefined)
  assert.equal(saved.records[0].parameters.qualificationStack.rows,undefined)
  assert.equal(saved.records[0].parameters.qualificationStack.records,undefined)
  assert.equal(Object.keys(record.metrics).length, payload.rows.filter(r=>r.kind==='count').length)
  assert.equal(record.parameters.qualificationStack.subgroups.length,payload.rows.filter(r=>r.kind!=='count').length)
  const evidence=saved.synthesis.strategyGroups.flatMap(g=>g.evidence)
  assert.ok(evidence.some(e=>e.membershipRule==='qualified-only'))
  assert.ok(evidence.some(e=>e.membershipRule==='qualification-stack-five-count-4'))
  assert.deepEqual(evidence.find(e=>e.metricsKey==='full::SPY::six::count-6').symbols,['SPY'])
  assert.ok(EVIDENCE_FAMILIES['signal-quality-catalogue'].experimentIds.includes(id))
  assert.deepEqual(createEffectiveExperimentConfiguration(experimentResults)[id].configuration,qualificationStackConfiguration)
  assert.deepEqual(resolveCurrentEffectiveExperimentConfiguration({run:{runContext:{...context,requestedExperiments:[id]},experimentResults},dataset:{rawSeriesBySymbol:raw}}).experiments[id],qualificationStackConfiguration)
})

test('fresh/saved table views agree, retain all predeclared subgroups and explain small/unavailable evidence', () => {
  const record=createResearchRecordForExperiment(id,runQualificationStack(raw,context),context)
  const saved=parseResearchJson(stringifyResearchJson(projectResearchRunForPersistence({records:[record],experimentResults:[]}))).records[0]
  const html=renderToStaticMarkup(React.createElement(QualificationStackResult,{record}))
  assert.equal(renderToStaticMarkup(React.createElement(QualificationStackResult,{record:saved})),html)
  for(const text of ['RESULT:','EVIDENCE:','INDEPENDENT CONDITION VIEW:','MISSING CONDITION FINDINGS:','NEXT QUESTION:',
    'Exactly 6 of 6','Exactly 5 of 6','Exactly 4 of 6','Exactly 5 of 5','Exactly 4 of 5','Exactly 3 of 5',
    'Missing EMA + Trend','Missing Trend confirmation family + RSI','Unavailable inputs','not zero performance',
    'Partial RSI/RVOL','not a win probability','not establish statistical independence',
    '<caption>','scope="col"','<select','<label','\u2014','30\u201399','Identical resolved occurrences','no optimized deletions']) assert.ok(html.includes(text),text)
  assert.match(renderToStaticMarkup(React.createElement(QualificationStackResult,{record:{}})),/unavailable/)
})
