import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildMarketWideContext, marketContextSymbols } from './marketContext.js'

function makeSeries(symbol, count = 240, start = '2022-01-03T14:00:00Z') {
  const startTime = Date.parse(start)
  return Array.from({ length: count }, (_, index) => {
    const close = 100 + index * (symbol === 'SPY' ? 0.3 : symbol === 'QQQ' ? 0.2 : 0.1)
    return {
      symbol,
      timeframe: '1Hour',
      timestamp: new Date(startTime + index * 3600000).toISOString(),
      open: close - 0.1,
      high: close + 0.5,
      low: close - 0.5,
      close,
      volume: 1000,
    }
  })
}

function buildFixture() {
  return Object.fromEntries(marketContextSymbols.map((symbol) => [symbol, makeSeries(symbol)]))
}

test('future candles cannot change earlier context values', () => {
  const source = buildFixture()
  const before = buildMarketWideContext(source)
  const changed = buildFixture()
  changed.SPY = changed.SPY.map((candle, index) => (index > 60 ? { ...candle, close: candle.close * 4, high: candle.high * 4 } : candle))
  const after = buildMarketWideContext(changed)
  before.rows.slice(0, 60).forEach((row, index) => assert.deepEqual(row, after.rows[index]))
})

test('incomplete universe coverage is retained but never used for breadth', () => {
  const source = buildFixture()
  source.IWM = source.IWM.filter((_, index) => index !== 10)
  const context = buildMarketWideContext(source)
  const incomplete = context.rows.find((row) => row.timestampUTC === source.SPY[10].timestamp)
  assert.equal(incomplete.coverageStatus, 'incomplete')
  assert.equal(incomplete.coverageCount, 2)
  assert.equal(incomplete.breadth, null)
  assert.equal(incomplete.riskOnOffProxy.state, 'Insufficient-Coverage')
})

test('breadth counts and fractions are calculated only for the complete universe', () => {
  const context = buildMarketWideContext(buildFixture())
  const row = context.rows.find((entry) => entry.breadth !== null)
  assert.ok(row)
  assert.equal(row.breadth.coverageCount, 3)
  assert.equal(row.breadth.upFraction + row.breadth.mixedFraction + row.breadth.downFraction, 1)
  assert.equal(row.breadth.upCount + row.breadth.mixedCount + row.breadth.downCount, 3)
})

test('trend and volatility remain unavailable before their frozen warmups', () => {
  const context = buildMarketWideContext(buildFixture())
  const first = context.rows[0]
  assert.equal(first.symbols.SPY.trendState, 'Insufficient-History')
  assert.equal(first.symbols.SPY.volatilityState, 'Insufficient-History')
  assert.equal(first.breadth, null)
})

test('timestamps are ordered and duplicate timestamps are excluded once', () => {
  const source = buildFixture()
  source.SPY.push({ ...source.SPY[5], close: source.SPY[5].close + 100 })
  const context = buildMarketWideContext(source)
  assert.deepEqual(context.rows.map((row) => row.timestampUTC), [...context.rows].map((row) => row.timestampUTC).sort())
  assert.equal(context.metadata.duplicateTimestampsBySymbol.SPY.length, 1)
  assert.equal(new Set(context.rows.map((row) => row.timestampUTC)).size, context.rows.length)
})

test('repeated runs on the same source data are deterministic apart from retrieval metadata', () => {
  const source = buildFixture()
  const first = buildMarketWideContext(source, { retrievalAt: '2026-09-24T00:00:00Z' })
  const second = buildMarketWideContext(source, { retrievalAt: '2026-09-24T00:00:00Z' })
  assert.deepEqual(second, first)
})

test('market-context module remains separate from scanner and Strategy Discovery behavior', async () => {
  const source = await import('node:fs/promises')
  const moduleText = await source.readFile(new URL('./marketContext.js', import.meta.url), 'utf8')
  assert.doesNotMatch(moduleText, /scanner\.js|strategyDiscovery|strategy\.js/)
})