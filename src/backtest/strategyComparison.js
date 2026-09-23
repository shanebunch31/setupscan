import { runSetupScanBacktest } from './strategy.js'

export const trendMomentumParameters = {
  momentumLookback: 20,
  atrPeriod: 14,
  stopAtrMultiple: 2,
  targetRMultiple: 2,
  maxHoldingBars: 12,
  splitRatio: 0.7,
}

const average = (values) => values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0

export function calculateResearchMetrics(trades) {
  const wins = trades.filter((trade) => trade.rMultiple > 0)
  const losses = trades.filter((trade) => trade.rMultiple < 0)
  const grossProfit = wins.reduce((total, trade) => total + trade.rMultiple, 0)
  const grossLoss = Math.abs(losses.reduce((total, trade) => total + trade.rMultiple, 0))
  let equity = 0
  let peak = 0
  let maximumDrawdown = 0
  trades.forEach((trade) => {
    equity += trade.rMultiple
    peak = Math.max(peak, equity)
    maximumDrawdown = Math.max(maximumDrawdown, peak - equity)
  })
  const winRate = trades.length ? wins.length / trades.length : 0
  const averageWinner = average(wins.map((trade) => trade.rMultiple))
  const averageLoser = average(losses.map((trade) => trade.rMultiple))
  return {
    totalTrades: trades.length,
    winningTrades: wins.length,
    losingTrades: losses.length,
    expiredTrades: trades.filter((trade) => trade.exitReason === 'Expired').length,
    winRate,
    grossProfit,
    grossLoss,
    profitFactor: grossLoss ? grossProfit / grossLoss : grossProfit ? Infinity : 0,
    expectancy: (winRate * averageWinner) + ((losses.length / (trades.length || 1)) * averageLoser),
    averageR: average(trades.map((trade) => trade.rMultiple)),
    maximumDrawdown,
    averageHoldingTime: average(trades.map((trade) => trade.holdingTime)),
    averageWinner,
    averageLoser,
  }
}

function simpleMovingAverage(candles, index, period) {
  if (index < period - 1) return null
  return average(candles.slice(index - period + 1, index + 1).map((candle) => candle.close))
}

function averageTrueRange(candles, index, period) {
  if (index < period) return null
  const ranges = []
  for (let offset = index - period + 1; offset <= index; offset += 1) {
    const previousClose = candles[offset - 1].close
    ranges.push(Math.max(candles[offset].high - candles[offset].low, Math.abs(candles[offset].high - previousClose), Math.abs(candles[offset].low - previousClose)))
  }
  return average(ranges)
}

function createTrendMomentumTrade(candle, entryCandle, candles, signalIndex, atr, settings) {
  const entryPrice = entryCandle.open
  const risk = atr * settings.stopAtrMultiple
  const stopPrice = entryPrice - risk
  const targetPrice = entryPrice + risk * settings.targetRMultiple
  const maxBars = Math.min(settings.maxHoldingBars, candles.length - signalIndex - 1)
  let exitReason = 'Expired'
  let exitPrice = candles[signalIndex + maxBars]?.close ?? entryPrice
  let holdingBars = maxBars
  for (let offset = 1; offset <= maxBars; offset += 1) {
    const futureCandle = candles[signalIndex + offset]
    if (futureCandle.low <= stopPrice) { exitReason = 'Stop'; exitPrice = stopPrice; holdingBars = offset; break }
    if (futureCandle.high >= targetPrice) { exitReason = 'Target'; exitPrice = targetPrice; holdingBars = offset; break }
  }
  const rMultiple = (exitPrice - entryPrice) / risk
  return { symbol: candle.symbol, timeframe: '1h', timestamp: candle.timestamp, setupType: 'Trend / Momentum', direction: 'Long', entryPrice, stopPrice, targetPrice, exitPrice, exitReason, holdingBars, holdingTime: holdingBars * 60, rMultiple, outcome: rMultiple > 0 ? 'Win' : rMultiple < 0 ? 'Loss' : 'Breakeven' }
}

export function runTrendMomentumBacktest(candles, settings = {}) {
  const options = { ...trendMomentumParameters, ...settings }
  const splitIndex = options.splitIndex ?? Math.floor(candles.length * options.splitRatio)
  const signals = []
  for (let index = options.momentumLookback; index < candles.length - 1; index += 1) {
    const sma50 = simpleMovingAverage(candles, index, 50)
    const previousSma50 = simpleMovingAverage(candles, index - 1, 50)
    const sma200 = simpleMovingAverage(candles, index, 200)
    const atr = averageTrueRange(candles, index, options.atrPeriod)
    const momentumReference = candles[index - options.momentumLookback].close
    if (sma50 === null || previousSma50 === null || sma200 === null || atr === null) continue
    if (candles[index].close > sma50 && sma50 > previousSma50 && candles[index].close > sma200 && sma50 > sma200 && candles[index].close > momentumReference && atr > 0) {
      signals.push({ candle: candles[index], index, atr })
    }
  }
  const trades = signals.map(({ candle, index, atr }) => createTrendMomentumTrade(candle, candles[index + 1], candles, index, atr, options)).sort((a, b) => a.timestamp.localeCompare(b.timestamp))
  const inSample = trades.filter((trade) => candles.findIndex((candle) => candle.timestamp === trade.timestamp) < splitIndex)
  const outOfSample = trades.filter((trade) => !inSample.includes(trade))
  return { candles, settings: { ...options, splitIndex }, trades, partitions: { inSample, outOfSample }, metrics: calculateResearchMetrics(trades), inSampleMetrics: calculateResearchMetrics(inSample), outOfSampleMetrics: calculateResearchMetrics(outOfSample) }
}

export function runStrategyComparison(candles, enrichedCandles) {
  const control = runSetupScanBacktest(enrichedCandles, { minimumScore: 75 })
  const trendMomentum = runTrendMomentumBacktest(candles)
  return { control, trendMomentum }
}
