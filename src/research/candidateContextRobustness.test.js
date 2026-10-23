import assert from 'node:assert/strict'
import { test } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { summarizeCandidateRobustness } from '../backtest/candidateContextRobustness.js'
import { createResearchRecordForExperiment, getResearchExperiment, listResearchExperiments } from './registry.js'
import { executeResearchExperiment, researchExperimentExecutors } from './experimentExecutors.js'
import { synthesizeResearch, EVIDENCE_FAMILIES } from './synthesis.js'
import { projectResearchRunForPersistence } from './researchRunHistory.js'
import { CandidateRobustnessResult } from './CandidateRobustnessResult.js'
import { RunResultSummary } from './ResearchWorkbench.js'
import { ResearchRunDetail } from './ResearchRunDetail.js'

const id = 'candidate-context-robustness'
function fixture() {
  const payload = summarizeCandidateRobustness({ available: true, options: { requestedEnd: '2026-10-21T16:00:00Z' }, records: ['SPY', 'QQQ', 'IWM'].map((symbol) => ({
    id: symbol, symbol, timestamp: '2025-06-03T14:00:00Z', decisionTimestamp: '2025-06-03T15:00:00Z', outcomeTimestamp: '2025-06-03T16:00:00Z',
    score: 85, membershipRule: 'research-eligible-75-plus',
    contexts: { trend: { available: true, value: 'Uptrend' }, volatility: { available: true, value: 'Medium' } },
    trade: { rMultiple: 0, holdingTime: 60, ambiguousCandle: false },
  })) })
  return { payload, record: createResearchRecordForExperiment(id, payload, { symbols: ['SPY', 'QQQ', 'IWM'], timeframe: '1Hour' }) }
}

test('canonical registry and executor register the frozen version and required inputs', () => {
  assert.equal(listResearchExperiments().filter((entry) => entry.id === id).length, 1)
  assert.equal(getResearchExperiment(id).methodologyVersion, 'candidate-context-robustness-2')
  assert.deepEqual(getResearchExperiment(id).requiredSymbols, [])
  assert.ok(researchExperimentExecutors[id])
  assert.equal(executeResearchExperiment(id, {}, {}).status, 'unavailable')
})

test('normalized synthesis keeps symbol, period, candidate, population, cost and method identities', () => {
  const { record } = fixture()
  const evidence = synthesizeResearch([record]).strategyGroups.flatMap((group) => group.evidence)
  const recent = evidence.find((entry) => entry.metricsKey === 'recent::QQQ')
  assert.deepEqual(recent.symbols, ['QQQ'])
  assert.equal(recent.outOfSampleRole, 'recent')
  assert.equal(recent.membershipRule, 'research-eligible-75-plus')
  assert.equal(recent.ruleSetVariant, 'context-trend-up+medium-volatility')
  assert.equal(recent.methodologyVersion, 'candidate-context-robustness-2')
  assert.equal(recent.costModel.status, 'modeled')
  assert.ok(EVIDENCE_FAMILIES['signal-quality-catalogue'].experimentIds.includes(id))
  assert.equal(recent.metrics.robustness.matched.costTiers.length, 4)
  assert.deepEqual(evidence.find((entry) => entry.metricsKey === 'year-2025::SPY').partition, { type: 'year', label: 'year-2025::SPY' })
})

test('all compact detail survives save projection and JSON round-trip without native observations', () => {
  const { payload, record } = fixture()
  const projected = projectResearchRunForPersistence({ records: [record], experimentResults: [{ experimentId: id, status: 'succeeded', nativeOutput: payload }] })
  assert.equal(projected.records[0].nativePayload, undefined)
  assert.equal(projected.experimentResults[0].nativeOutput, undefined)
  const saved = JSON.parse(JSON.stringify(projected))
  assert.deepEqual(saved.records[0].metrics['recent::SPY'].robustness, record.metrics['recent::SPY'].robustness)
  assert.deepEqual(saved.records[0].parameters.candidateRobustness.conclusions, payload.conclusions)
  const html = renderToStaticMarkup(React.createElement(CandidateRobustnessResult, { record: saved.records[0] }))
  assert.ok(html.includes('Resolved-trade day concentration'))
  assert.ok(html.includes('Recent minus development'))
  const history = renderToStaticMarkup(React.createElement(ResearchRunDetail, { run: saved }))
  assert.ok(history.includes('Resolved-trade day concentration'))
  assert.ok(history.includes('Trend Up + Medium Volatility — focused historical evidence'))
})

test('minimal Workbench view displays true zero, unavailable metrics, reference identity and caveats', () => {
  const { record } = fixture()
  const result = { records: [record], experimentResults: [], runContext: { requestedExperiments: [id] }, status: 'completed' }
  const html = renderToStaticMarkup(React.createElement(RunResultSummary, { result }))
  for (const text of ['focused historical evidence', '0.00', '—', 'IWM (requested symbol)', '30–99', 'not statistically', 'not untouched', 'not account equity', 'Unavailable is not false', 'Shadow forward suitability requires review']) {
    // The exact descriptive wording is intentional; no fabricated certainty.
    if (text === 'not statistically') assert.ok(html.includes('not statistical significance'))
    else assert.ok(html.includes(text), text)
  }
  assert.ok(html.includes('<caption>'))
  assert.ok(html.includes('scope="col"'))
  assert.ok(html.includes('scope="row"'))
})

test('older records without the additive report remain readable and unavailable input stays unavailable', () => {
  assert.equal(renderToStaticMarkup(React.createElement(CandidateRobustnessResult, { record: { metrics: {} } })), '')
  const record = createResearchRecordForExperiment(id, { available: false }, {})
  assert.equal(record.status, 'unavailable')
  assert.ok(renderToStaticMarkup(React.createElement(CandidateRobustnessResult, { record })).includes('No performance is inferred'))
})
