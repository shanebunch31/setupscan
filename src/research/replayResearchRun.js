import { createRunId, executeResearchRun } from './orchestration.js'
import { reconstructResearchDataset } from '../data/marketData.js'
import { checkResearchReplayCompatibility } from './replayCompatibility.js'

/**
 * Re-executes a persisted research run entirely from its canonical dataset.
 *
 * No market-data network requests are made. The original run is never mutated.
 */
export async function replayResearchRun({
  run,
  canonicalDataset,
  runtime,
  executeResearchRunOptions = {},
}) {
  const compatibility = checkResearchReplayCompatibility({
    run,
    canonicalDataset,
    runtime,
  })

  if (!compatibility.compatible) {
    const error = new Error('Research run is not compatible with deterministic replay.')
    error.code = 'RESEARCH_REPLAY_INCOMPATIBLE'
    error.blockers = compatibility.blockers
    throw error
  }

  const reconstructed = reconstructResearchDataset(canonicalDataset)

  const sourceContext = run?.runContext ?? {}
  const replayRunContext = {
    ...sourceContext,
    runId: createRunId(),
    requestedAt: new Date().toISOString(),
  }

  const fetchHistoricalMarketData = async (symbol) => {
    const result = reconstructed.fetchResultsBySymbol?.[symbol]
    if (!result) {
      throw new Error(`Replay dataset does not contain fetch results for ${symbol}`)
    }
    return result
  }

  return executeResearchRun(replayRunContext, {
    ...executeResearchRunOptions,
    fetchHistoricalMarketData,
  })
}
