import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runFrozenScoreHoldoutResearch, frozenScoreHoldoutDefaults } from './frozenScoreHoldoutBacktest.js'
import { scoreBucketDefinitions } from './signalQualityBacktest.js'

function makeDailySeries(symbol, count, startDate, waveShift = 0, seed = 1) {
  const start = new Date(startDate)
  return Array.from({ length: count }, (_, index) => {
    const wave = Math.sin((index + waveShift) / 9) * 2.2 + Math.sin((index + waveShift) / 23) * 1.4
    const close = 100 * seed + wave + index * 0.015
    const open = close - 0.12
    const high = Math.max(open, close) + 0.7
    const low = Math.min(open, close) - 0.7
    const timestamp = new Date(start.getTime() + index * 24 * 3600 * 1000).toISOString()
    return { symbol, timeframe: '1h', timestamp, open, high, low, close, volume: 1000000 + (index % 5) * 5000 }
  })
}

function buildDataset() {
  // ~4.3 years of daily-spaced candles starting exactly at the holdout window start.
  return {
    SPY: makeDailySeries('SPY', 1580, '2022-01-01T14:00:00Z', 0, 5.75),
    QQQ: makeDailySeries('QQQ', 1580, '2022-01-01T14:00:00Z', 4, 4.9),
    IWM: makeDailySeries('IWM', 1580, '2022-01-01T14:00:00Z', 9, 2.25),
  }
}

test('splits the synchronized timeline into a holdout window and a development window with no gap overlap', () => {
  const research = runFrozenScoreHoldoutResearch(buildDataset(), {})
  assert.ok(new Date(research.holdoutRange.start).getTime() >= new Date(frozenScoreHoldoutDefaults.holdoutStart).getTime())
  assert.ok(new Date(research.holdoutRange.end).getTime() <= new Date(frozenScoreHoldoutDefaults.holdoutEnd).getTime())
  assert.ok(new Date(research.developmentRange.start).getTime() > new Date(frozenScoreHoldoutDefaults.holdoutEnd).getTime())
  assert.ok(research.holdoutRange.candleCount > 0)
  assert.ok(research.developmentRange.candleCount > 0)
})

test('no candle timestamp is counted in both the holdout and development windows', () => {
  const research = runFrozenScoreHoldoutResearch(buildDataset(), {})
  const holdoutTimestamps = new Set(research.holdoutBaseline.trades.map((trade) => trade.timestamp))
  const developmentTimestamps = new Set(research.developmentBaseline.trades.map((trade) => trade.timestamp))
  const overlap = [...holdoutTimestamps].filter((timestamp) => developmentTimestamps.has(timestamp))
  assert.equal(overlap.length, 0)
})

test('every trade in every split enters strictly after its own signal candle (no look-ahead)', () => {
  const research = runFrozenScoreHoldoutResearch(buildDataset(), {})
  const timestamps = research.aligned.timestamps;
  [...research.holdoutBuckets, ...research.developmentBuckets].forEach((bucket) => {
    bucket.trades.forEach((trade) => {
      const signalIndex = timestamps.indexOf(trade.timestamp)
      assert.ok(signalIndex >= 0)
      assert.ok(signalIndex < timestamps.length - 1)
    })
  })
})

test('uses the existing frozen score bucket thresholds unmodified', () => {
  const research = runFrozenScoreHoldoutResearch(buildDataset(), {})
  assert.deepEqual(research.holdoutBuckets.map((bucket) => bucket.label), scoreBucketDefinitions.map(([label]) => label))
  research.holdoutBuckets.forEach((bucket, index) => {
    assert.equal(bucket.min, scoreBucketDefinitions[index][1])
    assert.equal(bucket.max, scoreBucketDefinitions[index][2])
  })
})

test('RV-confirmed variant trades are a subset of the baseline variant trades within each split', () => {
  const research = runFrozenScoreHoldoutResearch(buildDataset(), {})
  const holdoutBaselineTimestamps = new Set(research.holdoutBaseline.trades.map((trade) => trade.timestamp))
  research.holdoutRvConfirmed.trades.forEach((trade) => assert.ok(holdoutBaselineTimestamps.has(trade.timestamp)))
  const developmentBaselineTimestamps = new Set(research.developmentBaseline.trades.map((trade) => trade.timestamp))
  research.developmentRvConfirmed.trades.forEach((trade) => assert.ok(developmentBaselineTimestamps.has(trade.timestamp)))
})

test('does not mutate or optimize score bucket boundaries between development and holdout', () => {
  const research = runFrozenScoreHoldoutResearch(buildDataset(), {})
  assert.deepEqual(research.developmentBuckets.map((bucket) => [bucket.min, bucket.max]), research.holdoutBuckets.map((bucket) => [bucket.min, bucket.max]))
})
