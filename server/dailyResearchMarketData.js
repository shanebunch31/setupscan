
import { handleHistoricalRoute } from './historicalRoute.js'
import { fetchAlpacaHistoricalBars } from './alpacaProxy.js'
import { createHistoricalCacheKey } from '../src/research/historicalCacheKey.js'
import {
  buildHistoricalMarketDataResult,
  historicalFetchRange,
} from '../src/data/marketData.js'

function sendJson(response, status, body) {
  response.statusCode = status
  response.body = body
}

export function createDailyResearchMarketDataFetcher({
  store,
  fetchHistoricalMarketBars = fetchAlpacaHistoricalBars,
} = {}) {
  return async function fetchDailyResearchMarketData(
    symbol,
    timeframe = '1Hour',
    range = {},
  ) {
    const fetchRange = historicalFetchRange(range, timeframe)
    const params = new URLSearchParams({ symbol, timeframe })

    if (fetchRange.start) params.set('start', fetchRange.start)
    if (fetchRange.end) params.set('end', fetchRange.end)

    const response = { statusCode: 200, body: null }

    await handleHistoricalRoute({
      response,
      url: new URL(`http://localhost/api/historical?${params}`),
      fetchHistoricalMarketBars,
      researchRunStore: store,
      sendJson,
      createHistoricalCacheKey,
    })

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(
        response.body?.error || `Historical data request failed (${response.statusCode})`,
      )
    }

    const payload = response.body
    const candles = Array.isArray(payload?.candles) ? payload.candles : []

    return buildHistoricalMarketDataResult(
      symbol,
      timeframe,
      fetchRange,
      payload,
      candles,
    )
  }
}
