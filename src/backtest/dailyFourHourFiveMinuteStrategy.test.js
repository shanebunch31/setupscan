import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runSetupScanBacktest } from './strategy.js'
import { DAILY_FOUR_HOUR_FIVE_MINUTE_STRATEGY_ID, runDailyFourHourFiveMinuteResearch } from './dailyFourHourFiveMinuteStrategy.js'

const FIVE_MINUTES = 5 * 60 * 1000
const FOUR_HOURS = 4 * 60 * 60 * 1000
const DAY = 24 * 60 * 60 * 1000
const fiveMinuteStart = Date.parse('2026-03-05T14:30:00.000Z')

function candle(timestamp, close, { open = close, high = Math.max(open, close) + 1, low = Math.min(open, close) - 1, volume = 100 } = {}) {
  return { timestamp: new Date(timestamp).toISOString(), open, high, low, close, volume }
}

function dailySeries(direction) {
  const finalClose = direction === 'long' ? 110 : 90
  const end = Date.parse('2026-03-04T14:30:00.000Z')
  return Array.from({ length: 51 }, (_, index) => candle(
    end - (50 - index) * DAY,
    index === 50 ? finalClose : 100,
    direction === 'long'
      ? { high: index === 50 ? 111 : 101, low: 99 }
      : { high: 101, low: index === 50 ? 89 : 99 },
  ))
}

function fourHourSeries(direction) {
  const finalClose = direction === 'long' ? 110 : 90
  const start = Date.parse('2026-03-01T00:00:00.000Z')
  return Array.from({ length: 22 }, (_, index) => candle(
    start + index * FOUR_HOURS,
    index === 21 ? finalClose : 100,
    direction === 'long'
      ? { high: index === 21 ? 111 : 101, low: 99 }
      : { high: 101, low: index === 21 ? 89 : 99 },
  ))
}

function fiveMinuteSeries(direction, exit = 'time') {
  const confirmationClose = direction === 'long' ? 110 : 90
  const rows = Array.from({ length: 33 }, (_, index) => candle(
    fiveMinuteStart + index * FIVE_MINUTES,
    index === 20 ? confirmationClose : 100,
    direction === 'long'
      ? { high: index === 20 ? 111 : 101, low: index === 20 ? 99 : 99, volume: 100 }
      : { high: index === 20 ? 101 : 101, low: index === 20 ? 89 : 99, volume: 100 },
  ))
  rows[21] = candle(fiveMinuteStart + 21 * FIVE_MINUTES, direction === 'long' ? 110 : 90, {
    open: direction === 'long' ? 110 : 90,
    high: direction === 'long' ? 111 : 91,
    low: direction === 'long' ? 109 : 89,
  })
  for (let index = 22; index < rows.length; index += 1) {
    rows[index] = candle(fiveMinuteStart + index * FIVE_MINUTES, direction === 'long' ? 110 : 90, direction === 'long'
      ? { open: 110, high: 111, low: 109 }
      : { open: 90, high: 91, low: 89 })
  }
  if (exit === 'stop-gap') {
    rows[22] = candle(fiveMinuteStart + 22 * FIVE_MINUTES, direction === 'long' ? 95 : 105, direction === 'long'
      ? { open: 95, high: 100, low: 94 }
      : { open: 105, high: 106, low: 100 })
  }
  if (exit === 'ambiguous') {
    rows[22] = candle(fiveMinuteStart + 22 * FIVE_MINUTES, direction === 'long' ? 110 : 90, direction === 'long'
      ? { open: 110, high: 133, low: 98 }
      : { open: 90, high: 102, low: 78 })
  }
  return rows
}

function run(direction = 'long', options = {}) {
  const fiveMinuteCandles = options.fiveMinuteCandles ?? fiveMinuteSeries(direction, options.exit)
  return runDailyFourHourFiveMinuteResearch({
    symbol: 'SPY',
    dailyCandles: options.dailyCandles ?? dailySeries(direction),
    fourHourCandles: options.fourHourCandles ?? fourHourSeries(direction),
    fiveMinuteCandles,
    cutoff: '2026-03-06T00:00:00.000Z',
    source: 'TEST FIXTURE',
  })
}

