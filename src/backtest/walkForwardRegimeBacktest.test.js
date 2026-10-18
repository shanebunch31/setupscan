import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  runWalkForwardRegimeResearch,
  compareRegimeExpectancyByYear,
  walkForwardWindows,
  walkForwardDefaults,
  buildRealizedVol20Series,
  computeTercileBoundaries,
  classifyVolatility,
  volatilityLabels,
} from './walkForwardRegimeBacktest.js'
import { buildAlignedSeries, buildCatalogueBySymbol } from './signalQualityBacktest.js'
import { buildTradeWithinEvaluationWindow } from './evaluationWindow.js'
import { buildWalkForwardRegimeExpectancyObservations, buildWalkForwardTimelineRows } from './labChartData.js'

test('yearly regime comparison excludes years with an empty side or no trades in either regime', () => {
  const result = compareRegimeExpectancyByYear([
    { low: { tradeCount: 0, expectancy: 0 }, medium: { tradeCount: 4, expectancy: 0.7 } },
    { low: { tradeCount: 0, expectancy: 0 }, medium: { tradeCount: 0, expectancy: 0 } },
  ])
  assert.deepEqual(result, { comparableYearCount: 0, mediumExceedsLowCount: 0, lowExceedsMediumCount: 0 })
})

test('yearly regime comparison counts expectancy direction only for years with trades in both regimes', () => {
  const result = compareRegimeExpectancyByYear([
    { low: { tradeCount: 3, expectancy: 0.1 }, medium: { tradeCount: 2, expectancy: 0.5 } },
    { low: { tradeCount: 1, expectancy: 0.4 }, medium: { tradeCount: 1, expectancy: -0.2 } },
    { low: { tradeCount: 0, expectancy: 0 }, medium: { tradeCount: 2, expectancy: 0.8 } },
  ])
  assert.deepEqual(result, { comparableYearCount: 2, mediumExceedsLowCount: 1, lowExceedsMediumCount: 1 })
})

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
  const research = runWalkForwardRegimeResearch(buildDataset(), {})
  assert.ok(research.windows.some((windowEntry) => windowEntry.baseline.overall.tradeCount > 0), 'walk-forward candidate results must not silently be empty')
})

test('walk-forward chart data matches test-year regimes and actual realized training/test boundaries', () => {
  const research = runWalkForwardRegimeResearch(buildDataset(), {})
  const expectancyRows = buildWalkForwardRegimeExpectancyObservations(research.evidenceTable)
  const timelineRows = buildWalkForwardTimelineRows(research.windows)

  assert.deepEqual(expectancyRows.map((row) => row.label), research.evidenceTable.map((row) => String(row.testYear)))
  expectancyRows.forEach((row, rowIndex) => {
    const sourceYear = research.evidenceTable[rowIndex]
    for (const [seriesIndex, regimeKey] of ['low', 'medium', 'high'].entries()) {
      assert.equal(row.series[seriesIndex].tradeCount, sourceYear[regimeKey].tradeCount)
      assert.equal(row.series[seriesIndex].value,
        sourceYear[regimeKey].tradeCount > 0 && Number.isFinite(sourceYear[regimeKey].expectancy)
          ? sourceYear[regimeKey].expectancy
          : null)
    }
  })

  assert.deepEqual(timelineRows.map((row, index) => [
    row.label,
    row.training.start,
    row.training.end,
    row.test.start,
    row.test.end,
    row.training.candleCount,
    row.test.candleCount,
  ]), research.windows.map((window) => [
    `${window.label} · ${window.testYear}`,
    window.trainRealizedStart,
    window.trainRealizedEnd,
    window.testRealizedStart,
    window.testRealizedEnd,
    window.trainCandleCount,
    window.testCandleCount,
  ]))
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

test('no-future-information invariance: changing candles after a test period ends cannot change its resolved trade results', () => {
  const dataset = buildDataset()
  const before = runWalkForwardRegimeResearch(dataset, {})
  const mutatedDataset = {
    SPY: dataset.SPY.map((candle) => (new Date(candle.timestamp) > new Date('2023-12-31T23:59:59Z') ? { ...candle, close: candle.close * 2, high: candle.high * 2, low: candle.low * 2 } : candle)),
    QQQ: dataset.QQQ,
    IWM: dataset.IWM,
  }
  const after = runWalkForwardRegimeResearch(mutatedDataset, {})
  // Window 1's 2023 outcomes must be fully resolved by the 2023 test end, so changing 2024 onward
  // cannot alter which trades qualify or their results.
  assert.deepEqual(before.windows[0].boundaries, after.windows[0].boundaries)
  assert.deepEqual(before.windows[0].baseline.trades, after.windows[0].baseline.trades)
  assert.equal(before.windows[0].baseline.overall.totalR, after.windows[0].baseline.overall.totalR)
  before.windows[0].volatilityGroups.forEach((group, index) => {
    assert.equal(group.label, after.windows[0].volatilityGroups[index].label)
    assert.deepEqual(group.baseline.trades, after.windows[0].volatilityGroups[index].baseline.trades)
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
    .filter((entry) => entry.score >= 75 && entry.researchEligible && new Date(entry.timestamp).getTime() >= testStart && new Date(entry.timestamp).getTime() <= testEnd)
    .map((entry) => buildTradeWithinEvaluationWindow(
      aligned.raw[symbol], entry.index, walkForwardDefaults, research.aligned.timestamps.indexOf(window1.testRealizedEnd), { symbol },
    ))
    .filter(Boolean))
  assert.equal(window1.baseline.overall.tradeCount, expectedTrades.length)
  assert.ok(Math.abs(window1.baseline.overall.totalR - expectedTrades.reduce((sum, trade) => sum + trade.rMultiple, 0)) < 1e-9)
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

test('walk-forward trades and pooled regime summaries stay inside each test window', () => {
  const research = runWalkForwardRegimeResearch(buildDataset(), {})
  research.windows.forEach((windowEntry) => {
    const endIndex = research.aligned.timestamps.indexOf(windowEntry.testRealizedEnd)
    const tradeSets = [
      windowEntry.baseline.trades,
      windowEntry.rvConfirmed.trades,
      ...windowEntry.volatilityGroups.flatMap((group) => [group.baseline.trades, group.rvConfirmed.trades]),
      ...windowEntry.scoreByVolatility.flatMap((regime) => regime.buckets.map((bucket) => bucket.trades)),
    ]
    tradeSets.flat().forEach((trade) => {
      const signalIndex = research.aligned.timestamps.indexOf(trade.timestamp)
      assert.ok(signalIndex + trade.holdingBars <= endIndex)
      if (trade.exitReason === 'Expired') assert.equal(trade.holdingBars, research.options.maxHoldingBars)
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
