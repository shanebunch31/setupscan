import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildCumulativeRObservations } from './cumulativeRChartData.js'

test('cumulative R observations preserve source trade order and actual trade values', () => {
  const trades = [
    { timestamp: '2024-01-02T15:00:00.000Z', rMultiple: 1.25 },
    { timestamp: '2024-01-03T15:00:00.000Z', rMultiple: -0.5 },
    { timestamp: '2024-01-04T15:00:00.000Z', rMultiple: 0 },
  ]

  assert.deepEqual(buildCumulativeRObservations(trades), [
    { sequence: 1, timestamp: trades[0].timestamp, rMultiple: 1.25, cumulativeR: 1.25 },
    { sequence: 2, timestamp: trades[1].timestamp, rMultiple: -0.5, cumulativeR: 0.75 },
    { sequence: 3, timestamp: trades[2].timestamp, rMultiple: 0, cumulativeR: 0.75 },
  ])
})

test('empty trades produce no cumulative observations', () => {
  assert.deepEqual(buildCumulativeRObservations([]), [])
  assert.deepEqual(buildCumulativeRObservations(), [])
})

test('an invalid trade result is unavailable and does not become a fabricated zero', () => {
  const observations = buildCumulativeRObservations([
    { timestamp: '2024-01-02T15:00:00.000Z', rMultiple: 1 },
    { timestamp: '2024-01-03T15:00:00.000Z', rMultiple: Number.NaN },
    { timestamp: '2024-01-04T15:00:00.000Z', rMultiple: 2 },
  ])

  assert.deepEqual(observations.map(({ rMultiple, cumulativeR }) => [rMultiple, cumulativeR]), [
    [1, 1],
    [null, null],
    [2, null],
  ])
})
