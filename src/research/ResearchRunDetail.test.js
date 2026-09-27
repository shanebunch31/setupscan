import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { test } from 'node:test'
import { ResearchRunDetail } from './ResearchRunDetail.js'
import { createResearchHistoryActions, loadResearchRunDetail } from './researchHistoryModel.js'

function persistedRun() {
  return {
    runContext: {
      runId: 'run-detail-1', requestedAt: '2026-09-20T12:30:00.000Z', symbols: ['SPY', 'QQQ'],
      timeframe: '1Hour', requestedStart: '2024-01-01', requestedEnd: '2025-01-01', requestedExperiments: ['robustness'],
    },
    status: 'partial',
    fetchStatus: 'partial',
    fetchIssues: [{ symbol: 'QQQ', type: 'fetch-error', error: { message: 'Provider timeout' }, fetchResult: { candles: [{ close: 'RAW_ISSUE_CANDLE_MARKER' }] } }],
    dataset: { datasetId: 'dataset-detail-1', rawSeriesBySymbol: { SPY: [{ close: 'RAW_DATASET_CANDLE_MARKER' }] } },
    experimentResults: [{ experimentId: 'robustness', status: 'incomplete', error: null, nativeOutput: { large: 'RAW_NATIVE_OUTPUT_MARKER' } }],
    records: [{ id: 'robustness', nativePayload: { large: 'RAW_RECORD_PAYLOAD_MARKER' } }],
    synthesis: {
      coverage: { requested: ['robustness'], evaluated: ['robustness'], unavailable: [], incomplete: ['robustness'] },
      strategyGroups: [{
        strategyId: 'baseline',
        evidence: [{ id: 'evidence-1', sourceRecordId: 'robustness', metricsKey: 'overall', partition: { type: 'holdout', label: 'holdout' }, metrics: { tradeCount: 12, winRate: 0.58 } }],
        evidenceFamilies: [],
      }],
      conflicts: [{ id: 'conflict-1', observation: 'Evidence differs across partitions.' }],
      unresolvedQuestions: ['Holdout sample remains incomplete.'],
      compatibilityNotes: [{ type: 'unknown', note: 'Provider compatibility is unknown.' }],
      provenance: { runId: 'run-detail-1', datasetId: 'dataset-detail-1' },
    },
  }
}

test('Run Detail requests persisted data through getResearchRun with the selected run ID', async () => {
  const calls = []
  const result = await loadResearchRunDetail('run-detail-1', async (runId) => {
    calls.push(runId)
    return persistedRun()
  })
  assert.equal(result.runContext.runId, 'run-detail-1')
  assert.deepEqual(calls, ['run-detail-1'])
})

test('Run Detail renders persisted metadata, diagnostics, synthesis evidence, questions, notes, and provenance', () => {
  const html = renderToStaticMarkup(React.createElement(ResearchRunDetail, { run: persistedRun() }))
  for (const text of [
    'run-detail-1', '2026-09-20T12:30:00.000Z', 'partial', 'partial', 'SPY, QQQ', '1Hour',
    '2024-01-01 – 2025-01-01', 'dataset-detail-1', 'QQQ · fetch-error', 'Provider timeout',
    'robustness', 'incomplete',
    'baseline', 'overall', 'tradeCount: 12', 'winRate: 0.58',
    'holdout',
    'Evidence differs across partitions.', 'Holdout sample remains incomplete.',
    'Provider compatibility is unknown.', 'Provenance',
    'Dataset: the historical market-data pull used by this run.',
    'Synthesis: A structured summary of experiment results and remaining evidence gaps.',
    'Evidence: A measured result from an experiment and sample.',
    'Compatibility: Whether the available information allows two results to be compared directly.',
    'Provenance: Details showing where the run and its data came from.',
  ]) {
    assert.ok(html.includes(text), `expected detail summary to include ${text}`)
  }
  assert.match(html, /Requested experiment identifiers: <\/strong>robustness/)
  assert.match(html, /Evaluated experiment identifiers: <\/strong>robustness/)
  assert.match(html, /Incomplete experiment identifiers: <\/strong>robustness/)
  assert.match(html, /<summary>More metric details<\/summary>/)
  assert.match(html, /<summary>More provenance details<\/summary>/)
})

test('Run Detail does not render raw candles or large native/record payloads by default', () => {
  const html = renderToStaticMarkup(React.createElement(ResearchRunDetail, { run: persistedRun() }))
  assert.doesNotMatch(html, /RAW_ISSUE_CANDLE_MARKER|RAW_DATASET_CANDLE_MARKER|RAW_NATIVE_OUTPUT_MARKER|RAW_RECORD_PAYLOAD_MARKER/)
  assert.doesNotMatch(html, /\[object Object\]/)
})

