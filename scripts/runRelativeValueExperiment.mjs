// One-off research runner for Research Experiment #1 (Relative Value).
// Fetches real Alpaca historical bars and runs variants A-D with default parameters.
// Does not touch paper trading, the Render worker, Supabase, or the production scanner.
import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchAlpacaHistoricalBars } from '../server/alpacaProxy.js'
import { runRelativeValueExperiment, relativeValueDefaults } from '../src/backtest/relativeValueBacktest.js'
import {
  computeRatioSeries,
  computeRollingZScores,
  detectDivergences,
  evaluateMeanReversion,
} from '../src/backtest/relativeValue.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '..', '.env') })

const symbols = ['SPY', 'QQQ', 'IWM']
const requestedStart = '2022-01-01T00:00:00Z'
const requestedEnd = new Date().toISOString()
const costTiers = [
  ['Before execution costs', 0],
  ['Low execution costs (0.02R)', 0.02],
  ['Moderate execution costs (0.05R)', 0.05],
  ['High execution costs (0.10R)', 0.10],
]

const average = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0)

function metricsForCost(trades, costR) {
  const rValues = trades.map((trade) => trade.rMultiple - costR)
  const wins = rValues.filter((value) => value > 0)
  const losses = rValues.filter((value) => value < 0)
  const grossProfit = wins.reduce((sum, value) => sum + value, 0)
  const grossLoss = Math.abs(losses.reduce((sum, value) => sum + value, 0))
  let equity = 0, peak = 0, maximumDrawdown = 0
  rValues.forEach((value) => { equity += value; peak = Math.max(peak, equity); maximumDrawdown = Math.max(maximumDrawdown, peak - equity) })
  const winRate = trades.length ? wins.length / trades.length : 0
  const averageWinner = average(wins)
  const averageLoser = average(losses)
  return {
    tradeCount: trades.length,
    winRate,
    profitFactor: grossLoss ? grossProfit / grossLoss : grossProfit ? Infinity : 0,
    expectancy: winRate * averageWinner + (losses.length / (trades.length || 1)) * averageLoser,
    totalR: rValues.reduce((sum, value) => sum + value, 0),
    maximumDrawdown,
    averageHoldingTime: average(trades.map((trade) => trade.holdingTime)),
  }
}

function fmtPct(value) { return `${(value * 100).toFixed(1)}%` }
function fmtR(value) { return value === Infinity ? '∞' : `${value.toFixed(2)}R` }
function fmtDate(value) { return value ? new Date(value).toISOString().slice(0, 10) : '—' }

function printMetricsTable(rows, columns) {
  const header = columns.map((c) => c.label)
  const lines = [header.join(' | '), header.map(() => '---').join(' | ')]
  rows.forEach((row) => lines.push(columns.map((c) => c.value(row)).join(' | ')))
  console.log(lines.join('\n'))
}

