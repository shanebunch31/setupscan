/**
 * True when an OHLC candle opens between an active long stop and target, then spans both; false
 * when the open resolves a gap or only one barrier is touched; null when required OHLC data is
 * missing.
 * A gap through either barrier is resolved at the open by the existing fill model, so it is not
 * classified as intrabar ambiguous. This counts historical candle uncertainty; it does not model
 * the actual order of trades within a candle.
 */
export function isAmbiguousStopTargetCandle(candle, stopPrice, targetPrice) {
  if (!Number.isFinite(stopPrice) || !Number.isFinite(targetPrice) || stopPrice >= targetPrice) return null
  if (!Number.isFinite(candle?.open)) return null
  if (candle.open <= stopPrice || candle.open >= targetPrice) return false
  if (!Number.isFinite(candle.high) || !Number.isFinite(candle.low)) return null
  return candle.low <= stopPrice && candle.high >= targetPrice
}

export function summarizeAmbiguousTrades(trades) {
  if (!trades.every((trade) => typeof trade.ambiguousCandle === 'boolean')) {
    return {
      ambiguousTradeCount: null,
      ambiguityRateDenominator: null,
      ambiguousTradeRate: null,
    }
  }
  const ambiguousTradeCount = trades.filter((trade) => trade.ambiguousCandle === true).length
  const ambiguityRateDenominator = trades.length
  return {
    ambiguousTradeCount,
    ambiguityRateDenominator,
    ambiguousTradeRate: ambiguityRateDenominator
      ? ambiguousTradeCount / ambiguityRateDenominator
      : null,
  }
}
