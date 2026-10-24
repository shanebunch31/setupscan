import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { buildCandidateExitPair, summarizeCandidateExitPairs, runCandidateExitManagement, candidateExitConfiguration } from './candidateExitManagement.js'
import { createTrailingStopTrade } from './candidateTrailingStopTrade.js'
import { runTrailingStopBacktest } from './strategy.js'
import { buildJoinedContextStudyInput } from './joinedContextStudy.js'
import { candidateDefinition, candidatePeriods } from './candidateContextRobustness.js'

const period = { key: 'development', type: 'development', start: '2022-01-01T00:00:00Z', end: '2024-12-31T23:59:59.999Z' }
const record = (timestamp = '2024-06-03T14:00:00.000Z') => ({ id: `SPY:${timestamp}`, symbol: 'SPY', timestamp,
  decisionTimestamp: new Date(Date.parse(timestamp) + 3600000).toISOString(), score: 85, membershipRule: 'research-eligible-75-plus' })
function candles(overrides = [], timestamp = '2024-06-03T14:00:00.000Z', length = 13) {
  return Array.from({ length }, (_, i) => ({ symbol: 'SPY', timeframe: '1Hour', timestamp: new Date(Date.parse(timestamp) + i * 3600000).toISOString(),
    open: 100, high: 100.2, low: 99.9, close: 100, volume: 1000, ...overrides[i] }))
}
const pairFor = (overrides, length = 13) => buildCandidateExitPair(record(), candles(overrides, undefined, length), 0)
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-10, `${a} != ${b}`)

test('isolated trailing routine is identical to the private historical implementation', async () => {
  const source = await readFile(new URL('./strategy.js', import.meta.url), 'utf8')
  const expected = source.slice(source.indexOf('function createTrailingStopTrade('), source.indexOf('export function runTrailingStopBacktest(')).trim().replace(/\r\n/g, '\n')
  assert.equal(createTrailingStopTrade.toString().replace(/\r\n/g, '\n'), expected)
  const rows = candles([{ price: 110, vwap: 100, ema9: 102, ema21: 101, rsi: 60, relativeVolume: 1.3, breakout: true, trend: 'Bullish' },
    { high: 100.6 }, { open: 100.5, high: 100.8, low: 100.4 }, { open: 100.7, low: 100.4, high: 100.8 }])
  const native = runTrailingStopBacktest(rows, candidateExitConfiguration).trades
  assert.equal(native.length, 1)
  const { entryTimestamp: _, ...challenger } = buildCandidateExitPair({ ...record(), score: 100, setupType: native[0].setupType }, rows, 0).exits.trailing.trade
  assert.deepEqual(challenger, native[0])
})

test('same signal and entry; below +1R cannot activate; initial stop is unchanged', () => {
  const pair = pairFor([{}, { high: 100.499 }, { low: 99.5 }])
  for (const method of ['fixed', 'trailing']) {
    const trade = pair.exits[method].trade
    assert.equal(trade.timestamp, pair.timestamp)
    assert.equal(trade.entryTimestamp, pair.entryTimestamp)
    assert.equal(trade.entryPrice, 100)
    assert.equal(trade.targetPrice, 101)
    assert.equal(trade.exitReason, 'Stop')
    assert.equal(trade.exitPrice, 99.5)
  }
  assert.equal(pair.exits.trailing.trade.trailingStopActive, false)
})

test('activation at +1R uses exactly 0.3%, applies only on later candles and never lowers the stop', () => {
  const pair = pairFor([{}, { high: 100.5, low: 99.9 }, { open: 100.5, high: 100.8, low: 100.3 },
    { open: 100.6, high: 100.7, low: 100.55 }, { open: 100.6, high: 100.7, low: 100.4 }])
  const trade = pair.exits.trailing.trade
  assert.equal(trade.exitReason, 'Trailing Stop')
  assert.equal(trade.holdingBars, 4)
  assert.equal(trade.highestPrice, 100.8)
  close(trade.stopPrice, 100.8 * .997)
  assert.equal(trade.exitPrice, trade.stopPrice)
  assert.equal(trade.trailingStopActive, true)
})

test('both exits retain the 2R target and conservative target gap price', () => {
  for (const bar of [{ high: 101 }, { open: 102, high: 102.5, low: 99 }]) {
    const pair = pairFor([{}, {}, bar])
    for (const { trade } of Object.values(pair.exits)) {
      assert.equal(trade.exitReason, 'Target')
      assert.equal(trade.exitPrice, 101)
      assert.equal(trade.rMultiple, 2)
    }
  }
})

test('12-bar expiry retains final trailing state and dataset truncation stays excluded', () => {
  const overrides = Array.from({ length: 13 }, () => ({}))
  overrides[12] = { high: 100.5, close: 100.3 }
  const pair = pairFor(overrides)
  for (const { trade, exclusionReason } of Object.values(pair.exits)) {
    assert.equal(trade.holdingBars, 12)
    assert.equal(trade.exitReason, 'Expired')
    assert.equal(exclusionReason, null)
  }
  assert.equal(pair.exits.trailing.trade.trailingStopActive, true)
  close(pair.exits.trailing.trade.stopPrice, 100.5 * .997)
  const short = pairFor([], 4)
  for (const exit of Object.values(short.exits)) assert.equal(exit.exclusionReason, 'incomplete-holding-window')
  const absent = pairFor([], 1)
  assert.equal(absent.entryTimestamp, null)
  assert.equal(absent.exits.trailing.trade, null)
})

