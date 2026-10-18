import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildThresholdTableCells, thresholdTableHeadings } from './thresholdTablePresentation.js'

test('threshold table keeps distinct fixture metrics under their matching headings', () => {
  const result = {
    minimumScore: 73,
    metrics: {
      totalTrades: 11,
      winRate: 0.23,
      profitFactor: 1.47,
      expectancy: 0.58,
      averageR: 0.69,
      maximumDrawdown: 4.8,
      averageHoldingTime: 37,
      averageWinner: 1.81,
      averageLoser: -0.92,
    },
    inSampleMetrics: { totalTrades: 5 },
    outOfSampleMetrics: { totalTrades: 6 },
  }

  assert.deepEqual(thresholdTableHeadings, [
    'Threshold', 'Total', 'In-sample', 'Out-of-sample', 'Win rate', 'Profit factor',
    'Expectancy', 'Average R', 'Max DD', 'Avg hold', 'Avg win', 'Avg loss',
  ])
  assert.deepEqual(buildThresholdTableCells(result), [
    '73+', 11, 5, 6, '23.0%', '1.47', '0.58R', '0.69R', '4.80R', '37m', '1.81R', '-0.92R',
  ])
})
