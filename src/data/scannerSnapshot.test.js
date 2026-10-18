
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createScannerRange, fetchScannerSnapshot, isSuccessfulScannerRefresh, scannerDataQualityNotices } from './scannerSnapshot.js'

const range = { start: '2026-09-01T00:00:00.000Z', end: '2026-09-02T00:00:00.000Z' }
const fixedNow = () => new Date('2026-09-03T12:00:00.000Z')

test('scanner refresh ranges use the current time instead of a stale mount-time cutoff', () => {
  assert.deepEqual(createScannerRange(new Date('2026-09-10T12:00:00.000Z')), {
    start: '2026-09-03T12:00:00.000Z',
    end: '2026-09-10T12:00:00.000Z',
  })
})

test('scanner surfaces only reported historical candle quality issues', () => {
  assert.deepEqual(scannerDataQualityNotices([
    {
      symbol: 'SPY',
      dataQuality: {
        hourly: { outOfOrderCandleCount: 1, duplicateCandleCount: 0, rejectedCandleCount: 2, requestedEndExcludedCandleCount: 1 },
        fiveMinute: null,
      },
    },
    { symbol: 'QQQ', dataQuality: { hourly: null, fiveMinute: null } },
  ]), [
    'SPY hourly data: 1 out-of-order bar reordered, 2 invalid bars rejected, 1 bar excluded because they extended past the requested cutoff.',
  ])
})

function candle(symbol, timestamp, close, volume = 100) {
  return { symbol, timestamp, open: close, high: close + 1, low: close - 1, close, volume }
}


function regularSessionCandles(symbol, start, end, close = 100) {
  const candles = []
  const startMs = new Date(start).getTime()
  const endMs = new Date(end).getTime()

  for (
    let timestamp = startMs;
    timestamp < endMs;
    timestamp += 5 * 60 * 1000
  ) {
    candles.push(
      candle(symbol, new Date(timestamp).toISOString(), close),
    )
  }

  return candles
}


test('scanner requests hourly indicators and five-minute VWAP data for each symbol', async () => {
  const calls = []
  const entries = await fetchScannerSnapshot(['SPY', 'QQQ'], range, async (...args) => {
    calls.push(args)
    return {
  candles: args[1] === '1Hour'
    ? [candle(args[0], '2026-09-01T14:00:00.000Z', 100)]
    : [],
}
  }, fixedNow)

  assert.deepEqual(calls, [
    ['SPY', '1Hour', range],
    ['QQQ', '1Hour', range],
    ['SPY', '5Min', range],
    ['QQQ', '5Min', range],
  ])
  assert.deepEqual(entries.map(({ symbol, available }) => ({ symbol, available })), [
    { symbol: 'SPY', available: true },
    { symbol: 'QQQ', available: true },
  ])
  assert.equal(entries[0].snapshot.price, 100)
  assert.equal(entries[0].snapshot.vwap, null)
  assert.equal(isSuccessfulScannerRefresh(entries), true)
})

test('scanner carries hourly and five-minute data-quality counts to its result', async () => {
  const entries = await fetchScannerSnapshot(['SPY'], range, async (_symbol, timeframe) => ({
    candles: timeframe === '1Hour' ? [candle('SPY', '2026-09-03T10:00:00.000Z', 100)] : [],
    dataQuality: timeframe === '1Hour'
      ? { rejectedCandleCount: 1 }
      : { duplicateCandleCount: 2 },
  }), () => new Date('2026-09-03T11:00:00.000Z'))

  assert.deepEqual(entries[0].dataQuality, {
    hourly: { rejectedCandleCount: 1 },
    fiveMinute: { duplicateCandleCount: 2 },
  })
})

test('scanner refresh retains per-symbol unavailability when an hourly historical request fails', async () => {
  const entries = await fetchScannerSnapshot(['SPY', 'QQQ'], range, async (symbol, timeframe) => {
    if (symbol === 'QQQ' && timeframe === '1Hour') throw new Error('provider unavailable')
    return { candles: [candle(symbol, '2026-09-01T14:00:00.000Z', 100)] }
  }, fixedNow)

  assert.deepEqual(entries.map(({ symbol, available }) => ({ symbol, available })), [
    { symbol: 'SPY', available: true },
    { symbol: 'QQQ', available: false },
  ])
  assert.equal(isSuccessfulScannerRefresh(entries), true)
  assert.equal(isSuccessfulScannerRefresh([{ symbol: 'SPY', available: false }]), false)
})

test('scanner uses the previous completed hourly candle when the newest is still forming', async () => {
  const entries = await fetchScannerSnapshot(['SPY'], range, async (_symbol, timeframe) => ({
    candles: timeframe === '1Hour'
      ? [
          candle('SPY', '2026-09-03T09:00:00.000Z', 100),
          candle('SPY', '2026-09-03T10:00:00.000Z', 110),
        ]
      : [],
  }), () => new Date('2026-09-03T10:30:00.000Z'))

  assert.equal(entries[0].available, true)
  assert.equal(entries[0].snapshot.price, 100)
  assert.equal(entries[0].snapshot.vwap, null)
})

