import { adaptResearchExecutionResult } from './executionBridge.js'
import { synthesizeResearch } from './synthesis.js'
import { qualifyStrategyDiscovery } from './strategyQualification.js'

/** Creates a composition function with injectable bridge/synthesis dependencies for tests. */
export function createResearchRunComposer({
  adaptExecutionResult = adaptResearchExecutionResult,
  synthesize = synthesizeResearch,
} = {}) {
  return function composeResearchRunResult(executionRunResult) {
    const records = []
    for (const executionResult of executionRunResult.experimentResults) {
      const record = adaptExecutionResult(
        executionResult,
        executionRunResult.runContext,
        executionRunResult.dataset,
      )
      if (record !== null) records.push(record)
    }

    const synthesis = synthesize(records, {
      runId: executionRunResult.runContext.runId,
      datasetId: executionRunResult.dataset?.datasetId ?? null,
      requestedExperiments: executionRunResult.runContext.requestedExperiments,
      ...(executionRunResult.runContext.emaContractVersion
        ? { emaContractVersion: executionRunResult.runContext.emaContractVersion }
        : {}),
      adjustmentMode: executionRunResult.runContext.adjustmentMode ?? executionRunResult.dataset?.adjustmentMode ?? 'legacy-unknown',
      codeRevision: executionRunResult.runContext.codeRevision ?? null,
    })

    
    const discoveryRecord = records.find(
      (record) => record.id === 'strategy-discovery',
    )

    const qualification = qualifyStrategyDiscovery(
      discoveryRecord?.nativePayload ?? null,
    )

    return {
      ...executionRunResult,
      records,
      synthesis,
      qualification,
    }

  }
}

export const composeResearchRunResult = createResearchRunComposer()
