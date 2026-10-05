import assert from 'node:assert/strict'
import { test } from 'node:test'
import { handleHistoricalRoute } from './historicalRoute.js'
import { createHistoricalCacheKey } from '../src/research/historicalCacheKey.js'

test('fully covered historical requests reuse the cached series', async () => {
  let fetchCalls = 0
  const responses = []

  const sendJson = (_response, status, body) => {
    responses.push({ status, body })
  }

  const covered = {
    provider: 'ALPACA HISTORICAL',
    symbol: 'SPY',
    timeframe: '1Hour',
    adjustmentMode: 'split',
    requestedStart: '2026-01-01T00:00:00Z',
    requestedEnd: '2026-01-03T00:00:00Z',
    actualStart: '2026-01-02T14:00:00Z',
    actualEnd: '2026-01-03T00:00:00Z',
    candleCount: 2,
    complete: true,
    candles: [
      {
        symbol: 'SPY',
        timeframe: '1Hour',
        timestamp: '2026-01-02T14:00:00Z',
        open: 100,
        high: 101,
        low: 99,
        close: 100.5,
        volume: 5000,
      },
      {
        symbol: 'SPY',
        timeframe: '1Hour',
        timestamp: '2026-01-02T15:00:00Z',
        open: 100.5,
        high: 102,
        low: 100,
        close: 101.5,
        volume: 6000,
      },
    ],
  }

  const researchRunStore = {
    async findResearchHistoricalCacheCoverage() {
      return covered
    },

    async saveResearchHistoricalCache() {
      throw new Error('Should not save when cache already covers request')
    },
  }

  const fetchHistoricalMarketBars = async () => {
    fetchCalls += 1
    throw new Error('Historical fetch should not run')
  }

  const firstUrl = new URL(
    'http://localhost/api/historical?symbol=SPY&timeframe=1Hour&start=2026-01-01T00:00:00Z&end=2026-01-02T00:00:00Z',
  )

  const secondUrl = new URL(
    'http://localhost/api/historical?symbol=SPY&timeframe=1Hour&start=2026-01-01T00:00:00Z&end=2026-01-03T00:00:00Z',
  )

  await handleHistoricalRoute({
    response: {},
    url: firstUrl,
    fetchHistoricalMarketBars,
    researchRunStore,
    sendJson,
    createHistoricalCacheKey,
  })

  await handleHistoricalRoute({
    response: {},
    url: secondUrl,
    fetchHistoricalMarketBars,
    researchRunStore,
    sendJson,
    createHistoricalCacheKey,
  })

  assert.equal(fetchCalls, 0)
  assert.equal(responses.length, 2)
  assert.equal(responses[0].status, 200)
  assert.equal(responses[1].status, 200)

  assert.deepEqual(
    responses[0].body.candles,
    covered.candles,
  )

  assert.deepEqual(
    responses[1].body.candles,
    covered.candles,
  )
})

test('covered historical cache fetches only the missing tail and merges candles', async () => {
  let fetchCalls = 0
  let fetchInput = null
  let savedEntry = null
  const responses = []

  const sendJson = (_response, status, body) => {
    responses.push({ status, body })
  }

  const researchRunStore = {
    async getResearchHistoricalCache() {
      return null
    },

    async findResearchHistoricalCacheCoverage() {
      return {
        cacheKey: 'historical_SPY_1Hour_existing',
        provider: 'ALPACA HISTORICAL',
        symbol: 'SPY',
        timeframe: '1Hour',
        adjustmentMode: 'split',
        requestedStart: '2026-01-01T00:00:00Z',
        requestedEnd: '2026-01-02T20:00:00Z',
        actualStart: '2026-01-02T14:00:00Z',
        actualEnd: '2026-01-02T20:00:00Z',
        candleCount: 2,
        complete: true,
        candles: [
          {
            symbol: 'SPY',
            timeframe: '1Hour',
            timestamp: '2026-01-02T19:00:00Z',
            open: 100,
            high: 101,
            low: 99,
            close: 100.5,
            volume: 5000,
          },
          {
            symbol: 'SPY',
            timeframe: '1Hour',
            timestamp: '2026-01-02T20:00:00Z',
            open: 100.5,
            high: 102,
            low: 100,
            close: 101.5,
            volume: 6000,
          },
        ],
      }
    },

    async saveResearchHistoricalCache(entry) {
      savedEntry = entry
    },
  }

  const fetchHistoricalMarketBars = async (input) => {
    fetchCalls += 1
    fetchInput = input

    return {
      provider: 'ALPACA HISTORICAL',
      symbol: input.symbol,
      timeframe: input.timeframe,
      adjustmentMode: 'split',
      start: '2026-01-02T20:00:00Z',
      end: '2026-01-05T00:00:00Z',
      requestedStart: input.start,
      requestedEnd: input.end,
      candleCount: 2,
      minimumExpectedCandles: 2,
      complete: true,
      candles: [
        {
          symbol: input.symbol,
          timeframe: input.timeframe,
          timestamp: '2026-01-02T20:00:00Z',
          open: 100.5,
          high: 102,
          low: 100,
          close: 101.5,
          volume: 6000,
        },
        {
          symbol: input.symbol,
          ttimeframe: input.timeframe,
          timestamp: '2026-01-02T21:00:00Z',
          open: 101.5,
          high: 103,
          low: 101,
          close: 102.5,
          volume: 7000,
        },
      ],
    }
  }

  const url = new URL(
    'http://localhost/api/historical?symbol=SPY&timeframe=1Hour&start=2026-01-01T00:00:00Z&end=2026-01-05T00:00:00Z',
  )

  await handleHistoricalRoute({
    response: {},
    url,
    fetchHistoricalMarketBars,
    researchRunStore,
    sendJson,
    createHistoricalCacheKey,
  })

  assert.equal(fetchCalls, 1)
  assert.equal(fetchInput.start, '2026-01-02T20:00:00Z')
  assert.equal(fetchInput.end, '2026-01-05T00:00:00Z')

  assert.equal(responses.length, 1)
  assert.equal(responses[0].status, 200)

  assert.equal(responses[0].body.candleCount, 3)
  assert.deepEqual(
    responses[0].body.candles.map((candle) => candle.timestamp),
    [
      '2026-01-02T19:00:00Z',
      '2026-01-02T20:00:00Z',
      '2026-01-02T21:00:00Z',
    ],
  )

  assert.equal(savedEntry.candleCount, 3)
  assert.equal(savedEntry.complete, true)
  assert.equal(
    savedEntry.requestedEnd,
    '2026-01-05T00:00:00Z',
  )
})

