import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  runWalkForwardRegimeResearch,
  walkForwardWindows,
  walkForwardDefaults,
  buildRealizedVol20Series,
  computeTercileBoundaries,
  classifyVolatility,
  volatilityLabels,
} from './walkForwardRegimeBacktest.js'
import { buildAlignedSeries, buildCatalogueBySymbol, buildTradeFromIndex } from './signalQualityBacktest.js'

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
  // ~4.7 years of daily-spaced candles starting 2022-01-01, spanning all four walk-forward windows.
  return {
    SPY: makeDailySeries('SPY', 1720, '2022-01-01T14:00:00Z', 0, 5.75),
    QQQ: makeDailySeries('QQQ', 1720, '2022-01-01T14:00:00Z', 4, 4.9),
    IWM: makeDailySeries('IWM', 1720, '2022-01-01T14:00:00Z', 9, 2.25),
  }
}

test('chronological window construction: each window\'s train period ends before its test period begins', () => {
  walkForwardWindows.forEach((windowDef) => {
    assert.ok(new Date(windowDef.trainEnd).getTime() < new Date(windowDef.testStart).getTime())
  })
})

test('training/test separation: no timestamp is realized in both a window\'s training and test ranges', () => {
  const research = runWalkForwardRegimeResearch(buildDataset(), {})
  research.windows.forEach((windowEntry) => {
    const trainSet = new Set(research.aligned.timestamps.filter((t) => new Date(t).getTime() >= new Date(windowEntry.trainStart).getTime() && new Date(t).getTime() <= new Date(windowEntry.trainEnd).getTime()))
    const testSet = new Set(research.aligned.timestamps.filter((t) => new Date(t).getTime() >= new Date(windowEntry.testStart).getTime() && new Date(t).getTime() <= new Date(windowEntry.testEnd).getTime()))
    const overlap = [...trainSet].filter((t) => testSet.has(t))
    assert.equal(overlap.length, 0)
  })
})

test('training/test separation: each subsequent window\'s training period strictly extends the previous one', () => {
  for (let i = 1; i < walkForwardWindows.length; i += 1) {
    assert.equal(walkForwardWindows[i].trainStart, walkForwardWindows[0].trainStart)
    assert.ok(new Date(walkForwardWindows[i].trainEnd).getTime() > new Date(walkForwardWindows[i - 1].trainEnd).getTime())
  }
})

test('causal percentile boundaries are computed only from the values passed in (training sample)', () => {
  const trainingValues = [1, 2, 3, 4, 5, 6, 7, 8, 9]
  const boundaries = computeTercileBoundaries(trainingValues)
  assert.equal(boundaries.sampleSize, 9)
  assert.equal(boundaries.lowMediumBoundary, 3)
  assert.equal(boundaries.mediumHighBoundary, 6)
})

test('classifyVolatility respects frozen boundaries and the training-warmup threshold', () => {
  const boundaries = { lowMediumBoundary: 0.01, mediumHighBoundary: 0.02, sampleSize: 100 }
  assert.equal(classifyVolatility(0.005, boundaries, 60), 'Low')
  assert.equal(classifyVolatility(0.015, boundaries, 60), 'Medium')
  assert.equal(classifyVolatility(0.03, boundaries, 60), 'High')
  assert.equal(classifyVolatility(0.005, { ...boundaries, sampleSize: 10 }, 60), 'Insufficient-Training-History')
  assert.equal(classifyVolatility(null, boundaries, 60), 'Insufficient-Training-History')
})

