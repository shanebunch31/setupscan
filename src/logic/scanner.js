function scoreItem(item) {
  const reasons = []
  let score = 0

  const aboveVwap = item.price > item.vwap
  reasons.push({
    label: 'Price vs VWAP',
    points: aboveVwap ? 20 : 0,
    detail: aboveVwap
      ? "Trading above the regular-session VWAP, showing price acceptance above the session's volume-weighted average."
      : "Trading below the regular-session VWAP, limiting long-side conviction.",
  })
  if (aboveVwap) score += 20

  const emaAligned = item.ema9 > item.ema21
  reasons.push({
    label: 'EMA alignment',
    points: emaAligned ? 20 : 0,
    detail: emaAligned
      ? 'Fast EMA is above the slow EMA.'
      : 'Fast EMA remains below the slow EMA.',
  })
  if (emaAligned) score += 20

  const rsiQualified =
    item.rsi >= 55 &&
    item.rsi <= 70

  const rsiPoints =
    rsiQualified
      ? 15
      : item.rsi >= 45 &&
          item.rsi < 55
        ? 8
        : 0

  reasons.push({
    label: 'RSI momentum',
    points: rsiPoints,
    detail: rsiQualified
  ? `RSI ${item.rsi} supports bullish momentum without being extended.`
  : item.rsi >= 45 && item.rsi < 55
    ? `RSI ${item.rsi} shows some momentum, but has not reached the required range.`
    : `RSI ${item.rsi} is outside the favorable momentum range.`,
  })
  score += rsiPoints

  const volumeQualified =
    item.relativeVolume >= 1.2

  const volumePoints =
    volumeQualified
      ? 15
      : item.relativeVolume >= 1
        ? 8
        : 0

  reasons.push({
    label: 'Relative volume',
    points: volumePoints,
    detail: volumeQualified
      ? `${item.relativeVolume.toFixed(2)}x average volume confirms participation.`
      : `Volume at ${item.relativeVolume.toFixed(2)}x average does not meet the required confirmation threshold.`,
  })
  score += volumePoints

  const breakoutQualified =
    item.breakout === true

  reasons.push({
    label: 'Breakout / reclaim',
    points: breakoutQualified ? 15 : 0,
    detail: breakoutQualified
      ? 'Recent price action reclaimed a key range.'
      : 'No qualifying breakout or reclaim detected.',
  })
  if (breakoutQualified) score += 15

  const bullishTrend =
    item.trend === 'Bullish'

  reasons.push({
    label: 'Trend confirmation',
    points: bullishTrend ? 15 : 0,
    detail: bullishTrend
      ? 'Short-term structure confirms the bullish directional bias.'
      : 'Trend structure is not confirming a bullish setup.',
  })
  if (bullishTrend) score += 15

  const qualifiedSetup =
    aboveVwap &&
    emaAligned &&
    rsiQualified &&
    volumeQualified &&
    breakoutQualified &&
    bullishTrend

  const status =
    qualifiedSetup
      ? 'Qualified Setup'
      : score >= 75
        ? 'Potential Setup'
        : 'No Setup'

  const setupType =
    qualifiedSetup
      ? breakoutQualified
        ? 'Breakout reclaim'
        : 'Trend continuation'
      : 'No qualifying setup'

  return {
    ...item,
    score,
    status,
    setupType,
    qualifiedSetup,
    reasons,
  }
}

export function scanSetups(snapshot) {
  return snapshot
    .map(scoreItem)
    .sort((a, b) => b.score - a.score)
}