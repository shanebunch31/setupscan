import path from 'node:path'
import { fetchAlpacaHistoricalBars } from './alpacaProxy.js'
import { createPaperTradingEngine } from './paperTrading.js'
import { isRegularSession, nextPollTime } from './marketSession.js'
import { createPaperStore } from './paperStore.js'
import { createPostgresPaperStore } from './postgresPaperStore.js'
import { preparePaperCandles } from './paperCandlePipeline.js'
import { historicalCandleEndTime } from '../src/data/historicalDataContract.js'
import { configuredSeedSymbols, resolvePaperSymbolCap } from './paperSymbols.js'

const HISTORY_LOOKBACK_DAYS = 45
const DEFAULT_RETRY_MAX_MS = 15 * 60 * 1000
const FRESHNESS_GRACE_MS = 5 * 60 * 1000

function configFromEnvironment(environment = process.env) {
  const requestedPollInterval = Number(environment.PAPER_POLL_INTERVAL_MS || 60000)
  const requestedRetryMax = Number(environment.PAPER_RETRY_MAX_MS || DEFAULT_RETRY_MAX_MS)
  const requestedFetchTimeout = Number(environment.PAPER_FETCH_TIMEOUT_MS || 30000)
  const pollIntervalMs = Number.isFinite(requestedPollInterval) ? Math.max(1000, requestedPollInterval) : 60000
  return {
    symbolCap: resolvePaperSymbolCap(environment.PAPER_SYMBOL_CAP),
    timeframe: environment.PAPER_TIMEFRAME || '1Hour',
    marketTimezone: environment.PAPER_MARKET_TIMEZONE || 'America/New_York',
    // A bad environment value must not turn a failed cycle into a tight retry loop.
    pollIntervalMs,
    fetchTimeoutMs: Number.isFinite(requestedFetchTimeout) && requestedFetchTimeout > 0 ? Math.min(120000, requestedFetchTimeout) : 30000,
    retryMaxMs: Number.isFinite(requestedRetryMax) ? Math.max(pollIntervalMs, requestedRetryMax) : DEFAULT_RETRY_MAX_MS,
  }
}

function historyStart(end) {
  const start = new Date(end)
  start.setUTCDate(start.getUTCDate() - HISTORY_LOOKBACK_DAYS)
  return start.toISOString()
}

function retryDelay(config, consecutiveFailures) {
  const exponent = Math.min(Math.max(0, consecutiveFailures - 1), 8)
  return Math.min(config.retryMaxMs, config.pollIntervalMs * (2 ** exponent))
}

function sameSymbols(left = [], right = []) {
  return left.length === right.length && left.every((symbol, index) => symbol === right[index])
}

async function fetchWithDeadline(fetchBars, request, timeoutMs) {
  const controller = new AbortController()
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = Object.assign(new Error(`Market-data request timed out after ${timeoutMs}ms.`), { code: 'PAPER_FETCH_TIMEOUT' })
      reject(error)
      controller.abort()
    }, timeoutMs)
  })
  try {
    return await Promise.race([Promise.resolve().then(() => fetchBars({ ...request, signal: controller.signal })), timeout])
  } finally { clearTimeout(timer) }
}

function candleFreshness(latest, timeframe, current, marketTimezone) {
  const end = historicalCandleEndTime(latest.timestamp, timeframe)
  const interval = end - Date.parse(latest.timestamp)
  if (end === null || !(interval > 0)) return 'INCOMPLETE'
  // Before today's first full regular-session interval, yesterday's candle is
  // expected. This uses the existing weekday/session convention, not a holiday calendar.
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: marketTimezone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(current).map(({ type, value }) => [type, value]))
  const sinceOpen = ((Number(parts.hour) * 60 + Number(parts.minute) - 570) * 60 + Number(parts.second)) * 1000
  if (end < current.getTime() - sinceOpen && sinceOpen < interval + FRESHNESS_GRACE_MS) return 'WAITING_FOR_COMPLETION'
  return current.getTime() - end > interval + FRESHNESS_GRACE_MS ? 'STALE' : 'USABLE'
}

const failedDataStatuses = new Set(['EMPTY', 'STALE', 'INCOMPLETE', 'FETCH_ERROR', 'TIMEOUT', 'PROCESSING_ERROR'])

