export function createHistoricalCacheKey({
  symbol,
  timeframe,
  adjustmentMode = 'split',
}) {
  return [
    'historical',
    symbol,
    timeframe,
    adjustmentMode,
  ]
    .map((value) => encodeURIComponent(String(value)))
    .join(':')
}