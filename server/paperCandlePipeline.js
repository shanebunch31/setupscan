import { candleCompletesBy } from '../src/data/historicalDataContract.js'
import { enrichHistoricalCandles, validateAndOrderHistoricalCandles } from '../src/data/marketData.js'

/** Validate and order provider rows before enrichment, and retain only fully completed bars. */
export function preparePaperCandles(rawCandles, timeframe, now = new Date()) {
  const { candles: orderedCandles, dataQuality } = validateAndOrderHistoricalCandles(rawCandles)
  const requestedEnd = now instanceof Date ? now.toISOString() : new Date(now).toISOString()
  const candles = orderedCandles.filter((candle) => candleCompletesBy(candle, timeframe, requestedEnd))
  dataQuality.incompleteCandleCount = orderedCandles.length - candles.length
  return {
    candles: enrichHistoricalCandles(candles, timeframe),
    dataQuality,
  }
}
