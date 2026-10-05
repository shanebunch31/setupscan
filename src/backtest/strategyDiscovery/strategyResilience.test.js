import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildStrategyResilience,
  RESILIENCE_MIN_EVIDENCE,
} from './strategyResilience.js'

function trade({
  timestamp,
  symbol = 'SPY',
  rMultiple,
  entryPrice = 100,
  initialStopPrice = 99.5,
}) {
  return {
    timestamp,
    symbol,
    rMultiple,
    entryPrice,
    initialStopPrice,
  }
}

test('builds time and market stability groups from the same trade set', () => {
  const result = buildStrategyResilience({
    trades: [
      trade({
        timestamp: '2023-06-01T14:00:00Z',
        symbol: 'SPY',
        rMultiple: 1,
      }),
      trade({
        timestamp: '2025-06-01T14:00:00Z',
        symbol: 'QQQ',
        rMultiple: -1,
      }),
    ],
  })

  assert.equal(result.timeStability.status, 'Measured')
  assert.equal(result.timeStability.groups.length, 2)
  assert.equal(result.marketStability.groups.length, 2)
})

test('reports cost tiers without changing the underlying trades', () => {
  const trades = [
    trade({
      timestamp: '2025-06-01T14:00:00Z',
      rMultiple: 1,
    }),
  ]

  const result = buildStrategyResilience({ trades })

  assert.equal(result.costResilience.tiers.length, 4)
  assert.equal(trades[0].rMultiple, 1)
})

test('flags low evidence instead of hiding small samples', () => {
  const result = buildStrategyResilience({
    trades: [
      trade({
        timestamp: '2025-06-01T14:00:00Z',
        rMultiple: 1,
      }),
    ],
  })

  assert.equal(
    result.candidate.lowEvidence,
    true,
  )

  assert.equal(
    result.marketStability.groups[0].metrics.lowEvidence,
    true,
  )

  assert.equal(
    RESILIENCE_MIN_EVIDENCE,
    100,
  )
})

test('parameter stability compares explicitly supplied variants', () => {
  const result = buildStrategyResilience({
    candidateVariants: [
      {
        id: 'fixed-2r',
        label: 'Fixed stop + 2R',
        trades: [
          trade({
            timestamp: '2025-01-01T14:00:00Z',
            rMultiple: 2,
          }),
        ],
      },
      {
        id: 'trailing-1r-03',
        label: 'Trailing @ 1R / 0.3%',
        trades: [
          trade({
            timestamp: '2025-01-01T14:00:00Z',
            rMultiple: 1,
          }),
        ],
      },
    ],
  })

  assert.equal(
    result.parameterStability.groups.length,
    2,
  )

  assert.equal(
    result.parameterStability.groups[0].label,
    'Fixed stop + 2R',
  )
})

test('regime stability remains explicitly unassessed without regime labels', () => {
  const result = buildStrategyResilience({
    trades: [
      trade({
        timestamp: '2025-01-01T14:00:00Z',
        rMultiple: 1,
      }),
    ],
  })

  assert.equal(
    result.regimeStability.status,
    'Not assessed',
  )
})

test('regime stability groups only when causal labels are supplied', () => {
  const timestamp = '2025-01-01T14:00:00Z'

  const result = buildStrategyResilience({
    trades: [
      trade({
        timestamp,
        rMultiple: 1,
      }),
    ],
    regimeByTimestamp: {
      [timestamp]: 'Uptrend / Low Volatility',
    },
  })

  assert.equal(
    result.regimeStability.status,
    'Measured',
  )

  assert.equal(
    result.regimeStability.groups[0].label,
    'Uptrend / Low Volatility',
  )
})