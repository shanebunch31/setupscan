import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  EMA_CONTRACT_VERSION,
  buildHistoricalMarketDataResult,
  enrichHistoricalCandles,
  fetchHistoricalMarketData,
  historicalFetchRange,
} from './marketData.js'
import { createDatasetId } from '../research/orchestration.js'
import { scanSetups } from '../logic/scanner.js'
import { runSetupScanBacktest } from '../backtest/strategy.js'
import { historicalCandleEndTime } from './historicalDataContract.js'

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

test('enriched candles preserve the requested timeframe', () => {
  const input = candles([100, 101, 102])

  const hourly = enrichHistoricalCandles(input)
  const daily = enrichHistoricalCandles(input, '1Day')
  const fiveMinute = enrichHistoricalCandles(input, '5Min')

  assert.ok(hourly.every((candle) => candle.timeframe === '1Hour'))
  assert.ok(daily.every((candle) => candle.timeframe === '1Day'))
  assert.ok(fiveMinute.every((candle) => candle.timeframe === '5Min'))
})


test('VWAP uses regular-session candles and resets for a new trading day', () => {
  const input = [
    {
      symbol: 'SPY',
      timeframe: '1Hour',
      timestamp: '2026-10-12T14:00:00.000Z',
      open: 100,
      high: 102,
      low: 100,
      close: 101,
      volume: 100,
    },
    {
      symbol: 'SPY',
      timeframe: '1Hour',
      timestamp: '2026-10-12T15:00:00.000Z',
      open: 110,
      high: 112,
      low: 110,
      close: 111,
      volume: 300,
    },
    {
      symbol: 'SPY',
      timeframe: '1Hour',
      timestamp: '2026-10-13T14:00:00.000Z',
      open: 120,
      high: 122,
      low: 120,
      close: 121,
      volume: 200,
    },
  ]

  const enriched = enrichHistoricalCandles(input, '1Hour')

  const firstTypicalPrice = (102 + 100 + 101) / 3
  const secondTypicalPrice = (112 + 110 + 111) / 3
  const expectedSecondVwap =
    (firstTypicalPrice * 100 + secondTypicalPrice * 300) / 400

  assert.ok(Math.abs(enriched[0].vwap - firstTypicalPrice) < 1e-10)
  assert.ok(Math.abs(enriched[1].vwap - expectedSecondVwap) < 1e-10)
  assert.ok(Math.abs(enriched[2].vwap - 121) < 1e-10)
})

function makeSameSlotVolumeSessions(volumes, startDate = '2026-01-01') {
  const [year, month, day] = startDate.split('-').map(Number)
  return volumes.map((volume, index) => ({
    symbol: 'SPY',
    timeframe: '1Hour',
    timestamp: new Date(Date.UTC(year, month - 1, day + index, 15)).toISOString(),
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume,
  }))
}

test('intraday relative volume compares the current bar with the same clock-time in prior sessions', () => {
  const enriched = enrichHistoricalCandles(makeSameSlotVolumeSessions([100, 200, 300, 400, 500, 600, 700]))

  assert.equal(enriched.slice(0, 5).every((candle) => candle.relativeVolume === null), true)
  // First available baseline: (100 + 200 + 300 + 400 + 500) / 5 = 300.
  assert.equal(enriched[5].relativeVolume, 2)
  // The following day uses six earlier sessions: mean 350, current volume 700.
  assert.equal(enriched[6].relativeVolume, 2)
})

test('prepending older sessions does not change a recent candle relative to its latest-20-session baseline', () => {
  const recentVolumes = Array.from({ length: 26 }, (_, index) => 1000 + index * 10)
  recentVolumes[25] = 5000
  const recent = makeSameSlotVolumeSessions(recentVolumes)
  const older = makeSameSlotVolumeSessions(Array(5).fill(100000), '2025-12-27')

  const baselineRelativeVolume = enrichHistoricalCandles(recent).at(-1).relativeVolume
  const extendedRelativeVolume = enrichHistoricalCandles([...older, ...recent]).at(-1).relativeVolume

  assert.equal(baselineRelativeVolume, extendedRelativeVolume)
})

