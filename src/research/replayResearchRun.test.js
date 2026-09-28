import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createDatasetId } from './orchestration.js'
import { listResearchExperiments } from './registry.js'
import { reconstructResearchDataset } from '../data/marketData.js'
import {
  resolveCurrentEffectiveExperimentConfiguration,
} from './effectiveExperimentConfiguration.js'
import { checkResearchReplayCompatibility } from './replayCompatibility.js'
import { replayResearchRun } from './replayResearchRun.js'

const revision = 'abc123'
const emaVersion = 'setupscan-ema-sma-seeded-recursive-v1'
const baseSymbols = ['SPY', 'QQQ', 'IWM']

function makeCandles(symbol) {
  return Array.from({ length: 32 }, (_, index) => {
    const close =
      100 +
      index +
      (symbol === 'QQQ' ? 10 : symbol === 'IWM' ? 20 : 0)

    return {
      symbol,
      timeframe: '1Hour',
      timestamp: new Date(
        Date.UTC(2025, 0, 1) + index * 60 * 60 * 1000,
      ).toISOString(),
      open: close - 0.5,
      high: close + 1,
      low: close - 1,
      close,
      volume: 1000 + index,
    }
  })
}

function makeModernRun({
  symbols = baseSymbols,
  experimentIds = ['strategy-comparison'],
  unavailableSymbols = [],
  incompleteSymbols = [],
  emptySymbols = [],
} = {}) {
  const requestedStart = makeCandles('SPY')[20].timestamp
  const requestedEnd = makeCandles('SPY').at(-1).timestamp

  const bySymbol = {}
  const fetchResults = []
  const calculationSeries = []
  const fetchIssues = []
  const successfulSymbols = []

  for (const symbol of symbols) {
    if (unavailableSymbols.includes(symbol)) {
      bySymbol[symbol] = null

      fetchIssues.push({
        symbol,
        type: 'fetch-error',
        error: {
          message: 'fixture unavailable',
        },
      })

      continue
    }

    const calculationCandles = emptySymbols.includes(symbol)
      ? []
      : makeCandles(symbol)

    const requestedCandles = calculationCandles.filter(
      (candle) =>
        candle.timestamp >= requestedStart &&
        candle.timestamp <= requestedEnd,
    )

    const complete = !incompleteSymbols.includes(symbol)

    const metadata = {
      provider: 'ALPACA HISTORICAL',
      adjustmentMode: 'split',
      timeframe: '1Hour',
      requestedStart,
      requestedEnd,
      actualStart: requestedCandles[0]?.timestamp ?? null,
      actualEnd: requestedCandles.at(-1)?.timestamp ?? null,
      calculationStart: calculationCandles[0]?.timestamp ?? null,
      calculationEnd: calculationCandles.at(-1)?.timestamp ?? null,
      requestedCandleCount: requestedCandles.length,
      calculationCandleCount: calculationCandles.length,
      complete,
    }

    bySymbol[symbol] = metadata

    if (incompleteSymbols.includes(symbol)) {
      fetchIssues.push({
        symbol,
        type: 'incomplete',
      })
    }

    if (emptySymbols.includes(symbol)) {
      fetchIssues.push({
        symbol,
        type: 'empty',
      })
    }

    if (requestedCandles.length) {
      successfulSymbols.push(symbol)

      calculationSeries.push({
        symbol,
        timeframe: '1Hour',
        candles: calculationCandles,
      })

      const result = {
        provider: metadata.provider,
        adjustmentMode: metadata.adjustmentMode,
        symbol,
        timeframe: metadata.timeframe,
        start: metadata.actualStart,
        end: metadata.actualEnd,
        requestedStart,
        requestedEnd,
        candleCount: requestedCandles.length,
        requestedCandleCount: requestedCandles.length,
        calculationStart: metadata.calculationStart,
        calculationEnd: metadata.calculationEnd,
        calculationCandleCount: calculationCandles.length,
        complete,
        candles: requestedCandles,
      }

      Object.defineProperty(result, 'calculationCandles', {
        value: calculationCandles,
      })

      fetchResults.push(result)
    }
  }

  calculationSeries.sort((left, right) =>
    left.symbol.localeCompare(right.symbol),
  )

  const effectiveDateProvenance = {
    requestedStart,
    requestedEnd,
    symbols: bySymbol,
  }

  const adjustmentMode = 'split'

  const datasetId = fetchResults.length
    ? createDatasetId(fetchResults, adjustmentMode)
    : null

  const provider = 'ALPACA HISTORICAL'
  const timeframe = '1Hour'

  const fetchStatus =
    successfulSymbols.length === 0
      ? 'unavailable'
      : successfulSymbols.length !== symbols.length ||
          fetchIssues.length
        ? 'partial'
        : 'complete'

  const dataset = datasetId
    ? {
        datasetId,
        provider,
        adjustmentMode,
        timeframe,
        requestedStart,
        requestedEnd,
        effectiveMetadata: effectiveDateProvenance,
        fetchResultsBySymbol: Object.fromEntries(
          Object.entries(bySymbol).map(
            ([symbol, metadata]) => [
              symbol,
              metadata,
            ],
          ),
        ),
      }
    : null

  const canonicalDataset = datasetId
    ? {
        datasetId,
        provider,
        adjustmentMode,
        timeframe,
        effectiveMetadata: effectiveDateProvenance,
        calculationSeries,
      }
    : null

  const experimentResults = experimentIds.map(
    (experimentId) => {
      const definition =
        listResearchExperiments().find(
          (item) => item.id === experimentId,
        )

      const unavailable =
        definition.requiredSymbols.some(
          (symbol) =>
            !successfulSymbols.includes(
              symbol,
            ) ||
            incompleteSymbols.includes(
              symbol,
            ),
        ) ||
        (experimentId ===
          'strategy-comparison' &&
          !symbols.some(
            (symbol) =>
              successfulSymbols.includes(
                symbol,
              ) &&
              !incompleteSymbols.includes(
                symbol,
              ),
          ))

      return {
        experimentId,
        status: unavailable
          ? 'unavailable'
          : 'succeeded',
        nativeOutput: null,
        error: null,
      }
    },
  )

  const run = {
    runContext: {
      runId: 'run-fixture',
      requestedAt:
        '2025-01-02T00:00:00.000Z',
      symbols: [...symbols],
      timeframe,
      requestedStart,
      requestedEnd,
      requestedExperiments: [
        ...experimentIds,
      ],
      emaContractVersion: emaVersion,
      adjustmentMode,
      codeRevision: revision,
    },

    status:
      fetchStatus === 'complete' &&
      experimentResults.every(
        ({ status }) => status === 'succeeded',
      )
        ? 'completed'
        : successfulSymbols.length
          ? 'partial'
          : 'unavailable',

    fetchStatus,
    fetchIssues,
    dataset,
    effectiveDateProvenance,
    experimentResults,
    effectiveExperimentConfiguration: {},

    synthesis: {
      provenance: {
        datasetId,
      },
    },
  }

  if (datasetId) {
    const reconstructed =
      reconstructResearchDataset(
        canonicalDataset,
      )

    const expectedConfiguration =
      resolveCurrentEffectiveExperimentConfiguration(
        {
          run,
          dataset: reconstructed,
          codeRevision: revision,
        },
      )

    run.effectiveExperimentConfiguration =
      Object.fromEntries(
        experimentResults.map(
          ({
            experimentId,
            status,
          }) => [
            experimentId,
            {
              status,
              configuration:
                expectedConfiguration
                  .experiments[
                    experimentId
                  ],
            },
          ],
        ),
      )
  }

  return {
    run,
    canonicalDataset,
  }
}