test('Run Detail keeps the answer visible and all conflict, strategy, and technical detail available on demand', () => {
  const run = persistedRun()
  const requested = Array.from({ length: 10 }, (_, index) => `experiment-${index + 1}`)
  run.status = 'partial'
  run.runContext.requestedExperiments = requested
  run.experimentResults = requested.map((experimentId, index) => ({
    experimentId,
    status: index < 8 ? 'succeeded' : index === 8 ? 'unavailable' : 'incomplete',
    error: null,
  }))
  run.synthesis.coverage = {
    requested,
    evaluated: requested.slice(0, 8),
    unavailable: [requested[8]],
    incomplete: [requested[9]],
  }
  run.synthesis.strategyGroups = [
    { strategyId: 'baseline', evidence: [{ id: 'evidence-baseline', sourceRecordId: 'experiment-1', metricsKey: 'overall' }], evidenceFamilies: [{ id: 'family-shared' }] },
    { strategyId: 'variant', evidence: [{ id: 'evidence-variant', sourceRecordId: 'experiment-2', metricsKey: 'holdout' }], evidenceFamilies: [] },
  ]
  run.synthesis.conflicts = Array.from({ length: 34 }, (_, index) => ({
    id: `conflict-${index + 1}`,
    observation: index === 0 ? 'Metric difference retained exactly: 0.12345678901234567' : `Conflict record ${index + 1}`,
  }))
  run.synthesis.unresolvedQuestions = ['The incomplete sample does not settle this question.']

  const html = renderToStaticMarkup(React.createElement(ResearchRunDetail, { run }))
  assert.match(html, /Run status[\s\S]*partial/)
  assert.match(html, /8 of 10 experiments completed/)
  assert.match(html, /SPY, QQQ/)
  assert.match(html, /1Hour/)
  assert.match(html, /Historical dataset[\s\S]*Available/)
  assert.match(html, /10 requested · 8 evaluated · 1 unavailable · 1 incomplete/)
  assert.match(html, /View conflicts \(34\)/)
  assert.match(html, /Metric difference retained exactly: 0\.12345678901234567/)
  assert.match(html, /2 strategy groups · 2 evidence entries/)
  assert.match(html, /family-shared|1 shared evidence families/)
  assert.match(html, /How was this tested\? View technical details/)
  assert.match(html, /Run ID/)
  assert.match(html, /experiment-10/)
  assert.doesNotMatch(html, /<details[^>]*\bopen(?:=|[ >])/i)
  assert.ok(html.indexOf('The incomplete sample does not settle this question.') < html.indexOf('View conflicts (34)'))
  assert.ok(html.indexOf('The incomplete sample does not settle this question.') < html.indexOf('How was this tested? View technical details'))
})

test('Run Detail handles no selection, missing runs, and API errors', async () => {
  const noSelection = renderToStaticMarkup(React.createElement(ResearchRunDetail))
  const missing = renderToStaticMarkup(React.createElement(ResearchRunDetail, { runId: 'missing', error: 'Research run not found.' }))
  assert.match(noSelection, /Select a run to view its persisted detail/)
  assert.match(missing, /Research run not found/)
  await assert.rejects(loadResearchRunDetail('missing', async () => { throw new Error('History service unavailable') }), /History service unavailable/)
})

test('Run Detail renders its loading state visibly', () => {
  const html = renderToStaticMarkup(React.createElement(ResearchRunDetail, { runId: 'run-loading-1', loading: true }))
  assert.match(html, /Loading run detail/)
  assert.match(html, /role="status"/)
})

test('Run Detail error takes precedence over loading', () => {
  const html = renderToStaticMarkup(React.createElement(ResearchRunDetail, {
    runId: 'run-error-1',
    loading: true,
    error: 'Stored run could not be loaded.',
  }))
  assert.match(html, /Stored run could not be loaded\./)
  assert.match(html, /role="alert"/)
  assert.doesNotMatch(html, /Loading run detail/)
})

test('History/Detail actions expose only the existing list and detail read APIs', async () => {
  const calls = []
  const actions = createResearchHistoryActions({
    listRuns: async () => { calls.push('listResearchRuns'); return { runs: [] } },
    getRun: async (runId) => { calls.push(`getResearchRun:${runId}`); return persistedRun() },
  })
  assert.deepEqual(Object.keys(actions).sort(), ['getRun', 'list'])
  await actions.list()
  await actions.getRun('run-read-only')
  assert.deepEqual(calls, ['listResearchRuns', 'getResearchRun:run-read-only'])
})