test('daily relative volume uses only the prior daily bars', () => {
  const daily = makeSameSlotVolumeSessions([100, 200, 300, 400, 500, 600, 700])
    .map((candle) => ({ ...candle, timeframe: '1Day' }))
  const enriched = enrichHistoricalCandles(daily, '1Day')

  assert.equal(enriched[5].relativeVolume, 2)
  assert.equal(enriched[6].relativeVolume, 2)
})

test('relative volume identifies its causal prior-bar fallback when same-time sessions are unavailable', () => {
  const input = makeSameSlotVolumeSessions([100, 200, 300, 400, 500, 600], '2026-01-01')
    .map((candle, index) => ({
      ...candle,
      timestamp: new Date(Date.UTC(2026, 0, 1, 15, index * 60)).toISOString(),
    }))
  const enriched = enrichHistoricalCandles(input)

  assert.equal(enriched[5].relativeVolumeMethod, 'prior-bars')
  assert.equal(enriched[5].relativeVolume, 2)
})

test('historical fetch range preserves requested dates for supported timeframes', () => {
  const start = '2026-02-01T00:00:00.000Z'
  const end = '2026-02-02T00:00:00.000Z'

  for (const timeframe of ['1Hour', '1Day', '4Hour', '5Min']) {
    const range = historicalFetchRange({ start, end }, timeframe)

    assert.equal(range.requestedStart, start)
    assert.equal(range.requestedEnd, end)
    assert.ok(Date.parse(range.start) <= Date.parse(start))
    assert.equal(range.end, end)
  }
})


test('historical fetch range applies timeframe-specific warm-up history', () => {
  const start = '2026-02-01T00:00:00.000Z'
  const expectedDays = {
    '1Hour': 30,
    '1Day': 90,
    '4Hour': 60,
    '5Min': 30,
  }

  for (const [timeframe, days] of Object.entries(expectedDays)) {
    const range = historicalFetchRange({ start }, timeframe)
    const expectedStart = new Date(start)
    expectedStart.setUTCDate(expectedStart.getUTCDate() - days)

    assert.equal(range.start, expectedStart.toISOString())
    assert.equal(range.requestedStart, start)
  }
})


test('historical fetch range preserves an open-ended request', () => {
  const range = historicalFetchRange({ start: '2026-02-01T00:00:00.000Z' }, '1Day')

  assert.equal(range.requestedStart, '2026-02-01T00:00:00.000Z')
  assert.equal(range.requestedEnd, null)
  assert.equal(range.end, undefined)
})

test('historical result sorts bars, keeps the first duplicate, and reports input corrections', () => {
  const input = candles([100, 101, 102])
  const duplicate = { ...input[0], close: 99, open: 99, high: 100, low: 98 }
  const result = buildHistoricalMarketDataResult(
    'SPY',
    '1Hour',
    { requestedStart: null, requestedEnd: null },
    { provider: 'fixture', providerRequestId: 'request-1' },
    [input[2], input[0], duplicate, input[1]],
  )

  assert.deepEqual(result.candles.map(({ timestamp }) => timestamp), input.map(({ timestamp }) => timestamp))
  assert.equal(result.candles[0].close, 100)
  assert.equal(result.provider, 'fixture')
  assert.equal(result.providerRequestId, 'request-1')
  assert.deepEqual(result.dataQuality, {
    inputCandleCount: 4,
    outOfOrderCandleCount: 3,
    duplicateCandleCount: 1,
    rejectedCandleCount: 0,
    acceptedCandleCount: 3,
    requestedEndExcludedCandleCount: 0,
  })
})

