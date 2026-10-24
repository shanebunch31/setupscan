// Research-only copy of strategy.js's private createTrailingStopTrade routine.
// Exporting/moving the original would change the active Shadow Forward source fingerprint.
// The parity test checks both the complete routine text and native runner outcomes.
import { isAmbiguousStopTargetCandle } from './ambiguousCandle.js'
const timeframeMinutes = { '5m': 5, '15m': 15, '1h': 60, '4h': 240, '1D': 1440 }

export function createTrailingStopTrade(signal, entryCandle, candles, signalIndex, settings) {
  const entryPrice = entryCandle.open ?? entryCandle.close
  const risk = settings.stopDistance ?? entryPrice * settings.stopDistancePercent
  const initialStopPrice = entryPrice - risk
  const targetPrice = entryPrice + (settings.targetDistance ?? risk * settings.targetR)
  const maxBars = Math.min(settings.maxHoldingBars, candles.length - signalIndex - 1)

  let stopPrice = initialStopPrice
  let highestPrice = entryPrice
  let trailingStopActive = false
  let maximumFavorableExcursion = 0
  let maximumAdverseExcursion = 0
  let exitReason = 'Expired'
  let exitPrice = candles[signalIndex + maxBars]?.close ?? entryPrice
  let holdingBars = maxBars
  let ambiguousCandle = false
  let ambiguityDataAvailable = true

  for (let offset = 1; offset <= maxBars; offset += 1) {
    const candle = candles[signalIndex + offset]
    const candleAmbiguity = isAmbiguousStopTargetCandle(candle, stopPrice, targetPrice)
    if (candleAmbiguity === null) ambiguityDataAvailable = false
    if (candleAmbiguity === true) ambiguousCandle = true

    maximumFavorableExcursion = Math.max(
      maximumFavorableExcursion,
      candle.high - entryPrice,
    )

    maximumAdverseExcursion = Math.min(
      maximumAdverseExcursion,
      candle.low - entryPrice,
    )

    // Evaluate the stop carried into this candle first.
    // Only after the candle survives can the trail ratchet upward.
    // If the open is beyond a carried barrier, use the open for stops and the
    // conservative limit price for targets. The open establishes event order.
    if (Number.isFinite(candle.open) && candle.open <= stopPrice) {
      exitReason = trailingStopActive ? 'Trailing Stop' : 'Stop'
      exitPrice = candle.open
      holdingBars = offset
      break
    }

    if (Number.isFinite(candle.open) && candle.open >= targetPrice) {
      exitReason = 'Target'
      exitPrice = targetPrice
      holdingBars = offset
      break
    }

    if (candle.low <= stopPrice) {
      exitReason = trailingStopActive ? 'Trailing Stop' : 'Stop'
      exitPrice = stopPrice
      holdingBars = offset
      break
    }

    if (candle.high >= targetPrice) {
      exitReason = 'Target'
      exitPrice = targetPrice
      holdingBars = offset
      break
    }

    highestPrice = Math.max(highestPrice, candle.high)

    const currentR =
      (highestPrice - entryPrice) / risk

    if (currentR >= settings.activationR) {
      trailingStopActive = true

      const candidateStop =
        highestPrice *
        (1 - settings.trailDistancePercent)

      stopPrice = Math.max(
        stopPrice,
        candidateStop,
      )
    }
  }

  const rMultiple =
    (exitPrice - entryPrice) / risk

  return {
    symbol: signal.symbol,
    timeframe: signal.timeframe,
    timestamp: signal.timestamp,
    setupType: signal.setupType,
    score: signal.score,
    entryPrice,
    stopPrice,
    targetPrice,
    exitPrice,
    trailingStopActive,
    highestPrice,
    initialStopPrice,
    outcome:
      rMultiple > 0
        ? 'Win'
        : rMultiple < 0
          ? 'Loss'
          : 'Breakeven',
    exitReason,
    ambiguousCandle: ambiguityDataAvailable ? ambiguousCandle : null,
    rMultiple,
    maximumFavorableExcursion,
    maximumAdverseExcursion,
    holdingTime:
      holdingBars *
      (timeframeMinutes[signal.timeframe] || 60),
    holdingBars,
  }
}

