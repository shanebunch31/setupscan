import assert from 'node:assert/strict'
import { test } from 'node:test'
import { describeAmbiguousTrades, hasPerformanceObservations, summarizeRequiredResearchData } from './labEvidence.js'

test('performance observations require a positive finite count without converting missing counts to zero', () => {
  assert.equal(hasPerformanceObservations({ tradeCount: 0 }), false)
  assert.equal(hasPerformanceObservations({ occurrenceCount: 3 }), true)
  assert.equal(hasPerformanceObservations({}), false)
  assert.equal(hasPerformanceObservations({ tradeCount: null }), false)
})

test('required research data states distinguish loading, unavailable, partial, and ready inputs', () => {
  const symbols = ['SPY', 'QQQ', 'IWM']
  assert.equal(summarizeRequiredResearchData([{ symbol: 'SPY', status: 'AVAILABLE' }], symbols).state, 'loading')
  assert.equal(summarizeRequiredResearchData(symbols.map((symbol) => ({ symbol, status: 'LOADING' })), symbols).state, 'loading')
  assert.equal(summarizeRequiredResearchData(symbols.map((symbol) => ({ symbol, status: 'UNAVAILABLE' })), symbols).state, 'unavailable')
  assert.deepEqual(summarizeRequiredResearchData([
    { symbol: 'SPY', status: 'AVAILABLE' },
    { symbol: 'QQQ', status: 'UNAVAILABLE' },
    { symbol: 'IWM', status: 'AVAILABLE' },
  ], symbols), {
    state: 'partial', availableSymbols: ['SPY', 'IWM'], loadingSymbols: [], unavailableSymbols: ['QQQ'],
  })
  assert.equal(summarizeRequiredResearchData(symbols.map((symbol) => ({ symbol, status: 'AVAILABLE' })), symbols).state, 'ready')
})

test('ambiguity disclosure reports recorded counts and distinguishes absent or incomplete data', () => {
  assert.match(describeAmbiguousTrades({ tradeCount: 2, ambiguousTradeCount: 1, ambiguityRateDenominator: 2 }), /1 of 2 simulated trades \(50\.0%\)/)
  assert.match(describeAmbiguousTrades({ tradeCount: 2, ambiguousTradeCount: 0, ambiguityRateDenominator: 2 }), /0 of 2 simulated trades \(0\.0%\)/)
  assert.match(describeAmbiguousTrades({ tradeCount: 0, ambiguousTradeCount: 0, ambiguityRateDenominator: 0 }), /0 of 0 simulated trades[\s\S]*percentage is unavailable/)
  assert.match(describeAmbiguousTrades({ tradeCount: 0 }), /count is unavailable/)
  assert.match(describeAmbiguousTrades({ tradeCount: 2, ambiguousTradeCount: null, ambiguityRateDenominator: null }), /unavailable because complete candle-level/)
})
