import { adaptResearchExecutionResult } from './executionBridge.js'
import { synthesizeResearch } from './synthesis.js'

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
    })

    return { ...executionRunResult, records, synthesis }
  }
}

export const composeResearchRunResult = createResearchRunComposer()