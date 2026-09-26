import { compareResearchEvidence } from '../src/research/researchRunComparison.js'

export function createResearchRunComparisonService({ store, compare = compareResearchEvidence } = {}) {
  if (!store || typeof store.getResearchRunComparisonSnapshot !== 'function') {
    throw new TypeError('Research Run comparison service requires a store with getResearchRunComparisonSnapshot()')
  }

  return async function compareResearchRuns(runIdA, runIdB) {
    if (typeof runIdA !== 'string' || !runIdA || typeof runIdB !== 'string' || !runIdB) {
      const error = new Error('runIdA and runIdB are required')
      error.code = 'RESEARCH_RUN_INVALID'
      error.statusCode = 400
      throw error
    }
    const [snapshotA, snapshotB] = await Promise.all([
      store.getResearchRunComparisonSnapshot(runIdA),
      store.getResearchRunComparisonSnapshot(runIdB),
    ])
    if (!snapshotA || !snapshotB) {
      const missingRunId = !snapshotA ? runIdA : runIdB
      const error = new Error(`Research run not found: ${missingRunId}`)
      error.code = 'RESEARCH_RUN_NOT_FOUND'
      error.statusCode = 404
      throw error
    }

    const result = compare(snapshotA.synthesis, snapshotB.synthesis)
    return {
      ...result,
      runA: { ...result.runA, requestedAt: snapshotA.requestedAt },
      runB: { ...result.runB, requestedAt: snapshotB.requestedAt },
    }
  }
}