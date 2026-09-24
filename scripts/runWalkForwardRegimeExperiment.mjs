// One-off research runner for Research Experiment #6 (Walk-Forward Regime Validation).
// Fetches real Alpaca historical bars and reports chronological walk-forward volatility-regime
// results using the existing, frozen SetupScan scoring formula. Does not touch paper trading, the
// Render worker, Supabase, or the production scanner. Retries the fetch stage if the network stalls.
import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchAlpacaHistoricalBars } from '../server/alpacaProxy.js'
import { runWalkForwardRegimeResearch } from '../src/backtest/walkForwardRegimeBacktest.js'

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
function fmtVol(value) { return value === null ? '—' : `${(value * 100).toFixed(3)}%` }
function fmtDate(value) { return value ? new Date(value).toISOString().slice(0, 10) : '—' }
function fmtSign(value) { return value > 0 ? '+' : value < 0 ? '-' : '0' }

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
  console.log('=== Research Experiment #6 — Walk-Forward Regime Validation (real Alpaca data run) ===')
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

  const research = runWalkForwardRegimeResearch(rawSeriesBySymbol, {})
  const options = research.options
  const timestamps = research.aligned.timestamps

  console.log(`\nSynchronized/common candle count: ${timestamps.length}`)
  console.log(`Exact dates realized: ${fmtDate(timestamps[0])} -> ${fmtDate(timestamps.at(-1))}`)
  symbols.forEach((symbol) => console.log(`  ${symbol}: dropped ${research.aligned.droppedCounts[symbol]} candles during synchronization (gaps), ${research.aligned.duplicatesBySymbol[symbol].length} duplicate timestamps removed`))
  console.log(`\nFrozen scanner parameters (unchanged): minimumScore=${options.minimumScore}, targetR=${options.targetR}, maxHoldingBars=${options.maxHoldingBars}, stopDistancePercent=${options.stopDistancePercent}`)
  console.log('The scanner itself is completely frozen. Only regime classification boundaries are computed per window, from that window\'s training data only.')
  console.log('No parameter optimization was performed on the full dataset. No regime filter is deployed. No winner is selected.')

  console.log('\n\n############################################################')
  console.log('# Training / test windows realized + frozen volatility boundaries')
  console.log('############################################################')
  research.windows.forEach((windowEntry) => {
    console.log(`\n--- ${windowEntry.label} (test year ${windowEntry.testYear}) ---`)
    console.log(`  Training realized: ${fmtDate(windowEntry.trainRealizedStart)} -> ${fmtDate(windowEntry.trainRealizedEnd)} (${windowEntry.trainCandleCount} candles)`)
    console.log(`  Test realized: ${fmtDate(windowEntry.testRealizedStart)} -> ${fmtDate(windowEntry.testRealizedEnd)} (${windowEntry.testCandleCount} candles)`)
    console.log(`  Frozen boundaries (trailing 20-bar realized vol, training sample size ${windowEntry.boundaries.sampleSize}): Low<=${fmtVol(windowEntry.boundaries.lowMediumBoundary)} <= Medium <=${fmtVol(windowEntry.boundaries.mediumHighBoundary)} <= High`)
  })

  console.log('\n\n############################################################')
  console.log('# Part B — Walk-forward baseline by test year')
  console.log('############################################################')
  research.windows.forEach((windowEntry) => {
    console.log(`\n--- ${windowEntry.label} (test year ${windowEntry.testYear}) — combined ---`)
    printTable([{ label: 'Combined', metrics: windowEntry.baseline.overall }], metricColumns('', (r) => r.label))
    console.log('  By symbol:')
    printTable(windowEntry.baseline.bySymbol, metricColumns('Symbol', (r) => r.symbol))
  })

  console.log('\n\n############################################################')
  console.log('# Part C — Walk-forward performance by volatility regime (per test year, then pooled)')
  console.log('############################################################')
  research.windows.forEach((windowEntry) => {
    console.log(`\n--- ${windowEntry.label} (test year ${windowEntry.testYear}) ---`)
    printTable(windowEntry.volatilityGroups.map((g) => ({ label: `${g.label}${g.baseline.smallSample ? ' (SMALL SAMPLE)' : ''}`, metrics: g.baseline.overall })), metricColumns('Regime', (r) => r.label))
  })
  console.log('\n--- Pooled across all test periods ---')
  printTable(research.pooledVolatilityGroups.map((g) => ({ label: `${g.label}${g.baseline.smallSample ? ' (SMALL SAMPLE)' : ''}`, metrics: g.baseline.overall })), metricColumns('Regime', (r) => r.label))

  console.log('\n\n############################################################')
  console.log('# Part D — Critical test')
  console.log('############################################################')
  const c = research.criticalTest
  console.log(`High-volatility expectancy positive in ${c.highVolatilityPositiveCount} test period(s); negative in ${c.highVolatilityNegativeCount} test period(s).`)
  console.log(`Medium-volatility expectancy exceeded low-volatility expectancy in ${c.mediumExceedsLowCount} test period(s); the opposite occurred in ${c.lowExceedsMediumCount} test period(s).`)
  console.log(`Average expectancy across test periods — Low: ${fmtR(c.averageLowVolatilityExpectancy)}, Medium: ${fmtR(c.averageMediumVolatilityExpectancy)}, High: ${fmtR(c.averageHighVolatilityExpectancy)}`)
  console.log(`Median expectancy across test periods — Low: ${fmtR(c.medianLowVolatilityExpectancy)}, Medium: ${fmtR(c.medianMediumVolatilityExpectancy)}, High: ${fmtR(c.medianHighVolatilityExpectancy)}`)

  console.log('\n\n############################################################')
  console.log('# Part H — Sequential evidence table (most important output)')
  console.log('############################################################')
  printTable(research.evidenceTable, [
    { label: 'Test year', value: (r) => r.testYear },
    { label: 'Low exp (sign/trades/PF)', value: (r) => `${fmtR(r.low.expectancy)} (${fmtSign(r.low.expectancy)}/${r.low.tradeCount}/${fmtPf(r.low.profitFactor)})` },
    { label: 'Medium exp (sign/trades/PF)', value: (r) => `${fmtR(r.medium.expectancy)} (${fmtSign(r.medium.expectancy)}/${r.medium.tradeCount}/${fmtPf(r.medium.profitFactor)})` },
    { label: 'High exp (sign/trades/PF)', value: (r) => `${fmtR(r.high.expectancy)} (${fmtSign(r.high.expectancy)}/${r.high.tradeCount}/${fmtPf(r.high.profitFactor)})` },
  ])

  console.log('\n\n############################################################')
  console.log('# Part E — Score behavior inside walk-forward regimes')
  console.log('############################################################')
  research.windows.forEach((windowEntry) => {
    windowEntry.scoreByVolatility.forEach((regimeEntry) => {
      console.log(`\n--- ${windowEntry.label} (${windowEntry.testYear}) — volatility: ${regimeEntry.volatilityLabel} ---`)
      printTable(regimeEntry.buckets.map((bucket) => ({ label: `${bucket.label}${bucket.smallSample ? ' (SMALL SAMPLE)' : ''}`, metrics: bucket.overall })), metricColumns('Bucket', (r) => r.label))
      console.log(regimeEntry.monotonicity.evaluable
        ? `  Monotonicity: avgR-vs-order correlation=${regimeEntry.monotonicity.averageRCorrelation.toFixed(2)}, winRate-vs-order correlation=${regimeEntry.monotonicity.winRateCorrelation.toFixed(2)}`
        : `  Monotonicity: not evaluable (${regimeEntry.monotonicity.reason})`)
    })
  })

  console.log('\n\n############################################################')
  console.log('# Part F — RV confirmation by walk-forward volatility regime')
  console.log('############################################################')
  research.windows.forEach((windowEntry) => {
    console.log(`\n--- ${windowEntry.label} (test year ${windowEntry.testYear}) ---`)
    windowEntry.volatilityGroups.forEach((group) => {
      console.log(`  ${group.label}:`)
      printTable([
        { label: 'Baseline (75+)', metrics: group.baseline.overall },
        { label: 'RV-confirmed (75+ AND RV)', metrics: group.rvConfirmed.overall },
      ], metricColumns('Variant', (r) => r.label))
    })
  })

  console.log('\n\n############################################################')
  console.log('# Part G — Execution costs by walk-forward volatility regime (existing tiers, unchanged)')
  console.log('############################################################')
  research.windows.forEach((windowEntry) => {
    console.log(`\n--- ${windowEntry.label} (test year ${windowEntry.testYear}) ---`)
    windowEntry.volatilityGroups.forEach((group) => {
      console.log(`  ${group.label} — baseline:`)
      printTable(group.baseline.costTiers.filter((t) => t.label !== 'Before execution costs').map((t) => ({ label: t.label, metrics: t.metrics })), [
        { label: 'Cost tier', value: (r) => r.label },
        { label: 'PF', value: (r) => fmtPf(r.metrics.profitFactor) },
        { label: 'Expectancy', value: (r) => fmtR(r.metrics.expectancy) },
      ])
      console.log(`  ${group.label} — RV-confirmed:`)
      printTable(group.rvConfirmed.costTiers.filter((t) => t.label !== 'Before execution costs').map((t) => ({ label: t.label, metrics: t.metrics })), [
        { label: 'Cost tier', value: (r) => r.label },
        { label: 'PF', value: (r) => fmtPf(r.metrics.profitFactor) },
        { label: 'Expectancy', value: (r) => fmtR(r.metrics.expectancy) },
      ])
    })
  })

  console.log('\n\n############################################################')
  console.log('# Combined reference (all windows pooled)')
  console.log('############################################################')
  printTable([
    { label: 'Baseline (75+)', metrics: research.combinedBaseline.overall },
    { label: 'RV-confirmed (75+ AND RV)', metrics: research.combinedRvConfirmed.overall },
  ], metricColumns('Variant', (r) => r.label))

  console.log('\nRUN COMPLETE — descriptive research only. Scanner remains frozen. No regime filter deployed, no winner selected, no thresholds changed.')
}

main().catch((error) => {
  console.error('Run FAILED with an unexpected error:', error)
  process.exitCode = 1
})
