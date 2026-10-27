
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createScannerRange, fetchScannerSnapshot, isSuccessfulScannerRefresh, scannerDataQualityNotices, diagnoseScannerVwap } from './scannerSnapshot.js'
import { scanSetups } from '../logic/scanner.js'

const range = { start: '2026-09-01T00:00:00.000Z', end: '2026-09-02T00:00:00.000Z' }
const fixedNow = () => new Date('2026-09-03T12:00:00.000Z')

const incidentCutoff = '2026-10-27T17:00:00.000Z'
const incidentBars = () => regularSessionCandles('SPY', '2026-10-27T13:30:00.000Z', incidentCutoff)

test('1:05 PM scanner uses 42 completed session bars and makes VWAP evaluable without changing scoring', async () => {
  const entries = await fetchScannerSnapshot(['SPY', 'QQQ', 'IWM', 'NVDA', 'AMD'], {}, async (symbol, timeframe) => ({
    candles: timeframe === '1Hour'
      ? [candle(symbol, '2026-10-27T16:00:00.000Z', 105)]
      : incidentBars(),
  }), () => new Date('2026-10-27T17:05:00.000Z'))
  for (const entry of entries) {
    assert.equal(entry.snapshot.vwap, 100)
    assert.equal(entry.vwapDiagnostic.status, 'AVAILABLE')
    assert.equal(entry.vwapDiagnostic.evaluationTime, incidentCutoff)
    assert.equal(entry.vwapDiagnostic.usedCandleCount, 42)
    assert.equal(entry.vwapDiagnostic.latestIncludedCandle, '2026-10-27T16:55:00.000Z')
    assert.equal(entry.vwapDiagnostic.latestIncludedCandleEnd, incidentCutoff)
    const scored = scanSetups([entry.snapshot])[0]
    assert.equal(scored.reasons.find(r => r.label === 'Price vs VWAP').points, 20)
    assert.deepEqual(entry.snapshot.vwapDiagnostic, entry.vwapDiagnostic)
  }
})

test('VWAP diagnostics distinguish empty, wrong-day, unfinished and pre-session evidence', () => {
  assert.equal(diagnoseScannerVwap({ candles: [] }, incidentCutoff).reason, 'EMPTY_RESPONSE')
  assert.equal(diagnoseScannerVwap({ candles: [candle('SPY', '2026-10-26T14:00:00Z', 100)] }, incidentCutoff).reason, 'NO_SAME_EASTERN_DATE')
  assert.equal(diagnoseScannerVwap({ candles: [candle('SPY', incidentCutoff, 100)] }, incidentCutoff).reason, 'NO_COMPLETED_CANDLES')
  assert.equal(diagnoseScannerVwap({ candles: [candle('SPY', '2026-10-27T12:00:00Z', 100)] }, '2026-10-27T13:00:00Z').reason, 'NO_COMPLETED_REGULAR_SESSION_CANDLES')
})

test('VWAP diagnostics exclude future and extended-hours bars and preserve complete-session calculation', () => {
  const bars = [...incidentBars(), candle('SPY', incidentCutoff, 900), candle('SPY', '2026-10-27T17:05:00Z', 900), candle('SPY', '2026-10-27T12:00:00Z', 900)]
  const result = diagnoseScannerVwap({ candles: bars }, incidentCutoff)
  assert.equal(result.returnedCandleCount, 45)
  assert.equal(result.completedCandleCount, 43)
  assert.equal(result.usedCandleCount, 42)
  assert.equal(result.vwap, 100)
})

test('VWAP retains missing-opening, middle and final-slot protection with an observable reason', () => {
  for (const index of [0, 20, 41]) {
    const bars = incidentBars().filter((_, i) => i !== index)
    const result = diagnoseScannerVwap({ candles: bars }, incidentCutoff)
    assert.equal(result.reason, 'MISSING_OR_INVALID_SESSION_BARS')
    assert.equal(result.vwap, null)
    assert.equal(result.usedCandleCount, 0)
    assert.equal(result.missingSessionSlots.length, 1)
    assert.equal(result.missingSessionSlots[0], ['09:30', '11:10', '12:55'][[0, 20, 41].indexOf(index)])
  }
})

test('VWAP validates malformed rows and deduplicates timestamps before calculation', () => {
  const bars = incidentBars()
  const valid = diagnoseScannerVwap({ candles: [...bars, bars[0], { timestamp: 'invalid' }] }, incidentCutoff)
  assert.equal(valid.vwap, 100)
  assert.equal(valid.validation.duplicateCandleCount, 1)
  assert.equal(valid.validation.rejectedCandleCount, 1)
  const invalid = bars.map((c, i) => i === 20 ? { ...c, low: c.high + 1 } : c)
  assert.equal(diagnoseScannerVwap({ candles: invalid }, incidentCutoff).reason, 'MISSING_OR_INVALID_SESSION_BARS')
})

test('VWAP keeps provider completeness distinct from exact session coverage and rejects explicit stale data', () => {
  const partial = diagnoseScannerVwap({ candles: incidentBars(), complete: false }, incidentCutoff)
  assert.equal(partial.providerComplete, false)
  assert.equal(partial.vwap, 100)
  assert.equal(diagnoseScannerVwap({ candles: incidentBars(), stale: true }, incidentCutoff).reason, 'PROVIDER_MARKED_STALE')
  const huge = incidentBars().map(c => ({ ...c, open: 1e308, high: 1e308, low: 1e308, close: 1e308 }))
  assert.equal(diagnoseScannerVwap({ candles: huge }, incidentCutoff).reason, 'NON_FINITE_VWAP')
})

test('provider error diagnostics preserve hourly indicators and never include the provider error text', async () => {
  const secretMarker = 'do-not-expose-provider-url-or-token'
  const entries = await fetchScannerSnapshot(['SPY'], {}, async (symbol, timeframe) => {
    if (timeframe === '5Min') throw new Error(secretMarker)
    return { candles: Array.from({ length: 30 }, (_, i) => candle(symbol, new Date(Date.parse('2026-10-26T11:00:00Z') + i * 3600000).toISOString(), 100 + i)) }
  }, () => new Date('2026-10-27T17:05:00Z'))
  assert.equal(entries[0].available, true)
  assert.ok(Number.isFinite(entries[0].snapshot.ema21))
  assert.equal(entries[0].snapshot.vwap, null)
  assert.equal(entries[0].vwapDiagnostic.reason, 'FIVE_MINUTE_REQUEST_FAILED')
  assert.equal(entries[0].vwapDiagnostic.returnedCandleCount, null)
  assert.equal(JSON.stringify(entries).includes(secretMarker), false)
  assert.match(scannerDataQualityNotices(entries).join(' '), /FIVE_MINUTE_REQUEST_FAILED/)
})

test('VWAP session cutoff follows Eastern daylight and standard time', () => {
  const bars = regularSessionCandles('SPY', '2026-11-03T14:30:00Z', '2026-11-03T18:00:00Z')
  const result = diagnoseScannerVwap({ candles: bars }, '2026-11-03T18:00:00Z')
  assert.equal(result.usedCandleCount, 42)
  assert.equal(result.vwap, 100)
})

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
