// Strategy Discovery — Experiment: Volatility Compression \u2192 Expansion.
// Hypothesis: when volatility becomes unusually compressed and is followed by a bullish range
// expansion, does subsequent price movement show a measurable directional/range-expansion tendency?
// Independent module: changes here never affect the other three Batch A experiments.
import { average, buildOccurrence, computeAtr14Series, computeTrueRange } from './discoveryMetrics.js'

export const volatilityExpansionMeta = {
  experimentId: 'volatility-compression-expansion-v1',
  label: 'Volatility \u2014 Compression \u2192 Expansion',
  hypothesis: 'When ATR(14) compresses to 70% or less of its own trailing 20-candle average and is later followed by a bullish range-expansion candle (true range > 1.5x ATR, closing in the upper half of its range), does subsequent price movement show a measurable tendency?',
  parameters: { compressionLookback: 20, compressionThreshold: 0.7, expansionTrueRangeMultiple: 1.5, riskDefinition: '1 ATR(14)', primaryOutcome: '+1R before -1R within 5 completed candles', secondaryOutcome: '+2R before -1R within 10 completed candles' },
}

/**
 * Signal candles: causal \u2014 compression is evaluated using only the trailing 20 ATR(14) values
 * up to and including the current candle; expansion is evaluated only on candles at or after a
 * compression reading, using only that candle's own true range/ATR/close/open. Because ATR(14) is
 * itself a lagging 14-bar average, an expansion candle's own ATR(14) reading can still look
 * "compressed" relative to the recent (also still-low) average \u2014 so the compression flag and the
 * expansion check are evaluated independently on the same bar rather than being mutually exclusive.
 */
export function findVolatilityExpansionSignals(candles) {
  const atr14 = computeAtr14Series(candles)
  const { compressionLookback, compressionThreshold, expansionTrueRangeMultiple } = volatilityExpansionMeta.parameters
  const signals = []
  let compressionSeen = false

  for (let index = compressionLookback; index < candles.length; index += 1) {
    const atr = atr14[index]
    if (!(atr > 0)) continue
    const trailingAtrs = atr14.slice(index - compressionLookback, index).filter((value) => value !== null)
    if (trailingAtrs.length === compressionLookback) {
      const trailingAverageAtr = average(trailingAtrs)
      if (trailingAverageAtr > 0 && atr <= compressionThreshold * trailingAverageAtr) compressionSeen = true
    }
    if (!compressionSeen) continue

    const candle = candles[index]
    const trueRange = computeTrueRange(candles, index)
    const isExpansion = trueRange > expansionTrueRangeMultiple * atr
    const range = candle.high - candle.low
    const closesUpperHalf = range > 0 && (candle.close - candle.low) / range >= 0.5
    if (isExpansion && closesUpperHalf) {
      signals.push({ index, atr })
      compressionSeen = false // require a fresh compression reading before the next signal
    }
  }
  return signals
}


/** Runs the experiment for one symbol's raw (deduped, sorted) candle series. */
export function runVolatilityExpansionForSymbol(candles, symbol) {
  return findVolatilityExpansionSignals(candles)
    .map(({ index, atr }) => buildOccurrence({
      candles,
      signalIndex: index,
      symbol,
      risk: atr,
      primaryMaxBars: 5,
      primaryLabel: volatilityExpansionMeta.parameters.primaryOutcome,
    }))
    .filter(Boolean)
}
