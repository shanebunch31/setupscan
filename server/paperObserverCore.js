import path from 'node:path'
import { fetchAlpacaHistoricalBars } from './alpacaProxy.js'
import { createPaperTradingEngine } from './paperTrading.js'
import { isRegularSession, nextPollTime } from './marketSession.js'
import { createPaperStore } from './paperStore.js'
import { createPostgresPaperStore } from './postgresPaperStore.js'
import { preparePaperCandles } from './paperCandlePipeline.js'
import { historicalCandleEndTime } from '../src/data/historicalDataContract.js'

const DEFAULT_SYMBOLS = ['SPY', 'QQQ', 'IWM']
const HISTORY_LOOKBACK_DAYS = 45
const DEFAULT_RETRY_MAX_MS = 15 * 60 * 1000

function configFromEnvironment(environment = process.env) {
  const requestedPollInterval = Number(environment.PAPER_POLL_INTERVAL_MS || 60000)
  const requestedRetryMax = Number(environment.PAPER_RETRY_MAX_MS || DEFAULT_RETRY_MAX_MS)
  const pollIntervalMs = Number.isFinite(requestedPollInterval) ? Math.max(1000, requestedPollInterval) : 60000
  return {
    symbols: (environment.PAPER_SYMBOLS || DEFAULT_SYMBOLS.join(',')).split(',').map((symbol) => symbol.trim()).filter(Boolean),
    timeframe: environment.PAPER_TIMEFRAME || '1Hour',
    marketTimezone: environment.PAPER_MARKET_TIMEZONE || 'America/New_York',
    // A bad environment value must not turn a failed cycle into a tight retry loop.
    pollIntervalMs,
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

export async function createPaperObserver({ store, fetchBars = fetchAlpacaHistoricalBars, now = () => new Date(), environment = process.env, onError = (error) => console.error('Paper observer cycle failed:', error), schedule = setTimeout, cancelSchedule = clearTimeout } = {}) {
  const config = configFromEnvironment(environment)
  const selectedStore = store ?? (environment.DATABASE_URL ? createPostgresPaperStore() : createPaperStore(path.resolve('server/data/paper-trades.json')))
  const initialState = await selectedStore.load()
  const engine = createPaperTradingEngine({ state: initialState, saveState: () => {}, timeframe: config.timeframe })
  const state = { status: 'IDLE', lastSuccessfulUpdate: null, lastProcessedCandle: null, processedCandles: {}, dataQualityBySymbol: {}, currentError: null, consecutiveFailures: 0, nextExpectedProcessing: null, independent: true, ...initialState.observer }
  const candleHistoryBySymbol = {}
  let running = false
  let timer
  let activeCycle = null

  async function persist(metadata = {}) {
    state.status = metadata.status ?? state.status
    Object.assign(state, metadata)
    const snapshot = { ...engine.getState(), observer: { ...state } }
    await selectedStore.save(snapshot, { ...state, processedCandles: Object.entries(state.processedCandles).map(([symbol, timestamp]) => ({ symbol, timestamp })) })
  }

  async function runCycle() {
    const current = now()
    let processed = 0
    try {
      if (!isRegularSession(current)) {
        const shouldPersist = state.status !== 'IDLE' || state.currentError !== null || !state.nextExpectedProcessing
        state.status = 'IDLE'
        state.consecutiveFailures = 0
        state.currentError = null
        state.nextExpectedProcessing = nextPollTime(current, config.pollIntervalMs).toISOString()
        if (shouldPersist) await persist()
        return { ...state, skipped: 'MARKET_CLOSED' }
      }
      for (const symbol of config.symbols) {
        const end = current
        // The first cycle obtains the indicator warm-up history. Later cycles request
        // only the last completed candle and any new bars, then retain the same local
        // warm-up context for enrichment and signal evaluation.
        const cachedCandles = candleHistoryBySymbol[symbol] ?? []
        const start = cachedCandles.at(-1)?.timestamp ?? historyStart(end)
        const data = await fetchBars({ symbol, timeframe: config.timeframe, start, end: end.toISOString() })
        const prepared = preparePaperCandles([...cachedCandles, ...(data.candles ?? [])], config.timeframe, current)
        const candles = prepared.candles
        candleHistoryBySymbol[symbol] = candles.filter((candle) => Date.parse(candle.timestamp) >= Date.parse(historyStart(end)))
        state.dataQualityBySymbol[symbol] = prepared.dataQuality
        const latest = candles.at(-1)
        if (!latest || latest.timestamp === state.processedCandles[symbol]) continue
        const previousTimestamp = state.processedCandles[symbol]
        const previousIndex = candles.findIndex((candle) => candle.timestamp === previousTimestamp)
        const latestIndex = candles.length - 1
        const adjacent = previousIndex >= 0 && previousIndex === latestIndex - 1 &&
          historicalCandleEndTime(candles[previousIndex].timestamp, config.timeframe) === Date.parse(latest.timestamp)
        // On startup, establish a baseline without creating a trade from fetched history.
        // After downtime, evaluate existing trades but skip missed entry opportunities.
        engine.processCandles(symbol, candles, {
          newEntrySignalTimestamp: adjacent ? previousTimestamp : null,
          signalDetectedAt: () => now().toISOString(),
        })
        state.processedCandles[symbol] = latest.timestamp
        state.lastProcessedCandle = latest.timestamp
        processed += 1
      }
      const shouldPersist = processed > 0 || state.status !== 'RUNNING' || state.currentError !== null || state.consecutiveFailures > 0
      state.status = 'RUNNING'
      state.lastSuccessfulUpdate = current.toISOString()
      state.currentError = null
      state.consecutiveFailures = 0
      state.nextExpectedProcessing = nextPollTime(current, config.pollIntervalMs).toISOString()
      if (shouldPersist) await persist()
      return { ...state, processed }
    } catch (error) {
      state.status = 'ERROR'
      state.currentError = error.message
      state.consecutiveFailures += 1
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
  function status() { return { ...state, config: { ...config }, mode: 'AUTOMATED PAPER OBSERVER — NO REAL ORDERS', storage: environment.DATABASE_URL ? 'POSTGRES' : 'LOCAL JSON DEVELOPMENT FALLBACK' } }
  return { config, processOnce, start, stop, status, getJournal: engine.getJournal, getState: engine.getState }
}

export { configFromEnvironment }
