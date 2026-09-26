import { createResearchRecordForExperiment, getResearchExperiment } from './registry.js'
import { createResearchRecord } from './researchRecord.js'

const NORMALIZED_STATUS = Object.freeze({
  succeeded: 'completed',
  unavailable: 'unavailable',
  incomplete: 'incomplete',
})

function provenanceFor(runContext, dataset) {
  return {
    runId: runContext?.runId ?? null,
    datasetId: dataset?.datasetId ?? null,
    requestedAt: runContext?.requestedAt ?? null,
  }
}

function adapterContextFor(executionResult, runContext, dataset) {
  const status = NORMALIZED_STATUS[executionResult.status]
  const bySymbol = executionResult.nativeOutput?.bySymbol
  return {
    ...(bySymbol && typeof bySymbol === 'object' && !Array.isArray(bySymbol)
      ? { symbols: Object.keys(bySymbol) }
      : {}),
    timeframe: dataset?.timeframe ?? runContext?.timeframe ?? null,
    provider: dataset?.provider ?? null,
    requestedStart: runContext?.requestedStart ?? null,
    requestedEnd: runContext?.requestedEnd ?? null,
    available: executionResult.status !== 'unavailable',
    ...(executionResult.status === 'incomplete' ? { complete: false } : {}),
    status,
    provenance: provenanceFor(runContext, dataset),
  }
}

function createStatusRecord(executionResult, runContext, dataset, status) {
  const definition = getResearchExperiment(executionResult.experimentId)
  if (!definition) throw new Error(`Unknown research experiment: ${executionResult.experimentId}`)

  return createResearchRecord({
    id: definition.id,
    title: definition.title,
    category: definition.category,
    status,
    methodology: definition.methodology,
    input: {
      symbols: runContext?.symbols ?? [],
      timeframe: dataset?.timeframe ?? runContext?.timeframe ?? null,
      provider: dataset?.provider ?? null,
      requestedStart: runContext?.requestedStart ?? null,
      requestedEnd: runContext?.requestedEnd ?? null,
      actualStart: null,
      actualEnd: null,
      candleCount: null,
      sampleCounts: {},
      available: status === 'unavailable' ? false : undefined,
      complete: status === 'incomplete' ? false : undefined,
      status,
    },
    parameters: {},
    costModel: null,
    outOfSample: null,
    metrics: {},
    findings: [],
    provenance: provenanceFor(runContext, dataset),
    nativePayload: executionResult.nativeOutput ?? null,
  })
}

/** Creates a bridge; the optional registry factory seam keeps adapter selection testable. */
export function createResearchExecutionBridge(recordFactory = createResearchRecordForExperiment) {
  return function adaptResearchExecutionResult(executionResult, runContext, dataset) {
    const status = executionResult?.status
    if (!Object.hasOwn(NORMALIZED_STATUS, status) && status !== 'failed' && status !== 'skipped') {
      throw new Error(`Unknown experiment execution status: ${status}`)
    }
    if (status === 'failed' || status === 'skipped') return null

    if (status === 'succeeded' && executionResult.nativeOutput == null) {
      throw new Error(`Successful execution for ${executionResult.experimentId} requires nativeOutput`)
    }

    if (status === 'unavailable') {
      return createStatusRecord(executionResult, runContext, dataset, 'unavailable')
    }
    if (status === 'incomplete' && executionResult.nativeOutput == null) {
      return createStatusRecord(executionResult, runContext, dataset, 'incomplete')
    }

    return recordFactory(
      executionResult.experimentId,
      executionResult.nativeOutput,
      adapterContextFor(executionResult, runContext, dataset),
    )
  }
}

export const adaptResearchExecutionResult = createResearchExecutionBridge()