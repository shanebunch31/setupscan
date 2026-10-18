import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildWalkForwardRegimeExpectancyObservations,
  buildWalkForwardTimelineRows,
  buildVolatilityAwareControlDifferenceObservations,
  buildVolatilityAwareExpectancyObservations,
  buildYearlyExpectancyObservations,
} from './labChartData.js'

test('yearly chart observations match the existing baseline and RV-confirmed expectancy summaries', () => {
  const years = [
    {
      year: 2023,
      start: '2023-01-01T00:00:00.000Z',
      end: '2023-12-31T23:00:00.000Z',
      baseline: { overall: { tradeCount: 4, expectancy: 0 } },
      rvConfirmed: { overall: { tradeCount: 2, expectancy: -0.25 } },
    },
    {
      year: 2024,
      baseline: { overall: { tradeCount: 0, expectancy: 0 } },
      rvConfirmed: { overall: { tradeCount: 1, expectancy: 0.5 } },
    },
  ]

  assert.deepEqual(buildYearlyExpectancyObservations(years), [
    {
      label: '2023',
      detail: '2023-01-01T00:00:00.000Z through 2023-12-31T23:00:00.000Z UTC',
      series: [
        { label: 'Baseline', value: 0, tradeCount: 4 },
        { label: 'RV-confirmed', value: -0.25, tradeCount: 2 },
      ],
    },
    {
      label: '2024',
      detail: 'Date range unavailable',
      series: [
        { label: 'Baseline', value: null, tradeCount: 0 },
        { label: 'RV-confirmed', value: 0.5, tradeCount: 1 },
      ],
    },
  ])
})

test('yearly chart keeps missing counts and metrics unavailable instead of converting them to zero', () => {
  const [observation] = buildYearlyExpectancyObservations([{
    year: 2025,
    baseline: { overall: { expectancy: 0 } },
    rvConfirmed: { overall: { tradeCount: 3, expectancy: null } },
  }])
  assert.deepEqual(observation.series, [
    { label: 'Baseline', value: null, tradeCount: null },
    { label: 'RV-confirmed', value: null, tradeCount: 3 },
  ])
})

test('walk-forward regime chart preserves test-year order and each regime count and expectancy', () => {
  const rows = buildWalkForwardRegimeExpectancyObservations([
    {
      testYear: 2024,
      low: { tradeCount: 2, expectancy: 0.1 },
      medium: { tradeCount: 1, expectancy: 0 },
      high: { tradeCount: 0, expectancy: 0 },
    },
    {
      testYear: 2025,
      low: { tradeCount: 0, expectancy: 0 },
      medium: { tradeCount: 3, expectancy: -0.2 },
      high: { tradeCount: 1, expectancy: 0.4 },
    },
  ])
  assert.deepEqual(rows, [
    { label: '2024', series: [
      { label: 'Low volatility', value: 0.1, tradeCount: 2 },
      { label: 'Medium volatility', value: 0, tradeCount: 1 },
      { label: 'High volatility', value: null, tradeCount: 0 },
    ] },
    { label: '2025', series: [
      { label: 'Low volatility', value: null, tradeCount: 0 },
      { label: 'Medium volatility', value: -0.2, tradeCount: 3 },
      { label: 'High volatility', value: 0.4, tradeCount: 1 },
    ] },
  ])
})

test('walk-forward timeline uses actual realized date boundaries and leaves missing ranges unavailable', () => {
  const [row] = buildWalkForwardTimelineRows([{
    label: 'Window 2',
    testYear: 2024,
    trainRealizedStart: '2022-01-03T14:30:00.000Z',
    trainRealizedEnd: '2023-12-29T21:00:00.000Z',
    testRealizedStart: '2024-01-02T14:30:00.000Z',
    testRealizedEnd: '2024-12-31T21:00:00.000Z',
    trainCandleCount: 1800,
    testCandleCount: 900,
  }])
  assert.deepEqual(row, {
    label: 'Window 2 · 2024',
    testYear: '2024',
    training: { start: '2022-01-03T14:30:00.000Z', end: '2023-12-29T21:00:00.000Z', candleCount: 1800 },
    test: { start: '2024-01-02T14:30:00.000Z', end: '2024-12-31T21:00:00.000Z', candleCount: 900 },
  })

  const [missing] = buildWalkForwardTimelineRows([{ label: 'Empty', testYear: 2026 }])
  assert.deepEqual(missing.training, { start: null, end: null, candleCount: null })
  assert.deepEqual(missing.test, { start: null, end: null, candleCount: null })
})

