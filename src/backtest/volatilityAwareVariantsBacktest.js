// Research Experiment #7 — Volatility-Aware Strategy Variants.
// Tests whether three PREDEFINED, non-optimized volatility-aware entry rules change the
// Experiment #6 walk-forward results. The scanner scoring itself is completely frozen — variants
// only change which already-scored signals are accepted, based on the frozen Experiment #6
// walk-forward volatility classification (training-only boundaries, no future information).
// Research only — no production files are touched, no variant is deployed, and no thresholds are
// searched or optimized after seeing results.
import { buildTradeFromIndex, summarizeTrades, scoreBucketDefinitions } from './signalQualityBacktest.js'
import { computeWalkForwardWindows, walkForwardDefaults, classifyVolatility, volatilityLabels } from './walkForwardRegimeBacktest.js'

export const volatilityAwareDefaults = { ...walkForwardDefaults }

// Predefined before seeing any Experiment #7 result — see the anti-overfitting rule in the request.
// minimumScoreByRegime: null under a regime label means "take no new trades in that regime".
export const variantDefinitions = [
  { key: 'control', label: 'Control', minimumScoreByRegime: null },
  { key: 'skipHighVol', label: 'Skip High Vol', minimumScoreByRegime: { Low: 75, Medium: 75, High: null } },
  { key: 'highVol90', label: 'High Vol >=90', minimumScoreByRegime: { Low: 75, Medium: 75, High: 90 } },
  { key: 'highVol95', label: 'High Vol >=95', minimumScoreByRegime: { Low: 75, Medium: 75, High: 95 } },
]

const average = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0)
function median(values) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** Required minimum score for a variant under a given regime label; null means "reject entirely". */
function requiredScore(variant, regimeLabel, options) {
  if (variant.key === 'control') return options.minimumScore
  // 'Insufficient-Training-History' bars have no rule defined by the request; documented
  // assumption: treat them the same as Low/Medium (score >= 75, unaffected by the high-vol rule).
  const requirement = variant.minimumScoreByRegime[regimeLabel]
  return requirement === undefined ? variant.minimumScoreByRegime.Low : requirement
}

/** Regime lookup with an optional causal lag (Part H stress tests): uses realizedVol20[index - lag]. */
function makeRegimeLookup(realizedVol20, boundaries, warmup, lag) {
  return (index) => {
    const laggedIndex = index - lag
    const value = laggedIndex >= 0 ? realizedVol20[laggedIndex] : null
    return classifyVolatility(value, boundaries, warmup)
  }
}

function buildVariantTradesBySymbol(catalogueBySymbol, alignedRaw, testTimestampSet, regimeLookup, variant, options) {
  return Object.keys(catalogueBySymbol).map((symbol) => {
    const trades = catalogueBySymbol[symbol]
      .filter((entry) => testTimestampSet.has(entry.timestamp) && entry.status === 'Bullish')
      .map((entry) => {
        const regimeLabel = regimeLookup(entry.index)
        const requirement = requiredScore(variant, regimeLabel, options)
        if (requirement === null || entry.score < requirement) return null
        const trade = buildTradeFromIndex(alignedRaw[symbol], entry.index, options, { symbol })
        return trade ? { ...trade, score: entry.score, regimeLabel } : null
      })
      .filter(Boolean)
    return { symbol, trades }
  })
}

function metricsFromTrades(trades, timestamps) {
  return summarizeTrades([{ symbol: 'ALL', trades }], timestamps, 1).overall
}

function diffMetrics(variantOverall, controlOverall) {
  return {
    tradeCountChange: variantOverall.tradeCount - controlOverall.tradeCount,
    winRateChange: variantOverall.winRate - controlOverall.winRate,
    profitFactorChange: (variantOverall.profitFactor === Infinity || controlOverall.profitFactor === Infinity) ? null : variantOverall.profitFactor - controlOverall.profitFactor,
    expectancyChange: variantOverall.expectancy - controlOverall.expectancy,
    totalRChange: variantOverall.totalR - controlOverall.totalR,
    maxDrawdownChange: variantOverall.maximumDrawdown - controlOverall.maximumDrawdown,
  }
}

/**
 * Runs Control + the three predefined volatility-aware variants across the exact Experiment #6
 * walk-forward windows and frozen (training-only) volatility boundaries. Also runs two stress
 * tests (regime classification lagged by 1 and 2 bars) against the non-control variants, and a
 * high-volatility trade-removal / score-bucket decomposition for Control vs. the variants.
 */
