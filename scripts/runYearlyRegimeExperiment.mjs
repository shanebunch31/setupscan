// One-off research runner for Research Experiment #4 (Year-by-Year & Regime Stability).
// Fetches real Alpaca historical bars and reports calendar-year and regime-proxy results using
// the existing, frozen SetupScan scoring formula. Does not touch paper trading, the Render
// worker, Supabase, or the production scanner. Retries the fetch stage if the network stalls.
import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchAlpacaHistoricalBars } from '../server/alpacaProxy.js'
import { runYearlyRegimeResearch } from '../src/backtest/yearlyRegimeBacktest.js'
import { costTierDefinitions } from '../src/backtest/signalQualityBacktest.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '..', '.env') })

const symbols = ['SPY', 'QQQ', 'IWM']
const requestedStart = '2022-01-01T00:00:00Z'
const requestedEnd = new Date().toISOString()
const MAX_FETCH_ATTEMPTS = 3
const FETCH_ATTEMPT_TIMEOUT_MS = 90000

function fmtPct(value) { return `${(value * 100).toFixed(1)}%` }
function fmtR(value) { return value === Infinity ? '∞' : `${value.toFixed(2)}R` }
function fmtPf(value) { return value === Infinity ? '∞' : value.toFixed(2) }
function fmtDate(value) { return value ? new Date(value).toISOString().slice(0, 10) : '—' }
function fmtSignedPct(value) { return value === null ? '—' : `${value >= 0 ? '+' : ''}${(value * 100).toFixed(2)}%` }

function printTable(rows, columns) {
  const header = columns.map((c) => c.label)
  console.log([header.join(' | '), header.map(() => '---').join(' | '), ...rows.map((row) => columns.map((c) => c.value(row)).join(' | '))].join('\n'))
}

const metricColumns = (labelKey, labelFn) => [
  { label: labelKey, value: labelFn },
  { label: 'Trades', value: (r) => r.metrics.tradeCount },
  { label: 'Win rate', value: (r) => fmtPct(r.metrics.winRate) },
  { label: 'PF', value: (r) => fmtPf(r.metrics.profitFactor) },
  { label: 'Expectancy', value: (r) => fmtR(r.metrics.expectancy) },
  { label: 'Avg R', value: (r) => fmtR(r.metrics.averageR) },
  { label: 'Median R', value: (r) => fmtR(r.metrics.medianR) },
  { label: 'Total R', value: (r) => fmtR(r.metrics.totalR) },
  { label: 'Max DD', value: (r) => fmtR(r.metrics.maximumDrawdown) },
  { label: 'Avg hold', value: (r) => `${r.metrics.averageHoldingTime.toFixed(0)}m` },
]

async function fetchWithRetry(symbol) {
  let lastError = null
  for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt += 1) {
    const controller = new AbortController()
    const timeoutHandle = setTimeout(() => controller.abort(), FETCH_ATTEMPT_TIMEOUT_MS)
    try {
      console.log(`  fetching ${symbol} (attempt ${attempt}/${MAX_FETCH_ATTEMPTS})...`)
      const data = await fetchAlpacaHistoricalBars({ symbol, timeframe: '1Hour', start: requestedStart, end: requestedEnd })
      clearTimeout(timeoutHandle)
      return { symbol, ok: true, data }
    } catch (error) {
      clearTimeout(timeoutHandle)
      lastError = error
      console.log(`  attempt ${attempt} for ${symbol} failed: ${error.message}`)
    }
  }
  return { symbol, ok: false, error: lastError?.message ?? 'unknown error' }
}

