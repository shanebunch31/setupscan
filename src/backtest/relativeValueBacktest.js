// Research Experiment #1 — Relative Value backtest variants.
// Reuses the existing Alpaca historical pipeline (enrichHistoricalCandles) and existing baseline
// strategy (runSetupScanBacktest) for Variant A. Does not modify either. Research only — not
// wired into the production scanner or the paper trading engine.
import { enrichHistoricalCandles } from '../data/marketData.js'
import { scanSetups } from '../logic/scanner.js'
import { runSetupScanBacktest } from './strategy.js'
import {
  synchronizeCandleSeries,
  computeRatioSeries,
  computeRollingZScores,
  detectDivergences,
  evaluateMeanReversion,
  computeRelativeStrengthConfirmation,
} from './relativeValue.js'

export const relativeValueDefaults = {
  lookback: 20,
  divergenceZThreshold: 2,
  forwardHorizon: 10,
  minimumScore: 75,
  stopDistancePercent: 0.005,
  targetR: 2,
  maxHoldingBars: 12,
  executionCostR: 0.05,
  periodCount: 4,
}

const canonicalPairs = [['SPY', 'QQQ'], ['SPY', 'IWM'], ['QQQ', 'IWM']]
const average = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0)

function buildAlignedSeries(rawSeriesBySymbol) {
  const { timestamps, series, droppedCounts, duplicatesBySymbol } = synchronizeCandleSeries(rawSeriesBySymbol)
  const enriched = {}
  Object.keys(series).forEach((symbol) => { enriched[symbol] = enrichHistoricalCandles(series[symbol]) })
  return { timestamps, raw: series, enriched, droppedCounts, duplicatesBySymbol }
}

// Mirrors the entry/exit conventions of the existing baseline strategy (strategy.js createTrade):
// signal at index i -> entry at candle i+1 open -> stop/target evaluated from candle i+1 onward.
function buildTradeFromIndex(candles, signalIndex, options, meta = {}) {
  const entryCandle = candles[signalIndex + 1]
  if (!entryCandle) return null
  const entryPrice = entryCandle.open ?? entryCandle.close
  const risk = entryPrice * options.stopDistancePercent
  if (!(risk > 0)) return null
  const stopPrice = entryPrice - risk
  const targetPrice = entryPrice + risk * options.targetR
  const maxBars = Math.min(options.maxHoldingBars, candles.length - signalIndex - 1)
  if (maxBars < 1) return null
  let exitReason = 'Expired'
  let exitPrice = candles[signalIndex + maxBars]?.close ?? entryPrice
  let holdingBars = maxBars
  for (let offset = 1; offset <= maxBars; offset += 1) {
    const candle = candles[signalIndex + offset]
    if (candle.low <= stopPrice) { exitReason = 'Stop'; exitPrice = stopPrice; holdingBars = offset; break }
    if (candle.high >= targetPrice) { exitReason = 'Target'; exitPrice = targetPrice; holdingBars = offset; break }
  }
  const rMultiple = (exitPrice - entryPrice) / risk
  return {
    symbol: meta.symbol,
    variant: meta.variant,
    pair: meta.pair ?? null,
    timeframe: '1h',
    timestamp: candles[signalIndex].timestamp,
    entryPrice,
    stopPrice,
    targetPrice,
    exitPrice,
    exitReason,
    holdingBars,
    holdingTime: holdingBars * 60,
    rMultiple,
    rMultipleAfterCosts: rMultiple - options.executionCostR,
    outcome: rMultiple > 0 ? 'Win' : rMultiple < 0 ? 'Loss' : 'Breakeven',
  }
}

function computeMetrics(trades, useCosts) {
  const rKey = useCosts ? 'rMultipleAfterCosts' : 'rMultiple'
  const wins = trades.filter((trade) => trade[rKey] > 0)
  const losses = trades.filter((trade) => trade[rKey] < 0)
  const grossProfit = wins.reduce((sum, trade) => sum + trade[rKey], 0)
  const grossLoss = Math.abs(losses.reduce((sum, trade) => sum + trade[rKey], 0))
  let equity = 0
  let peak = 0
  let maximumDrawdown = 0
  trades.forEach((trade) => {
    equity += trade[rKey]
    peak = Math.max(peak, equity)
    maximumDrawdown = Math.max(maximumDrawdown, peak - equity)
  })
  const winRate = trades.length ? wins.length / trades.length : 0
  const averageWinner = average(wins.map((trade) => trade[rKey]))
  const averageLoser = average(losses.map((trade) => trade[rKey]))
  return {
    tradeCount: trades.length,
    winRate,
    profitFactor: grossLoss ? grossProfit / grossLoss : grossProfit ? Infinity : 0,
    expectancy: winRate * averageWinner + (losses.length / (trades.length || 1)) * averageLoser,
    totalR: trades.reduce((sum, trade) => sum + trade[rKey], 0),
    maximumDrawdown,
    averageHoldingTime: average(trades.map((trade) => trade.holdingTime)),
  }
}

