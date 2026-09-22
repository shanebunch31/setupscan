const requiredEnvironmentVariables = ['ALPACA_API_KEY', 'ALPACA_API_SECRET']
const alpacaBarsUrl = 'https://data.alpaca.markets/v2/stocks'

function getMissingEnvironmentVariables(environment = process.env) {
  return requiredEnvironmentVariables.filter((name) => !environment[name])
}

function normalizeBar(bar, symbol, timeframe) {
  return {
    symbol,
    timeframe,
    timestamp: bar.t,
    open: Number(bar.o),
    high: Number(bar.h),
    low: Number(bar.l),
    close: Number(bar.c),
    volume: Number(bar.v),
  }
}

export async function fetchAlpacaHistoricalBars({ symbol = 'SPY', timeframe = '1Hour', start, end, environment = process.env } = {}) {
  const missing = getMissingEnvironmentVariables(environment)
  if (missing.length) {
    const error = new Error(`Missing required environment variables: ${missing.join(', ')}`)
    error.code = 'MISSING_ALPACA_ENV'
    throw error
  }

  const bars = []
  let pageToken
  const requestedStart = start ?? null
  const requestedEnd = end ?? null
  do {
    const params = new URLSearchParams({ timeframe, adjustment: 'raw', feed: 'iex', limit: '10000' })
    if (start) params.set('start', start)
    if (end) params.set('end', end)
    if (pageToken) params.set('page_token', pageToken)
    const response = await fetch(`${alpacaBarsUrl}/${encodeURIComponent(symbol)}/bars?${params}`, {
      headers: {
        'APCA-API-KEY-ID': process.env.ALPACA_API_KEY,
        'APCA-API-SECRET-KEY': process.env.ALPACA_API_SECRET,
      },
    })
    if (!response.ok) {
      const error = new Error(`Alpaca historical data request failed with status ${response.status}`)
      error.code = 'ALPACA_REQUEST_FAILED'
      error.status = response.status
      throw error
    }
    const payload = await response.json()
    for (const bar of payload.bars ?? []) bars.push(normalizeBar(bar, symbol, timeframe))
    pageToken = payload.next_page_token
  } while (pageToken)

  const timestamps = bars.map((bar) => bar.timestamp).sort()
  const requestedDays = requestedStart && requestedEnd ? (new Date(requestedEnd) - new Date(requestedStart)) / 86400000 : 0
  const minimumExpectedCandles = requestedDays ? Math.min(1000, Math.max(20, Math.floor(requestedDays * 2))) : 0
  return {
    provider: 'ALPACA HISTORICAL',
    symbol,
    timeframe,
    start: timestamps[0] ?? start ?? null,
    end: timestamps[timestamps.length - 1] ?? end ?? null,
    candleCount: bars.length,
    requestedStart,
    requestedEnd,
    minimumExpectedCandles,
    complete: !minimumExpectedCandles || bars.length >= minimumExpectedCandles,
    candles: bars,
  }
}

export { getMissingEnvironmentVariables }