async function main() {
  console.log('=== Research Experiment #4 — Year-by-Year & Regime Stability (real Alpaca data run) ===')
  console.log(`Requested fetch range: ${requestedStart} -> ${requestedEnd}`)
  console.log('No demo/fallback/fabricated data will be substituted. Network stalls are retried, not bypassed.')

  const rawSeriesBySymbol = {}
  const fetchReports = []
  for (const symbol of symbols) {
    const result = await fetchWithRetry(symbol)
    if (result.ok) {
      rawSeriesBySymbol[symbol] = result.data.candles
      fetchReports.push({ symbol, ok: true, candleCount: result.data.candleCount, start: result.data.start, end: result.data.end })
    } else {
      fetchReports.push({ symbol, ok: false, error: result.error })
    }
  }

  console.log('\n--- Data fetch status ---')
  fetchReports.forEach((report) => {
    console.log(report.ok
      ? `${report.symbol}: OK — ${report.candleCount} candles, ${fmtDate(report.start)} -> ${fmtDate(report.end)}`
      : `${report.symbol}: FAILED after ${MAX_FETCH_ATTEMPTS} attempts — ${report.error}`)
  })
  if (fetchReports.some((report) => !report.ok)) {
    console.log('\nRun ABORTED: missing-data issue after retries. No demo/fake data was substituted.')
    process.exitCode = 1
    return
  }

  const research = runYearlyRegimeResearch(rawSeriesBySymbol, {})
  const options = research.options
  const timestamps = research.aligned.timestamps

  console.log(`\nSynchronized/common candle count: ${timestamps.length}`)
  console.log(`Exact dates realized: ${fmtDate(timestamps[0])} -> ${fmtDate(timestamps.at(-1))}`)
  symbols.forEach((symbol) => console.log(`  ${symbol}: dropped ${research.aligned.droppedCounts[symbol]} candles during synchronization (gaps), ${research.aligned.duplicatesBySymbol[symbol].length} duplicate timestamps removed`))
  console.log(`\nFrozen scanner parameters (unchanged): minimumScore=${options.minimumScore}, targetR=${options.targetR}, maxHoldingBars=${options.maxHoldingBars}, stopDistancePercent=${options.stopDistancePercent}`)
  console.log('No parameter optimization was performed. No winner is selected. No scoring weights or thresholds were changed.')

  console.log('\n\n############################################################')
  console.log('# Experiment A — Calendar-year breakdown (frozen baseline: score >= 75, Bullish)')
  console.log('############################################################')
  research.years.forEach((yearEntry) => {
    console.log(`\n--- ${yearEntry.year} (${fmtDate(yearEntry.start)} -> ${fmtDate(yearEntry.end)}, ${yearEntry.candleCount} candles) ---`)
    printTable([{ label: 'Overall', metrics: yearEntry.baseline.overall }], metricColumns('', (r) => r.label))
    console.log('  By symbol:')
    printTable(yearEntry.baseline.bySymbol, metricColumns('Symbol', (r) => r.symbol))
  })
  console.log('\n--- Combined across all years ---')
  printTable([{ label: 'Combined', metrics: research.combinedBaseline.overall }], metricColumns('', (r) => r.label))
  printTable(research.combinedBaseline.bySymbol, metricColumns('Symbol', (r) => r.symbol))

  console.log('\n\n############################################################')
  console.log('# Experiment B — Yearly score-bucket stability')
  console.log('############################################################')
  research.years.forEach((yearEntry) => {
    console.log(`\n--- ${yearEntry.year} ---`)
    printTable(yearEntry.buckets.map((bucket) => ({ ...bucket, label: `${bucket.label}${bucket.smallSample ? ' (SMALL SAMPLE)' : ''}`, metrics: bucket.overall })), metricColumns('Bucket', (r) => r.label))
    console.log(yearEntry.monotonicity.evaluable
      ? `  Monotonicity: avgR-vs-order correlation=${yearEntry.monotonicity.averageRCorrelation.toFixed(2)}, winRate-vs-order correlation=${yearEntry.monotonicity.winRateCorrelation.toFixed(2)}, monotonic-non-decreasing=${yearEntry.monotonicity.monotonicIncreasing}, increasing-step-fraction=${yearEntry.monotonicity.increasingStepFraction.toFixed(2)}`
      : '  Monotonicity: not evaluable (fewer than 2 populated buckets)')
  })

  console.log('\n\n############################################################')
  console.log('# Experiment C — Market-regime proxies (descriptive only, no new trading rule)')
  console.log('############################################################')
  printTable(research.years.flatMap((yearEntry) => symbols.map((symbol) => ({
    year: yearEntry.year, symbol, regime: yearEntry.regime[symbol], baseline: yearEntry.baseline.overall,
  }))), [
    { label: 'Year', value: (r) => r.year },
    { label: 'Symbol', value: (r) => r.symbol },
    { label: 'Buy&hold return', value: (r) => fmtSignedPct(r.regime.buyHoldReturn) },
    { label: 'Hourly return stdDev', value: (r) => (r.regime.hourlyReturnStdDev === null ? '—' : `${(r.regime.hourlyReturnStdDev * 100).toFixed(3)}%`) },
    { label: 'Annualized vol. proxy', value: (r) => (r.regime.annualizedVolatilityProxy === null ? '—' : `${(r.regime.annualizedVolatilityProxy * 100).toFixed(1)}%`) },
  ])
  console.log('\nBaseline scanner behavior per year (repeated for convenience alongside regime proxies above):')
  printTable(research.years.map((yearEntry) => ({ year: yearEntry.year, metrics: yearEntry.baseline.overall })), [
    { label: 'Year', value: (r) => r.year },
    { label: 'Trades', value: (r) => r.metrics.tradeCount },
    { label: 'Expectancy', value: (r) => fmtR(r.metrics.expectancy) },
    { label: 'PF', value: (r) => fmtPf(r.metrics.profitFactor) },
    { label: 'Max DD', value: (r) => fmtR(r.metrics.maximumDrawdown) },
  ])

  console.log('\n\n############################################################')
  console.log('# Experiment D — RV confirmation stability by year (baseline vs. score>=75 AND RV confirmation)')
  console.log('############################################################')
  research.years.forEach((yearEntry) => {
    console.log(`\n--- ${yearEntry.year} ---`)
    printTable([
      { label: 'Baseline (75+)', metrics: yearEntry.baseline.overall },
      { label: 'RV-confirmed (75+ AND RV)', metrics: yearEntry.rvConfirmed.overall },
    ], metricColumns('Variant', (r) => r.label))
  })
  console.log('\n--- Combined across all years ---')
  printTable([
    { label: 'Baseline (75+)', metrics: research.combinedBaseline.overall },
    { label: 'RV-confirmed (75+ AND RV)', metrics: research.combinedRvConfirmed.overall },
  ], metricColumns('Variant', (r) => r.label))

  console.log('\n\n############################################################')
  console.log('# Experiment E — Execution-cost robustness by year (existing cost tiers, unchanged)')
  console.log('############################################################')
  research.years.forEach((yearEntry) => {
    console.log(`\n--- ${yearEntry.year} — baseline ---`)
    printTable(costTierDefinitions.map(([label]) => ({ label, metrics: yearEntry.baseline.costTiers.find((t) => t.label === label).metrics })), [
      { label: 'Cost tier', value: (r) => r.label },
      { label: 'Trades', value: (r) => r.metrics.tradeCount },
      { label: 'PF', value: (r) => fmtPf(r.metrics.profitFactor) },
      { label: 'Expectancy', value: (r) => fmtR(r.metrics.expectancy) },
      { label: 'Total R', value: (r) => fmtR(r.metrics.totalR) },
    ])
    console.log(`--- ${yearEntry.year} — RV-confirmed ---`)
    printTable(costTierDefinitions.map(([label]) => ({ label, metrics: yearEntry.rvConfirmed.costTiers.find((t) => t.label === label).metrics })), [
      { label: 'Cost tier', value: (r) => r.label },
      { label: 'Trades', value: (r) => r.metrics.tradeCount },
      { label: 'PF', value: (r) => fmtPf(r.metrics.profitFactor) },
      { label: 'Expectancy', value: (r) => fmtR(r.metrics.expectancy) },
      { label: 'Total R', value: (r) => fmtR(r.metrics.totalR) },
    ])
  })

  console.log('\nRUN COMPLETE — no parameter optimization performed, no winner auto-selected, no scoring weights changed.')
}

main().catch((error) => {
  console.error('Run FAILED with an unexpected error:', error)
  process.exitCode = 1
})
