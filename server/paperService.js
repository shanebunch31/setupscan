import path from 'node:path'
import { fetchAlpacaHistoricalBars } from './alpacaProxy.js'
import { createPaperTradingEngine } from './paperTrading.js'
import { createPaperStore } from './paperStore.js'
import { preparePaperCandles } from './paperCandlePipeline.js'
import { historicalCandleEndTime } from '../src/data/historicalDataContract.js'

const symbols = ['SPY', 'QQQ', 'IWM']

export function createPaperService({ store = createPaperStore(path.resolve('server/data/paper-trades.json')), fetchBars = fetchAlpacaHistoricalBars, now = () => new Date() } = {}) {
  const initialState = store.load()
  const engine = createPaperTradingEngine({ state: initialState, saveState: store.save })
  // This UI service keeps an in-memory cursor. On a fresh process it establishes a
  // baseline without replaying historical entry signals; existing open trades still recover.
  const processedCandles = { ...(initialState.observer?.processedCandles ?? {}) }

  async function refresh() {
    const end = now()
    const start = new Date(end)
    start.setUTCDate(start.getUTCDate() - 45)
    const results = []
    for (const symbol of symbols) {
      try {
        const data = await fetchBars({ symbol, timeframe: '1Hour', start: start.toISOString(), end: end.toISOString() })
        const prepared = preparePaperCandles(data.candles ?? [], '1Hour', end)
        const { candles } = prepared
        const latest = candles.at(-1)
        if (latest) {
          const previousTimestamp = processedCandles[symbol]
          const previousIndex = candles.findIndex((candle) => candle.timestamp === previousTimestamp)
          const latestIndex = candles.length - 1
          const adjacent = previousIndex >= 0 && previousIndex === latestIndex - 1 &&
            historicalCandleEndTime(candles[previousIndex].timestamp, '1Hour') === Date.parse(latest.timestamp)
          engine.processCandles(symbol, candles, {
            newEntrySignalTimestamp: adjacent ? previousTimestamp : null,
            signalDetectedAt: () => now().toISOString(),
          })
          processedCandles[symbol] = latest.timestamp
        }
        results.push({ symbol, status: candles.length ? 'AVAILABLE' : 'UNAVAILABLE', ...(candles.length ? {} : { error: 'No valid completed historical candles were available.' }), provider: data.provider, candleCount: data.candleCount, dataQuality: prepared.dataQuality, entryPolicy: 'Forward-only; first refresh establishes a baseline. New entries wait for the close of an adjacent completed bar timestamped after detection; missed bars are skipped.' })
      } catch (error) {
        results.push({ symbol, status: 'UNAVAILABLE', error: error.message })
      }
    }
    return { ...engine.getJournal(), refreshedAt: end.toISOString(), data: results }
  }

  return { refresh, getJournal: engine.getJournal }
}
