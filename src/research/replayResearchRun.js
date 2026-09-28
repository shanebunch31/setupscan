import { createRunId, executeResearchRun } from './orchestration.js'
import { reconstructResearchDataset } from '../data/marketData.js'
import { checkResearchReplayCompatibility } from './replayCompatibility.js'

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
    const error = new Error(
      'Research run is not compatible with deterministic replay.',
    )

    error.code = 'RESEARCH_REPLAY_INCOMPATIBLE'
    error.blockers = compatibility.blockers

    throw error
  }

  const reconstructed =
    reconstructResearchDataset(canonicalDataset)

  const sourceContext = run?.runContext ?? {}

  const replayRunContext = {
    ...sourceContext,
    runId: createRunId(),
    requestedAt: new Date().toISOString(),

    // Persistent lineage: this run was created by replaying the
    // exact persisted dataset from the original run.
    replayOfRunId: sourceContext.runId ?? null,
  }

  const fetchHistoricalMarketData = async (symbol) => {
    const result =
      reconstructed.fetchResultsBySymbol?.[symbol]

    if (!result) {
      throw new Error(
        `Replay dataset does not contain fetch results for ${symbol}`,
      )
    }

    return result
  }

  return executeResearchRun(replayRunContext, {
    ...executeResearchRunOptions,
    fetchHistoricalMarketData,
  })
}