// Research Orchestration — Phase 4A/4C/4D/4E-1/4E-2.
// This module owns run identity/context, shared fetch outcomes, dataset identity, and native
// experiment execution. Normalization and synthesis remain later phases.
import { getResearchExperiment, listResearchExperiments } from './registry.js'
import { executeResearchExperiment } from './experimentExecutors.js'
import { fetchHistoricalMarketData as defaultFetchHistoricalMarketData } from '../data/marketData.js'

export { executeResearchExperiment }

/**
 * @typedef {object} FetchResult
 * @property {string} provider
 * @property {string} symbol
 * @property {string} timeframe
 * @property {string|null} start          Actual first candle timestamp.
 * @property {string|null} end            Actual last candle timestamp.
 * @property {string|null} requestedStart
 * @property {string|null} requestedEnd
 * @property {number} candleCount
 * @property {boolean} complete
 * @property {Array<object>} candles
 */

/**
 * @typedef {object} ResearchRunContext
 * @property {string} runId
 * @property {string} requestedAt         ISO timestamp of when the run was requested.
 * @property {string[]} symbols
 * @property {string} timeframe
 * @property {string|null} requestedStart
 * @property {string|null} requestedEnd
 * @property {string[]} requestedExperiments
 */

/**
 * @typedef {object} ExperimentExecutionResult
 * @property {string} experimentId
 * @property {'succeeded'|'failed'|'unavailable'|'skipped'|'incomplete'} status
 * @property {object|null} nativeOutput   Unmodified native experiment output when available.
 * @property {object|null} error          Structured error information when status is 'failed'.
 */

/**
 * @typedef {object} ResearchDataset
 * @property {string} datasetId
 * @property {string} provider
 * @property {string} timeframe
 * @property {string|null} requestedStart
 * @property {string|null} requestedEnd
 * @property {Record<string, FetchResult>} fetchResultsBySymbol
 * @property {Record<string, Array<object>>} rawSeriesBySymbol
 */

/**
 * @typedef {object} ResearchRunResult
 * @property {ResearchRunContext} runContext
 * @property {'completed'|'partial'|'unavailable'|'failed'} status
 * @property {'complete'|'partial'|'unavailable'|'not-requested'} fetchStatus
 * @property {Array<object>} fetchIssues Per-symbol fetch failures, empty results, or incomplete results.
 * @property {ResearchDataset|null} dataset
 * @property {ExperimentExecutionResult[]} experimentResults
 */

/**
 * Generates a new, opaque identifier for one orchestration run.
 *
 * Deliberately NOT derived from market data, fetch results, or dataset contents — two runs
 * executed back-to-back against an identical dataset must still receive different runIds, since
 * a runId identifies an *execution*, not the data it operated on (that's createDatasetId()'s job).
 *
 * Implementation is a timestamp plus a random component plus a monotonic in-process counter (as a
 * final collision guard), with no external dependency and no UUID library. Safe to store directly
 * as a provenance string (record.provenance.runId, synthesis.provenance.runId).
 *
 * @returns {string} A non-empty, opaque run identifier, e.g. "run_m1a2b3c4_f7g8h9j0_1".
 */
let runIdCounter = 0

export function createRunId() {
  runIdCounter = (runIdCounter + 1) % Number.MAX_SAFE_INTEGER
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).slice(2, 10)
  return `run_${timestamp}_${random}_${runIdCounter.toString(36)}`
}

/**
 * Generates a deterministic identifier for the dataset actually produced by a fetch, so two runs
 * that fetched the same provider/symbols/timeframe/actual-range/candle-count can be recognized as
 * having used the same underlying data, even if their runIds differ. Derived only from the
 * *actual* fetch outcome (provider, symbol, timeframe, actual start/end, candle count per symbol)
 * — never from requestedStart/requestedEnd/complete/minimumExpectedCandles, never from runId, and
 * never from input array order (entries are sorted by symbol before fingerprinting).
 *
 * @param {FetchResult[]} fetchResults Non-empty array; each entry must carry provider, symbol,
 *   timeframe, an actual start/end (accepts either `actualStart`/`actualEnd` or the fetch layer's
 *   own `start`/`end` field names), and a numeric candleCount.
 * @returns {string} e.g. "dataset_1a2b3c4d".
 */
