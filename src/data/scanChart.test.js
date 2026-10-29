import test from 'node:test'
import assert from 'node:assert/strict'
import { chartSessionKey, completedChartCandles, createScanChartRange, selectChartRange } from './scanChart.js'
import { scanSetups } from '../logic/scanner.js'
import { groupScannerEvidence } from '../scanEvidence.js'
import { operationalCheckState } from '../home/operationalCheck.js'

const bar = (timestamp) => ({ timestamp, open: 100, high: 102, low: 99, close: 101, volume: 1000 })
test('chart ranges use actual Eastern sessions across weekends and DST, not bar counts', () => {
  const days = ['2025-03-03', '2025-03-04', '2025-03-05', '2025-03-06', '2025-03-07', '2025-03-10', '2025-03-11']
  const candles = days.flatMap((date, i) => [bar(date + 'T15:00:00Z'), ...(i % 2 ? [bar(date + 'T16:00:00Z')] : [])])
  const expected = { '1D': ['2025-03-11', 1], '3D': ['2025-03-07', 3], '5D': ['2025-03-05', 5], ALL: ['2025-03-03', 7] }
  for (const [range, [first, count]] of Object.entries(expected)) {
    const shown = selectChartRange([...candles].reverse(), range)
    assert.equal(chartSessionKey(shown[0].timestamp), first)
    assert.equal(chartSessionKey(shown.at(-1).timestamp), '2025-03-11')
    assert.equal(new Set(shown.map((item) => chartSessionKey(item.timestamp))).size, count)
  }
  assert.equal(chartSessionKey('2025-03-11T00:30:00Z'), '2025-03-10')
  assert.equal(candles[0].timestamp, '2025-03-03T15:00:00Z')
})
test('chart excludes forming/invalid candles and preserves all available completed history', () => {
  const now = Date.parse('2025-03-11T17:30:00Z')
  const candles = [bar('2025-03-11T17:00:00Z'), bar('2025-03-11T16:00:00Z'), { ...bar('2025-03-11T15:00:00Z'), close: NaN }]
  assert.deepEqual(completedChartCandles(candles, now).map((item) => item.timestamp), ['2025-03-11T16:00:00Z'])
  const many = Array.from({ length: 80 }, (_, i) => bar(new Date(now - (i + 2) * 3600000).toISOString()))
  assert.equal(completedChartCandles(many, now).length, 80)
  const range = createScanChartRange(new Date(now))
  assert.equal(Date.parse(range.end) - Date.parse(range.start), 30 * 86400000)
  assert.deepEqual(selectChartRange([], 'ALL'), [])
})
test('partial-credit production scanner reasons remain missing full confirmation', () => {
  const [result] = scanSetups([{ symbol: 'TEST', price: 101, vwap: 100, ema9: 101, ema21: 99, rsi: 50, relativeVolume: 1.1, breakout: true, trend: 'Bullish' }])
  const before = JSON.stringify(result)
  const grouped = groupScannerEvidence(result.reasons)
  assert.deepEqual(grouped.missing.map((reason) => reason.label), ['RSI momentum', 'Relative volume'])
  assert.ok(grouped.missing.every((reason) => reason.points === 8))
  assert.equal(grouped.passed.length, 4)
  assert.equal(JSON.stringify(result), before)
})
test('operational state never reports healthy while checks are pending or warning', () => {
  assert.deepEqual(operationalCheckState(), { tone: 'healthy', title: 'All Systems Normal' })
  assert.equal(operationalCheckState({ loading: true }).tone, 'checking')
  assert.equal(operationalCheckState({ warnings: ['Unavailable'] }).title, 'Needs Attention')
  assert.equal(operationalCheckState({ warnings: ['Unavailable'], loading: true }).tone, 'warning')
})
