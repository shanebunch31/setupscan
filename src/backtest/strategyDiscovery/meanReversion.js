// Strategy Discovery — Experiment: Mean Reversion (Extreme Deviation → Reversion).
// Hypothesis: when price becomes unusually extended below VWAP and then shows an initial
// reversal, does price subsequently revert toward VWAP?
// Independent module: changes here never affect the other three Batch A experiments.
import { buildOccurrence, computeAtr14Series, computeSessionVwapSeries } from './discoveryMetrics.js'

export const meanReversionMeta = {
  experimentId: 'mean-reversion-v1',
  label: 'Mean Reversion — Extreme Deviation \u2192 Reversion',
  hypothesis: 'When price closes at least 2 ATR below session VWAP and then closes upward relative to its own open, does price subsequently revert toward VWAP before -1R, within 10 completed candles?',
  parameters: { deviationAtrMultiple: 2, primaryOutcome: 'Reaches VWAP before -1R within 10 completed candles', secondaryOutcome1: '+1R before -1R within 5 completed candles', secondaryOutcome2: '+2R before -1R within 10 completed candles' },
}

/** Signal candles: causal — session VWAP and ATR(14) only ever use information through the signal candle. */
export function findMeanReversionSignals(candles) {
  const atr14 = computeAtr14Series(candles)
  const vwapSeries = computeSessionVwapSeries(candles)
  const signals = []
  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index]
    const atr = atr14[index]
    const vwap = vwapSeries[index]
    if (!(atr > 0) || vwap === null) continue
    const deviation = vwap - candle.close
    const isExtendedBelowVwap = deviation >= meanReversionMeta.parameters.deviationAtrMultiple * atr
    const closesUpward = candle.close > candle.open
    if (isExtendedBelowVwap && closesUpward) signals.push({ index, atr, vwap })
  }
  return signals
}

/** Runs the experiment for one symbol's raw (deduped, sorted) candle series. */
export function runMeanReversionForSymbol(candles, symbol) {
  return findMeanReversionSignals(candles)
    .map(({ index, atr, vwap }) => buildOccurrence({
      candles,
      signalIndex: index,
      symbol,
      risk: atr,
      // Primary barrier is the VWAP level observed at the signal candle, not an entry-relative
      // R-multiple — this experiment specifically tests reversion toward VWAP, not "traded positive".
      getPrimaryUpperPrice: () => vwap,
      primaryMaxBars: 10,
      primaryLabel: meanReversionMeta.parameters.primaryOutcome,
    }))
    .filter(Boolean)
}