test('scanner uses the newest hourly candle when its interval has completed', async () => {
  const entries = await fetchScannerSnapshot(['SPY'], range, async (_symbol, timeframe) => ({
    candles: timeframe === '1Hour'
      ? [candle('SPY', '2026-09-03T10:00:00.000Z', 110)]
      : [],
  }), () => new Date('2026-09-03T11:00:00.000Z'))

  assert.equal(entries[0].available, true)
  assert.equal(entries[0].snapshot.price, 110)
})

test('scanner reports unavailable when all supplied hourly candles are still forming', async () => {
  const entries = await fetchScannerSnapshot(['SPY'], range, async (_symbol, timeframe) => ({
    candles: timeframe === '1Hour'
      ? [
          candle('SPY', '2026-09-03T10:00:00.000Z', 100),
          candle('SPY', '2026-09-03T11:00:00.000Z', 110),
        ]
      : [],
  }), () => new Date('2026-09-03T10:30:00.000Z'))

  assert.deepEqual(entries, [{
    symbol: 'SPY',
    available: false,
    dataQuality: { hourly: null, fiveMinute: null },
  }])
})

test('scanner does not score a partial historical window explicitly marked incomplete', async () => {
  const entries = await fetchScannerSnapshot(['SPY'], range, async () => ({
    complete: false,
    candles: [candle('SPY', '2026-09-03T10:00:00.000Z', 100)],
    dataQuality: { acceptedCandleCount: 1 },
  }), () => new Date('2026-09-03T11:00:00.000Z'))

  assert.equal(entries[0].available, false)
  assert.match(entries[0].error, /historical hourly candle set is incomplete/i)
  assert.deepEqual(entries[0].dataQuality, {
    hourly: { acceptedCandleCount: 1 },
    fiveMinute: null,
  })
  assert.deepEqual(scannerDataQualityNotices(entries), [
    'SPY: the historical hourly data set is incomplete, so no scanner score was produced.',
  ])
})


test('scanner calculates VWAP from completed five-minute candles available by the hourly close', async () => {
  const entries = await fetchScannerSnapshot(['SPY'], range, async (_symbol, timeframe) => ({
    candles: timeframe === '1Hour'
      ? [candle('SPY', '2026-09-03T13:00:00.000Z', 105)]
      : [
          ...regularSessionCandles(
            'SPY',
            '2026-09-03T13:30:00.000Z',
            '2026-09-03T14:00:00.000Z',
            100,
          ).map((item, index) => ({
            ...item,
            close: index % 2 === 0 ? 100 : 110,
            open: index % 2 === 0 ? 100 : 110,
            high: (index % 2 === 0 ? 100 : 110) + 1,
            low: (index % 2 === 0 ? 100 : 110) - 1,
            volume: index % 2 === 0 ? 100 : 300,
          })),
          candle('SPY', '2026-09-03T14:00:00.000Z', 200, 1000),
        ],
  }), () => new Date('2026-09-03T14:30:00.000Z'))

  assert.equal(entries[0].available, true)

  // The hourly candle ends at 14:00Z. The five-minute candle starting
  // at 14:00Z finishes after that cutoff and must be excluded.
  const completedCandles = regularSessionCandles(
    'SPY',
    '2026-09-03T13:30:00.000Z',
    '2026-09-03T14:00:00.000Z',
    100,
  ).map((item, index) => ({
    ...item,
    close: index % 2 === 0 ? 100 : 110,
    open: index % 2 === 0 ? 100 : 110,
    high: (index % 2 === 0 ? 100 : 110) + 1,
    low: (index % 2 === 0 ? 100 : 110) - 1,
    volume: index % 2 === 0 ? 100 : 300,
  }))

  const totalVolume = completedCandles.reduce(
    (sum, item) => sum + item.volume,
    0,
  )
  const expectedVwap = completedCandles.reduce(
    (sum, item) =>
      sum + ((item.high + item.low + item.close) / 3) * item.volume,
    0,
  ) / totalVolume

  assert.ok(Math.abs(entries[0].snapshot.vwap - expectedVwap) < 1e-10)
})

test('calculates VWAP correctly when five-minute candles arrive out of order', async () => {
  const now = new Date('2026-10-12T15:00:00.000Z')

  const completeCandles = regularSessionCandles(
    'SPY',
    '2026-10-12T13:30:00.000Z',
    '2026-10-12T15:00:00.000Z',
  )

  const candles = [...completeCandles].reverse()

  const fetchData = async (_symbol, timeframe) => ({
    candles: timeframe === '1Hour'
      ? [
          {
            timestamp: '2026-10-12T14:00:00.000Z',
            open: 100,
            high: 115,
            low: 99,
            close: 111,
            volume: 300,
          },
        ]
      : candles,
  })

  const results = await fetchScannerSnapshot(
    ['SPY'],
    { start: '2026-10-12T00:00:00.000Z', end: now.toISOString() },
    fetchData,
    () => now,
  )

  assert.equal(results[0].available, true)
  assert.ok(Number.isFinite(results[0].snapshot.vwap))
  assert.ok(results[0].snapshot.vwap > 0)
})

