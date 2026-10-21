import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  runSignalQualityResearch,
  buildAlignedSeries,
  buildCatalogueBySymbol,
  buildTradeFromIndex,
  summarizeTrades,
  assessScoreMonotonicity,
  scoreBucketDefinitions,
  componentDefinitions,
  signalQualityDefaults,
  classifyComponentContribution,
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

test('signal-quality long trades fill stop gaps at the open and retain conservative target limits', () => {
  const candles = [
    { timestamp: 'signal', open: 100, high: 101, low: 99, close: 100 },
    { timestamp: 'entry', open: 100, high: 100.5, low: 99.5, close: 100 },
    { timestamp: 'gap', open: 94, high: 100, low: 93, close: 96 },
  ]
  const options = { stopDistancePercent: 0.01, targetR: 2, maxHoldingBars: 2 }
  const stopGap = buildTradeFromIndex(candles, 0, options, { symbol: 'SPY' })
  assert.equal(stopGap.exitReason, 'Stop')
  assert.equal(stopGap.exitPrice, 94)

  candles[2] = { ...candles[2], open: 105, high: 106, low: 104, close: 105 }
  const targetGap = buildTradeFromIndex(candles, 0, options, { symbol: 'SPY' })
  assert.equal(targetGap.exitReason, 'Target')
  assert.equal(targetGap.exitPrice, 102)
})

test('signal-quality summaries report ambiguity count and trade denominator without changing stop-first outcomes', () => {
  const candles = [
    { timestamp: 'signal', open: 100, high: 101, low: 99, close: 100 },
    { timestamp: 'entry', open: 100, high: 100.5, low: 99.5, close: 100 },
    { timestamp: 'both', open: 100, high: 103, low: 98, close: 100 },
  ]
  const trade = buildTradeFromIndex(candles, 0, { stopDistancePercent: 0.01, targetR: 2, maxHoldingBars: 2 }, { symbol: 'SPY' })
  assert.equal(trade.ambiguousCandle, true)
  assert.equal(trade.exitReason, 'Stop')
  const summary = summarizeTrades([{ symbol: 'SPY', trades: [trade] }], ['signal'], 1)
  assert.equal(summary.overall.ambiguousTradeCount, 1)
  assert.equal(summary.overall.ambiguityRateDenominator, 1)
  assert.equal(summary.overall.ambiguousTradeRate, 1)

  const unavailable = summarizeTrades([{ symbol: 'legacy', trades: [{ timestamp: 'signal', rMultiple: 1 }] }], ['signal'], 1)
  assert.equal(unavailable.overall.ambiguousTradeCount, null)
  assert.equal(unavailable.overall.ambiguousTradeRate, null)

  const missingOpenCandles = [
    { timestamp: 'signal', open: 100, high: 101, low: 99, close: 100 },
    { timestamp: 'entry', open: 100, high: 100.5, low: 99.5, close: 100 },
    { timestamp: 'missing-open', high: 103, low: 98, close: 100 },
  ]
  const missingOpenTrade = buildTradeFromIndex(missingOpenCandles, 0, { stopDistancePercent: 0.01, targetR: 2, maxHoldingBars: 2 }, { symbol: 'SPY' })
  assert.equal(missingOpenTrade.exitReason, 'Stop')
  assert.equal(missingOpenTrade.ambiguousCandle, null)
  const incompleteSummary = summarizeTrades([{ symbol: 'SPY', trades: [missingOpenTrade] }], ['signal'], 1)
  assert.equal(incompleteSummary.overall.ambiguousTradeCount, null)
})

test('score buckets cover the expected 75-100 ranges and never overlap', () => {
  assert.deepEqual(scoreBucketDefinitions.map(([label]) => label), ['75-79', '80-84', '85-89', '90-94', '95-100'])
  for (let i = 1; i < scoreBucketDefinitions.length; i += 1) {
    assert.ok(scoreBucketDefinitions[i][1] > scoreBucketDefinitions[i - 1][2])
  }
})

test('pooled drawdown is chronological and same-time trade ordering is deterministic', () => {
  const tradeA = { symbol: 'A', timestamp: '2026-01-01T10:00:00.000Z', holdingBars: 1, rMultiple: 2, exitReason: 'Target' }
  const tradeB = { symbol: 'B', timestamp: '2026-01-01T10:00:00.000Z', holdingBars: 1, rMultiple: -1, exitReason: 'Stop' }
  const tradeC = { symbol: 'C', timestamp: '2026-01-02T10:00:00.000Z', holdingBars: 2, rMultiple: -2, exitReason: 'Stop' }
  const timestamps = [tradeA.timestamp, tradeC.timestamp]
  const first = summarizeTrades([
    { symbol: 'B', trades: [tradeB] },
    { symbol: 'C', trades: [tradeC] },
    { symbol: 'A', trades: [tradeA] },
  ], timestamps, 1)
  const reordered = summarizeTrades([
    { symbol: 'A', trades: [tradeA] },
    { symbol: 'B', trades: [tradeB] },
    { symbol: 'C', trades: [tradeC] },
  ], timestamps, 1)

  assert.deepEqual(first.trades.map((trade) => trade.symbol), ['A', 'B', 'C'])
  assert.equal(first.overall.maximumDrawdown, 3)
  assert.deepEqual(first.overall, reordered.overall)
  assert.deepEqual(first.costTiers.map((tier) => tier.metrics), reordered.costTiers.map((tier) => tier.metrics))
})

