// One-off research runner for Research Experiment #7 (Volatility-Aware Strategy Variants).
// Fetches real Alpaca historical bars and reports Control + 3 predefined volatility-aware
// variants against the exact Experiment #6 walk-forward windows. Does not touch paper trading,
// the Render worker, Supabase, or the production scanner. Retries the fetch stage if it stalls.
import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchAlpacaHistoricalBars } from '../server/alpacaProxy.js'
import { runVolatilityAwareVariantsResearch } from '../src/backtest/volatilityAwareVariantsBacktest.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '..', '.env') })

const symbols = ['SPY', 'QQQ', 'IWM']
const requestedStart = '2022-01-01T00:00:00Z'
const requestedEnd = new Date().toISOString()
const MAX_FETCH_ATTEMPTS = 3
const FETCH_ATTEMPT_TIMEOUT_MS = 90000

function fmtPct(value) { return `${(value * 100).toFixed(1)}%` }
function fmtR(value) { return value === Infinity || value === null ? '—' : `${value.toFixed(2)}R` }
function fmtPf(value) { return value === Infinity ? '∞' : value === null ? '—' : value.toFixed(2) }
function fmtDate(value) { return value ? new Date(value).toISOString().slice(0, 10) : '—' }
function fmtVol(value) { return value === null ? '—' : `${(value * 100).toFixed(3)}%` }

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
  console.log('=== Research Experiment #7 — Volatility-Aware Strategy Variants (real Alpaca data run) ===')
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

  const research = runVolatilityAwareVariantsResearch(rawSeriesBySymbol, {})
  const timestamps = research.aligned.timestamps

  console.log(`\nSynchronized/common candle count: ${timestamps.length}`)
  console.log(`Exact dates realized: ${fmtDate(timestamps[0])} -> ${fmtDate(timestamps.at(-1))}`)
  console.log('Control uses the frozen baseline (score>=75, Bullish) unchanged. Variants only change which already-scored signals are accepted, based on the frozen Experiment #6 volatility classification.')
  console.log('No thresholds were searched. Only the four predefined variants (Control, Skip High Vol, High Vol >=90, High Vol >=95) were run.')

  console.log('\n\n############################################################')
  console.log('# Frozen volatility boundaries (identical to Experiment #6)')
  console.log('############################################################')
  research.windows.forEach((windowEntry) => {
    console.log(`${windowEntry.label} (test ${windowEntry.testYear}): training sample ${windowEntry.boundaries.sampleSize}, Low<=${fmtVol(windowEntry.boundaries.lowMediumBoundary)} <= Medium <=${fmtVol(windowEntry.boundaries.mediumHighBoundary)} <= High`)
  })

  console.log('\n\n############################################################')
  console.log('# Part B — Overall comparison by test period (combined + by symbol)')
  console.log('############################################################')
  research.windows.forEach((windowEntry) => {
    console.log(`\n--- ${windowEntry.label} (test year ${windowEntry.testYear}) ---`)
    printTable(windowEntry.variants.map((v) => ({ label: v.label, metrics: v.summary.overall })), metricColumns('Variant', (r) => r.label))
    windowEntry.variants.forEach((v) => {
      if (v.summary.overall.tradeCount === 0) return
      console.log(`  ${v.label} by symbol:`)
      printTable(v.summary.bySymbol, metricColumns('Symbol', (r) => r.symbol))
    })
  })

  console.log('\n\n############################################################')
  console.log('# Part C — Walk-forward consistency table (expectancy / trades per test year)')
  console.log('############################################################')
  printTable(research.evidenceTable.map((row) => ({
    label: row.label,
    ...Object.fromEntries(row.byYear.map((y) => [String(y.testYear), `${fmtR(y.overall.expectancy)} / ${y.overall.tradeCount}`])),
  })), [
    { label: 'Variant', value: (r) => r.label },
    { label: '2023', value: (r) => r['2023'] },
    { label: '2024', value: (r) => r['2024'] },
    { label: '2025', value: (r) => r['2025'] },
    { label: '2026 YTD', value: (r) => r['2026 YTD'] },
  ])
  console.log('\nConsistency summary per variant:')
  printTable(research.consistency, [
    { label: 'Variant', value: (r) => r.label },
    { label: 'Positive periods', value: (r) => r.positivePeriods },
    { label: 'Negative periods', value: (r) => r.negativePeriods },
    { label: 'Mean yearly exp.', value: (r) => fmtR(r.meanYearlyExpectancy) },
    { label: 'Median yearly exp.', value: (r) => fmtR(r.medianYearlyExpectancy) },
    { label: 'Pooled exp.', value: (r) => fmtR(r.pooledExpectancy) },
    { label: 'Pooled PF', value: (r) => fmtPf(r.pooledProfitFactor) },
    { label: 'Pooled Max DD', value: (r) => fmtR(r.pooledMaxDrawdown) },
  ])

  console.log('\n\n############################################################')
  console.log('# Part D — Descriptive difference vs. Control, by test period')
  console.log('############################################################')
  research.windows.forEach((windowEntry) => {
    console.log(`\n--- ${windowEntry.label} (test year ${windowEntry.testYear}) ---`)
    printTable(windowEntry.diffsVsControl, [
      { label: 'Variant', value: (r) => r.label },
      { label: 'Δ Trades', value: (r) => r.diff.tradeCountChange },
      { label: 'Δ Win rate', value: (r) => `${(r.diff.winRateChange * 100).toFixed(1)}pp` },
      { label: 'Δ PF', value: (r) => (r.diff.profitFactorChange === null ? '—' : r.diff.profitFactorChange.toFixed(2)) },
      { label: 'Δ Expectancy', value: (r) => fmtR(r.diff.expectancyChange) },
      { label: 'Δ Total R', value: (r) => fmtR(r.diff.totalRChange) },
      { label: 'Δ Max DD', value: (r) => fmtR(r.diff.maxDrawdownChange) },
    ])
  })

  console.log('\n\n############################################################')
  console.log('# Part E — High-volatility trade removal analysis (Control vs. Skip High Vol)')
  console.log('############################################################')
  printTable(research.windows.map((w) => ({ label: `${w.label} (${w.testYear})`, removed: w.highVolRemoval.removedCount, metrics: w.highVolRemoval.metrics })), [
    { label: 'Test period', value: (r) => r.label },
    { label: 'Removed trades', value: (r) => r.removed },
    { label: 'R contribution', value: (r) => fmtR(r.metrics.totalR) },
    { label: 'Avg R of removed', value: (r) => fmtR(r.metrics.averageR) },
    { label: 'Win rate of removed', value: (r) => fmtPct(r.metrics.winRate) },
    { label: 'PF of removed', value: (r) => fmtPf(r.metrics.profitFactor) },
  ])

  console.log('\n\n############################################################')
  console.log('# Part F — High-volatility trades by score (Control, High Vol >=90, High Vol >=95)')
  console.log('############################################################')
  research.windows.forEach((windowEntry) => {
    console.log(`\n--- ${windowEntry.label} (test year ${windowEntry.testYear}) ---`)
    windowEntry.highVolScoreByVariant.forEach((entry) => {
      console.log(`  ${entry.key}:`)
      printTable(entry.buckets.map((bucket) => ({ label: `${bucket.label}${bucket.smallSample ? ' (SMALL SAMPLE)' : ''}`, metrics: bucket.metrics })), metricColumns('Bucket', (r) => r.label))
    })
  })

  console.log('\n\n############################################################')
  console.log('# Part G — Execution-cost robustness (pooled + by test year)')
  console.log('############################################################')
  console.log('\nPooled:')
  research.pooled.forEach((p) => {
    console.log(`  ${p.label}:`)
    printTable(p.summary.costTiers, [
      { label: 'Cost tier', value: (r) => r.label },
      { label: 'PF', value: (r) => fmtPf(r.metrics.profitFactor) },
      { label: 'Expectancy', value: (r) => fmtR(r.metrics.expectancy) },
      { label: 'Total R', value: (r) => fmtR(r.metrics.totalR) },
    ])
  })
  research.windows.forEach((windowEntry) => {
    console.log(`\n--- ${windowEntry.label} (test year ${windowEntry.testYear}) ---`)
    windowEntry.variants.forEach((v) => {
      console.log(`  ${v.label}:`)
      printTable(v.summary.costTiers, [
        { label: 'Cost tier', value: (r) => r.label },
        { label: 'PF', value: (r) => fmtPf(r.metrics.profitFactor) },
        { label: 'Expectancy', value: (r) => fmtR(r.metrics.expectancy) },
      ])
    })
  })

  console.log('\n\n############################################################')
  console.log('# Part H — Stress tests (regime classification lagged by 1 and 2 bars)')
  console.log('############################################################')
  console.log('Stress 1 = classification uses realizedVol20 from 1 bar earlier than the signal bar.')
  console.log('Stress 2 = classification uses realizedVol20 from 2 bars earlier (one additional completed candle of delay).')
  research.windows.forEach((windowEntry) => {
    console.log(`\n--- ${windowEntry.label} (test year ${windowEntry.testYear}) ---`)
    console.log('  Lag 0 (as reported above) vs Stress 1 (lag 1) vs Stress 2 (lag 2):')
    ;['skipHighVol', 'highVol90', 'highVol95'].forEach((key) => {
      const lag0 = windowEntry.variants.find((v) => v.key === key).summary.overall
      const lag1 = windowEntry.stress1.find((v) => v.key === key).summary.overall
      const lag2 = windowEntry.stress2.find((v) => v.key === key).summary.overall
      console.log(`  ${key}:`)
      printTable([
        { label: 'Lag 0', metrics: lag0 },
        { label: 'Stress 1 (lag 1)', metrics: lag1 },
        { label: 'Stress 2 (lag 2)', metrics: lag2 },
      ], metricColumns('', (r) => r.label))
    })
  })

  console.log('\nRUN COMPLETE — descriptive research only. Control and scanner remain frozen. No variant deployed, no winner selected, no thresholds searched.')
}

main().catch((error) => {
  console.error('Run FAILED with an unexpected error:', error)
  process.exitCode = 1
})
