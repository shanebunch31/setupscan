// Research Experiment #1 — Relative Value (Thorp-inspired relative-strength research).
// Pure, side-effect-free calculations. Not used by the production scanner or paper trading engine.

/**
 * Synchronizes multiple per-symbol candle series onto a common timestamp axis.
 * - Keeps only timestamps present in every symbol's series (no forward/backward fill).
 * - Duplicate timestamps within a symbol keep the first occurrence; later duplicates are dropped and reported.
 * - Never invents data: symbols with gaps simply drop those timestamps for everyone.
 */
export function synchronizeCandleSeries(seriesBySymbol) {
  const symbols = Object.keys(seriesBySymbol ?? {})
  if (!symbols.length) return { timestamps: [], series: {}, droppedCounts: {}, duplicatesBySymbol: {} }

  const perSymbolMaps = {}
  const duplicatesBySymbol = {}
  symbols.forEach((symbol) => {
    const map = new Map()
    const duplicates = []
    for (const candle of seriesBySymbol[symbol] ?? []) {
      if (!candle?.timestamp) continue
      if (map.has(candle.timestamp)) { duplicates.push(candle.timestamp); continue }
      map.set(candle.timestamp, candle)
    }
    perSymbolMaps[symbol] = map
    duplicatesBySymbol[symbol] = duplicates
  })

  const [firstSymbol, ...restSymbols] = symbols
  let commonTimestamps = [...perSymbolMaps[firstSymbol].keys()]
  restSymbols.forEach((symbol) => {
    const map = perSymbolMaps[symbol]
    commonTimestamps = commonTimestamps.filter((timestamp) => map.has(timestamp))
  })
  commonTimestamps.sort()

  const series = {}
  const droppedCounts = {}
  symbols.forEach((symbol) => {
    series[symbol] = commonTimestamps.map((timestamp) => perSymbolMaps[symbol].get(timestamp))
    droppedCounts[symbol] = (seriesBySymbol[symbol]?.length ?? 0) - series[symbol].length
  })

  return { timestamps: commonTimestamps, series, droppedCounts, duplicatesBySymbol }
}

/** Ratio of two aligned (same length, same timestamps) candle series, indexed the same way. */
export function computeRatioSeries(primarySeries, peerSeries) {
  return primarySeries.map((candle, index) => {
    const peerCandle = peerSeries[index]
    const ratio = candle?.close && peerCandle?.close ? candle.close / peerCandle.close : null
    return { timestamp: candle?.timestamp ?? peerCandle?.timestamp ?? null, ratio }
  })
}

/**
 * Rolling z-score of the ratio using only the trailing `lookback` bars ending at (and including) each index.
 * No future bars are ever read — index i only depends on ratioSeries[i - lookback + 1 .. i].
 */
export function computeRollingZScores(ratioSeries, lookback) {
  return ratioSeries.map((point, index) => {
    if (index < lookback - 1) return { ...point, mean: null, stdDev: null, zScore: null }
    const window = ratioSeries.slice(index - lookback + 1, index + 1).map((entry) => entry.ratio)
    if (window.some((value) => value === null || value === undefined)) return { ...point, mean: null, stdDev: null, zScore: null }
    const mean = window.reduce((sum, value) => sum + value, 0) / window.length
    const variance = window.reduce((sum, value) => sum + (value - mean) ** 2, 0) / window.length
    const stdDev = Math.sqrt(variance)
    const zScore = stdDev ? (point.ratio - mean) / stdDev : 0
    return { ...point, mean, stdDev, zScore }
  })
}

/** Flags bars where the trailing z-score of the ratio exceeds `threshold` in either direction. */
export function detectDivergences(zScoreSeries, threshold = 2) {
  return zScoreSeries.map((point) => {
    if (point.zScore === null) return { ...point, isDivergent: false, direction: null }
    if (point.zScore <= -threshold) return { ...point, isDivergent: true, direction: 'PRIMARY_CHEAP' }
    if (point.zScore >= threshold) return { ...point, isDivergent: true, direction: 'PRIMARY_RICH' }
    return { ...point, isDivergent: false, direction: 'NONE' }
  })
}

/**
 * Evaluation-only lookup at each divergent index: does the ratio move back toward its recent mean
 * `forwardHorizon` bars later? This intentionally reads forward bars — it is used only to score
 * outcomes after the fact, never to generate the entry signal itself.
 */
export function evaluateMeanReversion(divergenceSeries, divergentIndices, forwardHorizon) {
  return divergentIndices.map((index) => {
    const point = divergenceSeries[index]
    const forwardPoint = divergenceSeries[index + forwardHorizon]
    if (!point || !forwardPoint || point.ratio === null || forwardPoint.ratio === null) {
      return { index, timestamp: point?.timestamp ?? null, evaluated: false }
    }
    const reverted = point.direction === 'PRIMARY_CHEAP'
      ? forwardPoint.ratio > point.ratio
      : point.direction === 'PRIMARY_RICH'
        ? forwardPoint.ratio < point.ratio
        : false
    return {
      index,
      timestamp: point.timestamp,
      evaluated: true,
      direction: point.direction,
      startRatio: point.ratio,
      forwardRatio: forwardPoint.ratio,
      forwardTimestamp: forwardPoint.timestamp,
      reverted,
    }
  })
}

/**
 * Rolling relative-performance confirmation: is `primarySeries` outperforming the average of
 * `peerSeriesList` over the trailing `lookback` bars? Uses only candles at or before each index.
 */
export function computeRelativeStrengthConfirmation(primarySeries, peerSeriesList, lookback, { minimumRelativeReturn = 0 } = {}) {
  return primarySeries.map((candle, index) => {
    if (index < lookback || !candle) return { timestamp: candle?.timestamp ?? null, index, relativeReturn: null, confirmed: false }
    const reference = primarySeries[index - lookback]
    if (!reference?.close) return { timestamp: candle.timestamp, index, relativeReturn: null, confirmed: false }
    const primaryReturn = (candle.close - reference.close) / reference.close
    const peerReturns = peerSeriesList.map((peerSeries) => {
      const peerCandle = peerSeries[index]
      const peerReference = peerSeries[index - lookback]
      if (!peerCandle?.close || !peerReference?.close) return null
      return (peerCandle.close - peerReference.close) / peerReference.close
    })
    if (peerReturns.some((value) => value === null)) return { timestamp: candle.timestamp, index, relativeReturn: null, confirmed: false }
    const averagePeerReturn = peerReturns.reduce((sum, value) => sum + value, 0) / peerReturns.length
    const relativeReturn = primaryReturn - averagePeerReturn
    return { timestamp: candle.timestamp, index, relativeReturn, confirmed: relativeReturn > minimumRelativeReturn }
  })
}
