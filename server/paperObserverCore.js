import path from 'node:path'
import { enrichHistoricalCandles } from '../src/data/marketData.js'
import { fetchAlpacaHistoricalBars } from './alpacaProxy.js'
import { createPaperTradingEngine } from './paperTrading.js'
import { completedHourlyCandles, isRegularSession, nextPollTime } from './marketSession.js'
import { createPaperStore } from './paperStore.js'
import { createPostgresPaperStore } from './postgresPaperStore.js'

const DEFAULT_SYMBOLS = ['SPY', 'QQQ', 'IWM']

function configFromEnvironment(environment = process.env) {
  return {
    symbols: (environment.PAPER_SYMBOLS || DEFAULT_SYMBOLS.join(',')).split(',').map((symbol) => symbol.trim()).filter(Boolean),
    timeframe: environment.PAPER_TIMEFRAME || '1Hour',
    marketTimezone: environment.PAPER_MARKET_TIMEZONE || 'America/New_York',
    pollIntervalMs: Number(environment.PAPER_POLL_INTERVAL_MS || 60000),
  }
}

export async function createPaperObserver({ store, fetchBars = fetchAlpacaHistoricalBars, now = () => new Date(), environment = process.env } = {}) {
  const config = configFromEnvironment(environment)
  const selectedStore = store ?? (environment.DATABASE_URL ? createPostgresPaperStore() : createPaperStore(path.resolve('server/data/paper-trades.json')))
  const initialState = await selectedStore.load()
  const engine = createPaperTradingEngine({ state: initialState, saveState: () => {} })
  const state = { status: 'IDLE', lastSuccessfulUpdate: null, lastProcessedCandle: null, processedCandles: {}, currentError: null, nextExpectedProcessing: null, independent: true, ...initialState.observer }
  let running = false
  let timer

  async function persist(metadata = {}) {
    state.status = metadata.status ?? state.status
    Object.assign(state, metadata)
    const snapshot = { ...engine.getState(), observer: { ...state } }
    await selectedStore.save(snapshot, { ...state, processedCandles: Object.entries(state.processedCandles).map(([symbol, timestamp]) => ({ symbol, timestamp })) })
  }

  async function processOnce() {
    const current = now()
    if (!isRegularSession(current)) {
      state.status = 'IDLE'
      state.nextExpectedProcessing = nextPollTime(current, config.pollIntervalMs).toISOString()
      await persist()
      return { ...state, skipped: 'MARKET_CLOSED' }
    }
    let processed = 0
    try {
      for (const symbol of config.symbols) {
        const end = current
        const start = new Date(end)
        start.setUTCDate(start.getUTCDate() - 45)
        const data = await fetchBars({ symbol, timeframe: config.timeframe, start: start.toISOString(), end: end.toISOString() })
        const candles = completedHourlyCandles(enrichHistoricalCandles(data.candles ?? []), current)
        const latest = candles.at(-1)
        if (!latest || latest.timestamp === state.processedCandles[symbol]) continue
        engine.processCandles(symbol, candles)
        state.processedCandles[symbol] = latest.timestamp
        state.lastProcessedCandle = latest.timestamp
        processed += 1
      }
      state.status = 'RUNNING'
      state.lastSuccessfulUpdate = current.toISOString()
      state.currentError = null
      state.nextExpectedProcessing = nextPollTime(current, config.pollIntervalMs).toISOString()
      await persist()
      return { ...state, processed }
    } catch (error) {
      state.status = 'ERROR'
      state.currentError = error.message
      await persist()
      return { ...state, processed, error: error.message }
    }
  }

  function start() {
    if (running) return
    running = true
    const tick = async () => { await processOnce(); if (running) timer = setTimeout(tick, config.pollIntervalMs) }
    tick()
  }
  function stop() { running = false; if (timer) clearTimeout(timer) }
  function status() { return { ...state, config: { ...config }, mode: 'AUTOMATED PAPER OBSERVER — NO REAL ORDERS', storage: environment.DATABASE_URL ? 'POSTGRES' : 'LOCAL JSON DEVELOPMENT FALLBACK' } }
  return { config, processOnce, start, stop, status, getJournal: engine.getJournal, getState: engine.getState }
}

export { configFromEnvironment }