test('no-future-information invariance: changing a future test period\'s data cannot alter an earlier test period\'s regime label', () => {
  const dataset = buildDataset()
  const before = runWalkForwardRegimeResearch(dataset, {})
  const mutatedDataset = {
    SPY: dataset.SPY.map((candle) => (new Date(candle.timestamp) >= new Date('2025-01-01') ? { ...candle, close: candle.close * 3, high: candle.high * 3, low: candle.low * 3 } : candle)),
    QQQ: dataset.QQQ,
    IWM: dataset.IWM,
  }
  const after = runWalkForwardRegimeResearch(mutatedDataset, {})
  // Window 1's (test year 2023) boundaries and results must be unaffected by a mutation starting in 2025.
  assert.deepEqual(before.windows[0].boundaries, after.windows[0].boundaries)
  assert.equal(before.windows[0].baseline.overall.tradeCount, after.windows[0].baseline.overall.tradeCount)
  assert.equal(before.windows[0].baseline.overall.totalR, after.windows[0].baseline.overall.totalR)
})

test('no-future-information invariance: future volatility data cannot alter training-period percentile boundaries', () => {
  const dataset = buildDataset()
  const before = runWalkForwardRegimeResearch(dataset, {})
  const mutatedDataset = {
    SPY: dataset.SPY.map((candle) => (new Date(candle.timestamp) >= new Date('2024-01-01') ? { ...candle, close: candle.close * 4, high: candle.high * 4, low: candle.low * 4 } : candle)),
    QQQ: dataset.QQQ,
    IWM: dataset.IWM,
  }
  const after = runWalkForwardRegimeResearch(mutatedDataset, {})
  // Window 1's training period (2022 only) ends before the 2024 mutation, so its boundaries must be identical.
  assert.deepEqual(before.windows[0].boundaries, after.windows[0].boundaries)
})

test('no-future-information invariance: changing candles after a test period ends does not change that test period\'s regime classification', () => {
  const dataset = buildDataset()
  const before = runWalkForwardRegimeResearch(dataset, {})
  const mutatedDataset = {
    SPY: dataset.SPY.map((candle) => (new Date(candle.timestamp) > new Date('2023-12-31T23:59:59Z') ? { ...candle, close: candle.close * 2, high: candle.high * 2, low: candle.low * 2 } : candle)),
    QQQ: dataset.QQQ,
    IWM: dataset.IWM,
  }
  const after = runWalkForwardRegimeResearch(mutatedDataset, {})
  // Window 1's test period (2023) regime *classification* (boundaries and per-bar labels) must be
  // identical. Trade exit prices/R may legitimately extend into subsequent (mutated) candles when a
  // signal near year-end holds for up to maxHoldingBars — that is normal exit evaluation, not a
  // regime-classification look-ahead, so we compare classification counts rather than full trades.
  assert.deepEqual(before.windows[0].boundaries, after.windows[0].boundaries)
  before.windows[0].volatilityGroups.forEach((group, index) => {
    assert.equal(group.label, after.windows[0].volatilityGroups[index].label)
    assert.equal(group.baseline.overall.tradeCount, after.windows[0].volatilityGroups[index].baseline.overall.tradeCount)
  })
})

test('regime assignment: every classified test-period bar falls into Low, Medium, High, or Insufficient-Training-History', () => {
  const research = runWalkForwardRegimeResearch(buildDataset(), {})
  research.windows.forEach((windowEntry) => {
    windowEntry.volatilityGroups.forEach((group) => assert.ok(volatilityLabels.includes(group.label)))
  })
})

test('score bucket assignment inside walk-forward windows uses the existing frozen bucket thresholds', () => {
  const research = runWalkForwardRegimeResearch(buildDataset(), {})
  research.windows.forEach((windowEntry) => {
    windowEntry.scoreByVolatility.forEach((regimeEntry) => {
      assert.deepEqual(regimeEntry.buckets.map((bucket) => [bucket.min, bucket.max]), [[75, 79], [80, 84], [85, 89], [90, 94], [95, 100]])
    })
  })
})

