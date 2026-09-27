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
