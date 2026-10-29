// Chart presentation only. The production scanner keeps its own lookback.
const HOUR_MS = 60 * 60 * 1000
const sessionFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
})

export function chartSessionKey(timestamp) {
  const parts = Object.fromEntries(sessionFormatter.formatToParts(new Date(timestamp))
    .map(({ type, value }) => [type, value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}

export function createScanChartRange(now = new Date()) {
  const end = new Date(now)
  const start = new Date(end)
  start.setUTCDate(start.getUTCDate() - 30)
  return { start: start.toISOString(), end: end.toISOString() }
}

export function completedChartCandles(candles = [], now = Date.now()) {
  return candles.filter((candle) => {
    const timestamp = Date.parse(candle.timestamp)
    return Number.isFinite(timestamp) && timestamp + HOUR_MS <= Number(now)
      && ['open', 'high', 'low', 'close'].every((key) => Number.isFinite(candle[key]))
  }).sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
}

export function selectChartRange(candles = [], range = '5D') {
  const ordered = completedChartCandles(candles)
  const sessions = [...new Set(ordered.map((candle) => chartSessionKey(candle.timestamp)))]
  const count = { '1D': 1, '3D': 3, '5D': 5 }[range]
  if (!count) return ordered
  const allowed = new Set(sessions.slice(-count))
  return ordered.filter((candle) => allowed.has(chartSessionKey(candle.timestamp)))
}