export function createDatasetId(fetchResults) {
  assertValidFetchResults(fetchResults)
  const serialized = serializeFetchResultsForFingerprint(fetchResults)
  return `dataset_${deterministicHash(serialized)}`
}

function assertValidFetchResults(fetchResults) {
  if (!Array.isArray(fetchResults) || fetchResults.length === 0) {
    throw new Error('createDatasetId requires a non-empty array of fetch results')
  }
  fetchResults.forEach((result, index) => {
    ;['provider', 'symbol', 'timeframe'].forEach((field) => {
      if (typeof result?.[field] !== 'string' || !result[field]) {
        throw new Error(`createDatasetId: fetch result at index ${index} is missing required field "${field}"`)
      }
    })
    const actualStart = result?.actualStart ?? result?.start
    const actualEnd = result?.actualEnd ?? result?.end
    if (actualStart == null || actualEnd == null) {
      throw new Error(`createDatasetId: fetch result at index ${index} is missing an actual start/end`)
    }
    if (!Number.isFinite(result?.candleCount)) {
      throw new Error(`createDatasetId: fetch result at index ${index} is missing a numeric candleCount`)
    }
  })
}

/** Sorts by symbol and keeps only the fields that define dataset identity (request/completeness metadata is excluded). */
function serializeFetchResultsForFingerprint(fetchResults) {
  const normalized = fetchResults
    .map((result) => ({
      provider: result.provider,
      symbol: result.symbol,
      timeframe: result.timeframe,
      actualStart: result.actualStart ?? result.start,
      actualEnd: result.actualEnd ?? result.end,
      candleCount: result.candleCount,
    }))
    .sort((a, b) => (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0))
  return JSON.stringify(normalized)
}