test('requested end includes only full hourly and five-minute intervals, with timezone-aware daily bounds', () => {
  const hourlyAtBoundary = { timestamp: '2026-03-08T06:00:00Z' }
  assert.equal(historicalCandleEndTime(hourlyAtBoundary.timestamp, '1Hour'), Date.parse('2026-03-08T07:00:00Z'))
  assert.equal(historicalCandleEndTime('2026-03-08T05:00:00Z', '1Day'), Date.parse('2026-03-09T04:00:00Z'))

  const input = candles([100, 101, 102]).map((candle, index) => ({
    ...candle,
    timestamp: ['2026-03-08T14:00:00Z', '2026-03-08T15:00:00Z', '2026-03-08T16:00:00Z'][index],
  }))
  const atMidHour = buildHistoricalMarketDataResult('SPY', '1Hour', {
    requestedStart: '2026-03-08T14:00:00Z', requestedEnd: '2026-03-08T11:30:00-04:00',
  }, {}, input)
  assert.deepEqual(atMidHour.candles.map((candle) => candle.timestamp), ['2026-03-08T14:00:00Z'])
  assert.equal(atMidHour.dataQuality.requestedEndExcludedCandleCount, 2)

  const atExactBoundary = buildHistoricalMarketDataResult('SPY', '1Hour', {
    requestedStart: '2026-03-08T14:00:00Z', requestedEnd: '2026-03-08T16:00:00Z',
  }, {}, input)
  assert.deepEqual(atExactBoundary.candles.map((candle) => candle.timestamp), input.slice(0, 2).map((candle) => candle.timestamp))

  const fiveMinute = buildHistoricalMarketDataResult('SPY', '5Min', {
    requestedStart: null, requestedEnd: '2026-03-08T14:05:00Z',
  }, {}, [
    { ...input[0], timestamp: '2026-03-08T14:00:00Z' },
    { ...input[1], timestamp: '2026-03-08T14:05:00Z' },
  ])
  assert.deepEqual(fiveMinute.candles.map((candle) => candle.timestamp), ['2026-03-08T14:00:00Z'])
})

