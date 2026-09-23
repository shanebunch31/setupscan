// Research Experiment #4 — Year-by-Year & Regime Stability.
// Tests whether the existing, frozen SetupScan scanner behaves consistently across individual
// calendar years and across different descriptive market regimes. Reuses Experiment #2's
// per-candle catalogue (score/status/component flags, including the Experiment #1 relative-value
// confirmation) and trade-construction conventions unchanged. Research only — does not modify
// production scoring, paper trading, the Render worker, or Supabase.
import {
  signalQualityDefaults,
  scoreBucketDefinitions,
  buildAlignedSeries,
  buildCatalogueBySymbol,
  buildTradeFromIndex,
  summarizeTrades,
  assessScoreMonotonicity,
} from './signalQualityBacktest.js'

export const yearlyRegimeDefaults = {
  ...signalQualityDefaults,
  smallSampleThreshold: 30,
}

const average = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0)
const TRADING_HOURS_PER_YEAR = 6.5 * 252

/** Groups a sorted synchronized timeline into calendar-year buckets (UTC), each entry keeping only its own timestamps. */
export function groupTimestampsByYear(timestamps) {
  const years = [...new Set(timestamps.map((timestamp) => new Date(timestamp).getUTCFullYear()))].sort((a, b) => a - b)
  return years.map((year) => ({
    year,
    timestamps: timestamps.filter((timestamp) => new Date(timestamp).getUTCFullYear() === year),
  }))
}

function summarizeForYear(catalogueBySymbol, alignedRaw, yearTimestamps, predicate, options) {
  const yearSet = new Set(yearTimestamps)
  const tradesBySymbol = Object.keys(catalogueBySymbol).map((symbol) => {
    const trades = catalogueBySymbol[symbol]
      .filter((entry) => yearSet.has(entry.timestamp) && predicate(entry))
      .map((entry) => buildTradeFromIndex(alignedRaw[symbol], entry.index, options, { symbol }))
      .filter(Boolean)
    return { symbol, trades }
  })
  return summarizeTrades(tradesBySymbol, yearTimestamps, 1)
}

function bucketsForYear(catalogueBySymbol, alignedRaw, yearTimestamps, options) {
  return scoreBucketDefinitions.map(([label, min, max]) => {
    const summary = summarizeForYear(
      catalogueBySymbol,
      alignedRaw,
      yearTimestamps,
      (entry) => entry.score >= min && entry.score <= max && entry.status === 'Bullish',
      options,
    )
    return { label, min, max, smallSample: summary.overall.tradeCount < options.smallSampleThreshold, ...summary }
  })
}

/** Descriptive market-regime proxy for one symbol within one calendar year: buy-and-hold return and realized volatility. */
function computeRegimeProxy(rawCandles, yearTimestamps) {
  const yearSet = new Set(yearTimestamps)
  const candles = rawCandles.filter((candle) => yearSet.has(candle.timestamp))
  if (candles.length < 2) return { candleCount: candles.length, buyHoldReturn: null, hourlyReturnStdDev: null, annualizedVolatilityProxy: null }
  const buyHoldReturn = (candles.at(-1).close - candles[0].close) / candles[0].close
  const returns = []
  for (let index = 1; index < candles.length; index += 1) {
    returns.push((candles[index].close - candles[index - 1].close) / candles[index - 1].close)
  }
  const meanReturn = average(returns)
  const variance = average(returns.map((value) => (value - meanReturn) ** 2))
  const hourlyReturnStdDev = Math.sqrt(variance)
  return {
    candleCount: candles.length,
    buyHoldReturn,
    hourlyReturnStdDev,
    annualizedVolatilityProxy: hourlyReturnStdDev * Math.sqrt(TRADING_HOURS_PER_YEAR),
  }
}

/**
 * Runs the frozen baseline strategy, the Experiment #1 RV-confirmed variant, and score-bucket
 * stability checks separately for every calendar year present in the synchronized dataset, plus
 * descriptive (non-optimizing) market-regime proxies per year. Each year only ever reads its own
 * timestamps for signal/bucket membership; no later year's data can change an earlier year's
 * classification. Trade exits may span into the following year (a signal near December 31 can
 * still exit in January) — this is normal backtest behavior, not a look-ahead violation, since the
 * signal itself only used information available at or before its own candle.
 */
export function runYearlyRegimeResearch(rawSeriesBySymbol, settings = {}) {
  const options = { ...yearlyRegimeDefaults, ...settings }
  const aligned = buildAlignedSeries(rawSeriesBySymbol)
  const catalogueBySymbol = buildCatalogueBySymbol(aligned, options)
  const symbols = Object.keys(aligned.raw)
  const yearGroups = groupTimestampsByYear(aligned.timestamps)

  const baselinePredicate = (entry) => entry.score >= options.minimumScore && entry.status === 'Bullish'
  const rvConfirmedPredicate = (entry) => baselinePredicate(entry) && entry.components.rvConfirmation

  const years = yearGroups.map(({ year, timestamps }) => {
    const baseline = summarizeForYear(catalogueBySymbol, aligned.raw, timestamps, baselinePredicate, options)
    const rvConfirmed = summarizeForYear(catalogueBySymbol, aligned.raw, timestamps, rvConfirmedPredicate, options)
    const buckets = bucketsForYear(catalogueBySymbol, aligned.raw, timestamps, options)
    const monotonicity = assessScoreMonotonicity(buckets)
    const regime = {}
    symbols.forEach((symbol) => { regime[symbol] = computeRegimeProxy(aligned.raw[symbol], timestamps) })
    return {
      year,
      start: timestamps[0] ?? null,
      end: timestamps.at(-1) ?? null,
      candleCount: timestamps.length,
      baseline,
      rvConfirmed,
      buckets,
      monotonicity,
      regime,
    }
  })

  const combinedBaseline = summarizeForYear(catalogueBySymbol, aligned.raw, aligned.timestamps, baselinePredicate, options)
  const combinedRvConfirmed = summarizeForYear(catalogueBySymbol, aligned.raw, aligned.timestamps, rvConfirmedPredicate, options)

  return { aligned, options, years, combinedBaseline, combinedRvConfirmed }
}

export { assessScoreMonotonicity }
