import path from 'node:path'
import { enrichHistoricalCandles } from '../src/data/marketData.js'
import { fetchAlpacaHistoricalBars } from './alpacaProxy.js'
import { createPaperTradingEngine } from './paperTrading.js'
import { createPaperStore } from './paperStore.js'

const symbols = ['SPY', 'QQQ', 'IWM']

export function createPaperService({ store = createPaperStore(path.resolve('server/data/paper-trades.json')), fetchBars = fetchAlpacaHistoricalBars, now = () => new Date() } = {}) {
  const engine = createPaperTradingEngine({ state: store.load(), saveState: store.save })

  async function refresh() {
    const end = now()
    const start = new Date(end)
    start.setUTCDate(start.getUTCDate() - 45)
    const results = []
    for (const symbol of symbols) {
      try {
        const data = await fetchBars({ symbol, timeframe: '1Hour', start: start.toISOString(), end: end.toISOString() })
        const candles = enrichHistoricalCandles(data.candles ?? [])
        engine.processCandles(symbol, candles)
        results.push({ symbol, status: 'AVAILABLE', provider: data.provider, candleCount: data.candleCount })
      } catch (error) {
        results.push({ symbol, status: 'UNAVAILABLE', error: error.message })
      }
    }
    return { ...engine.getJournal(), refreshedAt: end.toISOString(), data: results }
  }

  return { refresh, getJournal: engine.getJournal }
}