test('every score-bucket and component trade enters strictly after its signal candle (no look-ahead)', () => {
  const research = runSignalQualityResearch(buildDataset(), { lookback: 10 })
  assert.ok(research.scoreBuckets.reduce((sum, bucket) => sum + bucket.overall.tradeCount, 0) > 0, 'eligible score signals must produce observations')
  assert.ok(research.components.some((component) => component.conditional.overall.tradeCount > 0), 'conditional research membership must not silently be empty')
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
    assert.ok(['positive', 'negative', 'negligible', 'insufficient-evidence'].includes(entry.classification))
    assert.equal(entry.accounting.baselineCount, entry.accounting.presentCount + entry.accounting.absentCount + entry.accounting.unavailableCount)
    assert.equal(entry.accounting.baselineResolvedCount, entry.accounting.presentResolvedCount + entry.accounting.absentResolvedCount + entry.accounting.unavailableResolvedCount)
    assert.equal(entry.accounting.outcomeExcludedCount, entry.accounting.baselineCount - entry.accounting.baselineResolvedCount)
    assert.equal(entry.accounting.reconciliationStatus, 'reconciled')
  })
})

test('component contribution requires 30 resolved observations on both sides', () => {
  assert.deepEqual(classifyComponentContribution({ contributionR: -0.5, presentResolvedCount: 200, absentResolvedCount: 7 }), {
    classification: 'insufficient-evidence',
    exploratory: true,
  })
})

test('component contribution is exploratory below 100 per side and negligible is symmetric', () => {
  assert.deepEqual(classifyComponentContribution({ contributionR: 0.03, presentResolvedCount: 99, absentResolvedCount: 100 }), {
    classification: 'positive',
    exploratory: true,
  })
  assert.deepEqual(classifyComponentContribution({ contributionR: 0.01, presentResolvedCount: 100, absentResolvedCount: 100 }), {
    classification: 'negligible',
    exploratory: false,
  })
  assert.deepEqual(classifyComponentContribution({ contributionR: -0.01, presentResolvedCount: 100, absentResolvedCount: 100 }), {
    classification: 'negligible',
    exploratory: false,
  })
})

test('score-bucket summaries expose average R, median R, and loss rate', () => {
  const research = runSignalQualityResearch(buildDataset(), { lookback: 10 })
  research.scoreBuckets.forEach((bucket) => {
    assert.ok(typeof bucket.overall.averageR === 'number')
    assert.ok(typeof bucket.overall.medianR === 'number')
    assert.ok(typeof bucket.overall.lossRate === 'number')
    assert.equal(bucket.overall.ambiguityRateDenominator, bucket.overall.tradeCount)
    assert.ok(Number.isFinite(bucket.overall.ambiguousTradeCount))
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

test('signal-quality catalogue preserves relative-volume method and excludes unavailable values from component groups', () => {
  const spy = makeHourlySeries('SPY', 8)
  spy[5].volume = 2000000 // first five prior bars form a 1x fallback baseline
  const aligned = buildAlignedSeries({ SPY: spy, QQQ: makeHourlySeries('QQQ', 8, 2, 1.1) })
  const catalogue = buildCatalogueBySymbol(aligned, { lookback: 3 })

  assert.equal(catalogue.SPY[0].relativeVolume, null)
  assert.equal(catalogue.SPY[0].relativeVolumeMethod, null)
  assert.equal(catalogue.SPY[0].relativeVolumeAvailable, false)
  assert.equal(catalogue.SPY[0].componentAvailability.relVolume, false)
  assert.equal(catalogue.SPY[0].components.relVolume, false)

  assert.equal(catalogue.SPY[5].relativeVolumeMethod, 'prior-bars')
  assert.equal(catalogue.SPY[5].relativeVolumeAvailable, true)
  assert.equal(catalogue.SPY[5].componentAvailability.relVolume, true)
  assert.equal(catalogue.SPY[5].components.relVolume, true)
})

test('uses signalQualityDefaults when settings are omitted', () => {
  const research = runSignalQualityResearch(buildDataset())
  assert.equal(research.options.minimumScore, signalQualityDefaults.minimumScore)
  assert.equal(research.options.lookback, signalQualityDefaults.lookback)
})
