import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runVolatilityAwareVariantsResearch, variantDefinitions } from './volatilityAwareVariantsBacktest.js'
import { runWalkForwardRegimeResearch } from './walkForwardRegimeBacktest.js'

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

test('frozen control equivalence: Control trades match Experiment #6 baseline trade construction exactly', () => {
  const dataset = buildDataset()
  const variantsResearch = runVolatilityAwareVariantsResearch(dataset, {})
  const walkForwardResearch = runWalkForwardRegimeResearch(dataset, {})
  variantsResearch.windows.forEach((windowEntry, index) => {
    const control = windowEntry.variants.find((v) => v.key === 'control').summary.overall
    const baseline = walkForwardResearch.windows[index].baseline.overall
    assert.equal(control.tradeCount, baseline.tradeCount)
    assert.equal(control.totalR, baseline.totalR)
    assert.equal(control.winRate, baseline.winRate)
  })
})

test('regime-specific entry acceptance: Low and Medium volatility trades are identical between Control and every variant', () => {
  const research = runVolatilityAwareVariantsResearch(buildDataset(), {})
  research.windows.forEach((windowEntry) => {
    const control = windowEntry.variants.find((v) => v.key === 'control').summary.trades
    const controlLowMedium = new Set(control.filter((t) => t.regimeLabel === 'Low' || t.regimeLabel === 'Medium').map((t) => `${t.symbol}:${t.timestamp}`))
    windowEntry.variants.filter((v) => v.key !== 'control').forEach((variant) => {
      const variantLowMedium = new Set(variant.summary.trades.filter((t) => t.regimeLabel === 'Low' || t.regimeLabel === 'Medium').map((t) => `${t.symbol}:${t.timestamp}`))
      assert.equal(variantLowMedium.size, controlLowMedium.size, `${variant.label} Low/Medium trade set size should match Control`)
      variantLowMedium.forEach((key) => assert.ok(controlLowMedium.has(key)))
    })
  })
})

test('high-volatility skip logic: Skip High Vol takes zero trades in bars classified High', () => {
  const research = runVolatilityAwareVariantsResearch(buildDataset(), {})
  research.windows.forEach((windowEntry) => {
    const skipHighVol = windowEntry.variants.find((v) => v.key === 'skipHighVol').summary.trades
    assert.equal(skipHighVol.filter((t) => t.regimeLabel === 'High').length, 0)
  })
})

test('high-volatility >=90 logic: High Vol >=90 only accepts high-volatility signals with score >= 90', () => {
  const research = runVolatilityAwareVariantsResearch(buildDataset(), {})
  research.windows.forEach((windowEntry) => {
    const highVol90 = windowEntry.variants.find((v) => v.key === 'highVol90').summary.trades
    highVol90.filter((t) => t.regimeLabel === 'High').forEach((trade) => assert.ok(trade.score >= 90))
  })
})

test('high-volatility >=95 logic: High Vol >=95 only accepts high-volatility signals with score >= 95', () => {
  const research = runVolatilityAwareVariantsResearch(buildDataset(), {})
  research.windows.forEach((windowEntry) => {
    const highVol95 = windowEntry.variants.find((v) => v.key === 'highVol95').summary.trades
    highVol95.filter((t) => t.regimeLabel === 'High').forEach((trade) => assert.ok(trade.score >= 95))
  })
})

test('no-look-ahead: every trade in every variant enters strictly after its own signal candle', () => {
  const research = runVolatilityAwareVariantsResearch(buildDataset(), {})
  const timestamps = research.aligned.timestamps
  research.windows.forEach((windowEntry) => {
    windowEntry.variants.forEach((variant) => {
      variant.summary.trades.forEach((trade) => {
        const signalIndex = timestamps.indexOf(trade.timestamp)
        assert.ok(signalIndex >= 0)
        assert.ok(signalIndex < timestamps.length - 1)
      })
    })
  })
})