test('multi-timeframe research records a causally aligned long trade at the next five-minute open', () => {
  const result = run('long')
  const [trade] = result.trades

  assert.equal(result.strategyId, DAILY_FOUR_HOUR_FIVE_MINUTE_STRATEGY_ID)
  assert.equal(result.timeframes.daily, '1Day')
  assert.equal(result.timeframes.setup, '4Hour')
  assert.equal(result.timeframes.entry, '5Min')
  assert.equal(trade.direction, 'long')
  assert.equal(trade.dailyBias, 'long')
  assert.equal(trade.fourHourSetup, 'long')
  assert.equal(trade.confirmationTimestamp, new Date(fiveMinuteStart + 20 * FIVE_MINUTES).toISOString())
  assert.equal(trade.entryTimestamp, new Date(fiveMinuteStart + 21 * FIVE_MINUTES).toISOString())
  assert.equal(trade.entryPrice, 110)
  assert.equal(trade.stopPrice, 99)
  assert.equal(trade.targetPrice, 132)
  assert.equal(trade.exitReason, 'Time')
  assert.equal(trade.holdingBars, 12)
  assert.ok(Date.parse(trade.dailyTimestamp) < Date.parse(trade.confirmationTimestamp))
  assert.ok(Date.parse(trade.fourHourTimestamp) < Date.parse(trade.confirmationTimestamp))
})

test('multi-timeframe research supports the fully specified bearish path', () => {
  const result = run('short')
  const [trade] = result.trades

  assert.equal(trade.direction, 'short')
  assert.equal(trade.entryPrice, 90)
  assert.equal(trade.stopPrice, 101)
  assert.equal(trade.targetPrice, 68)
  assert.equal(trade.exitReason, 'Time')
  assert.equal(result.metrics.shortTradeCount, 1)
})

test('daily EMA warm-up, neutral context, and incomplete daily candles do not create a trade', () => {
  const neutralDaily = dailySeries('long').map((row) => ({ ...row, close: 100, high: 101, low: 99 }))
  const neutral = run('long', { dailyCandles: neutralDaily })
  assert.equal(neutral.trades.length, 0)
  assert.ok((neutral.exclusions['daily-neutral'] ?? 0) > 0)

  const incompleteDaily = dailySeries('long').map((row, index, rows) => index === rows.length - 1
    ? { ...row, timestamp: '2026-03-05T14:30:00.000Z' }
    : row)
  const incomplete = runDailyFourHourFiveMinuteResearch({
    symbol: 'SPY',
    dailyCandles: incompleteDaily,
    fourHourCandles: fourHourSeries('long'),
    fiveMinuteCandles: fiveMinuteSeries('long'),
    cutoff: '2026-03-05T16:30:00.000Z',
  })
  assert.equal(incomplete.trades.length, 0)
  assert.ok((incomplete.exclusions['daily-neutral'] ?? 0) + (incomplete.exclusions['daily-ema-warmup'] ?? 0) > 0)
  assert.equal(incomplete.dataQuality.daily.incompleteCandleCount, 1)

  const warmup = run('long', { dailyCandles: dailySeries('long').slice(0, 30) })
  assert.equal(warmup.trades.length, 0)
  assert.ok((warmup.exclusions['daily-ema-warmup'] ?? 0) > 0)
})

test('four-hour breakout excludes the current candle and requires EMA alignment', () => {
  const notAbovePriorHigh = fourHourSeries('long').map((row, index) => index === 21 ? { ...row, close: 101, high: 111 } : row)
  const result = run('long', { fourHourCandles: notAbovePriorHigh })
  assert.equal(result.trades.length, 0)
  assert.ok((result.exclusions['four-hour-no-setup'] ?? 0) > 0)

  const insufficient = run('long', { fourHourCandles: fourHourSeries('long').slice(2) })
  assert.equal(insufficient.trades.length, 0)
  assert.ok((insufficient.exclusions['four-hour-warmup'] ?? 0) > 0)
})

test('a provider four-hour bar that has not completed by the research cutoff is excluded', () => {
  const futureFourHour = [
    ...fourHourSeries('long'),
    candle('2026-03-06T00:00:00.000Z', 80, { high: 101, low: 79 }),
  ]
  const result = run('long', { fourHourCandles: futureFourHour })
  assert.equal(result.dataQuality.fourHour.incompleteCandleCount, 1)
  assert.equal(result.trades.length, 1, 'the completed four-hour setup remains the only usable setup')
})

test('conflicting completed higher-timeframe context prevents an otherwise valid five-minute confirmation', () => {
  const result = run('long', { fourHourCandles: fourHourSeries('short') })
  assert.equal(result.trades.length, 0)
  assert.ok((result.exclusions['four-hour-direction-conflict'] ?? 0) > 0)
})

