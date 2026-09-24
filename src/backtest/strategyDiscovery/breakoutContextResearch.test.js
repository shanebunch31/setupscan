import assert from 'node:assert/strict'
import { test } from 'node:test'
import { classifyTimeOfDay, runBreakoutContextResearch } from './breakoutContextResearch.js'

function makeCandle(dayIndex, hourIndex, overrides = {}) {
  const totalHours = dayIndex * 24 + hourIndex
  const day = Math.floor(totalHours / 24) + 1
  const hour = totalHours % 24
  const timestamp = `2023-01-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00Z`
  return { timeframe: '1h', timestamp, open: 100, high: 101, low: 99, close: 100, volume: 1000, ...overrides }
}

function baselineSeries(dayIndex, hours) {
  return Array.from({ length: hours }, (_, hour) => makeCandle(dayIndex, hour))
}

function buildDataset(symbol, candles, status = 'AVAILABLE') {
  return status === 'AVAILABLE' ? { symbol, status, data: { candles } } : { symbol, status }
}

// Builds a 20-bar baseline + a qualifying momentum-breakout signal (high>101, close>101,
// volume >= 1.2x average) + a controlled next-bar entry + a controlled outcome bar.
function buildBreakoutSeries(dayIndex, { outcome, volumeRatio = 3 }) {
  const baseline = baselineSeries(dayIndex, 20)
  const breakout = makeCandle(dayIndex, 20, { high: 110, close: 105, volume: 1000 * volumeRatio })
  const entry = makeCandle(dayIndex, 21, { open: 106, high: 108, low: 105, close: 107 })
  const outcomeCandle = outcome === 'win'
    ? makeCandle(dayIndex, 22, { high: 1000, low: 105, close: 500 }) // guarantees +1R target regardless of exact ATR
    : makeCandle(dayIndex, 23, { high: 108, low: 1, close: 2 }) // guarantees -1R stop regardless of exact ATR
  return [...baseline, breakout, entry, outcomeCandle]
}

test('classifyTimeOfDay buckets Eastern-time sessions correctly across both EST and EDT', () => {
  // Winter (EST, UTC-5): 14:30 UTC = 09:30 ET, the first valid Morning minute.
  assert.equal(classifyTimeOfDay('2023-01-15T14:30:00Z'), 'Morning (09:30\u201311:00 ET)')
  // Summer (EDT, UTC-4): 16:30 UTC = 12:30 ET -> Midday.
  assert.equal(classifyTimeOfDay('2023-06-15T16:30:00Z'), 'Midday (11:00\u201314:00 ET)')
  assert.equal(classifyTimeOfDay('2023-06-15T19:30:00Z'), 'Afternoon (14:00\u201316:00 ET)')
  // 20:30 ET, well outside the regular session.
  assert.equal(classifyTimeOfDay('2023-06-16T00:30:00Z'), 'Outside Regular Session (Pre/Post-Market)')
})

test('reports unavailable, without inventing results, when the SPY/QQQ/IWM universe is not fully available', () => {
  const result = runBreakoutContextResearch([buildDataset('SPY', baselineSeries(0, 25)), buildDataset('QQQ', [], 'UNAVAILABLE')])
  assert.equal(result.available, false)
  assert.deepEqual(result.missingSymbols.sort(), ['IWM', 'QQQ'])
})

test('classifies every qualifying signal into all 8 context dimensions with no signal silently dropped', () => {
  const datasets = [
    buildDataset('SPY', buildBreakoutSeries(0, { outcome: 'win' })),
    buildDataset('QQQ', baselineSeries(0, 25)),
    buildDataset('IWM', baselineSeries(0, 25)),
  ]
  const result = runBreakoutContextResearch(datasets)
  assert.equal(result.available, true)
  assert.equal(result.totalQualifyingSignals, 1)
  assert.equal(result.dimensions.length, 8)
  result.dimensions.forEach((dimension) => {
    const totalAcrossBuckets = dimension.buckets.reduce((sum, bucket) => sum + bucket.summary.overall.occurrenceCount, 0)
    assert.equal(totalAcrossBuckets, 1, `dimension ${dimension.key} should account for the one qualifying signal`)
  })
  const volumeStrength = result.dimensions.find((dimension) => dimension.key === 'volumeStrength')
  const highBucket = volumeStrength.buckets.find((bucket) => bucket.label.startsWith('Volume Strength: High'))
  assert.ok(highBucket)
  assert.equal(highBucket.lowEvidence, true) // 1 occurrence is well under the 100-occurrence protocol threshold
})

test('merges occurrences from multiple symbols into the same context bucket before summarizing (enables chronological interleaving)', () => {
  const datasets = [
    buildDataset('SPY', buildBreakoutSeries(2, { outcome: 'loss', volumeRatio: 3 })), // later calendar day
    buildDataset('QQQ', baselineSeries(0, 25)),
    buildDataset('IWM', buildBreakoutSeries(0, { outcome: 'win', volumeRatio: 3 })), // earlier calendar day
  ]
  const result = runBreakoutContextResearch(datasets)
  const volumeStrength = result.dimensions.find((dimension) => dimension.key === 'volumeStrength')
  const highBucket = volumeStrength.buckets.find((bucket) => bucket.label.startsWith('Volume Strength: High'))
  assert.equal(highBucket.summary.overall.occurrenceCount, 2)
  const symbolsRepresented = highBucket.summary.bySymbol.map((row) => row.label).sort()
  assert.deepEqual(symbolsRepresented, ['IWM', 'SPY'])
})

test('produces deterministic results across repeated runs on the same input', () => {
  const datasets = [
    buildDataset('SPY', buildBreakoutSeries(0, { outcome: 'win' })),
    buildDataset('QQQ', buildBreakoutSeries(1, { outcome: 'loss' })),
    buildDataset('IWM', baselineSeries(0, 25)),
  ]
  const strip = (result) => ({ ...result, generatedAt: null })
  assert.deepEqual(strip(runBreakoutContextResearch(datasets)), strip(runBreakoutContextResearch(datasets)))
})

test('signal classification and outcomes are causal: appending future candles well beyond the outcome window never changes an earlier signal\u2019s bucket or result', () => {
  // Entry is at index 21; MFE/MAE/secondary outcomes read up to 10 bars forward (through index
  // 31), so the base series must already have real data through that point before comparing —
  // otherwise "extending" the dataset would legitimately fill in previously-missing forward bars,
  // which is expected behavior, not a look-ahead violation.
  const padding = Array.from({ length: 15 }, (_, offset) => makeCandle(0, 23 + offset))
  const spySeries = [...buildBreakoutSeries(0, { outcome: 'win' }), ...padding]
  const baseDatasets = [buildDataset('SPY', spySeries), buildDataset('QQQ', baselineSeries(0, 25)), buildDataset('IWM', baselineSeries(0, 25))]
  const extendedDatasets = [
    buildDataset('SPY', [...spySeries, makeCandle(5, 0, { high: 9000, low: 1, close: 9000 })]),
    ...baseDatasets.slice(1),
  ]
  const base = runBreakoutContextResearch(baseDatasets)
  const extended = runBreakoutContextResearch(extendedDatasets)
  assert.equal(base.totalQualifyingSignals, extended.totalQualifyingSignals)
  const volumeStrengthBase = base.dimensions.find((d) => d.key === 'volumeStrength')
  const volumeStrengthExtended = extended.dimensions.find((d) => d.key === 'volumeStrength')
  assert.deepEqual(volumeStrengthBase.buckets, volumeStrengthExtended.buckets)
})
