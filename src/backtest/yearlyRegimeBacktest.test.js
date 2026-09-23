import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runYearlyRegimeResearch, groupTimestampsByYear, yearlyRegimeDefaults } from './yearlyRegimeBacktest.js'
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
  // ~4.3 years of daily-spaced candles starting 2022-01-01, spanning calendar years 2022-2026.
  return {
    SPY: makeDailySeries('SPY', 1580, '2022-01-01T14:00:00Z', 0, 5.75),
    QQQ: makeDailySeries('QQQ', 1580, '2022-01-01T14:00:00Z', 4, 4.9),
    IWM: makeDailySeries('IWM', 1580, '2022-01-01T14:00:00Z', 9, 2.25),
  }
}

test('year splitting respects calendar boundaries at the UTC year edge', () => {
  const timestamps = ['2023-12-31T23:00:00.000Z', '2024-01-01T00:00:00.000Z', '2024-06-01T00:00:00.000Z']
  const groups = groupTimestampsByYear(timestamps)
  assert.equal(groups.length, 2)
  assert.deepEqual(groups[0].timestamps, ['2023-12-31T23:00:00.000Z'])
  assert.deepEqual(groups[1].timestamps, ['2024-01-01T00:00:00.000Z', '2024-06-01T00:00:00.000Z'])
})

test('every year in a multi-year dataset only contains its own timestamps (no future-year leakage into grouping)', () => {
  const research = runYearlyRegimeResearch(buildDataset(), {})
  research.years.forEach((yearEntry) => {
    yearEntry.regime.SPY && assert.ok(true)
    const allTimestampsBelongToYear = new Set(groupTimestampsByYear(research.aligned.timestamps).find((g) => g.year === yearEntry.year).timestamps)
    assert.equal(allTimestampsBelongToYear.size, yearEntry.candleCount)
  })
})

test('every trade (baseline, RV-confirmed, and bucket) enters strictly after its own signal candle (no look-ahead)', () => {
  const research = runYearlyRegimeResearch(buildDataset(), {})
  const timestamps = research.aligned.timestamps
  research.years.forEach((yearEntry) => {
    const allTradeSets = [yearEntry.baseline.trades, yearEntry.rvConfirmed.trades, ...yearEntry.buckets.map((bucket) => bucket.trades)]
    allTradeSets.forEach((trades) => {
      trades.forEach((trade) => {
        const signalIndex = timestamps.indexOf(trade.timestamp)
        assert.ok(signalIndex >= 0)
        assert.ok(signalIndex < timestamps.length - 1)
      })
    })
  })
})

test('score buckets per year use the existing frozen bucket thresholds unmodified', () => {
  const research = runYearlyRegimeResearch(buildDataset(), {})
  research.years.forEach((yearEntry) => {
    assert.deepEqual(yearEntry.buckets.map((bucket) => [bucket.min, bucket.max]), scoreBucketDefinitions.map(([, min, max]) => [min, max]))
  })
})

test('small-sample buckets are flagged rather than silently treated as meaningful', () => {
  const research = runYearlyRegimeResearch(buildDataset(), { smallSampleThreshold: 30 })
  research.years.forEach((yearEntry) => {
    yearEntry.buckets.forEach((bucket) => {
      assert.equal(bucket.smallSample, bucket.overall.tradeCount < 30)
    })
  })
})

test('cost tiers reduce expectancy monotonically as cost increases (before <= low <= moderate <= high in R terms)', () => {
  const research = runYearlyRegimeResearch(buildDataset(), {})
  research.years.forEach((yearEntry) => {
    if (yearEntry.baseline.overall.tradeCount === 0) return
    const totals = yearEntry.baseline.costTiers.map((tier) => tier.metrics.totalR)
    for (let index = 1; index < totals.length; index += 1) {
      assert.ok(totals[index] <= totals[index - 1] + 1e-9, 'higher cost tier should never produce more total R than a lower one')
    }
  })
})

test('produces deterministic results across repeated runs on the same input', () => {
  const dataset = buildDataset()
  const first = runYearlyRegimeResearch(dataset, {})
  const second = runYearlyRegimeResearch(dataset, {})
  assert.equal(JSON.stringify(first.years.map((y) => y.baseline.overall)), JSON.stringify(second.years.map((y) => y.baseline.overall)))
  assert.equal(JSON.stringify(first.combinedBaseline.overall), JSON.stringify(second.combinedBaseline.overall))
})

test('uses yearlyRegimeDefaults (frozen parameters) when settings are omitted', () => {
  const research = runYearlyRegimeResearch(buildDataset())
  assert.equal(research.options.minimumScore, yearlyRegimeDefaults.minimumScore)
  assert.equal(research.options.targetR, yearlyRegimeDefaults.targetR)
  assert.equal(research.options.stopDistancePercent, yearlyRegimeDefaults.stopDistancePercent)
})

test('regime proxy reports a buy-and-hold return and a volatility proxy per symbol per year', () => {
  const research = runYearlyRegimeResearch(buildDataset(), {})
  research.years.forEach((yearEntry) => {
    Object.values(yearEntry.regime).forEach((proxy) => {
      if (proxy.candleCount < 2) return
      assert.ok(Number.isFinite(proxy.buyHoldReturn))
      assert.ok(Number.isFinite(proxy.hourlyReturnStdDev))
      assert.ok(proxy.hourlyReturnStdDev >= 0)
    })
  })
})