test('adverse fixed and trailing gaps fill at open; both-barrier candles remain stop-first', () => {
  const initial = pairFor([{}, {}, { open: 99, high: 101.2, low: 98.9 }])
  for (const { trade } of Object.values(initial.exits)) assert.equal(trade.exitPrice, 99)
  const gap = pairFor([{}, { high: 100.6 }, { open: 100.1, high: 101.2, low: 100 }])
  assert.equal(gap.exits.trailing.trade.exitReason, 'Trailing Stop')
  assert.equal(gap.exits.trailing.trade.exitPrice, 100.1)
  const ambiguous = pairFor([{}, { high: 101.2, low: 99.4 }])
  for (const { trade } of Object.values(ambiguous.exits)) {
    assert.equal(trade.exitReason, 'Stop')
    assert.equal(trade.ambiguousCandle, true)
    assert.equal(trade.rMultiple, -1)
  }
  const active = pairFor([{}, { high: 100.6 }, { open: 100.5, high: 101.2, low: 100.2 }])
  assert.equal(active.exits.trailing.trade.exitReason, 'Trailing Stop')
  assert.equal(active.exits.trailing.trade.ambiguousCandle, true)
})

test('non-round entry risk, signal-candle extremes and no hindsight activation', () => {
  const rows = candles().map((bar) => ({ ...bar, open: 137.25, close: 137.25, high: 137.4, low: 137.2 }))
  rows[0].high = 200; rows[0].low = 50
  rows[1].high = 137.25 * 1.005 - .00001
  rows[2].high = 137.25 + 137.25 * .005
  rows[3].low = 137.25
  const trade = buildCandidateExitPair(record(), rows, 0).exits.trailing.trade
  assert.equal(trade.holdingBars, 3)
  assert.equal(trade.exitReason, 'Trailing Stop')
  close(trade.initialStopPrice, 137.25 * .995)
  close(trade.stopPrice, rows[2].high * .997)
})

function syntheticPair(day, r = 1, symbol = 'SPY') {
  const occurrence = record(`${day}T14:00:00.000Z`)
  const exit = { trade: { rMultiple: r, holdingBars: 2, holdingTime: 120, exitReason: r > 0 ? 'Target' : 'Stop', ambiguousCandle: false }, outcomeTimestamp: `${day}T17:00:00.000Z`, exclusionReason: null }
  return { ...occurrence, symbol, exits: { fixed: structuredClone(exit), trailing: structuredClone(exit) } }
}

test('all years, development/recent and four costs preserve true zero and unavailable evidence', () => {
  const pairs = [2022, 2023, 2024, 2025, 2026].map((year) => syntheticPair(`${year}-06-03`, 0))
  const periods = candidatePeriods('2026-10-23T16:00:00Z')
  const rows = summarizeCandidateExitPairs(pairs, ['SPY', 'QQQ'], periods)
  for (const row of rows) {
    assert.equal(row.resolvedCount, row.symbol === 'QQQ' ? 0 : row.period.key === 'development' ? 3 : row.period.key === 'recent' ? 2 : 1)
    assert.deepEqual(row.costTiers.map((tier) => tier.costR), [0, .02, .05, .1])
    for (const tier of row.costTiers) {
      if (!row.resolvedCount) assert.equal(tier.metrics, null)
      else {
        close(tier.metrics.averageR, -tier.costR)
        close(tier.metrics.totalR, -row.resolvedCount * tier.costR)
        close(tier.metrics.maximumDrawdown, row.resolvedCount * tier.costR)
      }
    }
  }
  assert.equal(periods.at(-1).end, '2026-10-23T16:00:00.000Z')
})

test('outcome exclusions are paired, including yearly and original 2024/2025/2026 boundaries', () => {
  const p = syntheticPair('2023-12-31')
  p.exits.fixed.outcomeTimestamp = '2024-01-01T01:00:00Z'
  const rows = summarizeCandidateExitPairs([p], ['SPY'], candidatePeriods('2026-10-23T16:00:00Z'))
  const year = rows.filter((r) => r.period.key === 'year-2023')
  assert.ok(year.every((r) => r.resolvedCount === 0 && r.accounting.pairedExcludedCount === 1))
  assert.equal(year[1].accounting.individuallyResolvedCount, 1)
  assert.equal(rows.find((r) => r.period.key === 'development').resolvedCount, 1)
  for (const year of [2024, 2025]) {
    const time = `${year}-12-31T22:00:00.000Z`
    const pair = buildCandidateExitPair(record(time), candles([], time), 0)
    assert.equal(pair.exits.fixed.exclusionReason, 'outcome-crosses-period')
    assert.equal(pair.exits.trailing.exclusionReason, 'outcome-crosses-period')
  }
})

