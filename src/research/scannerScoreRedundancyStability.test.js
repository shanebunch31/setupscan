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
import { ScannerScoreStabilityResult } from './ScannerScoreStabilityResult.js'
import { runScannerScoreStability, scoreStabilityConfiguration } from '../backtest/scannerScoreRedundancyStability.js'

const id = 'scanner-score-redundancy-stability'
const context = { symbols:['SPY','QQQ','IWM'], timeframe:'1Hour', requestedStart:'2024-12-30T00:00:00Z', requestedEnd:'2025-02-01T00:00:00Z',
  requestedAt:'2025-02-01T00:00:00Z', provenance:{runId:'score-stability-test',datasetId:'synthetic-v2',codeRevision:'fixture'} }
const raw = Object.fromEntries(context.symbols.map(symbol => [symbol,Array.from({length:420},(_,i)=> {
  const close=100+i*.03+Math.sin(i/6)
  return {symbol,timeframe:'1Hour',timestamp:new Date(Date.UTC(2024,11,24)+i*3600000).toISOString(),open:close,high:close+.2,low:close-.2,close,volume:1000+i}
})]))

test('opt-in dispatch uses full calculation pre-roll and frozen run cutoff, without changing shared dataset', () => {
  assert.equal(getResearchExperiment(id).defaultSelected,false)
  const dataset={rawSeriesBySymbol:Object.fromEntries(context.symbols.map(s=>[s,raw[s].filter(c=>c.timestamp>=context.requestedStart)])),
    calculationSeries:context.symbols.map(symbol=>({symbol,timeframe:'1Hour',candles:raw[symbol]}))}
  const before=structuredClone(dataset)
  const result=executeResearchExperiment(id,dataset,context)
  assert.equal(result.status,'succeeded')
  assert.deepEqual(result.nativeOutput,runScannerScoreStability(raw,context))
  assert.deepEqual(executeResearchExperiment(id,dataset,{...context,requestedEnd:null}).nativeOutput,result.nativeOutput)
  assert.deepEqual(dataset,before)
  assert.equal(executeResearchExperiment(id,dataset,{...context,timeframe:'5Min'}).status,'unavailable')
  assert.equal(executeResearchExperiment(id,{...raw,QQQ:[]},context).status,'unavailable')
  assert.equal(executeResearchExperiment('fake-score-study',raw,context).status,'failed')
  assert.ok(getResearchExperiment('scanner-component-ablation'))
})

test('normalized summaries, evidence, effective configuration, identity and provenance survive save projection', () => {
  const payload=runScannerScoreStability(raw,context)
  const record=createResearchRecordForExperiment(id,payload,context)
  const experimentResults=[{experimentId:id,status:'succeeded',nativeOutput:payload}]
  const run={records:[record],experimentResults,synthesis:synthesizeResearch([record])}
  const saved=parseResearchJson(stringifyResearchJson(projectResearchRunForPersistence(run)))
  assert.equal(saved.records[0].methodologyVersion,'scanner-score-redundancy-stability-1')
  assert.deepEqual(saved.records[0].parameters,record.parameters)
  assert.deepEqual(saved.records[0].metrics,record.metrics)
  assert.deepEqual(saved.records[0].provenance,record.provenance)
  assert.deepEqual(saved.synthesis,run.synthesis)
  assert.equal(saved.records[0].nativePayload,undefined)
  assert.equal(saved.experimentResults[0].nativeOutput,undefined)
  assert.equal(saved.records[0].parameters.scoreStability.rows,undefined)
  assert.equal(saved.records[0].parameters.scoreStability.records,undefined)
  const evidence=saved.synthesis.strategyGroups.flatMap(g=>g.evidence)
  assert.ok(evidence.some(e=>e.membershipRule==='research-eligible-75-plus'))
  assert.ok(evidence.some(e=>e.membershipRule==='score-stability-combined-20-mechanical-75-percent-64'))
  assert.deepEqual(evidence.find(e=>e.metricsKey==='full::SPY::baseline::fixed-75').symbols,['SPY'])
  assert.ok(EVIDENCE_FAMILIES['signal-quality-catalogue'].experimentIds.includes(id))
  assert.deepEqual(createEffectiveExperimentConfiguration(experimentResults)[id].configuration,scoreStabilityConfiguration)
  assert.deepEqual(resolveCurrentEffectiveExperimentConfiguration({run:{runContext:{...context,requestedExperiments:[id]},experimentResults},dataset:{rawSeriesBySymbol:raw}}).experiments[id],scoreStabilityConfiguration)
})

test('fresh/saved accessible tables show actual counts, costs, empty evidence, equivalence and deterministic interpretation', () => {
  const record=createResearchRecordForExperiment(id,runScannerScoreStability(raw,context),context)
  const saved=parseResearchJson(stringifyResearchJson(projectResearchRunForPersistence({records:[record],experimentResults:[]}))).records[0]
  const html=renderToStaticMarkup(React.createElement(ScannerScoreStabilityResult,{record}))
  assert.equal(renderToStaticMarkup(React.createElement(ScannerScoreStabilityResult,{record:saved})),html)
  for(const text of ['RESULT:','EVIDENCE:','STABILITY:','LIMITATION:','NEXTQUESTION:','mechanical-75-percent 64/85','mechanical-75-percent 60/80','not measured zero','unavailable input','not independent confirmations','<caption>','scope="col"','\u2014','30\u201399','2025','2026','Same resolved occurrences','Removed baseline-ranked dates']) assert.ok(html.includes(text),text)
  assert.match(renderToStaticMarkup(React.createElement(ScannerScoreStabilityResult,{record:{}})),/unavailable/)
})