async function main() {
  console.log('=== Research Experiment #1 — Relative Value (real Alpaca data run) ===')
  console.log(`Requested range: ${requestedStart} -> ${requestedEnd}`)

  const rawSeriesBySymbol = {}
  const fetchReports = []
  for (const symbol of symbols) {
    try {
      const data = await fetchAlpacaHistoricalBars({ symbol, timeframe: '1Hour', start: requestedStart, end: requestedEnd })
      rawSeriesBySymbol[symbol] = data.candles
      fetchReports.push({ symbol, ok: true, candleCount: data.candleCount, start: data.start, end: data.end, complete: data.complete })
    } catch (error) {
      fetchReports.push({ symbol, ok: false, error: error.message })
    }
  }

  console.log('\n--- Data fetch status ---')
  fetchReports.forEach((report) => {
    if (report.ok) {
      console.log(`${report.symbol}: OK — ${report.candleCount} candles, ${fmtDate(report.start)} -> ${fmtDate(report.end)}${report.complete ? '' : ' (INCOMPLETE per provider heuristic)'}`)
    } else {
      console.log(`${report.symbol}: FAILED — ${report.error}`)
    }
  })

  if (fetchReports.some((report) => !report.ok)) {
    console.log('\nRun ABORTED: missing-data issue — one or more symbols failed to fetch from Alpaca. No demo/fake data was substituted.')
    process.exitCode = 1
    return
  }

  const earliestBySymbol = fetchReports.map((report) => new Date(report.start).getTime())
  const olderPeriodAvailable = earliestBySymbol.every((time) => time <= new Date('2024-01-01T00:00:00Z').getTime())
  console.log(`\nOlder 2022–2024 window available for all symbols: ${olderPeriodAvailable ? 'YES' : 'NO'}`)

  const research = runRelativeValueExperiment(rawSeriesBySymbol, {})
  const options = research.options
  const timestamps = research.aligned.timestamps
  console.log(`\nSynchronized timeline: ${timestamps.length} common hourly candles, ${fmtDate(timestamps[0])} -> ${fmtDate(timestamps.at(-1))}`)
  symbols.forEach((symbol) => console.log(`  ${symbol}: dropped ${research.aligned.droppedCounts[symbol]} candles during synchronization (gaps/duplicates), ${research.aligned.duplicatesBySymbol[symbol].length} duplicate timestamps`))

  console.log(`\nDefault research parameters used: lookback=${options.lookback}, divergenceZThreshold=${options.divergenceZThreshold}, forwardHorizon=${options.forwardHorizon}, minimumScore=${options.minimumScore}, targetR=${options.targetR}, maxHoldingBars=${options.maxHoldingBars}`)
  console.log('No parameter search was performed. No variant is selected as a winner.')

  const periodCount = options.periodCount
  const periodSize = Math.ceil(timestamps.length / periodCount)
  const periodBounds = Array.from({ length: periodCount }, (_, index) => {
    const start = timestamps[index * periodSize]
    const end = timestamps[Math.min((index + 1) * periodSize, timestamps.length) - 1]
    return { label: `Period ${index + 1}`, start, end }
  })
  function periodLabelFor(timestamp) {
    const index = timestamps.indexOf(timestamp)
    if (index < 0) return null
    return `Period ${Math.floor(index / periodSize) + 1}`
  }

  const variantLabels = {
    A: 'Baseline existing strategy',
    B: 'Relative-value confirmation filter',
    C: 'Relative-value mean-reversion signal',
    D: 'Combined: baseline + relative-value confirmation',
  }

  for (const key of ['A', 'B', 'C', 'D']) {
    console.log(`\n\n############################################################`)
    console.log(`# Variant ${key} — ${variantLabels[key]}`)
    console.log(`############################################################`)
    const entries = research.variants[key]
    const allTrades = entries.flatMap((entry) => entry.trades)

    console.log(`\nOverall (before costs): ${allTrades.length} trades`)
    printMetricsTable([metricsForCost(allTrades, 0)], [
      { label: 'Trades', value: (m) => m.tradeCount },
      { label: 'Win rate', value: (m) => fmtPct(m.winRate) },
      { label: 'Profit factor', value: (m) => (m.profitFactor === Infinity ? '∞' : m.profitFactor.toFixed(2)) },
      { label: 'Expectancy', value: (m) => fmtR(m.expectancy) },
      { label: 'Total R', value: (m) => fmtR(m.totalR) },
      { label: 'Max DD', value: (m) => fmtR(m.maximumDrawdown) },
      { label: 'Avg hold', value: (m) => `${m.averageHoldingTime.toFixed(0)}m` },
    ])

    console.log('\n1) Results by symbol (before costs):')
    printMetricsTable(entries.map((entry) => ({ symbol: entry.symbol, m: metricsForCost(entry.trades, 0), start: timestamps[0], end: timestamps.at(-1) })), [
      { label: 'Symbol', value: (r) => r.symbol },
      { label: 'Date range', value: (r) => `${fmtDate(r.start)} -> ${fmtDate(r.end)}` },
      { label: 'Trades', value: (r) => r.m.tradeCount },
      { label: 'Win rate', value: (r) => fmtPct(r.m.winRate) },
      { label: 'Profit factor', value: (r) => (r.m.profitFactor === Infinity ? '∞' : r.m.profitFactor.toFixed(2)) },
      { label: 'Expectancy', value: (r) => fmtR(r.m.expectancy) },
      { label: 'Total R', value: (r) => fmtR(r.m.totalR) },
      { label: 'Max DD', value: (r) => fmtR(r.m.maximumDrawdown) },
      { label: 'Avg hold', value: (r) => `${r.m.averageHoldingTime.toFixed(0)}m` },
    ])

    console.log('\n2) Results by chronological market period (before costs, all symbols combined):')
    printMetricsTable(periodBounds.map((period) => ({ ...period, m: metricsForCost(allTrades.filter((trade) => periodLabelFor(trade.timestamp) === period.label), 0) })), [
      { label: 'Period', value: (r) => r.label },
      { label: 'Date range', value: (r) => `${fmtDate(r.start)} -> ${fmtDate(r.end)}` },
      { label: 'Trades', value: (r) => r.m.tradeCount },
      { label: 'Win rate', value: (r) => fmtPct(r.m.winRate) },
      { label: 'Profit factor', value: (r) => (r.m.profitFactor === Infinity ? '∞' : r.m.profitFactor.toFixed(2)) },
      { label: 'Expectancy', value: (r) => fmtR(r.m.expectancy) },
      { label: 'Total R', value: (r) => fmtR(r.m.totalR) },
      { label: 'Max DD', value: (r) => fmtR(r.m.maximumDrawdown) },
      { label: 'Avg hold', value: (r) => `${r.m.averageHoldingTime.toFixed(0)}m` },
    ])

    console.log('\n3-6) Results across execution cost tiers (all symbols combined):')
    printMetricsTable(costTiers.map(([label, costR]) => ({ label, m: metricsForCost(allTrades, costR) })), [
      { label: 'Cost tier', value: (r) => r.label },
      { label: 'Trades', value: (r) => r.m.tradeCount },
      { label: 'Win rate', value: (r) => fmtPct(r.m.winRate) },
      { label: 'Profit factor', value: (r) => (r.m.profitFactor === Infinity ? '∞' : r.m.profitFactor.toFixed(2)) },
      { label: 'Expectancy', value: (r) => fmtR(r.m.expectancy) },
      { label: 'Total R', value: (r) => fmtR(r.m.totalR) },
      { label: 'Max DD', value: (r) => fmtR(r.m.maximumDrawdown) },
    ])
  }

  console.log(`\n\n############################################################`)
  console.log('# Relative-value pair diagnostics (Variant C construction)')
  console.log('############################################################')
  console.log(`Lookback window: ${options.lookback} bars | z-score threshold: ${options.divergenceZThreshold} | forward horizon: ${options.forwardHorizon} bars`)

  const pairs = [['SPY', 'QQQ'], ['SPY', 'IWM'], ['QQQ', 'IWM']]
  const pairRows = pairs.map(([a, b]) => {
    const ratioSeries = computeRatioSeries(research.aligned.raw[a], research.aligned.raw[b])
    const zScoreSeries = computeRollingZScores(ratioSeries, options.lookback)
    const divergenceSeries = detectDivergences(zScoreSeries, options.divergenceZThreshold)
    const divergentIndices = divergenceSeries.map((point, index) => (point.isDivergent ? index : -1)).filter((index) => index >= 0)
    const evaluations = evaluateMeanReversion(divergenceSeries, divergentIndices, options.forwardHorizon)
    const evaluated = evaluations.filter((evaluation) => evaluation.evaluated)
    const reverted = evaluated.filter((evaluation) => evaluation.reverted)
    const subsequentReturns = evaluated.map((evaluation) => (evaluation.forwardRatio - evaluation.startRatio) / evaluation.startRatio)
    return {
      pair: `${a}/${b}`,
      divergenceCount: divergentIndices.length,
      evaluatedCount: evaluated.length,
      revertedCount: reverted.length,
      reversionRate: evaluated.length ? reverted.length / evaluated.length : 0,
      averageSubsequentReturn: average(subsequentReturns),
    }
  })
  printMetricsTable(pairRows, [
    { label: 'Pair', value: (r) => r.pair },
    { label: 'Divergence signals', value: (r) => r.divergenceCount },
    { label: 'Evaluated (horizon fit)', value: (r) => r.evaluatedCount },
    { label: 'Mean-reverted', value: (r) => r.revertedCount },
    { label: '% reverted', value: (r) => fmtPct(r.reversionRate) },
    { label: 'Avg subsequent ratio return', value: (r) => `${(r.averageSubsequentReturn * 100).toFixed(3)}%` },
  ])

  console.log('\nRUN COMPLETE — no parameter optimization performed, no winner auto-selected.')
}

main().catch((error) => {
  console.error('Run FAILED with an unexpected error:', error)
  process.exitCode = 1
})
