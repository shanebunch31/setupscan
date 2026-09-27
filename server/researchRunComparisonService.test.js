import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createResearchRunComparisonService } from './researchRunComparisonService.js'

function snapshot(runId) {
  return {
    runId,
    requestedAt: `${runId}-requested-at`,
    datasetId: `${runId}-dataset`,
    emaContractVersion: 'setupscan-ema-sma-seeded-recursive-v1',
    synthesis: { provenance: { runId, datasetId: `${runId}-dataset` }, strategyGroups: [] },
  }
}

test('comparison service reads compact snapshots and adds header requestedAt provenance', async () => {
  const calls = []
  const snapshots = new Map([['a', snapshot('a')], ['b', snapshot('b')]])
  const service = createResearchRunComparisonService({
    store: {
      getResearchRunComparisonSnapshot: async (runId) => {
        calls.push(runId)
        return snapshots.get(runId) ?? null
      },
      getResearchRun: () => { throw new Error('full native history must not be loaded') },
    },
    compare: (synthesisA, synthesisB) => ({
      runA: { runId: synthesisA.provenance.runId, datasetId: synthesisA.provenance.datasetId, requestedAt: null },
      runB: { runId: synthesisB.provenance.runId, datasetId: synthesisB.provenance.datasetId, requestedAt: null },
      comparisons: [], unmatched: [], compatibilityNotes: [], provenance: {},
    }),
  })

  const result = await service('a', 'b')
  assert.deepEqual(calls, ['a', 'b'])
  assert.equal(result.runA.requestedAt, 'a-requested-at')
  assert.equal(result.runB.requestedAt, 'b-requested-at')
  assert.equal(result.runA.emaContractVersion, 'setupscan-ema-sma-seeded-recursive-v1')
  assert.deepEqual(result.comparisons, [])
})

test('comparison service supplies legacy EMA version metadata without rewriting saved synthesis', async () => {
  const old = snapshot('old')
  old.emaContractVersion = 'legacy-unknown'
  const current = snapshot('current')
  let receivedOld
  const service = createResearchRunComparisonService({
    store: { getResearchRunComparisonSnapshot: async (id) => id === 'old' ? old : current },
    compare: (a, b) => {
      receivedOld = a
      return { runA: { emaContractVersion: a.provenance.emaContractVersion }, runB: { emaContractVersion: b.provenance.emaContractVersion } }
    },
  })
  const result = await service('old', 'current')
  assert.equal(receivedOld.provenance.emaContractVersion, 'legacy-unknown')
  assert.equal(result.runA.emaContractVersion, 'legacy-unknown')
  assert.equal(old.synthesis.provenance.emaContractVersion, undefined)
})

test('comparison service returns a not-found condition if either run is absent', async () => {
  const service = createResearchRunComparisonService({
    store: { getResearchRunComparisonSnapshot: async (runId) => runId === 'a' ? snapshot('a') : null },
  })
  await assert.rejects(service('a', 'missing'), { code: 'RESEARCH_RUN_NOT_FOUND', statusCode: 404 })
})

test('comparison service validates both run IDs', async () => {
  let storeCalls = 0
  const service = createResearchRunComparisonService({
    store: { getResearchRunComparisonSnapshot: async () => { storeCalls += 1; return snapshot('a') } },
  })
  await assert.rejects(service('', 'b'), { code: 'RESEARCH_RUN_INVALID', statusCode: 400 })
  assert.equal(storeCalls, 0)
})
