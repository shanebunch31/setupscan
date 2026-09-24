// One-off research runner for Research Experiment #2 (Signal Quality / Expected Value).
// Fetches real Alpaca historical bars and reports score-bucket and component results.
// Does not touch paper trading, the Render worker, Supabase, or the production scanner.
import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchAlpacaHistoricalBars } from '../server/alpacaProxy.js'
import { runSignalQualityResearch, assessScoreMonotonicity } from '../src/backtest/signalQualityBacktest.js'

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

const metricColumns = (labelKey, labelFn) => [
  { label: labelKey, value: labelFn },
  { label: 'Trades', value: (r) => r.metrics.tradeCount },
  { label: 'Win rate', value: (r) => fmtPct(r.metrics.winRate) },
  { label: 'PF', value: (r) => fmtPf(r.metrics.profitFactor) },
  { label: 'Expectancy', value: (r) => fmtR(r.metrics.expectancy) },
  { label: 'Total R', value: (r) => fmtR(r.metrics.totalR) },
  { label: 'Max DD', value: (r) => fmtR(r.metrics.maximumDrawdown) },
  { label: 'Avg hold', value: (r) => `${r.metrics.averageHoldingTime.toFixed(0)}m` },
]

function printBreakdown(summary) {
  console.log('  By symbol:')
  printTable(summary.bySymbol, metricColumns('Symbol', (r) => r.symbol))
  console.log('  By period:')
  printTable(summary.byPeriod, metricColumns('Period', (r) => r.label))
  console.log('  By cost tier:')
  printTable(summary.costTiers, metricColumns('Cost tier', (r) => r.label))
}

async function main() {
  console.log('=== Research Experiment #2 — Signal Quality / Expected Value (real Alpaca data run) ===')
  console.log(`Requested range: ${requestedStart} -> ${requestedEnd}`)

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

  const research = runSignalQualityResearch(rawSeriesBySymbol, {})
  const options = research.options
  const timestamps = research.aligned.timestamps
  console.log(`\nSynchronized timeline: ${timestamps.length} common hourly candles, ${fmtDate(timestamps[0])} -> ${fmtDate(timestamps.at(-1))}`)
  console.log(`Default parameters used: minimumScore=${options.minimumScore}, lookback=${options.lookback}, targetR=${options.targetR}, maxHoldingBars=${options.maxHoldingBars}, stopDistancePercent=${options.stopDistancePercent}`)
  console.log('No parameter search was performed. No winner is auto-selected.')

  console.log('\n\n############################################################')
  console.log('# Score buckets')
  console.log('############################################################')
  printTable(research.scoreBuckets, [
    { label: 'Bucket', value: (b) => b.label },
    { label: 'Trades', value: (b) => b.overall.tradeCount },
    { label: 'Win rate', value: (b) => fmtPct(b.overall.winRate) },
    { label: 'PF', value: (b) => fmtPf(b.overall.profitFactor) },
    { label: 'Expectancy', value: (b) => fmtR(b.overall.expectancy) },
    { label: 'Avg R', value: (b) => fmtR(b.overall.averageR) },
    { label: 'Median R', value: (b) => fmtR(b.overall.medianR) },
    { label: 'Loss rate', value: (b) => fmtPct(b.overall.lossRate) },
    { label: 'Total R', value: (b) => fmtR(b.overall.totalR) },
    { label: 'Max DD', value: (b) => fmtR(b.overall.maximumDrawdown) },
    { label: 'Avg hold', value: (b) => `${b.overall.averageHoldingTime.toFixed(0)}m` },
  ])

  const monotonicity = assessScoreMonotonicity(research.scoreBuckets)
  console.log(`\nMonotonicity check: ${monotonicity.evaluable
    ? `avgR-vs-order correlation=${monotonicity.averageRCorrelation.toFixed(2)}, winRate-vs-order correlation=${monotonicity.winRateCorrelation.toFixed(2)}, monotonic-non-decreasing=${monotonicity.monotonicIncreasing}, increasing-step-fraction=${monotonicity.increasingStepFraction.toFixed(2)}`
    : 'not evaluable (fewer than 2 populated buckets)'}`)

  research.scoreBuckets.forEach((bucket) => {
    console.log(`\n--- Bucket ${bucket.label} breakdown ---`)
    printBreakdown(bucket)
  })

  console.log('\n\n############################################################')
  console.log('# Individual components — A) independent  B) conditional (AND existing 75+ baseline)')
  console.log('############################################################')
  research.components.forEach((component) => {
    console.log(`\n=== ${component.label} (${component.key}) ===`)
    console.log('A) Independent overall:')
    printTable([{ metrics: component.independent.overall }], metricColumns('', () => 'overall'))
    printBreakdown(component.independent)
    console.log('B) Conditional overall (component AND 75+ bullish):')
    printTable([{ metrics: component.conditional.overall }], metricColumns('', () => 'overall'))
    printBreakdown(component.conditional)
  })

  console.log('\n\n############################################################')
  console.log('# Decomposition — present vs. absent among 75+ baseline signals')
  console.log('############################################################')
  printTable(research.decomposition, [
    { label: 'Component', value: (r) => r.label },
    { label: 'Present trades', value: (r) => r.present.overall.tradeCount },
    { label: 'Present win rate', value: (r) => fmtPct(r.present.overall.winRate) },
    { label: 'Present avg R', value: (r) => fmtR(r.present.overall.averageR) },
    { label: 'Absent trades', value: (r) => r.absent.overall.tradeCount },
    { label: 'Absent win rate', value: (r) => fmtPct(r.absent.overall.winRate) },
    { label: 'Absent avg R', value: (r) => fmtR(r.absent.overall.averageR) },
    { label: 'Contribution (R)', value: (r) => fmtR(r.contributionR) },
    { label: 'Classification', value: (r) => r.classification },
  ])

  console.log('\nRUN COMPLETE — no parameter optimization performed, no winner auto-selected.')
}

main().catch((error) => {
  console.error('Run FAILED with an unexpected error:', error)
  process.exitCode = 1
})
