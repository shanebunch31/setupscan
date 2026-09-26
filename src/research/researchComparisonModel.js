import { compareResearchRuns } from './researchRunHistory.js'

export function createResearchComparisonRequest(...runIds) {
  if (runIds.length !== 2) throw new Error('Select two research runs to compare.')
  const [runIdA, runIdB] = runIds
  if (typeof runIdA !== 'string' || !runIdA.trim() || typeof runIdB !== 'string' || !runIdB.trim()) {
    throw new Error('Select two research runs to compare.')
  }
  if (runIdA === runIdB) throw new Error('Select two different research runs.')
  return { runIdA, runIdB }
}

export function createResearchComparisonActions({ compareRuns = compareResearchRuns } = {}) {
  return {
    compare(...runIds) {
      const request = createResearchComparisonRequest(...runIds)
      return compareRuns(request.runIdA, request.runIdB)
    },
  }
}