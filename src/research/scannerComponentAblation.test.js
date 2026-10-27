import assert from 'node:assert/strict'
import { test } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createResearchRecordForExperiment, getResearchExperiment } from './registry.js'
import { executeResearchExperiment } from './experimentExecutors.js'
import { projectResearchRunForPersistence } from './researchRunHistory.js'
import { stringifyResearchJson, parseResearchJson } from './researchRunSerialization.js'
import { synthesizeResearch, EVIDENCE_FAMILIES } from './synthesis.js'
import { createEffectiveExperimentConfiguration, resolveCurrentEffectiveExperimentConfiguration } from './effectiveExperimentConfiguration.js'
import { ScannerAblationResult } from './ScannerAblationResult.js'
import { runScannerComponentAblation, ablationConfiguration } from '../backtest/scannerComponentAblation.js'
const id = 'scanner-component-ablation'
const context = { symbols:['SPY','QQQ','IWM'], timeframe:'1Hour',requestedStart:'2024-01-01T00:00:00Z',requestedEnd:'2024-03-01T00:00:00Z',provenance:{runId:'ablation-fixture',datasetId:'fixture-dataset',codeRevision:'fixture'} }
const raw = Object.fromEntries(context.symbols.map(symbol => [symbol,Array.from({length:300},(_,i)=> {
  const close=100+i*.03+Math.sin(i/6)
  return {symbol,timeframe:'1Hour',timestamp:new Date(Date.UTC(2024,0,1)+i*3600000).toISOString(),open:close,close,high:close+.2,low:close-.2,volume:1000+i}
})]))

test('ablation dispatch is opt-in, requires complete hourly universe and matches native runner', () => {
  assert.equal(getResearchExperiment(id).defaultSelected,false)
  const output=executeResearchExperiment(id,raw,context)
  assert.equal(output.status,'succeeded')
  assert.deepEqual(output.nativeOutput,runScannerComponentAblation(raw,context))
  assert.equal(executeResearchExperiment(id,{...raw,QQQ:[]},context).status,'unavailable')
  assert.equal(executeResearchExperiment(id,raw,{...context,timeframe:'5Min'}).status,'unavailable')
})

test('normalized evidence/provenance/methodology and compact detail survive history projection', () => {
  const payload=runScannerComponentAblation(raw,context)
  const record=createResearchRecordForExperiment(id,payload,context)
  const experimentResults=[{experimentId:id,status:'succeeded',nativeOutput:payload}]
  const saved=parseResearchJson(stringifyResearchJson(projectResearchRunForPersistence({records:[record],experimentResults,synthesis:synthesizeResearch([record])})))
  assert.equal(saved.records[0].methodologyVersion,'scanner-component-ablation-1')
  assert.deepEqual(saved.records[0].parameters,record.parameters)
  assert.deepEqual(saved.records[0].metrics,record.metrics)
  assert.deepEqual(saved.records[0].provenance,record.provenance)
  assert.equal(saved.records[0].nativePayload,undefined)
  assert.equal(saved.experimentResults[0].nativeOutput,undefined)
  const evidence=saved.synthesis.strategyGroups.flatMap(g=>g.evidence)
  assert.ok(evidence.some(e=>e.membershipRule==='research-eligible-75-plus'))
  assert.ok(evidence.some(e=>e.membershipRule==='ablation-without-ema-fixed-75'))
  assert.deepEqual(evidence.find(e=>e.metricsKey==='full::baseline').symbols,context.symbols)
  assert.deepEqual(evidence.find(e=>e.metricsKey==='symbol-SPY::baseline').symbols,['SPY'])
  assert.ok(EVIDENCE_FAMILIES['signal-quality-catalogue'].experimentIds.includes(id))
  const configuration=createEffectiveExperimentConfiguration(experimentResults)[id].configuration
  assert.deepEqual(configuration,ablationConfiguration)
  assert.deepEqual(resolveCurrentEffectiveExperimentConfiguration({run:{runContext:{...context,requestedExperiments:[id]},experimentResults},dataset:{rawSeriesBySymbol:raw}}).experiments[id],configuration)
})

test('saved and fresh views agree, explain absent metrics and threshold consequences with accessible tables', () => {
  const record=createResearchRecordForExperiment(id,runScannerComponentAblation(raw,context),context)
  const saved=parseResearchJson(stringifyResearchJson(projectResearchRunForPersistence({records:[record],experimentResults:[]}))).records[0]
  const html=renderToStaticMarkup(React.createElement(ScannerAblationResult,{record}))
  assert.equal(renderToStaticMarkup(React.createElement(ScannerAblationResult,{record:saved})),html)
  for(const text of ['temporarily remove one ingredient','Maximum score is 65','not measured zero performance','Unavailable','not independent confirmation','<caption>','scope="col"','<summary>','\u2014']) assert.ok(html.includes(text),text)
  assert.match(renderToStaticMarkup(React.createElement(ScannerAblationResult,{record:{}})),/unavailable/)
})

test('ablation renders intended Unicode punctuation and infinity without mojibake', () => {
  const record=createResearchRecordForExperiment(id,runScannerComponentAblation(raw,context),context)
  // Synthetic display case only: no losses makes profit factor unbounded.
  const populated=Object.values(record.metrics).find(m=>m.ablation.metrics)
  assert.ok(populated)
  populated.ablation.metrics.profitFactor=Infinity
  const html=renderToStaticMarkup(React.createElement(ScannerAblationResult,{record}))
  for(const text of ['\u2014','\u221e','30\u201399']) assert.ok(html.includes(text),text)
  for(const corrupted of ['\u00e2\u20ac\u201d','\u00e2\u02c6\u017e','30\u00e2\u20ac\u201c99','\ufffd']) {
    assert.equal(html.includes(corrupted),false)
  }
})
