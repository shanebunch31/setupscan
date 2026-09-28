import {
  getResearchDataset,
  getResearchRun,
  listResearchRuns,
  saveResearchRun,
} from './researchRunHistory.js'
import {
  executeResearchReplayInWorker,
} from './researchRunWorkerClient.js'

export const RESEARCH_HISTORY_PAGE_SIZE = 20

export function normalizeResearchHistoryFilters(form = {}) {
  const symbols = [
    ...new Set(
      String(form.symbols ?? '')
        .split(',')
        .map((symbol) => symbol.trim().toUpperCase())
        .filter(Boolean),
    ),
  ]

  return {
    ...(form.status ? { status: form.status } : {}),
    ...(String(form.datasetId ?? '').trim()
      ? { datasetId: String(form.datasetId).trim() }
      : {}),
    ...(String(form.experimentId ?? '').trim()
      ? { experimentId: String(form.experimentId).trim() }
      : {}),
    ...(symbols.length ? { symbols } : {}),
  }
}

export function createResearchHistoryActions({
  listRuns = listResearchRuns,
  getRun = getResearchRun,
  replayRun = executeResearchReplayInWorker,
  saveRun = saveResearchRun,
} = {}) {
  return {
    list(filters = {}, offset = 0) {
      return listRuns({
        ...filters,
        limit: RESEARCH_HISTORY_PAGE_SIZE + 1,
        offset,
      })
    },

    getRun(runId) {
      return getRun(runId)
    },

    async replay(run, canonicalDataset) {
      const result = await replayRun({
        run,
        canonicalDataset,
      })

      if (!result) {
        throw new Error(
          'Research replay returned no result.',
        )
      }

      const saved = await saveRun(result)

      return {
        result,
        saved,
      }
    },
  }
}

export function createResearchHistoryPage(
  offset,
  returnedRows,
  pageSize = RESEARCH_HISTORY_PAGE_SIZE,
) {
  const hasNext = returnedRows.length > pageSize

  return {
    rows: returnedRows.slice(0, pageSize),
    hasNext,
    nextOffset: hasNext
      ? offset + pageSize
      : null,
  }
}

export function loadResearchRunDetail(
  runId,
  getRun = getResearchRun,
) {
  return getRun(runId)
}

export function selectedResearchRun(
  runId,
  suppliedRun,
  loadedRunState,
) {
  if (suppliedRun) return suppliedRun

  return loadedRunState?.runId === runId
    ? loadedRunState.run
    : null
}

export function researchRunDatasetId(run) {
  return (
    run?.dataset?.datasetId ??
    run?.runContext?.datasetId ??
    run?.synthesis?.provenance?.datasetId ??
    null
  )
}

export function loadResearchRunDataset(
  run,
  getDataset = getResearchDataset,
) {
  const datasetId = researchRunDatasetId(run)

  return datasetId
    ? getDataset(datasetId)
    : Promise.resolve(null)
}

export function beginResearchRunDatasetLoad(
  run,
  getDataset,
  onState,
) {
  const datasetId = researchRunDatasetId(run)

  if (!datasetId) {
    onState({
      datasetId: null,
      status: 'idle',
      dataset: null,
      error: null,
    })

    return () => {}
  }

  let active = true

  onState({
    datasetId,
    status: 'loading',
    dataset: null,
    error: null,
  })

  Promise.resolve()
    .then(() =>
      loadResearchRunDataset(run, getDataset),
    )
    .then((dataset) => {
      if (active) {
        onState({
          datasetId,
          status: 'loaded',
          dataset,
          error: null,
        })
      }
    })
    .catch((error) => {
      if (active) {
        onState({
          datasetId,
          status: 'error',
          dataset: null,
          error: error.message,
        })
      }
    })

  return () => {
    active = false
  }
}