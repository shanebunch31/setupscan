
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createDailyResearchMarketDataFetcher } from './dailyResearchMarketData.js'

function makeCandles(count = 80) {
  return Array.from({ length: count }, (_, index) => {
    const close = 100 + index * 0.25

    return {
      timestamp: new Date(
        Date.UTC(2026, 0, 1, index),
      ).toISOString(),
      open: close - 0.1,
      high: close + 0.5,
      low: close - 0.5,
      close,
      volume: 1000,
    }
  })
}

test('fetches historical bars and returns processed market data', async () => {
  let fetchRequest

  const fetcher = createDailyResearchMarketDataFetcher({
    fetchHistoricalMarketBars: async (request) => {
      fetchRequest = request

      return {
        provider: 'TEST',
        symbol: request.symbol,
        timeframe: request.timeframe,
        adjustmentMode: 'split',
        complete: true,
        candleCount: 80,
        minimumExpectedCandles: 0,
        candles: makeCandles(),
      }
    },
  })

  const result = await fetcher('SPY', '1Hour', {
    start: '2026-01-01T00:00:00.000Z',
    end: '2026-01-05T00:00:00.000Z',
  })

  assert.equal(fetchRequest.symbol, 'SPY')
  assert.equal(fetchRequest.timeframe, '1Hour')
  assert.equal(result.symbol, 'SPY')
  assert.equal(result.provider, 'TEST')
  assert.ok(Array.isArray(result.candles))
  assert.ok(result.candles.length > 0)
})

test('throws when the historical route reports an error', async () => {
  const fetcher = createDailyResearchMarketDataFetcher({
    fetchHistoricalMarketBars: async () => {
      const error = new Error('Test market data failure')
      error.status = 502
      throw error
    },
  })

  await assert.rejects(
    fetcher('SPY', '1Hour', {
      start: '2026-01-01T00:00:00.000Z',
      end: '2026-01-05T00:00:00.000Z',
    }),
    /Test market data failure/,
  )
})