function periodLabelForTimestamp(timestamps, timestamp, periodCount) {
  const index = timestamps.indexOf(timestamp)
  if (index < 0) return null
  const periodSize = Math.ceil(timestamps.length / periodCount)
  return `Period ${Math.floor(index / periodSize) + 1}`
}

function summarizeVariant(entriesBySymbol, timestamps, periodCount) {
  const allTrades = entriesBySymbol.flatMap((entry) => entry.trades)
  const bySymbol = entriesBySymbol.map((entry) => ({
    symbol: entry.symbol,
    beforeCosts: computeMetrics(entry.trades, false),
    afterCosts: computeMetrics(entry.trades, true),
  }))
  const periodLabels = Array.from({ length: periodCount }, (_, index) => `Period ${index + 1}`)
  const byPeriod = periodLabels.map((label) => {
    const periodTrades = allTrades.filter((trade) => periodLabelForTimestamp(timestamps, trade.timestamp, periodCount) === label)
    return { label, beforeCosts: computeMetrics(periodTrades, false), afterCosts: computeMetrics(periodTrades, true) }
  })
  return {
    overallBeforeCosts: computeMetrics(allTrades, false),
    overallAfterCosts: computeMetrics(allTrades, true),
    bySymbol,
    byPeriod,
    trades: allTrades,
  }
}

/**
 * Runs all four research variants (A/B/C/D) for every symbol in `rawSeriesBySymbol`, treating
 * each symbol in turn as the "primary" instrument and the others as peers for relative-strength
 * comparisons. No variant is selected as a winner — all results are returned side by side.
 */
export function runRelativeValueExperiment(rawSeriesBySymbol, settings = {}) {
  const options = { ...relativeValueDefaults, ...settings }
  const aligned = buildAlignedSeries(rawSeriesBySymbol)
  const symbols = Object.keys(aligned.raw)
  const variants = { A: [], B: [], C: [], D: [] }

  symbols.forEach((primarySymbol) => {
    const peerSymbols = symbols.filter((symbol) => symbol !== primarySymbol)
    const primaryRaw = aligned.raw[primarySymbol]
    const primaryEnriched = aligned.enriched[primarySymbol]
    const peerRawSeriesList = peerSymbols.map((symbol) => aligned.raw[symbol])

    // Variant A — baseline, via the existing unmodified backtest infrastructure.
    const baseline = runSetupScanBacktest(primaryEnriched, { minimumScore: options.minimumScore })
    variants.A.push({
      symbol: primarySymbol,
      trades: baseline.trades.map((trade) => ({ ...trade, variant: 'A', rMultipleAfterCosts: trade.rMultiple - options.executionCostR })),
    })

    const confirmation = computeRelativeStrengthConfirmation(primaryRaw, peerRawSeriesList, options.lookback)

    // Variant B — relative-value confirmation filter, standalone (edge-triggered on confirmation turning true).
    const bTrades = []
    for (let index = 1; index < confirmation.length - 1; index += 1) {
      if (confirmation[index].confirmed && !confirmation[index - 1].confirmed) {
        const trade = buildTradeFromIndex(primaryRaw, index, options, { symbol: primarySymbol, variant: 'B' })
        if (trade) bTrades.push(trade)
      }
    }
    variants.B.push({ symbol: primarySymbol, trades: bTrades })

    // Variant C — relative-value mean-reversion signal (long primary when it is unusually cheap vs a peer).
    const cTrades = []
    peerSymbols.forEach((peerSymbol) => {
      const peerRaw = aligned.raw[peerSymbol]
      const ratioSeries = computeRatioSeries(primaryRaw, peerRaw)
      const zScoreSeries = computeRollingZScores(ratioSeries, options.lookback)
      const divergenceSeries = detectDivergences(zScoreSeries, options.divergenceZThreshold)
      for (let index = 1; index < divergenceSeries.length - 1; index += 1) {
        const isNewDivergence = divergenceSeries[index].direction === 'PRIMARY_CHEAP' && divergenceSeries[index - 1].direction !== 'PRIMARY_CHEAP'
        if (!isNewDivergence) continue
        const trade = buildTradeFromIndex(primaryRaw, index, options, { symbol: primarySymbol, variant: 'C', pair: `${primarySymbol}/${peerSymbol}` })
        if (trade) cTrades.push(trade)
      }
    })
    variants.C.push({ symbol: primarySymbol, trades: cTrades })

    // Variant D — combined: baseline bullish signal AND relative-value confirmation both true.
    const dTrades = []
    scanSetups(primaryEnriched).forEach((signal) => {
      if (signal.score < options.minimumScore || signal.status !== 'Bullish') return
      const index = primaryEnriched.findIndex((candle) => candle.timestamp === signal.timestamp)
      if (index < 0 || index >= primaryEnriched.length - 1) return
      if (!confirmation[index]?.confirmed) return
      const trade = buildTradeFromIndex(primaryRaw, index, options, { symbol: primarySymbol, variant: 'D' })
      if (trade) dTrades.push(trade)
    })
    variants.D.push({ symbol: primarySymbol, trades: dTrades })
  })

  return { aligned, options, variants }
}

