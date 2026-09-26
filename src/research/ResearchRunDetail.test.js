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
        evidence: [{ id: 'evidence-1', sourceRecordId: 'robustness', metricsKey: 'overall', partition: 'holdout', metrics: { tradeCount: 12, winRate: 0.58 } }],
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
    'Evidence differs across partitions.', 'Holdout sample remains incomplete.',
    'Provider compatibility is unknown.', 'Provenance',
  ]) {
    assert.ok(html.includes(text), `expected detail summary to include ${text}`)
  }
  assert.match(html, /Requested: <\/strong>robustness/)
  assert.match(html, /Evaluated: <\/strong>robustness/)
  assert.match(html, /Incomplete: <\/strong>robustness/)
})

test('Run Detail does not render raw candles or large native/record payloads by default', () => {
  const html = renderToStaticMarkup(React.createElement(ResearchRunDetail, { run: persistedRun() }))
  assert.doesNotMatch(html, /RAW_ISSUE_CANDLE_MARKER|RAW_DATASET_CANDLE_MARKER|RAW_NATIVE_OUTPUT_MARKER|RAW_RECORD_PAYLOAD_MARKER/)
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