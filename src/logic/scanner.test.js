import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isQualifiedSetupSignal, isResearchEligibleSignal, scanSetups } from './scanner.js'

test('VWAP reason describes the regular-session volume-weighted reference', () => {
  const result = scanSetups([{
    symbol: 'SPY',
    price: 101,
    vwap: 100,
    ema9: 101,
    ema21: 100,
    rsi: 60,
    relativeVolume: 1.2,
    breakout: true,
    trend: 'Bullish',
  }])[0]

  const reason = result.reasons.find(
    ({ label }) => label === 'Price vs VWAP',
  )

  assert.match(reason.detail, /regular-session VWAP/i)
  assert.match(reason.detail, /volume-weighted average/i)
})

test('unavailable relative volume contributes no confirmation points and has a clear explanation', () => {
  const result = scanSetups([{
    symbol: 'SPY',
    price: 101,
    vwap: 100,
    ema9: 101,
    ema21: 100,
    rsi: 60,
    relativeVolume: null,
    breakout: true,
    trend: 'Bullish',
  }])[0]
  const reason = result.reasons.find(({ label }) => label === 'Relative volume')

  assert.equal(reason.points, 0)
  assert.match(reason.detail, /unavailable until at least five prior observations/i)
  assert.equal(result.qualifiedSetup, false)
})

test('research eligibility includes both qualified and potential setups without depending on display labels', () => {
  const [qualified, potential] = scanSetups([
    { symbol: 'Q', price: 101, vwap: 100, ema9: 101, ema21: 100, rsi: 60, relativeVolume: 1.2, breakout: true, trend: 'Bullish' },
    { symbol: 'P', price: 101, vwap: 100, ema9: 101, ema21: 100, rsi: 60, relativeVolume: 1.2, breakout: true, trend: 'Bearish' },
  ])

  assert.equal(qualified.qualifiedSetup, true)
  assert.equal(qualified.researchEligible, true)
  assert.equal(potential.qualifiedSetup, false)
  assert.equal(potential.potentialSetup, true)
  assert.equal(potential.status, 'Potential Setup')
  assert.equal(isResearchEligibleSignal(qualified, 75), true)
  assert.equal(isResearchEligibleSignal(potential, 75), true)
  assert.equal(isResearchEligibleSignal(potential, 90), false)
  assert.equal(isResearchEligibleSignal({ ...potential, status: 'Bullish' }, 75), true)
  assert.equal(isResearchEligibleSignal({ ...potential, researchEligible: false }, 75), false)
  assert.equal(isQualifiedSetupSignal(qualified, 75), true)
  assert.equal(isQualifiedSetupSignal(potential, 75), false)
})

test('qualified-only and research-eligible populations remain distinct while 95+ currently equals exactly 100', () => {
  const signals = scanSetups([
    { symbol: 'QUALIFIED', price: 101, vwap: 100, ema9: 101, ema21: 100, rsi: 60, relativeVolume: 1.2, breakout: true, trend: 'Bullish' },
    { symbol: 'POTENTIAL', price: 101, vwap: 100, ema9: 101, ema21: 100, rsi: 60, relativeVolume: 1.2, breakout: true, trend: 'Bearish' },
  ])
  const qualifiedOnly = signals.filter((signal) => isQualifiedSetupSignal(signal, 75))
  const researchEligible = signals.filter((signal) => isResearchEligibleSignal(signal, 75))
  const ninetyFivePlus = signals.filter((signal) => isResearchEligibleSignal(signal, 95))
  const exactlyOneHundred = signals.filter((signal) => isResearchEligibleSignal(signal, 100))

  assert.deepEqual(qualifiedOnly.map((signal) => signal.symbol), ['QUALIFIED'])
  assert.deepEqual(researchEligible.map((signal) => signal.symbol), ['QUALIFIED', 'POTENTIAL'])
  assert.deepEqual(ninetyFivePlus.map((signal) => signal.symbol), exactlyOneHundred.map((signal) => signal.symbol))
})