test('empty chart inputs remain empty', () => {
  assert.deepEqual(buildYearlyExpectancyObservations(), [])
  assert.deepEqual(buildWalkForwardRegimeExpectancyObservations(), [])
  assert.deepEqual(buildWalkForwardTimelineRows(), [])
  assert.deepEqual(buildVolatilityAwareExpectancyObservations(), [])
  assert.deepEqual(buildVolatilityAwareControlDifferenceObservations(), [])
})

test('variant chart preserves actual window order, counts, dates, and zero versus unavailable expectancy', () => {
  const [row] = buildVolatilityAwareExpectancyObservations([{
    label: 'Window 1', testYear: 2024,
    testRealizedStart: '2024-01-02T14:30:00.000Z', testRealizedEnd: '2024-12-31T21:00:00.000Z',
    variants: [
      { label: 'Control', summary: { overall: { tradeCount: 2, expectancy: 0 } } },
      { label: 'Skip High Vol', summary: { overall: { tradeCount: 0, expectancy: 0 } } },
      { label: 'High Vol >=90', summary: { overall: { tradeCount: 1, expectancy: -0.25 } } },
      { label: 'High Vol >=95', summary: { overall: { expectancy: 0.5 } } },
    ],
  }])
  assert.equal(row.label, 'Window 1 · 2024')
  assert.equal(row.detail, '2024-01-02T14:30:00.000Z through 2024-12-31T21:00:00.000Z UTC')
  assert.deepEqual(row.series, [
    { label: 'Control', value: 0, tradeCount: 2 },
    { label: 'Skip High Vol', value: null, tradeCount: 0 },
    { label: 'High Vol >=90', value: -0.25, tradeCount: 1 },
    { label: 'High Vol >=95', value: null, tradeCount: null },
  ])
})

test('variant-control differences require both samples and retain genuine zero differences and both counts', () => {
  const [row] = buildVolatilityAwareControlDifferenceObservations([{
    label: 'Window 1', testYear: 2024,
    diffsVsControl: [
      { key: 'skip', label: 'Skip High Vol', diff: { expectancyChange: 0 } },
      { key: 'empty', label: 'Empty Variant', diff: { expectancyChange: -0.5 } },
      { key: 'populated', label: 'Populated Variant', diff: { expectancyChange: 0.25 } },
    ],
    variants: [
      { key: 'control', summary: { overall: { tradeCount: 3 } } },
      { key: 'skip', summary: { overall: { tradeCount: 2 } } },
      { key: 'empty', summary: { overall: { tradeCount: 0 } } },
      { key: 'populated', summary: { overall: { tradeCount: 1 } } },
    ],
  }])
  assert.deepEqual(row.series, [
    { label: 'Skip High Vol', value: 0, tradeCount: 2, comparisonTradeCount: 3 },
    { label: 'Empty Variant', value: null, tradeCount: 0, comparisonTradeCount: 3 },
    { label: 'Populated Variant', value: 0.25, tradeCount: 1, comparisonTradeCount: 3 },
  ])

  const [missingControl] = buildVolatilityAwareControlDifferenceObservations([{
    label: 'Window 2', testYear: 2025,
    diffsVsControl: [{ key: 'variant', label: 'Variant', diff: { expectancyChange: 0.2 } }],
    variants: [{ key: 'variant', summary: { overall: { tradeCount: 2 } } }],
  }])
  assert.deepEqual(missingControl.series[0], { label: 'Variant', value: null, tradeCount: 2, comparisonTradeCount: null })
})
