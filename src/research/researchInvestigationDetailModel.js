function runMetadataFromResearchRun(run) {
  if (!run || typeof run !== 'object') return null
  const context = run.runContext ?? {}
  const dataset = run.dataset ?? {}
  const coverage = run.synthesis?.coverage ?? {}
  return {
    requestedAt: context.requestedAt ?? run.requestedAt ?? null,
    status: run.status ?? null,
    symbols: Array.isArray(context.symbols) ? [...context.symbols] : null,
    timeframe: context.timeframe ?? null,
    datasetId: dataset.datasetId ?? run.datasetId ?? null,
    requestedExperiments: Array.isArray(context.requestedExperiments)
      ? [...context.requestedExperiments]
      : Array.isArray(run.requestedExperiments) ? [...run.requestedExperiments] : null,
    evaluatedExperiments: Array.isArray(coverage.evaluated) ? [...coverage.evaluated] : null,
  }
}

function isNotFound(error) {
  return error?.status === 404
    || error?.statusCode === 404
    || error?.code === 'RESEARCH_RUN_NOT_FOUND'
    || /^Research run not found:/i.test(error?.message ?? '')
}

export function projectResearchInvestigationDetail(investigation, runReferences = []) {
  const referenceById = new Map((Array.isArray(runReferences) ? runReferences : [])
    .filter((reference) => typeof reference?.runId === 'string')
    .map((reference) => [reference.runId, reference]))
  const runIds = Array.isArray(investigation?.runIds) ? investigation.runIds : []

  return {
    investigationId: typeof investigation?.investigationId === 'string' ? investigation.investigationId : null,
    question: typeof investigation?.question === 'string' ? investigation.question : null,
    status: typeof investigation?.status === 'string' ? investigation.status : null,
    createdAt: investigation?.createdAt ?? null,
    requestedExperiments: Array.isArray(investigation?.requestedExperiments)
      ? [...investigation.requestedExperiments]
      : [],
    associatedRuns: runIds.map((runId) => {
      const reference = referenceById.get(runId)
      const status = reference?.status ?? 'loading'
      return {
        runId,
        metadataStatus: status,
        error: reference?.error ?? null,
        metadata: status === 'available' ? runMetadataFromResearchRun(reference.run) : null,
      }
    }),
  }
}

export async function loadInvestigationRunMetadata(investigation, getRun) {
  const runIds = Array.isArray(investigation?.runIds) ? investigation.runIds : []
  if (typeof getRun !== 'function') throw new TypeError('getRun must be a function')
  return Promise.all(runIds.map(async (runId) => {
    try {
      const run = await getRun(runId)
      if (!run) return { runId, status: 'missing', run: null, error: 'Research run was not found.' }
      return { runId, status: 'available', run }
    } catch (error) {
      const missing = isNotFound(error)
      return {
        runId,
        status: missing ? 'missing' : 'unavailable',
        run: null,
        error: error?.message ?? 'Research run metadata is unavailable.',
      }
    }
  }))
}