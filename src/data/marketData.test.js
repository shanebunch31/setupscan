import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EMA_CONTRACT_VERSION, enrichHistoricalCandles, fetchHistoricalMarketData } from './marketData.js'
import { createDatasetId } from '../research/orchestration.js'
import { scanSetups } from '../logic/scanner.js'
import { runSetupScanBacktest } from '../backtest/strategy.js'

function candles(closes, { start = '2026-01-01T00:00:00.000Z', gaps = [] } = {}) {
  let timestamp = Date.parse(start)
  return closes.map((close, index) => {
    if (gaps.includes(index)) timestamp += 60 * 60 * 1000
    const candle = {
      symbol: 'SPY', timeframe: '1Hour', timestamp: new Date(timestamp).toISOString(),
      open: close, high: close + 1, low: close - 1, close, volume: 100,
    }
    timestamp += 60 * 60 * 1000
    return candle
  })
}

test('EMA9 uses an SMA seed followed by recursive 2/(N+1) updates', () => {
  const enriched = enrichHistoricalCandles(candles(Array.from({ length: 11 }, (_, index) => index + 1)))
  assert.equal(enriched[7].ema9, null)
  assert.equal(enriched[8].ema9, 5)
  assert.equal(enriched[9].ema9, 6)
  assert.ok(Math.abs(enriched[10].ema9 - 7) < 1e-12)
})

test('EMA21 uses an SMA seed followed by recursive 2/(N+1) updates', () => {
  const enriched = enrichHistoricalCandles(candles(Array.from({ length: 23 }, (_, index) => index + 1)))
  assert.equal(enriched[19].ema21, null)
  assert.equal(enriched[20].ema21, 11)
  assert.equal(enriched[21].ema21, 12)
  assert.equal(enriched[22].ema21, 13)
})

test('insufficient seed history remains unavailable without a shortened EMA', () => {
  const enriched = enrichHistoricalCandles(candles(Array.from({ length: 20 }, (_, index) => index + 1)))
  assert.ok(Number.isFinite(enriched.at(-1).ema9))
  assert.equal(enriched.at(-1).ema21, null)
  assert.equal(enriched.at(-1).trend, 'Neutral')
})

test('a candle without a close does not count toward the SMA seed', () => {
  const input = candles(Array.from({ length: 21 }, (_, index) => index + 1))
  input[10] = { ...input[10], close: null }
  const enriched = enrichHistoricalCandles(input)
  assert.equal(enriched.at(-1).ema21, null)
})

test('missing hourly bars are not interpolated and EMA updates once per observed close', () => {
  const enriched = enrichHistoricalCandles(candles(Array.from({ length: 10 }, (_, index) => index + 1), { gaps: [9] }))
  assert.equal(enriched.length, 10)
  assert.equal(enriched[8].ema9, 5)
  assert.equal(enriched[9].ema9, 6)
})

test('equal EMAs produce neutral trend; strict ordering produces bullish or bearish trend', () => {
  const flat = enrichHistoricalCandles(candles(Array(21).fill(100)))
  assert.equal(flat.at(-1).ema9, flat.at(-1).ema21)
  assert.equal(flat.at(-1).trend, 'Neutral')

  const rising = enrichHistoricalCandles(candles(Array.from({ length: 30 }, (_, index) => index + 1)))
  assert.ok(rising.at(-1).ema9 > rising.at(-1).ema21)
  assert.equal(rising.at(-1).trend, 'Bullish')

  const falling = enrichHistoricalCandles(candles(Array.from({ length: 30 }, (_, index) => 30 - index)))
  assert.ok(falling.at(-1).ema9 < falling.at(-1).ema21)
  assert.equal(falling.at(-1).trend, 'Bearish')
})

test('scanner and baseline backtest use the recursive EMA contract and leave warmup signals unqualified', () => {
  const closes = [
  100, 101, 100.5, 102, 101.5, 103,
  102, 103.5, 102.5, 104, 103, 104.5,
  103.5, 105, 104, 105.5, 104.5, 106,
  105, 106.5, 108, 107.2, 108.5, 109,
]

  const raw = candles(closes)

  raw.forEach((candle) => {
    candle.high = candle.close + 0.5
  })

  const enriched = enrichHistoricalCandles(raw)
  const scanned = scanSetups(enriched)

  assert.ok(scanned[0].timestamp >= raw[20].timestamp)
  assert.equal(
    scanned[0].reasons.find(({ label }) => label === 'EMA alignment').points,
    20,
  )
  assert.equal(
    scanned.at(-1).reasons.find(({ label }) => label === 'EMA alignment').points,
    0,
  )

  const backtest = runSetupScanBacktest(enriched)

  assert.ok(backtest.trades.length > 0)
  assert.ok(
    backtest.trades.every(
      (trade) => trade.timestamp >= raw[20].timestamp,
    ),
  )
})

test('historical pre-roll seeds EMAs but only requested-range candles are returned', async () => {
  const requestedStart = '2026-02-01T00:00:00.000Z'
  const requestedEnd = '2026-02-02T00:00:00.000Z'
  const preRoll = candles(Array(25).fill(100), { start: '2026-01-30T00:00:00.000Z' })
  const responseCandles = [
    ...preRoll,
    ...candles([110, 111], { start: requestedStart }),
  ]
  const previousFetch = globalThis.fetch
  let requestedUrl
  globalThis.fetch = async (url) => {
    requestedUrl = new URL(url, 'http://localhost')
    return {
      ok: true,
      json: async () => ({
        provider: 'ALPACA HISTORICAL', symbol: 'SPY', timeframe: '1Hour',
        start: responseCandles[0].timestamp, end: responseCandles.at(-1).timestamp,
        candleCount: responseCandles.length, complete: true, minimumExpectedCandles: 20,
        candles: responseCandles,
      }),
    }
  }

  try {
    const result = await fetchHistoricalMarketData('SPY', '1Hour', { start: requestedStart, end: requestedEnd })
    assert.equal(requestedUrl.searchParams.get('start'), '2026-01-02T00:00:00.000Z')
    assert.equal(result.requestedStart, requestedStart)
    assert.equal(result.candles.length, 2)
    assert.equal(result.calculationCandles.length, responseCandles.length)
    assert.equal(Object.keys(result).includes('calculationCandles'), false)
    const changedPreRoll = { ...result }
    const changedCalculationCandles = result.calculationCandles.map((candle, index) => index === 0 ? { ...candle, close: candle.close + 1 } : candle)
    Object.defineProperty(changedPreRoll, 'calculationCandles', { value: changedCalculationCandles })
    assert.notEqual(createDatasetId([result]), createDatasetId([changedPreRoll]))
    assert.ok(result.candles.every((candle) => candle.timestamp >= requestedStart))
    assert.ok(Math.abs(result.candles[0].ema21 - (100 + (2 / 22) * 10)) < 1e-10)
    assert.ok(Math.abs(result.candles[1].ema9 - 103.8) < 1e-10)
    assert.equal(result.candles[0].vwap, 110)
    assert.equal(enrichHistoricalCandles(result.candles)[0].ema21, result.candles[0].ema21)
    assert.equal(EMA_CONTRACT_VERSION, 'setupscan-ema-sma-seeded-recursive-v1')
  } finally {
    globalThis.fetch = previousFetch
  }
})