test('day sensitivity reuses Eastern clustering, union removal and cost calculations', () => {
  const pairs = Array.from({ length: 12 }, (_, i) => syntheticPair(`2024-06-${String(i + 1).padStart(2, '0')}`, i - 3))
  // UTC next day but the same Eastern signal day as the first record.
  pairs.push({ ...syntheticPair('2024-06-02', 0), decisionTimestamp: '2024-06-02T01:00:00Z' })
  const row = summarizeCandidateExitPairs(pairs, ['SPY'], [period])[0]
  assert.equal(row.clustering.uniqueSignalDays, 12)
  assert.equal(row.concentration[0].summary.resolvedCount, 13)
  const top = row.concentration[1], both = row.concentration[2]
  assert.equal(top.remainingDays, 7)
  assert.equal(top.summary.resolvedCount, 8)
  assert.equal(top.summary.metrics.totalR, 0) // -3..3 plus zero
  assert.equal(both.remainingDays, 2)
  assert.equal(both.summary.resolvedCount, 2)
  assert.equal(both.summary.metrics.totalR, 5) // 2 + 3
  close(both.summary.costTiers.at(-1).metrics.totalR, 4.8)
  assert.equal(row.clustering.topFiveTotalR, 30) // 4..8
})

test('evidence strength uses the common resolved sample: under 30, 30–99, 100+', () => {
  for (const [n, label] of [[0, 'insufficient-evidence'], [29, 'insufficient-evidence'], [30, 'exploratory'], [99, 'exploratory'], [100, 'stronger-descriptive-evidence']]) {
    const row = summarizeCandidateExitPairs(Array.from({ length: n }, () => syntheticPair('2024-06-03')), ['SPY'], [period])[0]
    assert.equal(row.evidenceStrength, label)
    assert.equal(row.averageHoldingBars, n ? 2 : null)
    assert.deepEqual(row.exitReasonCounts, n ? { Target: n } : {})
  }
})

test('real shared candidate pipeline yields nonzero paired signals for requested symbols without changing inputs', () => {
  const raw = Object.fromEntries(['SPY', 'QQQ', 'IWM'].map((symbol) => [symbol, Array.from({ length: 1200 }, (_, i) => {
    const close = 100 + i * .03 + Math.sin(i / 6)
    return { symbol, timeframe: '1Hour', timestamp: new Date(Date.UTC(2024, 0, 1) + i * 3600000).toISOString(), open: close, close, high: close + .2, low: close - .2, volume: 1000 + i }
  })]))
  const before = structuredClone(raw), options = { requestedEnd: '2024-06-01T00:00:00Z' }
  const native = buildJoinedContextStudyInput(raw, options)
  const expected = native.records.filter((r) => candidateDefinition.conditions.every(([field, value]) => r.contexts[field].available && r.contexts[field].value === value))
  const result = runCandidateExitManagement(raw, options)
  assert.ok(result.pairs.length > 0)
  assert.deepEqual(result.pairs.map((p) => p.id), expected.map((p) => p.id))
  assert.deepEqual(result.symbols, ['IWM', 'QQQ', 'SPY'])
  for (const pair of result.pairs) {
    for (const exit of Object.values(pair.exits)) {
      assert.equal(exit.trade.timestamp, pair.timestamp)
      assert.equal(exit.trade.entryTimestamp, pair.entryTimestamp)
      assert.equal(exit.trade.entryPrice, pair.entryPrice)
    }
    const fixed = expected.find((r) => r.id === pair.id).trade
    if (fixed) assert.equal(pair.exits.fixed.trade.rMultiple, fixed.rMultiple)
  }
  assert.ok(result.rows.filter((r) => r.period.key === 'full').every((r) => r.resolvedCount > 0))
  assert.deepEqual(raw, before)
  const arbitrary = runCandidateExitManagement({ XYZ: raw.SPY.map((bar) => ({ ...bar, symbol: 'XYZ' })) }, options)
  assert.deepEqual(arbitrary.symbols, ['XYZ'])
  assert.ok(arbitrary.pairs.length > 0)
  assert.equal(arbitrary.regimeSourceSymbol, 'XYZ')
})

test('incomplete hours, invalid inputs and no shared observations fail safely with coverage', () => {
  const raw = candles([], undefined, 14)
  const result = runCandidateExitManagement({ SPY: [...raw, { ...raw[0] }, { ...raw[0], open: -1 }] }, { requestedEnd: raw[13].timestamp })
  assert.equal(result.coverage.completionExcludedCounts.SPY, 1)
  assert.equal(result.coverage.dataQuality.SPY.rejectedCandleCount, 1)
  assert.equal(result.coverage.dataQuality.SPY.duplicateCandleCount, 1)
  assert.equal(runCandidateExitManagement({ SPY: [] }).available, false)
  assert.equal(runCandidateExitManagement({ SPY: raw.map((bar) => ({ ...bar, timeframe: '5Min' })) }).available, false)
  assert.equal(runCandidateExitManagement({ SPY: raw }, { requestedEnd: 'bad' }).available, false)
})