test(
  'replayResearchRun rejects incompatible runs before executing replay',
  async () => {
    const {
      run,
      canonicalDataset,
    } = makeModernRun()

    let executeResearchExperimentCalled =
      false

    const executeResearchExperiment =
      async () => {
        executeResearchExperimentCalled =
          true
      }

    let error = null

    try {
      await replayResearchRun({
        run,
        canonicalDataset,
        runtime: {
          codeRevision:
            'different-revision',
          emaContractVersion:
            emaVersion,
        },
        executeResearchRunOptions: {
          executeResearchExperiment,
        },
      })
    } catch (caughtError) {
      error = caughtError
    }

    assert.ok(error)
    assert.equal(
      error.code,
      'RESEARCH_REPLAY_INCOMPATIBLE',
    )
    assert.equal(
      executeResearchExperimentCalled,
      false,
    )
  },
)

test(
  'replayResearchRun creates a new run identity for a compatible replay',
  async () => {
    const {
      run,
      canonicalDataset,
    } = makeModernRun()

    const reconstructed =
      reconstructResearchDataset(
        canonicalDataset,
      )

    const expectedConfiguration =
      resolveCurrentEffectiveExperimentConfiguration(
        {
          run,
          dataset: reconstructed,
          codeRevision: revision,
        },
      )

    const runtime = {
      codeRevision: revision,
      emaContractVersion: emaVersion,
      expectedConfiguration,
    }

    const compatibility =
      checkResearchReplayCompatibility(
        {
          run,
          canonicalDataset,
          runtime,
        },
      )

    assert.deepEqual(
      compatibility,
      {
        compatible: true,
        blockers: [],
      },
    )

    let executedExperimentId = null

    const executeResearchExperiment =
      async (experimentId) => {
        executedExperimentId =
          experimentId

        return {
          nativeOutput: {
            replayed: true,
          },
          status: 'succeeded',
        }
      }

    const result =
      await replayResearchRun({
        run,
        canonicalDataset,
        runtime,
        executeResearchRunOptions: {
          executeResearchExperiment,
        },
      })

    assert.ok(result)
    assert.ok(result.runContext)

    assert.notEqual(
      result.runContext.runId,
      run.runContext.runId,
    )

    assert.match(
      result.runContext.runId,
      /^run_/,
    )

    assert.deepEqual(
      result.runContext.symbols,
      run.runContext.symbols,
    )

    assert.equal(
      result.runContext.timeframe,
      run.runContext.timeframe,
    )

    assert.equal(
      result.runContext.requestedStart,
      run.runContext.requestedStart,
    )

    assert.equal(
      result.runContext.requestedEnd,
      run.runContext.requestedEnd,
    )

    assert.deepEqual(
      result.runContext.requestedExperiments,
      run.runContext.requestedExperiments,
    )

    assert.equal(
      executedExperimentId,
      'strategy-comparison',
    )
  },
)