// One-off research runner for Research Experiment #3A (Frozen Score Holdout).
// Fetches real Alpaca historical bars and reports development-vs-holdout score-bucket results
// using the existing, unmodified SetupScan scoring formula. Does not touch paper trading, the
// Render worker, Supabase, or the production scanner.
import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchAlpacaHistoricalBars } from '../server/alpacaProxy.js'
import { runFrozenScoreHoldoutResearch, assessScoreMonotonicity, frozenScoreHoldoutDefaults } from '../src/backtest/frozenScoreHoldoutBacktest.js'
import { costTierDefinitions } from '../src/backtest/signalQualityBacktest.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '..', '.env') })

const symbols = ['SPY', 'QQQ', 'IWM']
const requestedStart = '2022-01-01T00:00:00Z'
const requestedEnd = new Date().toISOString()

function fmtPct(value) { return `${(value * 100).toFixed(1)}%` }
function fmtR(value) { return value === Infinity ? '∞' : `${value.toFixed(2)}R` }
function fmtPf(value) { return value === Infinity ? '∞' : value.toFixed(2) }
function fmtDate(value) { return value ? new Date(value).toISOString().slice(0, 10) : '—' }

function printTable(rows, columns) {
  const header = columns.map((c) => c.label)
  console.log([header.join(' | '), header.map(() => '---').join(' | '), ...rows.map((row) => columns.map((c) => c.value(row)).join(' | '))].join('\n'))
}

const bucketColumns = [
  { label: 'Bucket', value: (b) => b.label },
  { label: 'Trades', value: (b) => b.overall.tradeCount },
  { label: 'Win rate', value: (b) => fmtPct(b.overall.winRate) },
  { label: 'PF', value: (b) => fmtPf(b.overall.profitFactor) },
  { label: 'Expectancy', value: (b) => fmtR(b.overall.expectancy) },
  { label: 'Avg R', value: (b) => fmtR(b.overall.averageR) },
  { label: 'Median R', value: (b) => fmtR(b.overall.medianR) },
  { label: 'Total R', value: (b) => fmtR(b.overall.totalR) },
  { label: 'Max DD', value: (b) => fmtR(b.overall.maximumDrawdown) },
  { label: 'Avg hold', value: (b) => `${b.overall.averageHoldingTime.toFixed(0)}m` },
]

const variantColumns = [
  { label: 'Variant', value: (r) => r.label },
  { label: 'Trades', value: (r) => r.metrics.tradeCount },
  { label: 'Win rate', value: (r) => fmtPct(r.metrics.winRate) },
  { label: 'PF', value: (r) => fmtPf(r.metrics.profitFactor) },
  { label: 'Expectancy', value: (r) => fmtR(r.metrics.expectancy) },
  { label: 'Total R', value: (r) => fmtR(r.metrics.totalR) },
  { label: 'Max DD', value: (r) => fmtR(r.metrics.maximumDrawdown) },
  { label: 'Avg hold', value: (r) => `${r.metrics.averageHoldingTime.toFixed(0)}m` },
]

function printMonotonicity(label, buckets) {
  const monotonicity = assessScoreMonotonicity(buckets)
  console.log(`${label} monotonicity: ${monotonicity.evaluable
    ? `avgR-vs-order correlation=${monotonicity.averageRCorrelation.toFixed(2)}, winRate-vs-order correlation=${monotonicity.winRateCorrelation.toFixed(2)}, monotonic-non-decreasing=${monotonicity.monotonicIncreasing}, increasing-step-fraction=${monotonicity.increasingStepFraction.toFixed(2)}`
    : 'not evaluable (fewer than 2 populated buckets)'}`)
}

function printCostTiers(label, summary) {
  console.log(`${label} — results across execution cost tiers:`)
  printTable(costTierDefinitions.map(([tierLabel, costR]) => ({ tierLabel, metrics: summary.costTiers.find((t) => t.label === tierLabel)?.metrics ?? { tradeCount: 0 } })), [
    { label: 'Cost tier', value: (r) => r.tierLabel },
    { label: 'Trades', value: (r) => r.metrics.tradeCount },
    { label: 'Win rate', value: (r) => fmtPct(r.metrics.winRate ?? 0) },
    { label: 'PF', value: (r) => fmtPf(r.metrics.profitFactor ?? 0) },
    { label: 'Expectancy', value: (r) => fmtR(r.metrics.expectancy ?? 0) },
    { label: 'Total R', value: (r) => fmtR(r.metrics.totalR ?? 0) },
    { label: 'Max DD', value: (r) => fmtR(r.metrics.maximumDrawdown ?? 0) },
  ])
}

