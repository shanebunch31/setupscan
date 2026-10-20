import path from 'node:path'
import { createPaperTradingEngine } from './paperTrading.js'
import { createPaperStore } from './paperStore.js'
import { createPostgresPaperStore } from './postgresPaperStore.js'
import { configuredSeedSymbols } from './paperSymbols.js'

function selectStore({ store, environment, createJsonStore, createPostgresStore }) {
  if (store) return { store, storage: 'INJECTED TEST STORE' }
  if (environment.DATABASE_URL) {
    return { store: createPostgresStore(), storage: 'POSTGRES OBSERVER STATE' }
  }
  return {
    store: createJsonStore(path.resolve('server/data/paper-trades.json')),
    storage: 'LOCAL JSON DEVELOPMENT FALLBACK',
  }
}

function observerData(state, symbols, configuredSymbols) {
  const observer = state.observer
  const configured = new Set(configuredSymbols)
  const openSymbols = new Set((state.trades ?? []).filter((trade) => trade.status === 'open').map((trade) => trade.symbol))
  return symbols.map((symbol) => {
    const dataQuality = observer?.dataQualityBySymbol?.[symbol]
    const processedCandle = observer?.processedCandles?.[symbol] ?? null
    return {
      symbol,
      status: configured.has(symbol)
        ? (processedCandle && !observer?.baselinePendingSymbols?.includes(symbol) && observer?.activeSymbols?.includes(symbol) !== false ? 'AVAILABLE' : 'PENDING BASELINE')
        : (openSymbols.has(symbol) ? 'REMOVED — OPEN POSITION MANAGEMENT ONLY' : 'HISTORICAL — NOT ENABLED'),
      ...(processedCandle ? { lastProcessedCandle: processedCandle } : { error: configured.has(symbol)
        ? 'No completed candle checkpoint is available for this symbol.'
        : (openSymbols.has(symbol) ? 'This symbol is no longer enabled for new entries; an existing position is still managed.' : 'This symbol appears only in retained paper-trade history and is not enabled for new entries.') }),
      ...(dataQuality ? { dataQuality } : {}),
      entryPolicy: configured.has(symbol)
        ? 'Observer-only; this dashboard does not fetch candles, create paper entries, or update paper trades.'
        : (openSymbols.has(symbol) ? 'New entries are disabled. The observer continues managing an existing open paper position only.' : 'New entries are disabled. This symbol is retained only for historical paper-trade reporting.'),
    }
  })
}

export function createPaperService({
  store,
  environment = process.env,
  createJsonStore = createPaperStore,
  createPostgresStore = createPostgresPaperStore,
  now = () => new Date(),
} = {}) {
  const selected = selectStore({ store, environment, createJsonStore, createPostgresStore })

  async function readSnapshot() {
    const state = await selected.store.read()
    const configuredUniverse = typeof selected.store.readObserverSymbols === 'function'
      ? await selected.store.readObserverSymbols()
      : { initialized: false, symbols: [] }
    const configuredSymbols = configuredUniverse.initialized ? configuredUniverse.symbols : configuredSeedSymbols(environment)
    const activeSymbols = Array.isArray(state.observer?.activeSymbols) ? state.observer.activeSymbols : []
    const cursorSymbols = Object.keys(state.observer?.processedCandles ?? {})
    const tradeSymbols = (state.trades ?? []).map((trade) => trade.symbol)
    const symbols = [...new Set([...configuredSymbols, ...activeSymbols, ...cursorSymbols, ...tradeSymbols])].sort()
    const engine = createPaperTradingEngine({ state, saveState: () => {} })
    return {
      ...engine.getJournal({ symbols }),
      refreshedAt: now().toISOString(),
      storage: selected.storage,
      observer: state.observer ?? null,
      symbolUniverse: { initialized: configuredUniverse.initialized, symbols: configuredSymbols },
      data: observerData(state, symbols, configuredSymbols),
    }
  }

  return { readSnapshot }
}
