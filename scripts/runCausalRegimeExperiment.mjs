// One-off research runner for Research Experiment #5 (Causal Market-Regime Classification).
// Fetches real Alpaca historical bars and reports causal regime classification results using the
// existing, frozen SetupScan scoring formula. Does not touch paper trading, the Render worker,
// Supabase, or the production scanner. Retries the fetch stage if the network stalls.
import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchAlpacaHistoricalBars } from '../server/alpacaProxy.js'
import { runCausalRegimeResearch, trendLabels, volatilityLabels, breadthLabels } from '../src/backtest/causalRegimeBacktest.js'

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
  console.log('=== Research Experiment #5 — Causal Market-Regime Classification (real Alpaca data run) ===')
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

  const research = runCausalRegimeResearch(rawSeriesBySymbol, {})
  const options = research.options
  const timestamps = research.aligned.timestamps

  console.log(`\nSynchronized/common candle count: ${timestamps.length}`)
  console.log(`Exact dates realized: ${fmtDate(timestamps[0])} -> ${fmtDate(timestamps.at(-1))}`)
  symbols.forEach((symbol) => console.log(`  ${symbol}: dropped ${research.aligned.droppedCounts[symbol]} candles during synchronization (gaps), ${research.aligned.duplicatesBySymbol[symbol].length} duplicate timestamps removed`))
  console.log(`\nFrozen scanner parameters (unchanged): minimumScore=${options.minimumScore}, targetR=${options.targetR}, maxHoldingBars=${options.maxHoldingBars}, stopDistancePercent=${options.stopDistancePercent}`)
  console.log(`Volatility classification method: expanding-window percentile rank of trailing 20-bar realized volatility, warmup=${options.volatilityHistoryWarmup} observations, terciles (<=1/3 Low, <=2/3 Medium, >2/3 High). No future observations used.`)
  console.log('No parameter optimization was performed. No regime filter is deployed. No scoring weights or thresholds were changed.')

  console.log('\n\n############################################################')
  console.log('# Part C — Baseline performance by regime (trend / volatility / breadth)')
  console.log('############################################################')
  function printRegimeGroups(title, groups) {
    console.log(`\n${title}:`)
    printTable(groups.map((g) => ({ label: `${g.label}${g.baseline.smallSample ? ' (SMALL SAMPLE)' : ''}`, metrics: g.baseline.overall })), metricColumns('Regime', (r) => r.label))
    groups.forEach((g) => {
      if (g.baseline.overall.tradeCount === 0) return
      console.log(`  ${g.label} by symbol:`)
      printTable(g.baseline.bySymbol, metricColumns('Symbol', (r) => r.symbol))
    })
  }
  printRegimeGroups('Trend regime', research.trendGroups)
  printRegimeGroups('Volatility regime', research.volatilityGroups)
  printRegimeGroups('Breadth regime', research.breadthGroups)

  console.log('\n\n############################################################')
  console.log('# Part D — Combined regime states (predefined only)')
  console.log('############################################################')
  console.log('\nTrend + Volatility:')
  printTable(research.combinedTrendVolatility.map((c) => ({ label: `${c.label}${c.baseline.smallSample ? ' (SMALL SAMPLE)' : ''}`, metrics: c.baseline.overall })), metricColumns('Combo', (r) => r.label))
  console.log('\nTrend + Breadth:')
  printTable(research.combinedTrendBreadth.map((c) => ({ label: `${c.label}${c.baseline.smallSample ? ' (SMALL SAMPLE)' : ''}`, metrics: c.baseline.overall })), metricColumns('Combo', (r) => r.label))

  console.log('\n\n############################################################')
  console.log('# Part E — Year/regime reconciliation (% of that year\'s baseline trades)')
  console.log('############################################################')
  research.yearRegimeDistribution.forEach((yearEntry) => {
    console.log(`\n--- ${yearEntry.year} (${yearEntry.totalBaselineTrades} baseline trades) ---`)
    printTable([
      { dimension: 'Trend', ...Object.fromEntries(trendLabels.map((l) => [l, fmtPct(yearEntry.trend.percentages[l])])) },
      { dimension: 'Volatility', ...Object.fromEntries(volatilityLabels.map((l) => [l, fmtPct(yearEntry.volatility.percentages[l])])) },
      { dimension: 'Breadth', ...Object.fromEntries(breadthLabels.map((l) => [l, fmtPct(yearEntry.breadth.percentages[l])])) },
    ], [
      { label: 'Dimension', value: (r) => r.dimension },
      { label: 'Group 1', value: (r) => Object.values(r)[1] },
      { label: 'Group 2', value: (r) => Object.values(r)[2] },
      { label: 'Group 3', value: (r) => Object.values(r)[3] },
    ])
    console.log(`  (Trend: Uptrend/Mixed/Downtrend, Volatility: Low/Medium/High, Breadth: Strong/Mixed/Weak, insufficient-history counts: trend=${yearEntry.trend.insufficientHistoryCount}, vol=${yearEntry.volatility.insufficientHistoryCount}, breadth=${yearEntry.breadth.insufficientHistoryCount})`)
  })

  console.log('\n\n############################################################')
  console.log('# Part F — Score behavior inside regimes')
  console.log('############################################################')
  research.scoreByRegime.forEach((regimeEntry) => {
    console.log(`\n--- ${regimeEntry.dimension}: ${regimeEntry.label} ---`)
    printTable(regimeEntry.buckets.map((bucket) => ({ label: `${bucket.label}${bucket.smallSample ? ' (SMALL SAMPLE)' : ''}`, metrics: bucket.overall })), metricColumns('Bucket', (r) => r.label))
    console.log(regimeEntry.monotonicity.evaluable
      ? `  Monotonicity: avgR-vs-order correlation=${regimeEntry.monotonicity.averageRCorrelation.toFixed(2)}, winRate-vs-order correlation=${regimeEntry.monotonicity.winRateCorrelation.toFixed(2)}, monotonic-non-decreasing=${regimeEntry.monotonicity.monotonicIncreasing}`
      : `  Monotonicity: not evaluable (${regimeEntry.monotonicity.reason})`)
  })

  console.log('\n\n############################################################')
  console.log('# Part G — RV confirmation by regime (frozen baseline vs. frozen RV-confirmed)')
  console.log('############################################################')
  research.rvByRegime.forEach((regimeEntry) => {
    console.log(`\n--- ${regimeEntry.dimension}: ${regimeEntry.label} ---`)
    printTable([
      { label: 'Baseline (75+)', metrics: regimeEntry.baseline.overall },
      { label: 'RV-confirmed (75+ AND RV)', metrics: regimeEntry.rvConfirmed.overall },
    ], metricColumns('Variant', (r) => r.label))
  })

  console.log('\n\n############################################################')
  console.log('# Part H — Execution costs by regime (existing Low/Moderate/High tiers, unchanged)')
  console.log('############################################################')
  research.costByRegime.forEach((regimeEntry) => {
    console.log(`\n--- ${regimeEntry.dimension}: ${regimeEntry.label} — baseline ---`)
    printTable(regimeEntry.baseline.costTiers.filter((t) => t.label !== 'Before execution costs').map((t) => ({ label: t.label, metrics: t.metrics })), [
      { label: 'Cost tier', value: (r) => r.label },
      { label: 'PF', value: (r) => fmtPf(r.metrics.profitFactor) },
      { label: 'Expectancy', value: (r) => fmtR(r.metrics.expectancy) },
      { label: 'Total R', value: (r) => fmtR(r.metrics.totalR) },
    ])
    console.log(`--- ${regimeEntry.dimension}: ${regimeEntry.label} — RV-confirmed ---`)
    printTable(regimeEntry.rvConfirmed.costTiers.filter((t) => t.label !== 'Before execution costs').map((t) => ({ label: t.label, metrics: t.metrics })), [
      { label: 'Cost tier', value: (r) => r.label },
      { label: 'PF', value: (r) => fmtPf(r.metrics.profitFactor) },
      { label: 'Expectancy', value: (r) => fmtR(r.metrics.expectancy) },
      { label: 'Total R', value: (r) => fmtR(r.metrics.totalR) },
    ])
  })

  console.log('\n\n############################################################')
  console.log('# Combined baseline vs. RV-confirmed (all regimes combined, for reference)')
  console.log('############################################################')
  printTable([
    { label: 'Baseline (75+)', metrics: research.combinedBaseline.overall },
    { label: 'RV-confirmed (75+ AND RV)', metrics: research.combinedRvConfirmed.overall },
  ], metricColumns('Variant', (r) => r.label))

  console.log('\nRUN COMPLETE — descriptive research only. No regime filter deployed, no winner selected, no scoring weights or thresholds changed.')
}

main().catch((error) => {
  console.error('Run FAILED with an unexpected error:', error)
  process.exitCode = 1
})
