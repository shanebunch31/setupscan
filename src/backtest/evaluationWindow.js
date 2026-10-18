import { buildTradeFromIndex } from './signalQualityBacktest.js'

/**
 * Builds a trade for a bounded evaluation window. Early stop/target outcomes are valid when they
 * resolve inside the window; outcomes resolving after its final candle are excluded. An Expired
 * trade is retained only when its full configured holding horizon was observed.
 */
export function buildTradeWithinEvaluationWindow(candles, signalIndex, options, evaluationEndIndex, meta = {}) {
  if (!Number.isInteger(evaluationEndIndex) || signalIndex + 1 > evaluationEndIndex) return null
  const trade = buildTradeFromIndex(candles, signalIndex, options, meta)
  if (!trade) return null

  const outcomeEndIndex = signalIndex + trade.holdingBars
  if (outcomeEndIndex > evaluationEndIndex) return null
  if (trade.exitReason === 'Expired' && trade.holdingBars < options.maxHoldingBars) return null
  return trade
}