test('scanner keeps the hourly snapshot available when the five-minute request fails', async () => {
  const entries = await fetchScannerSnapshot(['SPY'], range, async (_symbol, timeframe) => {
    if (timeframe === '5Min') throw new Error('five-minute data unavailable')
    return { candles: [candle('SPY', '2026-09-03T13:00:00.000Z', 105)] }
  }, () => new Date('2026-09-03T14:30:00.000Z'))

  assert.equal(entries[0].available, true)
  assert.equal(entries[0].snapshot.price, 105)
  assert.equal(entries[0].snapshot.vwap, null)
})


test('scanner rejects VWAP when the opening five-minute candle is missing', async () => {
  const now = new Date('2026-10-12T15:00:00.000Z')
  const candles = regularSessionCandles(
    'SPY',
    '2026-10-12T13:30:00.000Z',
    '2026-10-12T15:00:00.000Z',
  ).slice(1)

  const results = await fetchScannerSnapshot(
    ['SPY'],
    range,
    async (_symbol, timeframe) => ({
      candles: timeframe === '1Hour'
        ? [candle('SPY', '2026-10-12T14:00:00.000Z', 111)]
        : candles,
    }),
    () => now,
  )

  assert.equal(results[0].available, true)
  assert.equal(results[0].snapshot.vwap, null)
})

test('scanner rejects VWAP when a middle five-minute candle is missing', async () => {
  const now = new Date('2026-10-12T15:00:00.000Z')
  const candles = regularSessionCandles(
    'SPY',
    '2026-10-12T13:30:00.000Z',
    '2026-10-12T15:00:00.000Z',
  )
  candles.splice(6, 1)

  const results = await fetchScannerSnapshot(
    ['SPY'],
    range,
    async (_symbol, timeframe) => ({
      candles: timeframe === '1Hour'
        ? [candle('SPY', '2026-10-12T14:00:00.000Z', 111)]
        : candles,
    }),
    () => now,
  )

  assert.equal(results[0].available, true)
  assert.equal(results[0].snapshot.vwap, null)
})

test('scanner rejects VWAP when the final completed five-minute candle is missing', async () => {
  const now = new Date('2026-10-12T15:00:00.000Z')
  const candles = regularSessionCandles(
    'SPY',
    '2026-10-12T13:30:00.000Z',
    '2026-10-12T15:00:00.000Z',
  )
  candles.pop()

  const results = await fetchScannerSnapshot(
    ['SPY'],
    range,
    async (_symbol, timeframe) => ({
      candles: timeframe === '1Hour'
        ? [candle('SPY', '2026-10-12T14:00:00.000Z', 111)]
        : candles,
    }),
    () => now,
  )

  assert.equal(results[0].available, true)
  assert.equal(results[0].snapshot.vwap, null)
})


test('scanner calculates VWAP when the evaluation cutoff contains seconds and milliseconds', async () => {
  const hourlyCandle = candle(
    'SPY',
    '2026-10-12T14:00:30.500Z',
    105,
  )

  const fiveMinuteCandles = regularSessionCandles(
    'SPY',
    '2026-10-12T13:30:00.000Z',
    '2026-10-12T15:00:00.000Z',
  )

  const results = await fetchScannerSnapshot(
    ['SPY'],
    range,
    async (_symbol, timeframe) => ({
      candles: timeframe === '1Hour'
        ? [hourlyCandle]
        : fiveMinuteCandles,
    }),
    () => new Date('2026-10-12T16:00:30.500Z'),
  )

  assert.equal(results[0].available, true)
  assert.ok(Number.isFinite(results[0].snapshot.vwap))
})

test('scanner rejects VWAP after market close when a regular-session candle is missing', async () => {
  const hourlyCandle = candle(
    'SPY',
    '2026-10-12T19:00:00.000Z',
    105,
  )

  const fiveMinuteCandles = regularSessionCandles(
    'SPY',
    '2026-10-12T13:30:00.000Z',
    '2026-10-12T20:00:00.000Z',
  )

  // Remove a candle from the middle of the regular trading session.
  fiveMinuteCandles.splice(30, 1)

  const results = await fetchScannerSnapshot(
    ['SPY'],
    range,
    async (_symbol, timeframe) => ({
      candles: timeframe === '1Hour'
        ? [hourlyCandle]
        : fiveMinuteCandles,
    }),
    () => new Date('2026-10-12T20:00:00.000Z'),
  )

  assert.equal(results[0].available, true)
  assert.equal(results[0].snapshot.vwap, null)
})