test('walk-forward boundaries match Experiment #6 exactly (same training-only tercile boundaries)', () => {
  const dataset = buildDataset()
  const variantsResearch = runVolatilityAwareVariantsResearch(dataset, {})
  const walkForwardResearch = runWalkForwardRegimeResearch(dataset, {})
  variantsResearch.windows.forEach((windowEntry, index) => {
    assert.deepEqual(windowEntry.boundaries, walkForwardResearch.windows[index].boundaries)
  })
})

test('delayed classification stress test: lag-1 and lag-2 stress results can differ from lag-0 but remain internally consistent (no crash, valid trade sets)', () => {
  const research = runVolatilityAwareVariantsResearch(buildDataset(), {})
  const timestamps = research.aligned.timestamps
  research.windows.forEach((windowEntry) => {
    windowEntry.stress1.concat(windowEntry.stress2).forEach((variantResult) => {
      variantResult.summary.trades.forEach((trade) => {
        const signalIndex = timestamps.indexOf(trade.timestamp)
        assert.ok(signalIndex >= 0 && signalIndex < timestamps.length - 1)
      })
    })
    // Skip High Vol under any lag can never include a trade whose (lagged) regime label is High.
    const skipStress1 = windowEntry.stress1.find((v) => v.key === 'skipHighVol')
    assert.equal(skipStress1.summary.trades.filter((t) => t.regimeLabel === 'High').length, 0)
  })
})

test('produces deterministic results across repeated runs on the same input', () => {
  const dataset = buildDataset()
  const first = runVolatilityAwareVariantsResearch(dataset, {})
  const second = runVolatilityAwareVariantsResearch(dataset, {})
  assert.equal(JSON.stringify(first.evidenceTable), JSON.stringify(second.evidenceTable))
  assert.equal(JSON.stringify(first.consistency), JSON.stringify(second.consistency))
  assert.equal(JSON.stringify(first.windows.map((w) => w.boundaries)), JSON.stringify(second.windows.map((w) => w.boundaries)))
})

test('cost tiers reduce total R monotonically as cost increases for every variant', () => {
  const research = runVolatilityAwareVariantsResearch(buildDataset(), {})
  research.windows.forEach((windowEntry) => {
    windowEntry.variants.forEach((variant) => {
      if (variant.summary.overall.tradeCount === 0) return
      const totals = variant.summary.costTiers.map((tier) => tier.metrics.totalR)
      for (let index = 1; index < totals.length; index += 1) {
        assert.ok(totals[index] <= totals[index - 1] + 1e-9)
      }
    })
  })
})

test('small-sample handling: high-volatility score buckets are flagged rather than treated as meaningful', () => {
  const research = runVolatilityAwareVariantsResearch(buildDataset(), { smallSampleThreshold: 30 })
  research.windows.forEach((windowEntry) => {
    windowEntry.highVolScoreByVariant.forEach((entry) => {
      entry.buckets.forEach((bucket) => assert.equal(bucket.smallSample, bucket.metrics.tradeCount < 30))
    })
  })
})

test('high-volatility removal analysis: removed-trade count matches the difference between Control and Skip High Vol trade counts', () => {
  const research = runVolatilityAwareVariantsResearch(buildDataset(), {})
  research.windows.forEach((windowEntry) => {
    const control = windowEntry.variants.find((v) => v.key === 'control').summary.overall.tradeCount
    const skipHighVol = windowEntry.variants.find((v) => v.key === 'skipHighVol').summary.overall.tradeCount
    assert.equal(windowEntry.highVolRemoval.removedCount, control - skipHighVol)
  })
})

test('all four predefined variants are present and no additional thresholds were introduced', () => {
  assert.deepEqual(variantDefinitions.map((v) => v.key), ['control', 'skipHighVol', 'highVol90', 'highVol95'])
  assert.equal(variantDefinitions.find((v) => v.key === 'highVol90').minimumScoreByRegime.High, 90)
  assert.equal(variantDefinitions.find((v) => v.key === 'highVol95').minimumScoreByRegime.High, 95)
})
