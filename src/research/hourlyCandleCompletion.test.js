import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fetchAlpacaHistoricalBars } from '../../server/alpacaProxy.js'
import { fetchHistoricalMarketData } from '../data/marketData.js'
import { createDatasetId, createResearchRunContext, executeResearchRun } from './orchestration.js'

const fixedNow = new Date('2026-09-03T11:30:00Z')
const environment = { ALPACA_API_KEY: 'test-key', ALPACA_API_SECRET: 'test-secret' }

function alpacaBars(formingClose = '102') {
  return [
    { t: '2026-08-10T10:00:00Z', o: '98', h: '101', l: '97', c: '100', v: '1000' },
    { t: '2026-09-03T10:00:00Z', o: '99', h: '101', l: '98', c: '100', v: '1100' },
    { t: '2026-09-03T11:00:00Z', o: '100', h: formingClose, l: '99', c: formingClose, v: '1200' },
  ]
}

async function fetchResearchData(bars, range = { start: '2026-09-03T00:00:00Z' }) {
  const originalFetch = globalThis.fetch
  let proxyResult
  try {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ bars }) })
    proxyResult = await fetchAlpacaHistoricalBars({
      symbol: 'SPY', timeframe: '1Hour', ...range, environment, now: () => fixedNow,
    })

    globalThis.fetch = async () => ({ ok: true, json: async () => proxyResult })
    return await fetchHistoricalMarketData('SPY', '1Hour', range)
  } finally {
    globalThis.fetch = originalFetch
  }
}

test('Research excludes a forming hourly bar from requested and calculation candles and dataset identity', async () => {
  const first = await fetchResearchData(alpacaBars('102'))
  const second = await fetchResearchData(alpacaBars('999'))

  assert.deepEqual(first.candles.map(({ timestamp }) => timestamp), ['2026-09-03T10:00:00Z'])
  assert.deepEqual(first.calculationCandles.map(({ timestamp }) => timestamp), [
    '2026-08-10T10:00:00Z',
    '2026-09-03T10:00:00Z',
  ])
  assert.ok(first.candles.every(({ timestamp }) => timestamp !== '2026-09-03T11:00:00Z'))
  assert.ok(first.calculationCandles.every(({ timestamp }) => timestamp !== '2026-09-03T11:00:00Z'))
  assert.equal(createDatasetId([first]), createDatasetId([second]))
})

test('no completed hourly candles produce an unavailable Research symbol and no experiment execution', async () => {
  const originalFetch = globalThis.fetch
  let experimentCalls = 0
  let fetchResult
  try {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ bars: [
        { t: '2026-09-03T11:00:00Z', o: '100', h: '102', l: '99', c: '101', v: '1200' },
      ] }),
    })
    fetchResult = await fetchAlpacaHistoricalBars({
      symbol: 'SPY', timeframe: '1Hour', environment, now: () => fixedNow,
    })
  } finally {
    globalThis.fetch = originalFetch
  }

  assert.deepEqual(fetchResult.candles, [])
  assert.equal(fetchResult.candleCount, 0)
  const result = await executeResearchRun(
    createResearchRunContext({ symbols: ['SPY'], timeframe: '1Hour', requestedExperiments: ['robustness'] }),
    {
      fetchHistoricalMarketData: async () => fetchResult,
      executeResearchExperiment: async () => { experimentCalls += 1 },
    },
  )
  assert.equal(result.status, 'unavailable')
  assert.equal(result.fetchStatus, 'unavailable')
  assert.equal(result.dataset, null)
  assert.equal(result.experimentResults[0].status, 'unavailable')
  assert.equal(experimentCalls, 0)
})
