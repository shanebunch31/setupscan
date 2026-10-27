import assert from 'node:assert/strict'
import { test } from 'node:test'
import { handleHistoricalRoute } from './historicalRoute.js'
import { createHistoricalCacheKey } from '../src/research/historicalCacheKey.js'
import { diagnoseScannerVwap } from '../src/data/scannerSnapshot.js'

test('same-day five-minute cache ending at 11:45 ET fetches its missing tail and restores session VWAP', async () => {
  const bars = Array.from({ length: 78 }, (_, i) => ({
    symbol: 'SPY', timeframe: '5Min', timestamp: new Date(Date.parse('2026-10-27T13:30:00Z') + i * 300000).toISOString(),
    open: 100, high: 101, low: 99, close: 100, volume: 100,
  }))
  const cached = bars.slice(0, 28)
  const cutoff = '2026-10-27T20:00:00Z'
  const missing = diagnoseScannerVwap({ candles: cached }, cutoff)
  assert.equal(missing.missingSessionSlots.length, 50)
  assert.equal(missing.missingSessionSlots[0], '11:50')
  assert.equal(missing.missingSessionSlots.at(-1), '15:55')
  const calls = [], saves = []
  let response
  await handleHistoricalRoute({
    response: {}, url: new URL(`http://local/api/historical?symbol=SPY&timeframe=5Min&start=2026-10-01&end=${cutoff}`),
    researchRunStore: {
      findResearchHistoricalCacheCoverage: async () => ({ symbol: 'SPY', timeframe: '5Min', complete: true, actualEnd: cached.at(-1).timestamp, candles: cached }),
      saveResearchHistoricalCache: async entry => saves.push(entry),
    },
    fetchHistoricalMarketBars: async input => {
      calls.push(input)
      return { complete: true, candles: bars.slice(27) }
    },
    sendJson: (_, status, body) => { response = { status, body } }, createHistoricalCacheKey,
  })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].start, cached.at(-1).timestamp)
  assert.equal(calls[0].end, cutoff)
  assert.equal(response.status, 200)
  assert.equal(response.body.candles.length, 78)
  assert.equal(saves.length, 1)
  const diagnostic = diagnoseScannerVwap(response.body, cutoff)
  assert.equal(diagnostic.vwap, 100)
  assert.equal(diagnostic.usedCandleCount, 78)
})

test('same-day cache still reuses an exactly completed interval but fetches later hourly coverage', async () => {
  for (const [end, expectedCalls] of [['2026-10-27T17:00:00Z', 0], ['2026-10-27T18:00:00Z', 1]]) {
    let calls = 0
    await handleHistoricalRoute({
      response: {}, url: new URL(`http://local/api/historical?symbol=SPY&timeframe=1Hour&end=${end}`),
      researchRunStore: {
        findResearchHistoricalCacheCoverage: async () => ({ complete: true, actualEnd: '2026-10-27T16:00:00Z', candles: [] }),
        saveResearchHistoricalCache: async () => {},
      },
      fetchHistoricalMarketBars: async () => { calls++; return { complete: true, candles: [] } },
      sendJson: (_, status) => assert.equal(status, 200), createHistoricalCacheKey,
    })
    assert.equal(calls, expectedCalls)
  }
})

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
    'http://localhost/api/historical?symbol=SPY&timeframe=1Hour&start=2026-01-01T00:00:00Z&end=2026-01-02T16:00:00Z',
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

test('cached historical requests return only candles within the requested date range', async () => {
  const responses = []

  const covered = {
    provider: 'ALPACA HISTORICAL',
    symbol: 'SPY',
    timeframe: '1Hour',
    adjustmentMode: 'split',
    requestedStart: '2021-12-02T00:00:00Z',
    requestedEnd: '2026-10-09T20:00:00Z',
    actualStart: '2021-12-02T13:00:00Z',
    actualEnd: '2026-10-09T20:00:00Z',
    candleCount: 3,
    complete: true,
    candles: [
      {
        symbol: 'SPY',
        timeframe: '1Hour',
        timestamp: '2021-12-02T13:00:00Z',
        close: 100,
      },
      {
        symbol: 'SPY',
        timeframe: '1Hour',
        timestamp: '2026-09-15T14:00:00Z',
        close: 200,
      },
      {
        symbol: 'SPY',
        timeframe: '1Hour',
        timestamp: '2026-10-09T20:00:00Z',
        close: 210,
      },
    ],
  }

  const researchRunStore = {
    async findResearchHistoricalCacheCoverage() {
      return covered
    },
  }

  const fetchHistoricalMarketBars = async () => {
    throw new Error('A fully covered request should use the cache')
  }

  await handleHistoricalRoute({
    response: {},
    url: new URL(
      'http://localhost/api/historical?symbol=SPY&timeframe=1Hour&start=2026-09-11T21:35:55Z&end=2026-10-11T21:35:55Z',
    ),
    fetchHistoricalMarketBars,
    researchRunStore,
    sendJson: (_response, status, body) => {
      responses.push({ status, body })
    },
    createHistoricalCacheKey,
  })

  assert.equal(responses[0].status, 200)
  assert.deepEqual(
    responses[0].body.candles.map((candle) => candle.timestamp),
    [
      '2026-09-15T14:00:00Z',
      '2026-10-09T20:00:00Z',
    ],
  )
  assert.equal(responses[0].body.candleCount, 2)
})