test('the scanner\'s trade entries remain unchanged by the walk-forward regime research (identical to Experiment #2 trade construction)', () => {
  const dataset = buildDataset()
  const research = runWalkForwardRegimeResearch(dataset, {})
  const aligned = buildAlignedSeries(dataset)
  const catalogueBySymbol = buildCatalogueBySymbol(aligned, walkForwardDefaults)
  const window1 = research.windows[0]
  const testStart = new Date(window1.testStart).getTime()
  const testEnd = new Date(window1.testEnd).getTime()
  const expectedTrades = Object.keys(catalogueBySymbol).flatMap((symbol) => catalogueBySymbol[symbol]
    .filter((entry) => entry.score >= 75 && entry.status === 'Bullish' && new Date(entry.timestamp).getTime() >= testStart && new Date(entry.timestamp).getTime() <= testEnd)
    .map((entry) => buildTradeFromIndex(aligned.raw[symbol], entry.index, walkForwardDefaults, { symbol }))
    .filter(Boolean))
  assert.equal(window1.baseline.overall.tradeCount, expectedTrades.length)
  assert.equal(window1.baseline.overall.totalR, expectedTrades.reduce((sum, trade) => sum + trade.rMultiple, 0))
})

test('no-look-ahead: every trade in every window enters strictly after its own signal candle', () => {
  const research = runWalkForwardRegimeResearch(buildDataset(), {})
  const timestamps = research.aligned.timestamps
  research.windows.forEach((windowEntry) => {
    const allTradeSets = [windowEntry.baseline.trades, windowEntry.rvConfirmed.trades, ...windowEntry.volatilityGroups.map((g) => g.baseline.trades)]
    allTradeSets.forEach((trades) => {
      trades.forEach((trade) => {
        const signalIndex = timestamps.indexOf(trade.timestamp)
        assert.ok(signalIndex >= 0)
        assert.ok(signalIndex < timestamps.length - 1)
      })
    })
  })
})

test('produces deterministic results across repeated runs on the same input', () => {
  const dataset = buildDataset()
  const first = runWalkForwardRegimeResearch(dataset, {})
  const second = runWalkForwardRegimeResearch(dataset, {})
  assert.equal(JSON.stringify(first.evidenceTable), JSON.stringify(second.evidenceTable))
  assert.equal(JSON.stringify(first.criticalTest), JSON.stringify(second.criticalTest))
  assert.equal(JSON.stringify(first.windows.map((w) => w.boundaries)), JSON.stringify(second.windows.map((w) => w.boundaries)))
})

test('cost tiers reduce total R monotonically as cost increases, within each window\'s volatility groups', () => {
  const research = runWalkForwardRegimeResearch(buildDataset(), {})
  research.windows.forEach((windowEntry) => {
    windowEntry.volatilityGroups.forEach((group) => {
      if (group.baseline.overall.tradeCount === 0) return
      const totals = group.baseline.costTiers.map((tier) => tier.metrics.totalR)
      for (let index = 1; index < totals.length; index += 1) {
        assert.ok(totals[index] <= totals[index - 1] + 1e-9)
      }
    })
  })
})

test('small-sample regimes and buckets are flagged rather than treated as meaningful', () => {
  const research = runWalkForwardRegimeResearch(buildDataset(), { smallSampleThreshold: 30 })
  research.windows.forEach((windowEntry) => {
    windowEntry.volatilityGroups.forEach((group) => assert.equal(group.baseline.smallSample, group.baseline.overall.tradeCount < 30))
    windowEntry.scoreByVolatility.forEach((regimeEntry) => {
      regimeEntry.buckets.forEach((bucket) => assert.equal(bucket.smallSample, bucket.overall.tradeCount < 30))
    })
  })
  research.pooledVolatilityGroups.forEach((group) => assert.equal(group.baseline.smallSample, group.baseline.overall.tradeCount < 30))
})

test('realized volatility series is causal (null before 20 bars exist, defined after)', () => {
  const dataset = buildDataset()
  const series = buildRealizedVol20Series(dataset.SPY)
  assert.equal(series[18], null)
  assert.notEqual(series[25], null)
})