async function main() {
  console.log('=== Research Experiment #3A — Frozen Score Holdout (real Alpaca data run) ===')
  console.log(`Requested fetch range: ${requestedStart} -> ${requestedEnd}`)
  console.log(`Requested holdout window: ${frozenScoreHoldoutDefaults.holdoutStart} -> ${frozenScoreHoldoutDefaults.holdoutEnd}`)
  console.log('Development window is defined as everything in the synchronized dataset strictly after the holdout window ends')
  console.log('(the holdout window already comprises the earliest available data, so "outside the holdout" is the later block).')

  const rawSeriesBySymbol = {}
  const fetchReports = []
  for (const symbol of symbols) {
    try {
      const data = await fetchAlpacaHistoricalBars({ symbol, timeframe: '1Hour', start: requestedStart, end: requestedEnd })
      rawSeriesBySymbol[symbol] = data.candles
      fetchReports.push({ symbol, ok: true, candleCount: data.candleCount, start: data.start, end: data.end })
    } catch (error) {
      fetchReports.push({ symbol, ok: false, error: error.message })
    }
  }

  console.log('\n--- Data fetch status ---')
  fetchReports.forEach((report) => {
    console.log(report.ok
      ? `${report.symbol}: OK — ${report.candleCount} candles, ${fmtDate(report.start)} -> ${fmtDate(report.end)}`
      : `${report.symbol}: FAILED — ${report.error}`)
  })
  if (fetchReports.some((report) => !report.ok)) {
    console.log('\nRun ABORTED: missing-data issue. No demo/fake data was substituted.')
    process.exitCode = 1
    return
  }

  const research = runFrozenScoreHoldoutResearch(rawSeriesBySymbol, {})
  const options = research.options

  console.log(`\nSynchronized timeline: ${research.aligned.timestamps.length} common hourly candles, ${fmtDate(research.aligned.timestamps[0])} -> ${fmtDate(research.aligned.timestamps.at(-1))}`)
  console.log(`Frozen scoring formula parameters (unchanged): minimumScore=${options.minimumScore}, targetR=${options.targetR}, maxHoldingBars=${options.maxHoldingBars}, stopDistancePercent=${options.stopDistancePercent}`)
  console.log(`\nExact holdout dates realized: ${fmtDate(research.holdoutRange.start)} -> ${fmtDate(research.holdoutRange.end)} (${research.holdoutRange.candleCount} candles)`)
  console.log(`Exact development dates realized: ${fmtDate(research.developmentRange.start)} -> ${fmtDate(research.developmentRange.end)} (${research.developmentRange.candleCount} candles)`)
  console.log('No parameter search or scoring optimization was performed. No winner is auto-selected.')

  console.log('\n\n############################################################')
  console.log('# 2) Score-bucket table — HOLDOUT period (2022-01-03 -> 2024-12-31 realized)')
  console.log('############################################################')
  printTable(research.holdoutBuckets, bucketColumns)
  printMonotonicity('Holdout', research.holdoutBuckets)

  console.log('\n\n############################################################')
  console.log('# 4a) Score-bucket table — DEVELOPMENT period (comparison baseline)')
  console.log('############################################################')
  printTable(research.developmentBuckets, bucketColumns)
  printMonotonicity('Development', research.developmentBuckets)

  console.log('\n\n############################################################')
  console.log('# 4b) Development vs. holdout — side-by-side bucket comparison')
  console.log('############################################################')
  research.holdoutBuckets.forEach((holdoutBucket, index) => {
    const developmentBucket = research.developmentBuckets[index]
    console.log(`\nBucket ${holdoutBucket.label}:`)
    printTable([
      { label: 'Development', metrics: developmentBucket.overall },
      { label: 'Holdout', metrics: holdoutBucket.overall },
    ], variantColumns)
  })

  console.log('\n\n############################################################')
  console.log('# 3) Baseline vs. Experiment #1 RV-confirmed — holdout period')
  console.log('############################################################')
  printTable([
    { label: 'Baseline (75+ bullish)', metrics: research.holdoutBaseline.overall },
    { label: 'RV-confirmed (75+ AND RV confirmation)', metrics: research.holdoutRvConfirmed.overall },
  ], variantColumns)

  console.log('\nBaseline vs. RV-confirmed — development period (for comparison):')
  printTable([
    { label: 'Baseline (75+ bullish)', metrics: research.developmentBaseline.overall },
    { label: 'RV-confirmed (75+ AND RV confirmation)', metrics: research.developmentRvConfirmed.overall },
  ], variantColumns)

  console.log('\n\n############################################################')
  console.log('# 5) Cost robustness — holdout period')
  console.log('############################################################')
  printCostTiers('Holdout baseline', research.holdoutBaseline)
  printCostTiers('Holdout RV-confirmed', research.holdoutRvConfirmed)

  console.log('\n\n############################################################')
  console.log('# By symbol — holdout period')
  console.log('############################################################')
  console.log('Baseline by symbol:')
  printTable(research.holdoutBaseline.bySymbol, [
    { label: 'Symbol', value: (r) => r.symbol },
    ...variantColumns.slice(1),
  ])
  console.log('\nRV-confirmed by symbol:')
  printTable(research.holdoutRvConfirmed.bySymbol, [
    { label: 'Symbol', value: (r) => r.symbol },
    ...variantColumns.slice(1),
  ])

  console.log('\nRUN COMPLETE — no parameter optimization performed, no winner auto-selected.')
}

main().catch((error) => {
  console.error('Run FAILED with an unexpected error:', error)
  process.exitCode = 1
})
