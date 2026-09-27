// Research Orchestration — Phase 4A/4C/4D/4E-1/4E-2.
// This module owns run identity/context, shared fetch outcomes, dataset identity, and native
// experiment execution. Normalization and synthesis remain later phases.
import { getResearchExperiment, listResearchExperiments } from './registry.js'
import { executeResearchExperiment } from './experimentExecutors.js'
import { EMA_CONTRACT_VERSION, fetchHistoricalMarketData as defaultFetchHistoricalMarketData } from '../data/marketData.js'
import { HISTORICAL_ADJUSTMENT_MODE, LEGACY_ADJUSTMENT_MODE } from '../data/historicalDataContract.js'

export { executeResearchExperiment }

/**
 * @typedef {object} FetchResult
 * @property {string} provider
 * @property {string} symbol
 * @property {string} timeframe
 * @property {string} adjustmentMode
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
 * @property {string} adjustmentMode
 * @property {string|null} requestedStart
 * @property {string|null} requestedEnd
 * @property {string[]} requestedExperiments
 * @property {string} emaContractVersion
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
 * @property {string} adjustmentMode
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
 * Generates a deterministic identifier from the actual fetch metadata and ordered candle contents.
 * Input symbols are sorted, while candle order within each symbol is preserved. Request metadata,
 * completeness flags, and run identity do not affect this ID.
 *
 * @param {FetchResult[]} fetchResults Non-empty array; each entry must carry provider, symbol,
 *   timeframe, an actual start/end (accepts either `actualStart`/`actualEnd` or the fetch layer's
 *   own `start`/`end` field names), and a numeric candleCount.
 * @returns {string} e.g. "dataset_<sha256>".
 */
export function createDatasetId(fetchResults, defaultAdjustmentMode = LEGACY_ADJUSTMENT_MODE) {
  assertValidFetchResults(fetchResults)
  const serialized = serializeFetchResultsForFingerprint(fetchResults, defaultAdjustmentMode)
  return `dataset_${sha256Hex(serialized)}`
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
function serializeFetchResultsForFingerprint(fetchResults, defaultAdjustmentMode) {
  const normalized = fetchResults
    .map((result) => [
      result.provider,
      result.symbol,
      result.timeframe,
      result.calculationStart ?? result.actualStart ?? result.start,
      result.calculationEnd ?? result.actualEnd ?? result.end,
      result.calculationCandleCount ?? result.candleCount,
      result.adjustmentMode ?? defaultAdjustmentMode,
      (Array.isArray(result.calculationCandles)
        ? result.calculationCandles
        : Array.isArray(result.candles) ? result.candles : []).map((candle) => [
        candle?.symbol ?? result.symbol,
        candle?.timestamp ?? null,
        candle?.timeframe ?? result.timeframe,
        candle?.open ?? null,
        candle?.high ?? null,
        candle?.low ?? null,
        candle?.close ?? null,
        candle?.volume ?? null,
      ]),
    ])
    .sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
  return JSON.stringify(normalized)
}

/** Synchronous SHA-256 over UTF-8 canonical JSON, without runtime-specific crypto APIs. */
function sha256Hex(input) {
  const bytes = new TextEncoder().encode(input)
  const bitLength = bytes.length * 8
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64
  const padded = new Uint8Array(paddedLength)
  padded.set(bytes)
  padded[bytes.length] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false)
  view.setUint32(paddedLength - 4, bitLength >>> 0, false)

  const constants = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]
  const state = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]
  const words = new Uint32Array(64)
  const rotateRight = (value, count) => (value >>> count) | (value << (32 - count))

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(offset + index * 4, false)
    for (let index = 16; index < 64; index += 1) {
      const x = words[index - 15]
      const y = words[index - 2]
      const sigma0 = rotateRight(x, 7) ^ rotateRight(x, 18) ^ (x >>> 3)
      const sigma1 = rotateRight(y, 17) ^ rotateRight(y, 19) ^ (y >>> 10)
      words[index] = (words[index - 16] + sigma0 + words[index - 7] + sigma1) >>> 0
    }

    let [a, b, c, d, e, f, g, h] = state
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25)
      const choice = (e & f) ^ (~e & g)
      const temp1 = (h + sum1 + choice + constants[index] + words[index]) >>> 0
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22)
      const majority = (a & b) ^ (a & c) ^ (b & c)
      const temp2 = (sum0 + majority) >>> 0
      h = g; g = f; f = e; e = (d + temp1) >>> 0
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0
    }
    ;[a, b, c, d, e, f, g, h].forEach((value, index) => { state[index] = (state[index] + value) >>> 0 })
  }
  return state.map((value) => value.toString(16).padStart(8, '0')).join('')
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
    emaContractVersion: EMA_CONTRACT_VERSION,
    adjustmentMode: HISTORICAL_ADJUSTMENT_MODE,
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
        datasetId: createDatasetId(nonEmptyFetchResults, runContext.adjustmentMode ?? LEGACY_ADJUSTMENT_MODE),
        provider: [...providers][0],
        adjustmentMode: nonEmptyFetchResults.every((result) => (result.adjustmentMode ?? runContext.adjustmentMode ?? LEGACY_ADJUSTMENT_MODE) === (nonEmptyFetchResults[0].adjustmentMode ?? runContext.adjustmentMode ?? LEGACY_ADJUSTMENT_MODE))
          ? nonEmptyFetchResults[0].adjustmentMode ?? runContext.adjustmentMode ?? LEGACY_ADJUSTMENT_MODE
          : 'mixed',
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
