function scoreItem(item) {
  const reasons = []
  let score = 0

  const vwapAvailable =
  Number.isFinite(item.price) &&
  Number.isFinite(item.vwap)

const aboveVwap =
  vwapAvailable && item.price > item.vwap

reasons.push({
  label: 'Price vs VWAP',
  points: aboveVwap ? 20 : 0,
  detail: !vwapAvailable
    ? 'VWAP is unavailable, so this condition cannot be evaluated.'
    : aboveVwap
      ? "Trading above the regular-session VWAP, showing price acceptance above the session's volume-weighted average."
      : 'Trading at or below the regular-session VWAP, limiting long-side conviction.',
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

  const relativeVolumeAvailable = Number.isFinite(item.relativeVolume)
  const volumeQualified =
    relativeVolumeAvailable && item.relativeVolume >= 1.2

  const volumePoints =
    volumeQualified
      ? 15
      : relativeVolumeAvailable && item.relativeVolume >= 1
        ? 8
        : 0

  const volumeBaselineDescription = item.relativeVolumeMethod === 'same-time-of-day'
    ? 'average volume for this time in prior sessions'
    : item.relativeVolumeMethod === 'prior-daily-bars'
      ? 'average volume in prior daily bars'
      : item.relativeVolumeMethod === 'prior-bars'
        ? 'average volume in the prior 20 available bars (not adjusted for time of day)'
        : 'the available historical average volume'

  reasons.push({
    label: 'Relative volume',
    points: volumePoints,
    detail: !relativeVolumeAvailable
      ? 'Comparable volume is unavailable until at least five prior observations are available.'
      : volumeQualified
        ? `${item.relativeVolume.toFixed(2)}x ${volumeBaselineDescription} confirms participation.`
        : `Volume at ${item.relativeVolume.toFixed(2)}x ${volumeBaselineDescription} does not meet the required confirmation threshold.`,
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

  const potentialSetup =
  !qualifiedSetup &&
  score >= 75

const status =
  qualifiedSetup
    ? 'Qualified Setup'
    : potentialSetup
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
  potentialSetup,
  // Stable research membership: both qualified and potential 75+ setups are eligible.
  // Keep this separate from the user-facing status wording.
  researchEligible: qualifiedSetup || potentialSetup,
  reasons,
}
}

/** Whether a scored scanner result belongs to a research candidate set at the requested floor. */
export function isResearchEligibleSignal(signal, minimumScore = 75) {
  return signal?.researchEligible === true &&
    Number.isFinite(signal.score) &&
    signal.score >= minimumScore
}

/** Whether a scanner result meets the actual strategy's qualified-only entry rule. */
export function isQualifiedSetupSignal(signal, minimumScore = 0) {
  return signal?.qualifiedSetup === true &&
    Number.isFinite(signal.score) &&
    signal.score >= minimumScore
}

export function scanSetups(snapshot) {
  return snapshot
    .map(scoreItem)
    .sort((a, b) => b.score - a.score)
}