test('five-minute confirmation requires a valid regular-session VWAP and uninterrupted required bars', () => {
  const missingVolume = fiveMinuteSeries('long').map((row) => ({ ...row, volume: 0 }))
  const result = run('long', { fiveMinuteCandles: missingVolume })
  assert.equal(result.trades.length, 0)
  assert.ok((result.exclusions['vwap-unavailable'] ?? 0) > 0)

  const missingInterval = fiveMinuteSeries('long').map((row, index) => index === 10 ? { ...row, volume: Number.NaN } : row)
  const missingIntervalResult = run('long', { fiveMinuteCandles: missingInterval })
  assert.equal(missingIntervalResult.trades.length, 0)
  assert.ok((missingIntervalResult.exclusions['five-minute-gap'] ?? 0) > 0)

  const premarket = fiveMinuteSeries('long').map((row) => ({ ...row, timestamp: new Date(Date.parse(row.timestamp) - 6 * 60 * 60 * 1000).toISOString() }))
  const premarketResult = run('long', { fiveMinuteCandles: premarket })
  assert.equal(premarketResult.trades.length, 0)
  assert.ok((premarketResult.exclusions['vwap-unavailable'] ?? 0) > 0)
})

test('a missing next five-minute candle, invalid structural stop, and end-of-dataset each skip rather than fabricate a completion', () => {
  const missingEntry = run('long', { fiveMinuteCandles: fiveMinuteSeries('long').slice(0, 21) })
  assert.equal(missingEntry.trades.length, 0)
  assert.ok((missingEntry.exclusions['next-entry-candle-unavailable'] ?? 0) > 0)

  const wrongSideStop = fiveMinuteSeries('long').map((row, index) => {
    if (index >= 11 && index <= 19) return { ...row, open: 120, high: 121, low: 120, close: 120 }
    if (index === 20) return { ...row, open: 130, high: 131, low: 130, close: 130 }
    if (index === 21) return { ...row, open: 120, high: 121, low: 119, close: 120 }
    return row
  })
  const invalidStop = run('long', { fiveMinuteCandles: wrongSideStop })
  assert.equal(invalidStop.trades.length, 0)
  assert.ok((invalidStop.exclusions['structural-stop-invalid'] ?? 0) > 0)

  const truncated = run('long', { fiveMinuteCandles: fiveMinuteSeries('long').slice(0, 30) })
  assert.equal(truncated.trades.length, 0)
  assert.ok((truncated.exclusions['end-of-dataset-before-time-exit'] ?? 0) > 0)
})

test('duplicate confirmation rows cannot create duplicate entries', () => {
  const rows = fiveMinuteSeries('long')
  const duplicate = { ...rows[20] }
  const result = run('long', { fiveMinuteCandles: [...rows.slice(0, 21), duplicate, ...rows.slice(21)] })
  assert.equal(result.trades.length, 1)
  assert.equal(result.dataQuality.fiveMinute.duplicateCandleCount, 1)
})

test('gap-through stops use the adverse opening price and ambiguous five-minute candles remain stop-first for both directions', () => {
  const longGap = run('long', { exit: 'stop-gap' }).trades[0]
  assert.equal(longGap.exitReason, 'Stop')
  assert.equal(longGap.exitPrice, 95)

  const shortGap = run('short', { exit: 'stop-gap' }).trades[0]
  assert.equal(shortGap.exitReason, 'Stop')
  assert.equal(shortGap.exitPrice, 105)

  const longAmbiguous = run('long', { exit: 'ambiguous' }).trades[0]
  assert.equal(longAmbiguous.exitReason, 'Stop')
  assert.equal(longAmbiguous.exitPrice, 99)

  const shortAmbiguous = run('short', { exit: 'ambiguous' }).trades[0]
  assert.equal(shortAmbiguous.exitReason, 'Stop')
  assert.equal(shortAmbiguous.exitPrice, 101)
})

test('the existing hourly backtest remains available and unchanged by the separate strategy module', () => {
  const hourly = Array.from({ length: 12 }, (_, index) => ({
    timestamp: new Date(Date.UTC(2026, 0, 1, index)).toISOString(),
    timeframe: '1h', open: 100, high: 101, low: 99, close: 100, volume: 1000,
    price: 100, vwap: 99, ema9: 101, ema21: 99, rsi: 60, relativeVolume: 1.5,
    relativeVolumeMethod: 'prior-bars', breakout: index === 2, trend: 'Bullish',
  }))
  const result = runSetupScanBacktest(hourly, { splitIndex: 12, maxHoldingBars: 2, stopDistance: 5, targetDistance: 10 })
  assert.equal(result.trades.length, 1)
  assert.equal(result.trades[0].entryPrice, 100)
})
