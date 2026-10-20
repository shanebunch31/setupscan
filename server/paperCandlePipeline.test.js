import assert from 'node:assert/strict'
import test from 'node:test'
import { preparePaperCandles } from './paperCandlePipeline.js'

function candle(timestamp, close, overrides = {}) {
  return {
    timestamp,
    open: close - 0.5,
    high: close + 1,
    low: close - 1,
    close,
    volume: 1000,
    ...overrides,
  }
}

test('paper candle preparation preserves provider validation, chronological order, and completed-bar filtering', () => {
  const firstNine = candle('2026-10-19T09:00:00.000Z', 99)
  const result = preparePaperCandles([
    candle('2026-10-19T10:00:00.000Z', 100),
    firstNine,
    candle('2026-10-19T09:00:00.000Z', 123),
    candle('invalid', 101),
    candle('2026-10-19T11:00:00.000Z', 102),
  ], '1Hour', new Date('2026-10-19T11:00:00.000Z'))

  assert.deepEqual(result.candles.map((item) => item.timestamp), [
    '2026-10-19T09:00:00.000Z',
    '2026-10-19T10:00:00.000Z',
  ])
  assert.equal(result.candles[0].close, firstNine.close)
  assert.deepEqual(result.dataQuality, {
    inputCandleCount: 5,
    outOfOrderCandleCount: 2,
    duplicateCandleCount: 1,
    rejectedCandleCount: 1,
    acceptedCandleCount: 3,
    incompleteCandleCount: 1,
  })
})