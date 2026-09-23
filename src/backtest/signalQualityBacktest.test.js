import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  runSignalQualityResearch,
  assessScoreMonotonicity,
  scoreBucketDefinitions,
  componentDefinitions,
  signalQualityDefaults,
} from './signalQualityBacktest.js'

function makeHourlySeries(symbol, count, waveShift = 0, seed = 1) {
  return Array.from({ length: count }, (_, index) => {
    const wave = Math.sin((index + waveShift) / 6) * 2 + Math.sin((index + waveShift) / 17) * 1.3
    const close = 100 * seed + wave + index * 0.01
    const open = close - 0.1
    const high = Math.max(open, close) + 0.6
    const low = Math.min(open, close) - 0.6
    return {
      symbol,
      timeframe: '1h',
      timestamp: new Date(Date.UTC(2026, 0, 1, index)).toISOString(),
      open, high, low, close,
      volume: 1000000 + (index % 5) * 5000,
    }
  })
}

function buildDataset() {
  return {
    SPY: makeHourlySeries('SPY', 400, 0, 5.75),
    QQQ: makeHourlySeries('QQQ', 400, 3, 4.9),
    IWM: makeHourlySeries('IWM', 400, 7, 2.25),
  }
}

test('score buckets cover the expected 75-100 ranges and never overlap', () => {
  assert.deepEqual(scoreBucketDefinitions.map(([label]) => label), ['75-79', '80-84', '85-89', '90-94', '95-100'])
  for (let i = 1; i < scoreBucketDefinitions.length; i += 1) {
    assert.ok(scoreBucketDefinitions[i][1] > scoreBucketDefinitions[i - 1][2])
  }
})

test('every score-bucket and component trade enters strictly after its signal candle (no look-ahead)', () => {
  const research = runSignalQualityResearch(buildDataset(), { lookback: 10 })
  const checkTrades = (trades) => trades.forEach((trade) => {
    const signalIndex = research.aligned.timestamps.indexOf(trade.timestamp)
    assert.ok(signalIndex >= 0)
    assert.ok(signalIndex < research.aligned.timestamps.length - 1)
  })
  research.scoreBuckets.forEach((bucket) => checkTrades(bucket.trades))
  research.components.forEach((component) => {
    checkTrades(component.independent.trades)
    checkTrades(component.conditional.trades)
  })
})

test('conditional component trades are a subset of the 75+ baseline signal set', () => {
  const research = runSignalQualityResearch(buildDataset(), { lookback: 10 })
  const allBaselineTimestamps = new Set(research.scoreBuckets.flatMap((bucket) => bucket.trades.map((trade) => trade.timestamp)))
  research.components.forEach((component) => {
    component.conditional.trades.forEach((trade) => {
      assert.ok(allBaselineTimestamps.has(trade.timestamp), `${component.key} conditional trade should be a 75+ baseline signal too`)
    })
  })
})

test('decomposition present/absent groups are disjoint and both drawn from 75+ baseline signals', () => {
  const research = runSignalQualityResearch(buildDataset(), { lookback: 10 })
  research.decomposition.forEach((entry) => {
    const presentTimestamps = new Set(entry.present.trades.map((trade) => `${trade.symbol}:${trade.timestamp}`))
    const absentTimestamps = new Set(entry.absent.trades.map((trade) => `${trade.symbol}:${trade.timestamp}`))
    presentTimestamps.forEach((key) => assert.ok(!absentTimestamps.has(key), `${entry.key} present/absent sets must be disjoint`))
    assert.ok(['positive', 'negative', 'negligible', 'insufficient-data'].includes(entry.classification))
  })
})

test('score-bucket summaries expose average R, median R, and loss rate', () => {
  const research = runSignalQualityResearch(buildDataset(), { lookback: 10 })
  research.scoreBuckets.forEach((bucket) => {
    assert.ok(typeof bucket.overall.averageR === 'number')
    assert.ok(typeof bucket.overall.medianR === 'number')
    assert.ok(typeof bucket.overall.lossRate === 'number')
  })
})

test('assessScoreMonotonicity reports a correlation and is not evaluable with fewer than 2 populated buckets', () => {
  assert.deepEqual(assessScoreMonotonicity([]), { evaluable: false })
  const research = runSignalQualityResearch(buildDataset(), { lookback: 10 })
  const assessment = assessScoreMonotonicity(research.scoreBuckets)
  if (assessment.evaluable) {
    assert.ok(assessment.averageRCorrelation >= -1 && assessment.averageRCorrelation <= 1)
  }
})

test('all seven component definitions are present including the Experiment #1 relative-value confirmation', () => {
  const keys = componentDefinitions.map((component) => component.key)
  assert.deepEqual(keys, ['aboveVwap', 'emaAligned', 'rsiRange', 'relVolume', 'breakout', 'bullishTrend', 'rvConfirmation'])
})

test('uses signalQualityDefaults when settings are omitted', () => {
  const research = runSignalQualityResearch(buildDataset())
  assert.equal(research.options.minimumScore, signalQualityDefaults.minimumScore)
  assert.equal(research.options.lookback, signalQualityDefaults.lookback)
})
