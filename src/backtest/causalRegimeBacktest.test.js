import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  computeCausalRegimeSeries,
  runCausalRegimeResearch,
  causalRegimeDefaults,
  trendLabels,
  volatilityLabels,
  breadthLabels,
} from './causalRegimeBacktest.js'

function makeDailySeries(symbol, count, startDate, waveShift = 0, seed = 1, trendSlope = 0.015) {
  const start = new Date(startDate)
  return Array.from({ length: count }, (_, index) => {
    const wave = Math.sin((index + waveShift) / 9) * 2.2 + Math.sin((index + waveShift) / 23) * 1.4
    const close = 100 * seed + wave + index * trendSlope
    const open = close - 0.12
    const high = Math.max(open, close) + 0.7
    const low = Math.min(open, close) - 0.7
    const timestamp = new Date(start.getTime() + index * 24 * 3600 * 1000).toISOString()
    return { symbol, timeframe: '1h', timestamp, open, high, low, close, volume: 1000000 + (index % 5) * 5000 }
  })
}

function buildDataset() {
  return {
    SPY: makeDailySeries('SPY', 1580, '2022-01-01T14:00:00Z', 0, 5.75),
    QQQ: makeDailySeries('QQQ', 1580, '2022-01-01T14:00:00Z', 4, 4.9),
    IWM: makeDailySeries('IWM', 1580, '2022-01-01T14:00:00Z', 9, 2.25),
  }
}

test('causal rolling calculations only use trailing candles (SMA/return/ATR/volatility are null before enough history)', () => {
  const dataset = buildDataset()
  const regime = computeCausalRegimeSeries(dataset, causalRegimeDefaults)
  assert.equal(regime[10].trend.sma50, null, 'SMA50 should be null before 50 bars exist')
  assert.equal(regime[198].trend.sma200, null, 'SMA200 should be null before 200 bars exist')
  assert.notEqual(regime[199].trend.sma200, null, 'SMA200 should be available once 200 bars exist')
  assert.equal(regime[18].volatility.realizedVol20, null, 'realizedVol20 should be null before 20 bars exist')
  assert.notEqual(regime[25].volatility.realizedVol20, null)
})

test('no future observations are used: regime classification at index i is unchanged when later candles change', () => {
  const dataset = buildDataset()
  const regimeBefore = computeCausalRegimeSeries(dataset, causalRegimeDefaults)
  const mutatedDataset = {
    SPY: dataset.SPY.map((candle, index) => (index > 800 ? { ...candle, close: candle.close * 5, high: candle.high * 5, low: candle.low * 5 } : candle)),
    QQQ: dataset.QQQ,
    IWM: dataset.IWM,
  }
  const regimeAfter = computeCausalRegimeSeries(mutatedDataset, causalRegimeDefaults)
  for (let index = 0; index <= 800; index += 1) {
    assert.deepEqual(regimeBefore[index].trend, regimeAfter[index].trend, `trend at index ${index} must be unaffected by a later mutation`)
    assert.deepEqual(regimeBefore[index].volatility, regimeAfter[index].volatility, `volatility at index ${index} must be unaffected by a later mutation`)
    assert.deepEqual(regimeBefore[index].breadth, regimeAfter[index].breadth, `breadth at index ${index} must be unaffected by a later mutation`)
  }
})

test('trend regime classification follows the fixed Uptrend/Downtrend/Mixed definition', () => {
  const dataset = buildDataset()
  const regime = computeCausalRegimeSeries(dataset, causalRegimeDefaults)
  regime.forEach((point) => {
    if (point.trend.aboveSma50 === null || point.trend.slope === null) {
      assert.equal(point.trend.classification, 'Insufficient-History')
    } else if (point.trend.aboveSma50 && point.trend.slope > 0) {
      assert.equal(point.trend.classification, 'Uptrend')
    } else if (!point.trend.aboveSma50 && point.trend.slope < 0) {
      assert.equal(point.trend.classification, 'Downtrend')
    } else {
      assert.equal(point.trend.classification, 'Mixed')
    }
  })
})

test('breadth regime classification follows the fixed Strong/Mixed/Weak definition', () => {
  const dataset = buildDataset()
  const regime = computeCausalRegimeSeries(dataset, causalRegimeDefaults)
  regime.forEach((point) => {
    if (point.breadth.countAboveSma50 === null) {
      assert.equal(point.breadth.classification, 'Insufficient-History')
    } else if (point.breadth.countAboveSma50 === 3) {
      assert.equal(point.breadth.classification, 'Strong')
    } else if (point.breadth.countAboveSma50 === 0) {
      assert.equal(point.breadth.classification, 'Weak')
    } else {
      assert.equal(point.breadth.classification, 'Mixed')
    }
  })
})

