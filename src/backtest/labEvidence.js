export function hasPerformanceObservations(metrics) {
  const count = metrics?.tradeCount ?? metrics?.totalTrades ?? metrics?.occurrenceCount
  return Number.isFinite(count) && count > 0
}

export function summarizeRequiredResearchData(datasets, requiredSymbols) {
  const bySymbol = new Map((datasets ?? []).map((dataset) => [dataset.symbol, dataset]))
  const entries = requiredSymbols.map((symbol) => ({ symbol, dataset: bySymbol.get(symbol) }))
  const availableSymbols = entries
    .filter(({ dataset }) => dataset?.status === 'AVAILABLE')
    .map(({ symbol }) => symbol)
  const loadingSymbols = entries
    .filter(({ dataset }) => !dataset || dataset.status === 'LOADING')
    .map(({ symbol }) => symbol)
  const unavailableSymbols = entries
    .filter(({ dataset }) => dataset && dataset.status !== 'AVAILABLE' && dataset.status !== 'LOADING')
    .map(({ symbol }) => symbol)

  const state = loadingSymbols.length
    ? 'loading'
    : availableSymbols.length === requiredSymbols.length
      ? 'ready'
      : availableSymbols.length
        ? 'partial'
        : 'unavailable'

  return { state, availableSymbols, loadingSymbols, unavailableSymbols }
}

export function describeAmbiguousTrades(metrics) {
  const tradeCount = metrics?.tradeCount ?? metrics?.totalTrades
  if (!Number.isFinite(tradeCount)) {
    return 'No completed trade observations are available, so the ambiguous-candle count is unavailable.'
  }
  const ambiguousCount = metrics?.ambiguousTradeCount
  const denominator = metrics?.ambiguityRateDenominator
  if (!Number.isFinite(ambiguousCount) || !Number.isFinite(denominator) || denominator !== tradeCount) {
    if (tradeCount === 0) return 'No completed trade observations are available. The ambiguous-candle count is unavailable because complete candle-level ambiguity data was not recorded.'
    return 'The ambiguous-candle count is unavailable because complete candle-level ambiguity data was not recorded for every trade.'
  }
  if (tradeCount === 0) return `Same-candle stop/target ambiguity: ${ambiguousCount} of 0 simulated trades. The percentage is unavailable because there were no completed trade observations. The OHLC simulation resolves such candles stop-first; the count describes uncertainty in historical candles, not actual trade execution.`
  const rate = denominator > 0 ? ` (${((ambiguousCount / denominator) * 100).toFixed(1)}%)` : ''
  return `Same-candle stop/target ambiguity: ${ambiguousCount} of ${denominator} simulated trades${rate}. The OHLC simulation resolves such candles stop-first; the count describes uncertainty in historical candles, not actual trade execution.`
}