test('cached and provider historical responses exclude bars that finish after a mid-interval cutoff', async () => {
  const sourceCandles = [
    { symbol: 'SPY', timeframe: '1Hour', timestamp: '2026-03-08T14:00:00Z', close: 100 },
    { symbol: 'SPY', timeframe: '1Hour', timestamp: '2026-03-08T15:00:00Z', close: 101 },
  ]
  const covered = {
    provider: 'ALPACA HISTORICAL', symbol: 'SPY', timeframe: '1Hour', adjustmentMode: 'split',
    actualStart: sourceCandles[0].timestamp, actualEnd: sourceCandles[1].timestamp,
    complete: true, candles: sourceCandles,
  }
  const cacheStore = { async findResearchHistoricalCacheCoverage() { return covered } }
  const cachedResponses = []
  const noFetch = async () => { throw new Error('complete cache must be reused') }

  for (const end of ['2026-03-08T11:30:00-04:00', '2026-03-08T12:00:00-04:00']) {
    await handleHistoricalRoute({
      response: {},
      url: new URL(`http://localhost/api/historical?symbol=SPY&timeframe=1Hour&start=2026-03-08T14%3A00%3A00Z&end=${encodeURIComponent(end)}`),
      fetchHistoricalMarketBars: noFetch,
      researchRunStore: cacheStore,
      sendJson: (_response, status, body) => cachedResponses.push({ status, body }),
      createHistoricalCacheKey,
    })
  }
  assert.deepEqual(cachedResponses[0].body.candles.map((candle) => candle.timestamp), ['2026-03-08T14:00:00Z'])
  assert.deepEqual(cachedResponses[1].body.candles.map((candle) => candle.timestamp), sourceCandles.map((candle) => candle.timestamp))

  const providerResponses = []
  await handleHistoricalRoute({
    response: {},
    url: new URL('http://localhost/api/historical?symbol=SPY&timeframe=1Hour&start=2026-03-08T14%3A00%3A00Z&end=2026-03-08T11%3A30%3A00-04%3A00'),
    fetchHistoricalMarketBars: async () => ({ provider: 'fixture', complete: false, candles: sourceCandles }),
    sendJson: (_response, status, body) => providerResponses.push({ status, body }),
    createHistoricalCacheKey,
  })
  assert.deepEqual(providerResponses[0].body.candles.map((candle) => candle.timestamp), ['2026-03-08T14:00:00Z'])
})


test('historical failures distinguish cache read, provider and cache write without leaking details', async () => {
  for (const stage of ['cache-read', 'provider', 'cache-write']) {
    const failure = Object.assign(new Error('private connection details'), { code: 'ECONNRESET' })
    let providerCalls = 0
    let result
    await handleHistoricalRoute({
      response: {}, url: new URL('http://localhost/api/historical?symbol=SPY&timeframe=1Hour'), createHistoricalCacheKey,
      sendJson: (_res, status, body) => { result = { status, body } },
      researchRunStore: {
        findResearchHistoricalCacheCoverage: async () => { if (stage === 'cache-read') throw failure; return null },
        saveResearchHistoricalCache: async () => { throw failure },
      },
      fetchHistoricalMarketBars: async () => {
        providerCalls++
        if (stage === 'provider') throw failure
        return { complete: true, candles: [] }
      },
    })
    assert.equal(result.status, 502)
    assert.equal(result.body.stage, stage)
    assert.equal(result.body.code, 'ECONNRESET')
    assert.ok(!JSON.stringify(result).includes('private connection details'))
    assert.equal(providerCalls, stage === 'cache-read' ? 0 : 1)
  }
})

test('historical missing configuration and nested network errors have safe diagnostics', async () => {
  for (const [failure, status, code] of [
    [Object.assign(new Error('private'), { code: 'MISSING_ALPACA_ENV' }), 503, 'MISSING_ALPACA_ENV'],
    [new Error('private', { cause: { code: 'ENOTFOUND' } }), 502, 'ENOTFOUND'],
    [Object.assign(new Error('private'), { code: 'secret-value' }), 502, null],
  ]) {
    let result
    await handleHistoricalRoute({ response: {}, url: new URL('http://localhost/api/historical'), createHistoricalCacheKey,
      fetchHistoricalMarketBars: async () => { throw failure },
      sendJson: (_res, status, body) => { result = { status, body } },
    })
    assert.equal(result.status, status)
    assert.equal(result.body.code, code)
    assert.ok(!JSON.stringify(result).includes('private'))
    assert.ok(!JSON.stringify(result).includes('secret-value'))
  }
})
