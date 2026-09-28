import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { test } from 'node:test'
import { CanonicalDatasetSection, ResearchRunDetail } from './ResearchRunDetail.js'
import { beginResearchRunDatasetLoad, createResearchHistoryActions, loadResearchRunDataset, loadResearchRunDetail, selectedResearchRun } from './researchHistoryModel.js'

function persistedRun() {
  return {
    runContext: {
      runId: 'run-detail-1', requestedAt: '2026-09-20T12:30:00.000Z', symbols: ['SPY', 'QQQ'],
        timeframe: '1Hour', requestedStart: '2024-01-01', requestedEnd: '2025-01-01', requestedExperiments: ['robustness'],
        emaContractVersion: 'setupscan-ema-sma-seeded-recursive-v1', adjustmentMode: 'split', codeRevision: 'revision-persisted-1',
    },
    status: 'partial',
    fetchStatus: 'partial',
    fetchIssues: [{ symbol: 'QQQ', type: 'fetch-error', error: { message: 'Provider timeout' }, fetchResult: { candles: [{ close: 'RAW_ISSUE_CANDLE_MARKER' }] } }],
    dataset: { datasetId: 'dataset-detail-1', provider: 'alpaca', adjustmentMode: 'split', timeframe: '1Hour', effectiveMetadata: { requestedStart: '2024-01-01', requestedEnd: '2025-01-01', symbols: { SPY: { actualStart: '2024-01-02', actualEnd: '2024-12-31', calculationStart: '2023-12-01', calculationEnd: '2024-12-31' } } }, rawSeriesBySymbol: { SPY: [{ close: 'RAW_DATASET_CANDLE_MARKER' }] } },
    effectiveDateProvenance: { requestedStart: '2024-01-01', requestedEnd: '2025-01-01', symbols: { SPY: { actualStart: '2024-01-02', actualEnd: '2024-12-31', calculationStart: '2023-12-01', calculationEnd: '2024-12-31' } } },
    effectiveExperimentConfiguration: { robustness: { status: 'succeeded', configuration: { periodCount: 4 } } },
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
    'Dataset: the historical market-data input used by this run.',
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

test('saved Run Detail loads the canonical dataset using its persisted datasetId', async () => {
  const dataset = { datasetId: 'dataset-detail-1', calculationSeries: [{ symbol: 'SPY', timeframe: '1Hour', candles: [{ timestamp: '2023-12-01T14:00:00Z' }, { timestamp: '2024-12-31T20:00:00Z' }] }] }
  const calls = []
  const loaded = await loadResearchRunDataset(persistedRun(), async (datasetId) => {
    calls.push(datasetId)
    return dataset
  })
  assert.deepEqual(calls, ['dataset-detail-1'])
  assert.deepEqual(loaded, dataset)

  const html = renderToStaticMarkup(React.createElement(CanonicalDatasetSection, { dataset: loaded, datasetId: loaded.datasetId }))
  assert.match(html, /Canonical calculation dataset/)
  assert.match(html, /SPY.*2 calculation candles/)
  assert.match(html, /2023-12-01T14:00:00Z to 2024-12-31T20:00:00Z/)
  assert.doesNotMatch(html, /close|open|volume/i)
})

test('Run Detail dataset effect path loads direct and asynchronously retrieved runs, and ignores stale results', async () => {
  const directRun = persistedRun()
  const directStates = []
  const directDataset = { datasetId: 'dataset-detail-1', calculationSeries: [] }
  const cleanupDirect = beginResearchRunDatasetLoad(directRun, async (id) => {
    assert.equal(id, 'dataset-detail-1')
    return directDataset
  }, (state) => directStates.push(state))
  await new Promise((resolve) => setImmediate(resolve))
  cleanupDirect()
  assert.deepEqual(directStates.map(({ status }) => status), ['loading', 'loaded'])
  assert.deepEqual(directStates.at(-1).dataset, directDataset)

  const loadedRun = await loadResearchRunDetail('run-async-1', async (id) => ({ ...persistedRun(), runContext: { ...persistedRun().runContext, runId: id }, dataset: { ...persistedRun().dataset, datasetId: 'dataset-async-1' } }))
  const asyncStates = []
  let finishOldFetch
  const cleanupOld = beginResearchRunDatasetLoad(directRun, () => new Promise((resolve) => { finishOldFetch = resolve }), (state) => asyncStates.push(state))
  await Promise.resolve()
  cleanupOld()
  const cleanupNew = beginResearchRunDatasetLoad(loadedRun, async (id) => ({ datasetId: id, calculationSeries: [] }), (state) => asyncStates.push(state))
  await new Promise((resolve) => setImmediate(resolve))
  finishOldFetch({ datasetId: 'dataset-detail-1', calculationSeries: [{ symbol: 'STALE' }] })
  cleanupNew()
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(asyncStates.filter(({ status }) => status === 'loaded').map(({ datasetId }) => datasetId), ['dataset-async-1'])
  assert.equal(selectedResearchRun('run-async-1', null, { runId: 'run-old', run: directRun }), null)
  assert.equal(selectedResearchRun('run-async-1', null, { runId: 'run-async-1', run: loadedRun }), loadedRun)
})

test('legacy saved runs without a datasetId still render and skip canonical retrieval', async () => {
  const run = persistedRun()
  run.dataset = null
  run.synthesis.provenance = { runId: 'run-detail-1' }
  let called = false
  assert.equal(await loadResearchRunDataset(run, async () => { called = true }), null)
  assert.equal(called, false)

  const html = renderToStaticMarkup(React.createElement(ResearchRunDetail, { run }))
  assert.match(html, /run-detail-1/)
  assert.match(html, /This legacy run has no dataset ID/)
  assert.match(html, /Persisted run provenance/)
})

test('canonical dataset retrieval failure has a clear detail error state', async () => {
  const states = []
  beginResearchRunDatasetLoad(persistedRun(), async () => { throw new Error('Stored dataset is unavailable') }, (state) => states.push(state))
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(states.map(({ status }) => status), ['loading', 'error'])
  const html = renderToStaticMarkup(React.createElement(React.Fragment, null,
    React.createElement(ResearchRunDetail, { run: persistedRun() }),
    React.createElement(CanonicalDatasetSection, { datasetId: 'dataset-detail-1', error: states.at(-1).error }),
  ))
  assert.match(html, /Run status/)
  assert.match(html, /Canonical dataset could not be loaded: Stored dataset is unavailable/)
  assert.match(html, /role="alert"/)
})

test('canonical dataset loading state is visible while saved contents are being fetched', () => {
  const html = renderToStaticMarkup(React.createElement(CanonicalDatasetSection, { datasetId: 'dataset-detail-1', loading: true }))
  assert.match(html, /Loading canonical dataset/)
  assert.match(html, /role="status"/)
})

test('Persisted Run Detail surfaces existing provenance without exposing candle or native payloads', () => {
  const html = renderToStaticMarkup(React.createElement(ResearchRunDetail, { run: persistedRun() }))
  for (const field of ['Persisted run provenance', 'Dataset ID', 'Provider', 'alpaca', 'Adjustment mode', 'split', 'Requested date range', '2024-01-01', 'Code revision', 'Effective and calculation ranges by symbol', '2023-12-01', 'Effective experiment configuration', 'periodCount']) {
    assert.ok(html.includes(field), `expected provenance to include ${field}`)
  }
  assert.doesNotMatch(html, /RAW_DATASET_CANDLE_MARKER|RAW_NATIVE_OUTPUT_MARKER|RAW_RECORD_PAYLOAD_MARKER/)
})
