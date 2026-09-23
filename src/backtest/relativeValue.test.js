import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  synchronizeCandleSeries,
  computeRatioSeries,
  computeRollingZScores,
  detectDivergences,
  evaluateMeanReversion,
  computeRelativeStrengthConfirmation,
} from './relativeValue.js'

function makeSeries(symbol, closes, { startHour = 0, skip = [], duplicateAt = [] } = {}) {
  const rows = []
  closes.forEach((close, index) => {
    const hour = startHour + index
    if (skip.includes(index)) return
    const timestamp = new Date(Date.UTC(2026, 0, 1, hour)).toISOString()
    rows.push({ symbol, timestamp, open: close, high: close + 0.5, low: close - 0.5, close, volume: 1000 })
    if (duplicateAt.includes(index)) {
      rows.push({ symbol, timestamp, open: close + 99, high: close + 99, low: close + 99, close: close + 99, volume: 1000 })
    }
  })
  return rows
}

test('candle synchronization keeps only timestamps common to every symbol', () => {
  const spy = makeSeries('SPY', [1, 2, 3, 4, 5])
  const qqq = makeSeries('QQQ', [1, 2, 3, 4, 5])
  const iwm = makeSeries('IWM', [1, 2, 3, 4, 5], { skip: [2] })
  const { timestamps, series } = synchronizeCandleSeries({ SPY: spy, QQQ: qqq, IWM: iwm })
  assert.equal(timestamps.length, 4)
  assert.equal(series.SPY.length, 4)
  assert.equal(series.QQQ.length, 4)
  assert.equal(series.IWM.length, 4)
  assert.ok(!timestamps.includes(spy[2].timestamp))
})

test('missing candle handling drops the affected bar for every symbol and reports the count', () => {
  const spy = makeSeries('SPY', [1, 2, 3, 4, 5])
  const qqq = makeSeries('QQQ', [1, 2, 3, 4, 5], { skip: [0, 4] })
  const { timestamps, series, droppedCounts } = synchronizeCandleSeries({ SPY: spy, QQQ: qqq })
  assert.equal(timestamps.length, 3)
  assert.equal(series.SPY.length, 3)
  assert.equal(droppedCounts.SPY, 2)
  assert.equal(droppedCounts.QQQ, 0)
})

test('duplicate timestamps within a symbol keep only the first occurrence', () => {
  const spy = makeSeries('SPY', [1, 2, 3], { duplicateAt: [1] })
  const qqq = makeSeries('QQQ', [1, 2, 3])
  const { series, duplicatesBySymbol } = synchronizeCandleSeries({ SPY: spy, QQQ: qqq })
  assert.equal(series.SPY.length, 3)
  assert.equal(series.SPY[1].close, 2)
  assert.equal(duplicatesBySymbol.SPY.length, 1)
})

test('relative-value ratio and rolling z-score are calculated correctly', () => {
  const primary = [10, 10, 10, 10, 20].map((close, index) => ({ timestamp: `t${index}`, close }))
  const peer = [10, 10, 10, 10, 10].map((close, index) => ({ timestamp: `t${index}`, close }))
  const ratioSeries = computeRatioSeries(primary, peer)
  assert.deepEqual(ratioSeries.map((point) => point.ratio), [1, 1, 1, 1, 2])
  const zScoreSeries = computeRollingZScores(ratioSeries, 4)
  // Window for index 3 is [1,1,1,1] -> mean 1, stdDev 0 -> zScore defined as 0 by convention.
  assert.equal(zScoreSeries[3].mean, 1)
  assert.equal(zScoreSeries[3].stdDev, 0)
  assert.equal(zScoreSeries[3].zScore, 0)
  // Window for index 4 is [1,1,1,2] -> mean 1.25, stdDev = sqrt(((.25)^2*3+(.75)^2)/4)
  const expectedMean = 1.25
  const expectedVariance = ((1 - expectedMean) ** 2 * 3 + (2 - expectedMean) ** 2) / 4
  const expectedStdDev = Math.sqrt(expectedVariance)
  assert.ok(Math.abs(zScoreSeries[4].mean - expectedMean) < 1e-9)
  assert.ok(Math.abs(zScoreSeries[4].stdDev - expectedStdDev) < 1e-9)
  assert.ok(Math.abs(zScoreSeries[4].zScore - (2 - expectedMean) / expectedStdDev) < 1e-9)
})

test('divergence detection only flags bars beyond the z-score threshold', () => {
  // Trailing window at index 5 is [10,10,10,10,20]: mean 12, stdDev 4, zScore exactly 2.
  const ratioSeries = [10, 10, 10, 10, 10, 20, 10, 10].map((ratio, index) => ({ timestamp: `t${index}`, ratio }))
  const zScoreSeries = computeRollingZScores(ratioSeries, 5)
  const divergenceSeries = detectDivergences(zScoreSeries, 2)
  assert.equal(zScoreSeries[5].zScore, 2)
  assert.equal(divergenceSeries[5].isDivergent, true)
  assert.equal(divergenceSeries[5].direction, 'PRIMARY_RICH')
  assert.equal(divergenceSeries[3].isDivergent, false)
})

test('rolling z-score has no look-ahead: value at index i is unchanged when future candles change', () => {
  const baseRatios = [1, 1.1, 0.95, 1.05, 1.2, 0.9, 1.0]
  const ratioSeriesA = baseRatios.map((ratio, index) => ({ timestamp: `t${index}`, ratio }))
  const ratioSeriesB = baseRatios.map((ratio, index) => ({ timestamp: `t${index}`, ratio: index === 5 ? ratio + 50 : ratio }))
  const zScoresA = computeRollingZScores(ratioSeriesA, 3)
  const zScoresB = computeRollingZScores(ratioSeriesB, 3)
  for (let index = 0; index < 5; index += 1) {
    assert.equal(zScoresA[index].zScore, zScoresB[index].zScore, `index ${index} should be unaffected by a future change`)
  }
})

test('relative-strength confirmation has no look-ahead and only uses trailing data', () => {
  const primary = [10, 10.5, 11, 11.5, 12, 12.5].map((close, index) => ({ timestamp: `t${index}`, close }))
  const peer = [10, 10, 10, 10, 10, 10].map((close, index) => ({ timestamp: `t${index}`, close }))
  const confirmationBefore = computeRelativeStrengthConfirmation(primary, [peer], 2)
  const mutatedPrimary = primary.map((candle, index) => (index === 5 ? { ...candle, close: 999 } : candle))
  const confirmationAfter = computeRelativeStrengthConfirmation(mutatedPrimary, [peer], 2)
  for (let index = 0; index < 5; index += 1) {
    assert.equal(confirmationBefore[index].confirmed, confirmationAfter[index].confirmed, `index ${index} should be unaffected by a later mutation`)
  }
  assert.equal(confirmationBefore[2].confirmed, true)
})

test('mean-reversion evaluation reads forward bars only for scoring, never for the entry signal', () => {
  const divergenceSeries = [1, 1, 1, 0.7, 0.8, 0.95, 1.0].map((ratio, index) => ({
    timestamp: `t${index}`,
    ratio,
    direction: index === 3 ? 'PRIMARY_CHEAP' : 'NONE',
  }))
  const evaluations = evaluateMeanReversion(divergenceSeries, [3], 3)
  assert.equal(evaluations[0].evaluated, true)
  assert.equal(evaluations[0].reverted, true)
  assert.equal(evaluations[0].startRatio, 0.7)
  assert.equal(evaluations[0].forwardRatio, 1.0)
})
