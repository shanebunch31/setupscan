import { runResearch } from './runResearch.js'
import { replayResearchRun } from './replayResearchRun.js'
import { composeResearchRunResult } from './researchRunComposition.js'
import {
  resolveCurrentEffectiveExperimentConfiguration,
} from './effectiveExperimentConfiguration.js'
import {
  reconstructResearchDataset,
  EMA_CONTRACT_VERSION,
} from '../data/marketData.js'

function errorPayload(error) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(error.code !== undefined
        ? { code: error.code }
        : {}),
      ...(Array.isArray(error.blockers)
        ? { blockers: error.blockers }
        : {}),
    }
  }

  return {
    name: 'NonErrorThrown',
    message: String(error),
  }
}

function currentCodeRevision() {
  const value = import.meta.env?.VITE_GIT_COMMIT

  return typeof value === 'string' && value.trim()
    ? value.trim()
    : null
}

self.onmessage = async ({ data }) => {
  try {
    if (data?.type === 'run') {
      const result = await runResearch(data.request)

      self.postMessage({
        type: 'result',
        result,
      })

      return
    }

    if (data?.type === 'replay') {
      const {
        run,
        canonicalDataset,
      } = data

      const codeRevision = currentCodeRevision()
      const reconstructed =
        reconstructResearchDataset(
          canonicalDataset,
        )

      const expectedConfiguration =
        resolveCurrentEffectiveExperimentConfiguration({
          run,
          dataset: reconstructed,
          codeRevision,
        })

      const executionRunResult =
        await replayResearchRun({
          run,
          canonicalDataset,
          runtime: {
            codeRevision,
            emaContractVersion:
              EMA_CONTRACT_VERSION,
            expectedConfiguration,
          },
        })

      const result =
        composeResearchRunResult(
          executionRunResult,
        )

      self.postMessage({
        type: 'result',
        result,
      })

      return
    }

    self.postMessage({
      type: 'error',
      error: {
        name: 'ResearchWorkerProtocolError',
        message:
          'Unsupported Research Worker message.',
      },
    })
  } catch (error) {
    self.postMessage({
      type: 'error',
      error: errorPayload(error),
    })
  }
}