/** Runs the experiment and pre-computes summary metrics (overall, by symbol, by period, by cost basis) for each variant. */
export function runRelativeValueResearch(rawSeriesBySymbol, settings = {}) {
  const experiment = runRelativeValueExperiment(rawSeriesBySymbol, settings)
  const summaries = {}
  Object.keys(experiment.variants).forEach((key) => {
    summaries[key] = summarizeVariant(experiment.variants[key], experiment.aligned.timestamps, experiment.options.periodCount)
  })
  return { ...experiment, summaries }
}

/** Descriptive snapshot of the three canonical pairs (SPY/QQQ, SPY/IWM, QQQ/IWM) — no trading involved. */
export function computeCanonicalRelativeStrength(alignedRaw, lookback, zThreshold = relativeValueDefaults.divergenceZThreshold) {
  return canonicalPairs
    .filter(([a, b]) => alignedRaw[a]?.length && alignedRaw[b]?.length)
    .map(([a, b]) => {
      const ratioSeries = computeRatioSeries(alignedRaw[a], alignedRaw[b])
      const zScoreSeries = computeRollingZScores(ratioSeries, lookback)
      const divergenceSeries = detectDivergences(zScoreSeries, zThreshold)
      return {
        pair: `${a}/${b}`,
        latestRatio: ratioSeries.at(-1)?.ratio ?? null,
        latestZScore: zScoreSeries.at(-1)?.zScore ?? null,
        divergentCandleCount: divergenceSeries.filter((point) => point.isDivergent).length,
        candleCount: ratioSeries.length,
      }
    })
}

/** Tests whether divergences beyond `divergenceZThreshold` mean-revert within `forwardHorizon` bars, per canonical pair. */
export function runMeanReversionTest(alignedRaw, { lookback, divergenceZThreshold, forwardHorizon }) {
  return canonicalPairs
    .filter(([a, b]) => alignedRaw[a]?.length && alignedRaw[b]?.length)
    .map(([a, b]) => {
      const ratioSeries = computeRatioSeries(alignedRaw[a], alignedRaw[b])
      const zScoreSeries = computeRollingZScores(ratioSeries, lookback)
      const divergenceSeries = detectDivergences(zScoreSeries, divergenceZThreshold)
      const divergentIndices = divergenceSeries.map((point, index) => (point.isDivergent ? index : -1)).filter((index) => index >= 0)
      const evaluations = evaluateMeanReversion(divergenceSeries, divergentIndices, forwardHorizon)
      const evaluated = evaluations.filter((evaluation) => evaluation.evaluated)
      const revertedCount = evaluated.filter((evaluation) => evaluation.reverted).length
      return {
        pair: `${a}/${b}`,
        divergenceCount: divergentIndices.length,
        evaluatedCount: evaluated.length,
        revertedCount,
        reversionRate: evaluated.length ? revertedCount / evaluated.length : 0,
      }
    })
}