/** Small, dependency-free, deterministic 32-bit string hash (FNV-1a). Not cryptographic by design. */
function deterministicHash(input) {
  let hash = 0x811c9dc5
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

/**
 * Builds the bookkeeping context for one run, before any fetch happens: a fresh runId plus the
 * caller's requested intent (symbols, timeframe, requested date range, which experiments to run).
 * Carries intent only — outcome (fetch results, datasetId, records) is added later by the future
 * executeResearchRun(). Never contains datasetId, candles, fetch results, native results, records,
 * synthesis output, or experiment parameters (parameter plumbing is a later phase's contract).
 *
 * @param {{symbols: string[], timeframe: string, requestedStart?: string, requestedEnd?: string, requestedExperiments?: string[]}} request
 * @returns {ResearchRunContext}
 */
export function createResearchRunContext(request = {}) {
  const symbols = normalizeSymbols(request.symbols)
  const timeframe = normalizeTimeframe(request.timeframe)
  const { requestedStart, requestedEnd } = normalizeRequestedDateRange(request.requestedStart, request.requestedEnd)
  const requestedExperiments = normalizeRequestedExperiments(request.requestedExperiments)

  return {
    // Always minted fresh here — the sole call site for run identity. A caller-supplied runId or
    // requestedAt is never accepted or honored, by construction (request.runId/.requestedAt are
    // simply never read above).
    runId: createRunId(),
    requestedAt: new Date().toISOString(),
    symbols,
    timeframe,
    requestedStart,
    requestedEnd,
    requestedExperiments,
  }
}

function normalizeSymbols(symbols) {
  if (!Array.isArray(symbols) || symbols.length === 0) {
    throw new Error('createResearchRunContext requires a non-empty array of symbols')
  }
  const normalized = []
  const seen = new Set()
  symbols.forEach((symbol) => {
    if (typeof symbol !== 'string' || !symbol.trim()) {
      throw new Error(`createResearchRunContext: symbol "${symbol}" is not a valid non-empty string`)
    }
    const upper = symbol.trim().toUpperCase()
    if (!seen.has(upper)) { seen.add(upper); normalized.push(upper) }
  })
  return normalized
}

// The only request-level timeframe value used anywhere in this project today is '1Hour'
// (server/alpacaProxy.js's default, every scripts/run*.mjs caller, strategyDiscoveryTimeframe).
// '1h' is accepted as a recognized alias only because it already appears as the enriched-candle
// metadata artifact (src/data/marketData.js's enrichHistoricalCandles) — it is normalized to the
// canonical request form here, never used as the canonical value itself.
const TIMEFRAME_ALIASES = { '1Hour': '1Hour', '1h': '1Hour' }

function normalizeTimeframe(timeframe) {
  if (typeof timeframe !== 'string' || !(timeframe in TIMEFRAME_ALIASES)) {
    throw new Error(`createResearchRunContext: unknown timeframe "${timeframe}"`)
  }
  return TIMEFRAME_ALIASES[timeframe]
}

function normalizeRequestedDateRange(requestedStart, requestedEnd) {
  const start = requestedStart ?? null
  const end = requestedEnd ?? null
  if (start !== null && typeof start !== 'string') throw new Error('createResearchRunContext: requestedStart must be a string')
  if (end !== null && typeof end !== 'string') throw new Error('createResearchRunContext: requestedEnd must be a string')
  const startTime = start === null ? null : new Date(start).getTime()
  const endTime = end === null ? null : new Date(end).getTime()
  if (start !== null && !Number.isFinite(startTime)) {
    throw new Error('createResearchRunContext: requestedStart must be a valid date')
  }
  if (end !== null && !Number.isFinite(endTime)) {
    throw new Error('createResearchRunContext: requestedEnd must be a valid date')
  }
  if (start !== null && end !== null && !(startTime < endTime)) {
    throw new Error('createResearchRunContext: requestedStart must be strictly before requestedEnd')
  }
  return { requestedStart: start, requestedEnd: end }
}

function normalizeRequestedExperiments(requestedExperiments) {
  if (requestedExperiments === undefined) return listResearchExperiments().map((definition) => definition.id)
  if (!Array.isArray(requestedExperiments)) {
    throw new Error('createResearchRunContext: requestedExperiments must be an array of registry experiment ids')
  }
  const normalized = []
  const seen = new Set()
  requestedExperiments.forEach((experimentId) => {
    if (!getResearchExperiment(experimentId)) {
      throw new Error(`createResearchRunContext: unknown experiment id "${experimentId}"`)
    }
    if (!seen.has(experimentId)) { seen.add(experimentId); normalized.push(experimentId) }
  })
  return normalized
}

function structuredError(error) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(error.code !== undefined ? { code: error.code } : {}),
      ...(error.status !== undefined ? { status: error.status } : {}),
      ...(error.stack ? { stack: error.stack } : {}),
    }
  }
  return { name: 'NonErrorThrown', message: String(error), thrownValue: error }
}

function unavailableResult(experimentId) {
  return { experimentId, status: 'unavailable', nativeOutput: null, error: null }
}

function fetchStatusFor(runContext, rawSeriesBySymbol, fetchIssues) {
  const symbols = runContext.symbols ?? []
  const usableCount = symbols.filter((symbol) => rawSeriesBySymbol[symbol]?.length > 0).length
  if (usableCount === 0) return 'unavailable'
  if (usableCount !== symbols.length || fetchIssues.length > 0) return 'partial'
  return 'complete'
}

/**
 * Fetches the run-context symbols once each, assembles one canonical dataset, then dispatches
 * requested native experiments sequentially. No adapters or synthesis run in this phase.
 *
 * @param {ResearchRunContext} runContext
 * @param {{fetchHistoricalMarketData?: Function, executeResearchExperiment?: Function}} options
 * @returns {Promise<ResearchRunResult>}
 */