test('historical result rejects invalid timestamps and OHLCV without fabricating values', () => {
  const input = candles([100, 101, 102, 103])
  input[1] = { ...input[1], open: null }
  input[2] = { ...input[2], volume: Number.NaN }
  input[3] = { ...input[3], timestamp: 'not-a-timestamp' }
  const result = buildHistoricalMarketDataResult(
    'SPY',
    '1Hour',
    { requestedStart: null, requestedEnd: null },
    { provider: 'fixture' },
    input,
  )

  assert.deepEqual(result.candles.map(({ close }) => close), [100])
  assert.equal(result.calculationCandleCount, 1)
  assert.equal(result.dataQuality.rejectedCandleCount, 3)
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

  raw.forEach((candle, index) => {
    // Give each bar a distinct session at the same clock-time so this scanner test has a valid
    // causal relative-volume baseline after its five-session warmup.
    candle.timestamp = new Date(Date.UTC(2026, 0, 1 + index, 15)).toISOString()
    candle.high = candle.close + 0.5
  })
  raw[20].volume = 200

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
    ...candles([112], { start: requestedEnd }),
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
    assert.equal(result.calculationCandles.length, responseCandles.length - 1)
    assert.equal(result.dataQuality.requestedEndExcludedCandleCount, 1)
    assert.equal(Object.keys(result).includes('calculationCandles'), false)
    const changedPreRoll = { ...result }
    const changedCalculationCandles = result.calculationCandles.map((candle, index) => index === 0 ? { ...candle, close: candle.close + 1 } : candle)
    Object.defineProperty(changedPreRoll, 'calculationCandles', { value: changedCalculationCandles })
    assert.notEqual(createDatasetId([result]), createDatasetId([changedPreRoll]))
    assert.ok(result.candles.every((candle) => candle.timestamp >= requestedStart))
    assert.ok(result.calculationCandles.every((candle) => candle.timestamp < requestedEnd))
    assert.ok(Math.abs(result.candles[0].ema21 - (100 + (2 / 22) * 10)) < 1e-10)
    assert.ok(Math.abs(result.candles[1].ema9 - 103.8) < 1e-10)
    assert.equal(result.candles[0].vwap, null)
    assert.equal(enrichHistoricalCandles(result.candles)[0].ema21, result.candles[0].ema21)
    assert.equal(EMA_CONTRACT_VERSION, 'setupscan-ema-sma-seeded-recursive-v1')
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('historical pre-roll provides RSI context for the first requested candle', async () => {
  const requestedStart = '2026-02-01T00:00:00.000Z'
  const requestedEnd = '2026-02-02T00:00:00.000Z'

  const preRoll = candles(
    Array.from({ length: 25 }, (_, index) => 100 + index),
    { start: '2026-01-30T00:00:00.000Z' },
  )

  const responseCandles = [
    ...preRoll,
    ...candles([130, 131], { start: requestedStart }),
  ]

  const previousFetch = globalThis.fetch

  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      provider: 'ALPACA HISTORICAL',
      symbol: 'SPY',
      timeframe: '1Hour',
      start: responseCandles[0].timestamp,
      end: responseCandles.at(-1).timestamp,
      candleCount: responseCandles.length,
      complete: true,
      minimumExpectedCandles: 2,
      candles: responseCandles,
    }),
  })

  try {
    const result = await fetchHistoricalMarketData(
      'SPY',
      '1Hour',
      { start: requestedStart, end: requestedEnd },
    )

    assert.equal(result.candles.length, 2)
    assert.ok(Number.isFinite(result.candles[0].ema21))
    assert.ok(Number.isFinite(result.candles[0].rsi))
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('historical pre-roll supplies causal relative-volume context to the first requested candle', async () => {
  const requestedStart = '2026-02-02T16:00:00.000Z'
  const requestedEnd = '2026-02-02T17:00:00.000Z'
  const preRoll = makeSameSlotVolumeSessions([100, 200, 300, 400, 500], '2026-01-20').map((candle) => ({
    ...candle,
    timestamp: new Date(new Date(candle.timestamp).getTime() + 60 * 60 * 1000).toISOString(),
  }))
  const requested = makeSameSlotVolumeSessions([600], '2026-02-02').map((candle) => ({
    ...candle,
    timestamp: new Date(new Date(candle.timestamp).getTime() + 60 * 60 * 1000).toISOString(),
    open: 110,
    high: 111,
    low: 109,
    close: 110,
  }))
  const currentSessionContext = {
    ...requested[0],
    timestamp: '2026-02-02T15:00:00.000Z',
    open: 99,
    high: 101,
    low: 99,
    close: 100,
    volume: 100,
  }
  const responseCandles = [...preRoll, currentSessionContext, ...requested]
  const previousFetch = globalThis.fetch

  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      provider: 'ALPACA HISTORICAL',
      symbol: 'SPY',
      timeframe: '1Hour',
      start: responseCandles[0].timestamp,
      end: responseCandles.at(-1).timestamp,
      candleCount: responseCandles.length,
      complete: true,
      minimumExpectedCandles: 1,
      candles: responseCandles,
    }),
  })

  try {
    const result = await fetchHistoricalMarketData(
      'SPY',
      '1Hour',
      { start: requestedStart, end: requestedEnd },
    )
    assert.equal(result.candles.length, 1)
    assert.equal(result.candles[0].relativeVolume, 2)
    assert.equal(result.candles[0].relativeVolumeMethod, 'same-time-of-day')
    assert.ok(Math.abs(result.candles[0].vwap - ((100 * 100 + 110 * 600) / 700)) < 1e-9)
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('historical pre-roll preserves breakout context for requested candles', async () => {
  const requestedStart = '2026-02-01T00:00:00.000Z'
  const requestedEnd = '2026-02-02T00:00:00.000Z'

  const preRoll = candles(
    Array(25).fill(100),
    { start: '2026-01-30T00:00:00.000Z' },
  ).map((candle) => ({
    ...candle,
    high: 105,
  }))

  const responseCandles = [
    ...preRoll,
    ...candles([110, 111], { start: requestedStart }),
  ]

  const previousFetch = globalThis.fetch

  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      provider: 'ALPACA HISTORICAL',
      symbol: 'SPY',
      timeframe: '1Hour',
      start: responseCandles[0].timestamp,
      end: responseCandles.at(-1).timestamp,
      candleCount: responseCandles.length,
      complete: true,
      minimumExpectedCandles: 2,
      candles: responseCandles,
    }),
  })

  try {
    const result = await fetchHistoricalMarketData(
      'SPY',
      '1Hour',
      { start: requestedStart, end: requestedEnd },
    )

    assert.equal(result.candles.length, 2)
    assert.equal(result.candles[0].breakout, true)
  } finally {
    globalThis.fetch = previousFetch
  }
})
