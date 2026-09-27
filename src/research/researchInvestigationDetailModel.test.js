import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  loadInvestigationRunMetadata,
  projectResearchInvestigationDetail,
} from './researchInvestigationDetailModel.js'

const investigation = {
  investigationId: 'inv-1',
  question: 'Does relative value improve the baseline?',
  status: 'active',
  createdAt: '2026-09-20T00:00:00.000Z',
  requestedExperiments: ['relative-value', 'robustness'],
  runIds: ['run-b', 'run-a'],
}

test('projects investigation metadata and run metadata without changing ownership', () => {
  const projected = projectResearchInvestigationDetail(investigation, [{
    runId: 'run-b',
    status: 'available',
    run: {
      runContext: {
        requestedAt: '2026-09-21T00:00:00.000Z',
        symbols: ['SPY', 'QQQ'],
        timeframe: '1Hour',
        requestedExperiments: ['relative-value'],
      },
      status: 'completed',
      dataset: { datasetId: 'dataset-b' },
      synthesis: { coverage: { evaluated: ['relative-value'] }, strategyGroups: [{ nativePayload: 'must not copy' }] },
      records: [{ nativePayload: 'must not copy' }],
    },
  }])

  assert.deepEqual(projected, {
    investigationId: 'inv-1',
    question: investigation.question,
    status: 'active',
    createdAt: investigation.createdAt,
    requestedExperiments: ['relative-value', 'robustness'],
    associatedRuns: [
      {
        runId: 'run-b',
        metadataStatus: 'available',
        error: null,
        metadata: {
          requestedAt: '2026-09-21T00:00:00.000Z',
          status: 'completed',
          symbols: ['SPY', 'QQQ'],
          timeframe: '1Hour',
          datasetId: 'dataset-b',
          requestedExperiments: ['relative-value'],
          evaluatedExperiments: ['relative-value'],
        },
      },
      { runId: 'run-a', metadataStatus: 'loading', error: null, metadata: null },
    ],
  })
  assert.doesNotMatch(JSON.stringify(projected), /nativePayload|strategyGroups|records/)
})

test('preserves plan and associated run order and represents an empty run list', () => {
  const projected = projectResearchInvestigationDetail({
    ...investigation,
    requestedExperiments: ['walk-forward-regime', 'robustness'],
    runIds: [],
  })
  assert.deepEqual(projected.requestedExperiments, ['walk-forward-regime', 'robustness'])
  assert.deepEqual(projected.associatedRuns, [])
})

test('represents sparse run metadata as null rather than inventing values', () => {
  const [run] = projectResearchInvestigationDetail(investigation, [{ runId: 'run-b', status: 'available', run: { status: 'partial' } }]).associatedRuns
  assert.deepEqual(run.metadata, {
    requestedAt: null,
    status: 'partial',
    symbols: null,
    timeframe: null,
    datasetId: null,
    requestedExperiments: null,
    evaluatedExperiments: null,
  })
})

test('loads run metadata by saved IDs and preserves missing/unavailable states and order', async () => {
  const calls = []
  const references = await loadInvestigationRunMetadata(investigation, async (runId) => {
    calls.push(runId)
    if (runId === 'run-b') return { runContext: { runId } }
    if (runId === 'run-a') throw Object.assign(new Error('Research run not found: run-a'), { code: 'RESEARCH_RUN_NOT_FOUND' })
  })
  assert.deepEqual(calls, ['run-b', 'run-a'])
  assert.deepEqual(references.map(({ runId, status }) => [runId, status]), [
    ['run-b', 'available'], ['run-a', 'missing'],
  ])
  assert.equal(references[1].error, 'Research run not found: run-a')
})

test('an empty associated-run list performs no run fetches', async () => {
  let calls = 0
  assert.deepEqual(await loadInvestigationRunMetadata({ runIds: [] }, async () => { calls += 1 }), [])
  assert.equal(calls, 0)
})