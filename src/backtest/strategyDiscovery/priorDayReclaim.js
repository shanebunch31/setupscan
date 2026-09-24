// Strategy Discovery — Experiment: Market Structure, Prior-Day High Reclaim (bullish only).
// Hypothesis: when price moves above the previous trading day's high, fails back below it, and
// later reclaims it, does the reclaim contain useful information about subsequent direction?
// Batch A implements only the bullish previous-day-HIGH version; the bearish previous-day-LOW
// version is explicitly deferred to a later batch, per the Strategy Discovery Protocol.
// Independent module: changes here never affect the other three Batch A experiments.
import { buildOccurrence, computeAtr14Series } from './discoveryMetrics.js'

export const priorDayReclaimMeta = {
  experimentId: 'prior-day-high-reclaim-v1',
  label: 'Market Structure — Prior-Day High Reclaim (bullish only)',
  hypothesis: 'When price trades above the previous completed trading day\u2019s high, closes back below it, and later closes back above it, does the reclaim carry useful information about subsequent direction?',
  parameters: { riskDefinition: '1 ATR(14)', primaryOutcome: '+1R before -1R within 5 completed candles', secondaryOutcome: '+2R before -1R within 10 completed candles' },
}

/**
 * Signal candles: causal — the reference level for a calendar day is that day's previous
 * COMPLETED day's high, only available starting from the first candle of the new day. The
 * reclaim state machine resets whenever the reference level changes (i.e. at each new day).
 */
export function findPriorDayReclaimSignals(candles) {
  const signals = []
  let currentDayKey = null
  let currentDayMaxHigh = null
  let referenceLevel = null
  let state = 'seekingAbove'

  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index]
    const day = candle.timestamp.slice(0, 10)
    if (day !== currentDayKey) {
      referenceLevel = currentDayKey === null ? null : currentDayMaxHigh
      currentDayKey = day
      currentDayMaxHigh = candle.high
      state = 'seekingAbove'
    } else {
      currentDayMaxHigh = Math.max(currentDayMaxHigh, candle.high)
    }

    if (referenceLevel === null) continue

    if (state === 'seekingAbove') {
      if (candle.high > referenceLevel) state = 'seekingBelowClose'
    } else if (state === 'seekingBelowClose') {
      if (candle.close < referenceLevel) state = 'seekingReclaim'
    } else if (state === 'seekingReclaim') {
      if (candle.close > referenceLevel) {
        signals.push({ index, referenceLevel })
        state = 'seekingBelowClose'
      }
    }
  }
  return signals
}

/** Runs the experiment for one symbol's raw (deduped, sorted) candle series. */
export function runPriorDayReclaimForSymbol(candles, symbol) {
  const atr14 = computeAtr14Series(candles)
  return findPriorDayReclaimSignals(candles)
    .map(({ index }) => {
      const atr = atr14[index]
      if (!(atr > 0)) return null
      return buildOccurrence({
        candles,
        signalIndex: index,
        symbol,
        risk: atr,
        primaryMaxBars: 5,
        primaryLabel: priorDayReclaimMeta.parameters.primaryOutcome,
      })
    })
    .filter(Boolean)
}
