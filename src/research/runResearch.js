import { createResearchRunContext, executeResearchRun } from './orchestration.js'
import { composeResearchRunResult as defaultComposeResearchRunResult } from './researchRunComposition.js'

/**
 * Public application-facing research API. The optional second argument is an internal
 * dependency seam for host-specific fetch adapters and tests; request fields remain stable.
 */
export async function runResearch(request, options = {}) {
  const runContext = createResearchRunContext(request)
  const {
    composeResearchRunResult = defaultComposeResearchRunResult,
    ...executionOptions
  } = options ?? {}
  const executionRunResult = await executeResearchRun(runContext, executionOptions)
  return composeResearchRunResult(executionRunResult)
}