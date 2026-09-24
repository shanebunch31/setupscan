// Strategy Discovery — Experiment: Momentum / Breakout + Confirmation.
// Hypothesis: when price breaks above a recent high with volume confirmation and closes above
// that level, does subsequent price movement show a measurable bullish tendency?
// Independent module: changes here never affect the other three Batch A experiments.
import { average, buildOccurrence, computeAtr14Series } from './discoveryMetrics.js'

export const momentumBreakoutMeta = {
  experimentId: 'momentum-breakout-v1',
  label: 'Momentum — Breakout + Confirmation',
  hypothesis: 'When price breaks above a recent 20-candle high with above-average volume and closes above that level, does subsequent price movement show a measurable bullish tendency?',
  parameters: { lookbackBars: 20, volumeMultiple: 1.2, riskDefinition: '1 ATR(14)', primaryOutcome: '+1R before -1R within 5 completed candles', secondaryOutcome: '+2R before -1R within 10 completed candles' },
}

/** Signal candles: causal, only reads the previous 20 completed candles and the signal candle itself. */
export function findMomentumBreakoutSignals(candles) {
  const atr14 = computeAtr14Series(candles)
  const signals = []
  const lookbackBars = momentumBreakoutMeta.parameters.lookbackBars
  for (let index = lookbackBars; index < candles.length; index += 1) {
    const lookback = candles.slice(index - lookbackBars, index)
    const highestHigh = Math.max(...lookback.map((candle) => candle.high))
    const averageVolume = average(lookback.map((candle) => candle.volume ?? 0))
    const candle = candles[index]
    const atr = atr14[index]
    if (!(atr > 0)) continue
    if (!(averageVolume > 0)) continue
    const hasBreakoutHigh = candle.high > highestHigh
    const hasBreakoutClose = candle.close > highestHigh
    const hasVolumeConfirmation = (candle.volume ?? 0) >= momentumBreakoutMeta.parameters.volumeMultiple * averageVolume
    if (hasBreakoutHigh && hasBreakoutClose && hasVolumeConfirmation) signals.push({ index, atr })
  }
  return signals
}

/** Runs the experiment for one symbol's raw (deduped, sorted) candle series. */
export function runMomentumBreakoutForSymbol(candles, symbol) {
  return findMomentumBreakoutSignals(candles)
    .map(({ index, atr }) => buildOccurrence({
      candles,
      signalIndex: index,
      symbol,
      risk: atr,
      primaryMaxBars: 5,
      primaryLabel: momentumBreakoutMeta.parameters.primaryOutcome,
    }))
    .filter(Boolean)
}