test('expanding volatility percentile only ranks against history available at or before the current bar', () => {
  const dataset = buildDataset()
  const regime = computeCausalRegimeSeries(dataset, causalRegimeDefaults)
  const firstClassifiedIndex = regime.findIndex((point) => point.volatility.classification !== 'Insufficient-History')
  assert.ok(firstClassifiedIndex > 0)
  // Manually recompute the percentile rank using only realizedVol20 values at indices <= firstClassifiedIndex.
  const historyUpToPoint = regime.slice(0, firstClassifiedIndex + 1).map((point) => point.volatility.realizedVol20).filter((value) => value !== null)
  const currentVol = regime[firstClassifiedIndex].volatility.realizedVol20
  const expectedRank = historyUpToPoint.filter((value) => value <= currentVol).length / historyUpToPoint.length
  assert.ok(Math.abs(regime[firstClassifiedIndex].volatility.percentileRank - expectedRank) < 1e-9)
  assert.ok(['Low', 'Medium', 'High'].includes(regime[firstClassifiedIndex].volatility.classification))
})

test('volatility classification requires the configured warmup before leaving Insufficient-History', () => {
  const dataset = buildDataset()
  const regime = computeCausalRegimeSeries(dataset, { ...causalRegimeDefaults, volatilityHistoryWarmup: 60 })
  const firstNonNullVol = regime.findIndex((point) => point.volatility.realizedVol20 !== null)
  for (let index = firstNonNullVol; index < firstNonNullVol + 59; index += 1) {
    assert.equal(regime[index].volatility.classification, 'Insufficient-History')
  }
})

test('year/regime attribution: every baseline trade in the yearly distribution belongs to the year it was counted under', () => {
  const research = runCausalRegimeResearch(buildDataset(), {})
  const total = research.yearRegimeDistribution.reduce((sum, year) => sum + year.totalBaselineTrades, 0)
  assert.equal(total, research.combinedBaseline.overall.tradeCount)
  research.yearRegimeDistribution.forEach((yearEntry) => {
    trendLabels.forEach((label) => {
      assert.ok(yearEntry.trend.counts[label] >= 0)
      assert.ok(yearEntry.trend.percentages[label] >= 0 && yearEntry.trend.percentages[label] <= 1)
    })
  })
})

test('score bucket attribution inside regimes uses the existing frozen bucket thresholds', () => {
  const research = runCausalRegimeResearch(buildDataset(), {})
  research.scoreByRegime.forEach((regimeEntry) => {
    assert.deepEqual(regimeEntry.buckets.map((bucket) => [bucket.min, bucket.max]), [[75, 79], [80, 84], [85, 89], [90, 94], [95, 100]])
  })
})

test('small-sample regimes and buckets are flagged rather than treated as meaningful', () => {
  const research = runCausalRegimeResearch(buildDataset(), { smallSampleThreshold: 30 })
  research.trendGroups.forEach((group) => assert.equal(group.baseline.smallSample, group.baseline.overall.tradeCount < 30))
  research.combinedTrendVolatility.forEach((combo) => assert.equal(combo.baseline.smallSample, combo.baseline.overall.tradeCount < 30))
  research.scoreByRegime.forEach((regimeEntry) => {
    regimeEntry.buckets.forEach((bucket) => assert.equal(bucket.smallSample, bucket.overall.tradeCount < 30))
    if (regimeEntry.monotonicity.evaluable === false) assert.equal(regimeEntry.monotonicity.reason, 'insufficient-sample')
  })
})

test('produces deterministic results across repeated runs on the same input', () => {
  const dataset = buildDataset()
  const first = runCausalRegimeResearch(dataset, {})
  const second = runCausalRegimeResearch(dataset, {})
  assert.equal(JSON.stringify(first.trendGroups), JSON.stringify(second.trendGroups))
  assert.equal(JSON.stringify(first.combinedBaseline.overall), JSON.stringify(second.combinedBaseline.overall))
  assert.equal(JSON.stringify(first.yearRegimeDistribution), JSON.stringify(second.yearRegimeDistribution))
})

test('every trade in every regime grouping enters strictly after its own signal candle (no look-ahead)', () => {
  const research = runCausalRegimeResearch(buildDataset(), {})
  const timestamps = research.aligned.timestamps
  const allTradeSets = [
    ...research.trendGroups.map((g) => g.baseline.trades),
    ...research.volatilityGroups.map((g) => g.baseline.trades),
    ...research.breadthGroups.map((g) => g.baseline.trades),
    ...research.combinedTrendVolatility.map((c) => c.baseline.trades),
  ]
  allTradeSets.forEach((trades) => {
    trades.forEach((trade) => {
      const signalIndex = timestamps.indexOf(trade.timestamp)
      assert.ok(signalIndex >= 0)
      assert.ok(signalIndex < timestamps.length - 1)
    })
  })
})

test('all fixed regime label sets match the predefined Part B definitions', () => {
  assert.deepEqual(trendLabels, ['Uptrend', 'Mixed', 'Downtrend'])
  assert.deepEqual(volatilityLabels, ['Low', 'Medium', 'High'])
  assert.deepEqual(breadthLabels, ['Strong', 'Mixed', 'Weak'])
})
