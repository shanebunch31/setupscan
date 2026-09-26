import { getResearchRun, listResearchRuns } from './researchRunHistory.js'

export const RESEARCH_HISTORY_PAGE_SIZE = 20

export function normalizeResearchHistoryFilters(form = {}) {
  const symbols = [...new Set(String(form.symbols ?? '').split(',').map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))]
  return {
    ...(form.status ? { status: form.status } : {}),
    ...(String(form.datasetId ?? '').trim() ? { datasetId: String(form.datasetId).trim() } : {}),
    ...(String(form.experimentId ?? '').trim() ? { experimentId: String(form.experimentId).trim() } : {}),
    ...(symbols.length ? { symbols } : {}),
  }
}

export function createResearchHistoryActions({ listRuns = listResearchRuns, getRun = getResearchRun } = {}) {
  return {
    list(filters = {}, offset = 0) {
      return listRuns({ ...filters, limit: RESEARCH_HISTORY_PAGE_SIZE + 1, offset })
    },
    getRun(runId) {
      return getRun(runId)
    },
  }
}

export function createResearchHistoryPage(offset, returnedRows, pageSize = RESEARCH_HISTORY_PAGE_SIZE) {
  const hasNext = returnedRows.length > pageSize
  return {
    rows: returnedRows.slice(0, pageSize),
    hasNext,
    nextOffset: hasNext ? offset + pageSize : null,
  }
}

export function loadResearchRunDetail(runId, getRun = getResearchRun) {
  return getRun(runId)
}