export async function executeResearchRun(runContext, options = {}) {
  const requestedExperiments = runContext?.requestedExperiments ?? []
  const dependencies = options ?? {}
  const experimentDispatcher = dependencies.executeResearchExperiment ?? executeResearchExperiment
  if (requestedExperiments.length === 0) {
    return {
      runContext,
      status: 'completed',
      fetchStatus: 'not-requested',
      fetchIssues: [],
      dataset: null,
      experimentResults: [],
    }
  }

  const fetcher = dependencies.fetchHistoricalMarketData ?? defaultFetchHistoricalMarketData
  if (typeof fetcher !== 'function' || typeof experimentDispatcher !== 'function') {
    return {
      runContext,
      status: 'failed',
      fetchStatus: 'unavailable',
      fetchIssues: [{ type: 'orchestration-configuration-error', message: 'Fetch and experiment dependencies must be functions.' }],
      dataset: null,
      experimentResults: [],
    }
  }
  const symbols = runContext.symbols ?? []
  const fetchIssues = []
  const fetchResultsBySymbol = {}
  const rawSeriesBySymbol = {}
  const nonEmptyFetchResults = []
  const successfulFetchResults = []

  const settledFetches = await Promise.allSettled(symbols.map((symbol) => Promise.resolve().then(() => fetcher(
    symbol,
    runContext.timeframe,
    { start: runContext.requestedStart, end: runContext.requestedEnd },
  ))))

  settledFetches.forEach((outcome, index) => {
    const symbol = symbols[index]
    if (outcome.status === 'rejected') {
      fetchIssues.push({ symbol, type: 'fetch-error', error: structuredError(outcome.reason) })
      return
    }

    const fetchResult = outcome.value
    successfulFetchResults.push(fetchResult)
    fetchResultsBySymbol[symbol] = fetchResult
    const candles = Array.isArray(fetchResult?.candles) ? fetchResult.candles : []
    if (candles.length === 0) {
      fetchIssues.push({ symbol, type: 'empty', fetchResult })
      return
    }

    rawSeriesBySymbol[symbol] = candles
    nonEmptyFetchResults.push(fetchResult)
    if (fetchResult.complete === false) fetchIssues.push({ symbol, type: 'incomplete', fetchResult })
  })

  const fetchStatus = fetchStatusFor(runContext, rawSeriesBySymbol, fetchIssues)
  const providers = new Set(successfulFetchResults.map((result) => result?.provider))
  if (successfulFetchResults.length && (providers.size !== 1 || typeof [...providers][0] !== 'string' || ![...providers][0])) {
    fetchIssues.push({
      type: 'provider-inconsistent',
      providers: [...providers],
      fetchResultsBySymbol,
    })
    return {
      runContext,
      status: 'failed',
      fetchStatus,
      fetchIssues,
      dataset: null,
      experimentResults: [],
    }
  }

  let dataset = null
  if (nonEmptyFetchResults.length) {
    try {
      dataset = {
        datasetId: createDatasetId(nonEmptyFetchResults),
        provider: [...providers][0],
        timeframe: runContext.timeframe,
        requestedStart: runContext.requestedStart,
        requestedEnd: runContext.requestedEnd,
        fetchResultsBySymbol,
        rawSeriesBySymbol,
      }
    } catch (error) {
      fetchIssues.push({ type: 'dataset-assembly-error', error: structuredError(error), fetchResultsBySymbol })
      return {
        runContext,
        status: 'failed',
        fetchStatus,
        fetchIssues,
        dataset: null,
        experimentResults: [],
      }
    }
  }

  if (!dataset) {
    return {
      runContext,
      status: 'unavailable',
      fetchStatus: 'unavailable',
      fetchIssues,
      dataset: null,
      experimentResults: requestedExperiments.map(unavailableResult),
    }
  }

  const experimentResults = []
  for (const experimentId of requestedExperiments) {
    try {
      const result = await experimentDispatcher(experimentId, dataset, runContext)
      experimentResults.push(result)
    } catch (error) {
      experimentResults.push({
        experimentId,
        status: 'failed',
        nativeOutput: null,
        error: structuredError(error),
      })
    }
  }

  const allExperimentsSucceeded = experimentResults.length === requestedExperiments.length
    && experimentResults.every((result) => result?.status === 'succeeded')
  const status = fetchStatus === 'complete' && allExperimentsSucceeded ? 'completed' : 'partial'
  return { runContext, status, fetchStatus, fetchIssues, dataset, experimentResults }
}
