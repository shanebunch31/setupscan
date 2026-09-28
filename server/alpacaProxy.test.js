import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fetchAlpacaHistoricalBars } from './alpacaProxy.js'

test('historical Alpaca requests use split adjustment and expose the mode in fetch metadata', async () => {
  const originalFetch = globalThis.fetch
  const originalKey = process.env.ALPACA_API_KEY
  const originalSecret = process.env.ALPACA_API_SECRET
  let requestUrl
  process.env.ALPACA_API_KEY = 'test-key'
  process.env.ALPACA_API_SECRET = 'test-secret'
  globalThis.fetch = async (url) => {
    requestUrl = new URL(url)
    return { ok: true, json: async () => ({ bars: [{ t: '2026-01-02T14:00:00Z', o: '1', h: '2', l: '0.5', c: '1.5', v: '10' }] }) }
  }

  try {
    const result = await fetchAlpacaHistoricalBars({ symbol: 'SPY' })
    assert.equal(requestUrl.searchParams.get('adjustment'), 'split')
    assert.equal(requestUrl.searchParams.get('feed'), 'iex')
    assert.equal(result.adjustmentMode, 'split')
  } finally {
    globalThis.fetch = originalFetch
    if (originalKey === undefined) delete process.env.ALPACA_API_KEY
    else process.env.ALPACA_API_KEY = originalKey
    if (originalSecret === undefined) delete process.env.ALPACA_API_SECRET
    else process.env.ALPACA_API_SECRET = originalSecret
  }
})

test('current 1Hour requests exclude forming bars and include the exact completion boundary', async () => {
  const originalFetch = globalThis.fetch
  const originalKey = process.env.ALPACA_API_KEY
  const originalSecret = process.env.ALPACA_API_SECRET
  let requestUrl
  process.env.ALPACA_API_KEY = 'test-key'
  process.env.ALPACA_API_SECRET = 'test-secret'
  globalThis.fetch = async (url) => {
    requestUrl = new URL(url)
    return {
      ok: true,
      json: async () => ({ bars: [
        { t: '2026-09-03T09:00:00Z', o: '1', h: '2', l: '0.5', c: '1.5', v: '10' },
        { t: '2026-09-03T10:00:00Z', o: '2', h: '3', l: '1.5', c: '2.5', v: '20' },
        { t: '2026-09-03T11:00:00Z', o: '3', h: '4', l: '2.5', c: '3.5', v: '30' },
      ] }),
    }
  }

  try {
    const result = await fetchAlpacaHistoricalBars({
      symbol: 'SPY', timeframe: '1Hour', now: () => new Date('2026-09-03T11:00:00Z'),
    })
    assert.equal(requestUrl.searchParams.has('start'), false)
    assert.equal(requestUrl.searchParams.has('end'), false)
    assert.deepEqual(result.candles.map(({ timestamp }) => timestamp), ['2026-09-03T09:00:00Z', '2026-09-03T10:00:00Z'])
    assert.equal(result.candleCount, 2)
    assert.equal(result.end, '2026-09-03T10:00:00Z')
    assert.deepEqual(Object.keys(result.candles[0]), ['symbol', 'timeframe', 'timestamp', 'open', 'high', 'low', 'close', 'volume'])
  } finally {
    globalThis.fetch = originalFetch
    if (originalKey === undefined) delete process.env.ALPACA_API_KEY
    else process.env.ALPACA_API_KEY = originalKey
    if (originalSecret === undefined) delete process.env.ALPACA_API_SECRET
    else process.env.ALPACA_API_SECRET = originalSecret
  }
})

test('past-range 1Hour requests retain completed candles and their requested bounds', async () => {
  const originalFetch = globalThis.fetch
  const originalKey = process.env.ALPACA_API_KEY
  const originalSecret = process.env.ALPACA_API_SECRET
  let requestUrl
  process.env.ALPACA_API_KEY = 'test-key'
  process.env.ALPACA_API_SECRET = 'test-secret'
  globalThis.fetch = async (url) => {
    requestUrl = new URL(url)
    return {
      ok: true,
      json: async () => ({ bars: [
        { t: '2026-06-02T14:00:00Z', o: '1', h: '2', l: '0.5', c: '1.5', v: '10' },
        { t: '2026-06-02T15:00:00Z', o: '2', h: '3', l: '1.5', c: '2.5', v: '20' },
      ] }),
    }
  }

  try {
    const start = '2026-06-02T00:00:00Z'
    const end = '2026-06-03T00:00:00Z'
    const result = await fetchAlpacaHistoricalBars({
      symbol: 'SPY', timeframe: '1Hour', start, end, now: () => new Date('2026-09-03T11:30:00Z'),
    })
    assert.equal(requestUrl.searchParams.get('start'), start)
    assert.equal(requestUrl.searchParams.get('end'), end)
    assert.deepEqual(result.candles.map(({ timestamp }) => timestamp), ['2026-06-02T14:00:00Z', '2026-06-02T15:00:00Z'])
    assert.equal(result.requestedStart, start)
    assert.equal(result.requestedEnd, end)
  } finally {
    globalThis.fetch = originalFetch
    if (originalKey === undefined) delete process.env.ALPACA_API_KEY
    else process.env.ALPACA_API_KEY = originalKey
    if (originalSecret === undefined) delete process.env.ALPACA_API_SECRET
    else process.env.ALPACA_API_SECRET = originalSecret
  }
})

test('non-hourly historical requests do not apply the hourly completion filter', async () => {
  const originalFetch = globalThis.fetch
  const originalKey = process.env.ALPACA_API_KEY
  const originalSecret = process.env.ALPACA_API_SECRET
  let requestUrl
  process.env.ALPACA_API_KEY = 'test-key'
  process.env.ALPACA_API_SECRET = 'test-secret'
  globalThis.fetch = async (url) => {
    requestUrl = new URL(url)
    return {
      ok: true,
      json: async () => ({ bars: [{ t: '2026-09-03T11:00:00Z', o: '1', h: '2', l: '0.5', c: '1.5', v: '10' }] }),
    }
  }

  try {
    const result = await fetchAlpacaHistoricalBars({
      symbol: 'SPY', timeframe: '1Day', now: () => new Date('2026-09-03T11:30:00Z'),
    })
    assert.equal(requestUrl.searchParams.get('timeframe'), '1Day')
    assert.equal(result.candleCount, 1)
    assert.equal(result.candles[0].timestamp, '2026-09-03T11:00:00Z')
  } finally {
    globalThis.fetch = originalFetch
    if (originalKey === undefined) delete process.env.ALPACA_API_KEY
    else process.env.ALPACA_API_KEY = originalKey
    if (originalSecret === undefined) delete process.env.ALPACA_API_SECRET
    else process.env.ALPACA_API_SECRET = originalSecret
  }
})
