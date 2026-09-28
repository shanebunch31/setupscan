import assert from 'node:assert/strict'
import { test } from 'node:test'
import { enrichHistoricalCandles, fetchHistoricalMarketData, reconstructResearchDataset } from './marketData.js'
import { createDatasetId } from '../research/orchestration.js'

function bars(symbol, start, count, base) {
  const startTime = Date.parse(start)
  return Array.from({ length: count }, (_, index) => {
    const close = base + index * 0.25
    return {
      symbol,
      timeframe: '1Hour',
      timestamp: new Date(startTime + index * 60 * 60 * 1000).toISOString(),
      open: close - 0.1,
      high: close + 1,
      low: close - 1,
      close,
      volume: 1000 + index * 10,
    }
  })
}

async function liveFetch(symbol, candles, range) {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      provider: 'ALPACA HISTORICAL',
      symbol,
      timeframe: '1Hour',
      adjustmentMode: 'split',
      start: candles[0]?.timestamp ?? null,
      end: candles.at(-1)?.timestamp ?? null,
      candleCount: candles.length,
      minimumExpectedCandles: 0,
      complete: true,
      candles,
    }),
  })
  try {
    return await fetchHistoricalMarketData(symbol, '1Hour', range)
  } finally {
    globalThis.fetch = originalFetch
  }
}

function persistedDataset(liveResults, symbolOrder) {
  const first = liveResults[symbolOrder[0]]
  const calculationSeries = Object.keys(liveResults).sort().map((symbol) => {
    const result = liveResults[symbol]
    return {
      symbol,
      timeframe: '1Hour',
      candles: result.calculationCandles.map(({ symbol: candleSymbol, timestamp, timeframe, open, high, low, close, volume }) => ({
        symbol: candleSymbol,
        timestamp,
        timeframe,
        open,
        high,
        low,
        close,
        volume,
      })),
    }
  })
  const symbols = Object.fromEntries(symbolOrder.map((symbol) => {
    const result = liveResults[symbol]
    return [symbol, {
      provider: result.provider,
      adjustmentMode: result.adjustmentMode,
      timeframe: result.timeframe,
      requestedStart: result.requestedStart,
      requestedEnd: result.requestedEnd,
      actualStart: result.start,
      actualEnd: result.end,
      calculationStart: result.calculationStart,
      calculationEnd: result.calculationEnd,
      requestedCandleCount: result.requestedCandleCount,
      calculationCandleCount: result.calculationCandleCount,
      complete: result.complete,
    }]
  }))
  return {
    datasetId: createDatasetId(Object.values(liveResults)),
    provider: first.provider,
    adjustmentMode: first.adjustmentMode,
    timeframe: first.timeframe,
    effectiveMetadata: {
      requestedStart: first.requestedStart,
      requestedEnd: first.requestedEnd,
      symbols,
    },
    calculationSeries,
  }
}

test('reconstructs the historical requested/enriched inputs with pre-roll EMA and inclusive bounds', async () => {
  const allBars = bars('SPY', '2026-01-01T00:00:00.000Z', 30, 100)
  const requestedStart = allBars[25].timestamp
  const requestedEnd = allBars[27].timestamp
  const live = await liveFetch('SPY', allBars, { start: requestedStart, end: requestedEnd })
  const canonical = persistedDataset({ SPY: live }, ['SPY'])
  const originalCanonical = structuredClone(canonical)

  const previousFetch = globalThis.fetch
  let networkCalls = 0
  globalThis.fetch = async () => { networkCalls += 1; throw new Error('offline reconstruction must not fetch') }
  let reconstructed
  try {
    reconstructed = reconstructResearchDataset(canonical)
  } finally {
    globalThis.fetch = previousFetch
  }

  assert.equal(networkCalls, 0)
  assert.deepEqual(reconstructed.rawSeriesBySymbol.SPY, live.candles)
  assert.deepEqual(reconstructed.fetchResultsBySymbol.SPY.candles, live.candles)
  assert.equal(reconstructed.rawSeriesBySymbol.SPY[0].timestamp, requestedStart)
  assert.equal(reconstructed.rawSeriesBySymbol.SPY.at(-1).timestamp, requestedEnd)
  assert.ok(reconstructed.fetchResultsBySymbol.SPY.calculationCandles.some(({ timestamp }) => timestamp < requestedStart))
  assert.equal(reconstructed.rawSeriesBySymbol.SPY[0].ema21, live.candles[0].ema21)
  assert.ok(Number.isFinite(reconstructed.rawSeriesBySymbol.SPY[0].ema21))
  const requestedOnlyWithoutPrecomputedMarker = reconstructed.rawSeriesBySymbol.SPY.map((candle) => ({ ...candle }))
  assert.equal(enrichHistoricalCandles(requestedOnlyWithoutPrecomputedMarker)[0].ema21, null)
  assert.equal(reconstructed.rawSeriesBySymbol.SPY[0].vwap, live.candles[0].vwap)
  assert.equal(reconstructed.rawSeriesBySymbol.SPY[0].rsi, live.candles[0].rsi)
  assert.equal(reconstructed.datasetId, canonical.datasetId)
  assert.deepEqual(canonical, originalCanonical)
})

test('reconstruction preserves saved symbol order while keeping each symbol series separate', async () => {
  const requestedStart = '2026-02-01T00:00:00.000Z'
  const requestedEnd = '2026-02-02T00:00:00.000Z'
  const liveResults = {
    QQQ: await liveFetch('QQQ', bars('QQQ', '2026-01-31T00:00:00.000Z', 30, 200), { start: requestedStart, end: requestedEnd }),
    SPY: await liveFetch('SPY', bars('SPY', '2026-01-31T00:00:00.000Z', 30, 100), { start: requestedStart, end: requestedEnd }),
  }
  const canonical = persistedDataset(liveResults, ['QQQ', 'SPY'])
  const reconstructed = reconstructResearchDataset(canonical)

  assert.deepEqual(Object.keys(reconstructed.rawSeriesBySymbol), ['QQQ', 'SPY'])
  assert.deepEqual(reconstructed.rawSeriesBySymbol.QQQ, liveResults.QQQ.candles)
  assert.deepEqual(reconstructed.rawSeriesBySymbol.SPY, liveResults.SPY.candles)
  assert.ok(reconstructed.rawSeriesBySymbol.QQQ.every((candle) => candle.symbol === 'QQQ'))
  assert.ok(reconstructed.rawSeriesBySymbol.SPY.every((candle) => candle.symbol === 'SPY'))
})

test('reconstruction rejects inputs without canonical calculation candles', () => {
  assert.throws(() => reconstructResearchDataset({ datasetId: 'dataset-empty' }), /calculationSeries/)
})