export function runVolatilityAwareVariantsResearch(rawSeriesBySymbol, settings = {}) {
  const options = { ...volatilityAwareDefaults, ...settings }
  const { aligned, catalogueBySymbol, timestamps, realizedVol20, windows: builtWindows } = computeWalkForwardWindows(rawSeriesBySymbol, options)

  const windows = builtWindows.map((windowEntry) => {
    const testTimestampSet = new Set(windowEntry.testIndices.map((index) => timestamps[index]))
    const lookupLag0 = makeRegimeLookup(realizedVol20, windowEntry.boundaries, options.volatilityTrainingWarmup, 0)
    const lookupLag1 = makeRegimeLookup(realizedVol20, windowEntry.boundaries, options.volatilityTrainingWarmup, 1)
    const lookupLag2 = makeRegimeLookup(realizedVol20, windowEntry.boundaries, options.volatilityTrainingWarmup, 2)

    const runVariant = (variant, lookup) => summarizeTrades(buildVariantTradesBySymbol(catalogueBySymbol, aligned.raw, testTimestampSet, lookup, variant, options), timestamps, 1)

    const variants = variantDefinitions.map((variant) => ({ key: variant.key, label: variant.label, summary: runVariant(variant, lookupLag0) }))
    const stress1 = variantDefinitions.filter((v) => v.key !== 'control').map((variant) => ({ key: variant.key, label: variant.label, summary: runVariant(variant, lookupLag1) }))
    const stress2 = variantDefinitions.filter((v) => v.key !== 'control').map((variant) => ({ key: variant.key, label: variant.label, summary: runVariant(variant, lookupLag2) }))

    const controlTrades = variants.find((v) => v.key === 'control').summary.trades
    const removedHighVolTrades = controlTrades.filter((trade) => trade.regimeLabel === 'High')
    const highVolRemoval = {
      removedCount: removedHighVolTrades.length,
      metrics: metricsFromTrades(removedHighVolTrades, timestamps),
    }

    const highVolScoreByVariant = ['control', 'highVol90', 'highVol95'].map((key) => {
      const variantTrades = variants.find((v) => v.key === key).summary.trades.filter((trade) => trade.regimeLabel === 'High')
      const buckets = scoreBucketDefinitions.map(([label, min, max]) => {
        const bucketTrades = variantTrades.filter((trade) => trade.score >= min && trade.score <= max)
        const metrics = metricsFromTrades(bucketTrades, timestamps)
        return { label, min, max, smallSample: metrics.tradeCount < options.smallSampleThreshold, metrics }
      })
      return { key, buckets }
    })

    const diffsVsControl = variants.filter((v) => v.key !== 'control').map((variant) => ({
      key: variant.key,
      label: variant.label,
      diff: diffMetrics(variant.summary.overall, variants.find((v) => v.key === 'control').summary.overall),
    }))

    return {
      label: windowEntry.label,
      testYear: windowEntry.testYear,
      trainRealizedStart: windowEntry.trainRealizedStart,
      trainRealizedEnd: windowEntry.trainRealizedEnd,
      testRealizedStart: windowEntry.testRealizedStart,
      testRealizedEnd: windowEntry.testRealizedEnd,
      boundaries: windowEntry.boundaries,
      variants,
      stress1,
      stress2,
      highVolRemoval,
      highVolScoreByVariant,
      diffsVsControl,
    }
  })

  // Pooled (all test periods combined) per variant.
  const pooled = variantDefinitions.map((variant) => {
    const allTradesBySymbol = Object.keys(catalogueBySymbol).map((symbol) => ({
      symbol,
      trades: windows.flatMap((windowEntry) => windowEntry.variants.find((v) => v.key === variant.key).summary.trades.filter((trade) => trade.symbol === symbol)),
    }))
    return { key: variant.key, label: variant.label, summary: summarizeTrades(allTradesBySymbol, timestamps, 1) }
  })

  const evidenceTable = variantDefinitions.map((variant) => ({
    key: variant.key,
    label: variant.label,
    byYear: windows.map((windowEntry) => ({ testYear: windowEntry.testYear, overall: windowEntry.variants.find((v) => v.key === variant.key).summary.overall })),
  }))

  const consistency = evidenceTable.map((row) => {
    const expectancies = row.byYear.map((y) => y.overall.expectancy)
    const pooledSummary = pooled.find((p) => p.key === row.key).summary.overall
    return {
      key: row.key,
      label: row.label,
      positivePeriods: row.byYear.filter((y) => y.overall.tradeCount > 0 && y.overall.expectancy > 0).length,
      negativePeriods: row.byYear.filter((y) => y.overall.tradeCount > 0 && y.overall.expectancy < 0).length,
      meanYearlyExpectancy: average(expectancies),
      medianYearlyExpectancy: median(expectancies),
      pooledExpectancy: pooledSummary.expectancy,
      pooledProfitFactor: pooledSummary.profitFactor,
      pooledMaxDrawdown: pooledSummary.maximumDrawdown,
    }
  })

  return { aligned, options, windows, pooled, evidenceTable, consistency }
}