test('fully covered historical cache avoids a new historical fetch', async () => {
  let fetchCalls = 0
  const responses = []

  const sendJson = (_response, status, body) => {
    responses.push({ status, body })
  }

  const researchRunStore = {
    async getResearchHistoricalCache() {
      return null
    },

    async findResearchHistoricalCacheCoverage() {
      return {
        provider: 'ALPACA HISTORICAL',
        symbol: 'SPY',
        timeframe: '1Hour',
        adjustmentMode: 'split',
        requestedStart: '2026-01-01T00:00:00Z',
        requestedEnd: '2026-01-03T00:00:00Z',
        actualStart: '2026-01-02T14:00:00Z',
        actualEnd: '2026-01-03T00:00:00Z',
        candleCount: 1,
        complete: true,
        candles: [
          {
            symbol: 'SPY',
            timeframe: '1Hour',
            timestamp: '2026-01-02T14:00:00Z',
            open: 100,
            high: 101,
            low: 99,
            close: 100.5,
            volume: 5000,
          },
        ],
      }
    },

    async saveResearchHistoricalCache() {
      throw new Error('Should not save when cache already covers request')
    },
  }

  const fetchHistoricalMarketBars = async () => {
    fetchCalls += 1
    throw new Error('Historical fetch should not run')
  }

  const url = new URL(
    'http://localhost/api/historical?symbol=SPY&timeframe=1Hour&start=2026-01-01T00:00:00Z&end=2026-01-03T00:00:00Z',
  )

  await handleHistoricalRoute({
    response: {},
    url,
    fetchHistoricalMarketBars,
    researchRunStore,
    sendJson,
    createHistoricalCacheKey,
  })

  assert.equal(fetchCalls, 0)
  assert.equal(responses.length, 1)
  assert.equal(responses[0].status, 200)
  })

test('fully covered historical cache avoids a new historical fetch', async () => {
  let fetchCalls = 0
  const responses = []

  const sendJson = (_response, status, body) => {
    responses.push({ status, body })
  }

  const covered = {
    provider: 'ALPACA HISTORICAL',
    symbol: 'SPY',
    timeframe: '1Hour',
    adjustmentMode: 'split',
    requestedStart: '2026-01-01T00:00:00Z',
    requestedEnd: '2026-01-03T00:00:00Z',
    actualStart: '2026-01-02T14:00:00Z',
    actualEnd: '2026-01-03T00:00:00Z',
    candleCount: 1,
    complete: true,
    candles: [
      {
        symbol: 'SPY',
        timeframe: '1Hour',
        timestamp: '2026-01-02T14:00:00Z',
        open: 100,
        high: 101,
        low: 99,
        close: 100.5,
        volume: 5000,
      },
    ],
  }

  const researchRunStore = {
    async getResearchHistoricalCache() {
      return null
    },

    async findResearchHistoricalCacheCoverage() {
      return covered
    },

    async saveResearchHistoricalCache() {
      throw new Error('Should not save when cache already covers request')
    },
  }

  const fetchHistoricalMarketBars = async () => {
    fetchCalls += 1
    throw new Error('Historical fetch should not run')
  }

  const url = new URL(
    'http://localhost/api/historical?symbol=SPY&timeframe=1Hour&start=2026-01-01T00:00:00Z&end=2026-01-03T00:00:00Z',
  )

  await handleHistoricalRoute({
    response: {},
    url,
    fetchHistoricalMarketBars,
    researchRunStore,
    sendJson,
    createHistoricalCacheKey,
  })

  assert.equal(fetchCalls, 0)
  assert.equal(responses.length, 1)
  assert.equal(responses[0].status, 200)
  assert.equal(responses[0].body.candleCount, covered.candleCount)
  assert.deepEqual(
    responses[0].body.candles,
    covered.candles,
  )
})