export async function createPaperObserver({ store, symbolUniverse, fetchBars = fetchAlpacaHistoricalBars, now = () => new Date(), environment = process.env, onError = (error) => console.error('Paper observer cycle failed:', error), schedule = setTimeout, cancelSchedule = clearTimeout } = {}) {
  const config = configFromEnvironment(environment)
  const selectedStore = store ?? (environment.DATABASE_URL ? createPostgresPaperStore() : createPaperStore(path.resolve('server/data/paper-trades.json')))
  const initialState = await selectedStore.load()
  const engine = createPaperTradingEngine({ state: initialState, saveState: () => {}, timeframe: config.timeframe })
  const state = { status: 'IDLE', lastSuccessfulUpdate: null, lastProcessedCandle: null, processedCandles: {}, dataQualityBySymbol: {}, currentError: null, consecutiveFailures: 0, nextExpectedProcessing: null, independent: true, activeSymbols: [], baselinePendingSymbols: [], ...initialState.observer }
  const candleHistoryBySymbol = {}
  let running = false
  let timer
  let activeCycle = null

  async function configuredSymbols() {
    if (symbolUniverse) return symbolUniverse.getSymbols()
    if (typeof selectedStore.ensureObserverSymbols === 'function') {
      return selectedStore.ensureObserverSymbols(() => configuredSeedSymbols(environment), config.symbolCap)
    }
    return configuredSeedSymbols(environment)
  }

  async function persist(metadata = {}) {
    state.status = metadata.status ?? state.status
    Object.assign(state, metadata)
    const snapshot = { ...engine.getState(), observer: { ...state } }
    await selectedStore.save(snapshot, { ...state, processedCandles: Object.entries(state.processedCandles).map(([symbol, timestamp]) => ({ symbol, timestamp })) })
  }

  async function runCycle() {
    const current = now()
    let processed = 0
    let freshSymbols = 0
    let savingCycle = false
    const previousFailures = state.consecutiveFailures
    const previousSuccess = state.lastSuccessfulUpdate
    const previousResults = state.symbolResults ?? {}
    const previousSummary = JSON.stringify(state.cycleSummary)
    state.lastPollAt = current.toISOString()
    state.symbolResults = {}
    try {
      const activeSymbols = await configuredSymbols()
      const previousActiveSymbols = Array.isArray(state.activeSymbols) ? state.activeSymbols : []
      const addedSymbols = new Set(activeSymbols.filter((symbol) => !previousActiveSymbols.includes(symbol)))
      const openSymbols = engine.getState().trades.filter((trade) => trade.status === 'open').map((trade) => trade.symbol)
      const symbolsToManage = [...new Set([...activeSymbols, ...openSymbols])].sort()
      const activeSet = new Set(activeSymbols)
      const universeChanged = !sameSymbols(activeSymbols, previousActiveSymbols)
      const baselinePending = new Set((state.baselinePendingSymbols ?? []).filter((symbol) => activeSet.has(symbol)))
      for (const symbol of addedSymbols) baselinePending.add(symbol)
      state.baselinePendingSymbols = [...baselinePending].sort()
      state.activeSymbols = activeSymbols
      // Removal cancels pending entries even without new candles or an open position.
      engine.retainPendingEntrySymbols(activeSymbols)

      if (!isRegularSession(current)) {
        const shouldPersist = universeChanged || state.status !== 'IDLE' || state.currentError !== null || state.cycleOutcome !== 'MARKET_CLOSED' || !state.nextExpectedProcessing
        state.cycleOutcome = 'MARKET_CLOSED'
        state.cycleSummary = { attempted: 0, fresh: 0, failed: 0 }
        state.symbolResults = Object.fromEntries(symbolsToManage.map((symbol) => [symbol, {
          ...previousResults[symbol], dataStatus: 'MARKET_CLOSED', checkedAt: null, processed: false, error: null,
        }]))
        state.status = 'IDLE'
        state.consecutiveFailures = 0
        state.currentError = null
        state.nextExpectedProcessing = nextPollTime(current, config.pollIntervalMs).toISOString()
        if (shouldPersist) await persist()
        return { ...state, skipped: 'MARKET_CLOSED' }
      }
      for (const symbol of symbolsToManage) {
        const result = state.symbolResults[symbol] = {
          dataStatus: 'FETCH_ERROR', checkedAt: current.toISOString(),
          lastSuccessfulPollAt: previousResults[symbol]?.lastSuccessfulPollAt ?? null,
          lastFreshDataAt: previousResults[symbol]?.lastFreshDataAt ?? null,
          latestCompletedCandle: null, processed: false, error: null,
        }
        let fetched = false
        try {
          const end = current
          // The first cycle obtains the indicator warm-up history. Later cycles request
          // only the last completed candle and any new bars, then retain the same local
          // warm-up context for enrichment and signal evaluation.
          const cachedCandles = candleHistoryBySymbol[symbol] ?? []
          const start = cachedCandles.at(-1)?.timestamp ?? historyStart(end)
          const data = await fetchWithDeadline(fetchBars, { symbol, timeframe: config.timeframe, start, end: end.toISOString() }, config.fetchTimeoutMs)
          fetched = true
          result.lastSuccessfulPollAt = now().toISOString()
          if (!Array.isArray(data?.candles)) throw new Error('Provider response does not contain a candle array.')
          const incoming = preparePaperCandles(data.candles, config.timeframe, current)
          const prepared = preparePaperCandles([...cachedCandles, ...(data.candles ?? [])], config.timeframe, current)
          const candles = prepared.candles
          state.dataQualityBySymbol[symbol] = prepared.dataQuality
          const latest = candles.at(-1)
          const providerLatest = incoming.candles.at(-1)
          result.latestCompletedCandle = providerLatest?.timestamp ?? null
          result.providerComplete = data.complete ?? null
          result.dataQuality = incoming.dataQuality
          // The provider's minimum-history heuristic also flags short incremental
          // tails. Retained validated context can satisfy that known count; an
          // unexplained explicit incomplete response remains incomplete.
          const contextSatisfiesMinimum = cachedCandles.length > 0 && Number.isFinite(data.minimumExpectedCandles) &&
            data.minimumExpectedCandles > 0 && candles.length >= data.minimumExpectedCandles
          result.contextSatisfiesProviderMinimum = contextSatisfiesMinimum
          result.dataStatus = !data.candles.length ? 'EMPTY'
            : incoming.dataQuality.rejectedCandleCount > 0 || (data.complete === false && !contextSatisfiesMinimum) ? 'INCOMPLETE'
            : !providerLatest ? 'INCOMPLETE'
            : candleFreshness(providerLatest, config.timeframe, current, config.marketTimezone)
          // Unfinished rows never count as usable observations; normal in-progress
          // bars may accompany a valid latest completed bar.
          if (result.dataStatus === 'USABLE') result.dataStatus = 'NO_NEW_DATA'
          // Do not advance trades, baselines, checkpoints, or cached context from
          // stale/insufficient responses. Rejected rows have no location metadata
          // proving they are unrelated to recovery, so retry a clean response.
          // Normal unfinished bars were filtered above and do not invalidate a
          // response that also supplies timely, validated completed candles.
          if (result.dataStatus !== 'NO_NEW_DATA') continue
          candleHistoryBySymbol[symbol] = candles.filter((candle) => Date.parse(candle.timestamp) >= Date.parse(historyStart(end)))
          const needsBaseline = baselinePending.has(symbol)
          // A symbol checkpoint can be ahead of an open trade's own cursor (for
          // example, after an older engine skipped a truncated-history position).
          const positionNeedsEvaluation = latest && engine.getState().trades.some((trade) =>
            trade.symbol === symbol && trade.status === 'open' &&
            (!Number.isFinite(Date.parse(trade.lastEvaluatedCandleTimestamp)) ||
              Date.parse(trade.lastEvaluatedCandleTimestamp) < Date.parse(latest.timestamp)))
          if (!latest || (!needsBaseline && latest.timestamp === state.processedCandles[symbol] && !positionNeedsEvaluation)) continue
          // Cached candles alone cannot clear a baseline after a failed/empty provider response.
          if (needsBaseline && !incoming.candles.length) continue
          const previousTimestamp = state.processedCandles[symbol]
          const previousIndex = candles.findIndex((candle) => candle.timestamp === previousTimestamp)
          const latestIndex = candles.length - 1
          const adjacent = previousIndex >= 0 && previousIndex === latestIndex - 1 &&
            historicalCandleEndTime(candles[previousIndex].timestamp, config.timeframe) === Date.parse(latest.timestamp)
          // On startup, establish a baseline without creating a trade from fetched history.
          // After downtime, evaluate existing trades but skip missed entry opportunities.
          engine.processCandles(symbol, candles, {
            newEntrySignalTimestamp: activeSet.has(symbol) && !needsBaseline && adjacent ? previousTimestamp : null,
            signalDetectedAt: () => now().toISOString(),
            allowNewEntries: activeSet.has(symbol) && !needsBaseline,
          })
          baselinePending.delete(symbol)
          state.baselinePendingSymbols = [...baselinePending].sort()
          state.processedCandles[symbol] = latest.timestamp
          state.lastProcessedCandle = latest.timestamp
          processed += 1
          result.processed = true
          if (result.dataStatus === 'NO_NEW_DATA' && providerLatest.timestamp === latest.timestamp) {
            result.dataStatus = 'FRESH'
            result.lastFreshDataAt = now().toISOString()
            freshSymbols += 1
          }
        } catch (error) {
          result.dataStatus = error.code === 'PAPER_FETCH_TIMEOUT' ? 'TIMEOUT' : fetched ? 'PROCESSING_ERROR' : 'FETCH_ERROR'
          result.error = error.message
          result.errorCode = error.code ?? null
        }
      }
      const failed = Object.entries(state.symbolResults).filter(([, result]) => failedDataStatuses.has(result.dataStatus))
      const nextStatus = failed.length ? 'ERROR' : symbolsToManage.length ? 'RUNNING' : 'IDLE'
      state.cycleOutcome = failed.length ? (failed.length < symbolsToManage.length ? 'PARTIAL' : 'DATA_UNAVAILABLE')
        : freshSymbols ? 'FRESH' : symbolsToManage.length ? 'NO_NEW_DATA' : 'NO_SYMBOLS'
      state.cycleSummary = { attempted: symbolsToManage.length, fresh: freshSymbols, failed: failed.length,
        bySymbol: Object.fromEntries(Object.entries(state.symbolResults).map(([symbol, result]) => [symbol, result.dataStatus])) }
      // Separate dashboard processes need durable polling liveness even when no
      // new candle exists. Reuse the protected save path; polling is not freshness.
      const successfulPollChanged = Object.entries(state.symbolResults).some(([symbol, result]) =>
        result.lastSuccessfulPollAt !== null && result.lastSuccessfulPollAt !== previousResults[symbol]?.lastSuccessfulPollAt)
      const shouldPersist = successfulPollChanged || universeChanged || processed > 0 || state.status !== nextStatus || state.currentError !== null || state.consecutiveFailures > 0 || previousSummary !== JSON.stringify(state.cycleSummary)
      state.status = nextStatus
      if (freshSymbols > 0) state.lastSuccessfulUpdate = current.toISOString()
      state.currentError = failed.length ? failed.map(([symbol, result]) => `${symbol}: ${result.error ?? result.dataStatus}`).join('; ') : null
      state.consecutiveFailures = failed.length ? previousFailures + 1 : 0
      state.nextExpectedProcessing = nextPollTime(current, failed.length ? retryDelay(config, state.consecutiveFailures) : config.pollIntervalMs).toISOString()
      if (shouldPersist) { savingCycle = true; await persist(); savingCycle = false }
      if (failed.length) { try { onError(Object.assign(new Error(state.currentError), { code: failed.length === 1 ? failed[0][1].errorCode ?? 'PAPER_SYMBOL_DATA_FAILURE' : 'PAPER_SYMBOL_DATA_FAILURE' })) } catch {} }
      return { ...state, processed, ...(failed.length ? { error: state.currentError } : {}) }
    } catch (error) {
      if (savingCycle && ['PARTIAL', 'DATA_UNAVAILABLE'].includes(state.cycleOutcome) && state.currentError) {
        error = new AggregateError([error], `${state.currentError}; persistence failed: ${error.message}`)
      }
      state.lastSuccessfulUpdate = previousSuccess
      state.cycleOutcome = 'ERROR'
      state.status = 'ERROR'
      state.currentError = error.message
      state.consecutiveFailures = previousFailures + 1
      state.nextExpectedProcessing = nextPollTime(current, retryDelay(config, state.consecutiveFailures)).toISOString()
      let persistenceError = null
      try {
        await persist()
      } catch (persistError) {
        persistenceError = persistError
        state.currentError = `${error.message}; recording the error also failed: ${persistError.message}`
      }
      try { onError(persistenceError ? new AggregateError([error, persistenceError], state.currentError) : error) } catch {}
      return { ...state, processed, error: state.currentError }
    }
  }

  function processOnce() {
    if (activeCycle) return activeCycle
    const wrappedCycle = runCycle().finally(() => {
      if (activeCycle === wrappedCycle) activeCycle = null
    })
    activeCycle = wrappedCycle
    return wrappedCycle
  }

  function start() {
    if (running) return
    running = true
    const tick = () => {
      if (!running) return
      processOnce()
        .then((result) => result?.status === 'ERROR' ? retryDelay(config, result.consecutiveFailures) : config.pollIntervalMs)
        .catch((error) => { try { onError(error) } catch {}; return retryDelay(config, state.consecutiveFailures + 1) })
        .then((delay) => { if (running) timer = schedule(tick, delay) })
    }
    tick()
  }
  function stop() { running = false; if (timer !== undefined) cancelSchedule(timer); timer = undefined }
  function status() { return { ...state, config: { ...config, symbols: state.activeSymbols }, mode: 'AUTOMATED PAPER OBSERVER — NO REAL ORDERS', storage: environment.DATABASE_URL ? 'POSTGRES' : 'LOCAL JSON DEVELOPMENT FALLBACK' } }
  return { config, processOnce, start, stop, status, getJournal: () => engine.getJournal({ symbols: state.activeSymbols }), getState: engine.getState }
}

export { configFromEnvironment }
