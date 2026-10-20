import {
  calculateEmaSeries,
  enrichHistoricalCandles,
  validateAndOrderHistoricalCandles,
} from '../data/marketData.js'
import { candleCompletesBy, historicalCandleEndTime } from '../data/historicalDataContract.js'

export const DAILY_FOUR_HOUR_FIVE_MINUTE_STRATEGY_ID = 'daily-4hour-5minute-breakout-v1'
export const DAILY_FOUR_HOUR_FIVE_MINUTE_METHODOLOGY_VERSION = 'daily-4hour-5minute-breakout-v1'

export const dailyFourHourFiveMinuteDefaults = Object.freeze({
  dailyTimeframe: '1Day',
  setupTimeframe: '4Hour',
  entryTimeframe: '5Min',
  dailyFastEmaPeriod: 20,
  dailySlowEmaPeriod: 50,
  setupFastEmaPeriod: 9,
  setupSlowEmaPeriod: 21,
  breakoutLookbackBars: 20,
  structuralStopLookbackBars: 10,
  targetR: 2,
  maxHoldingBars: 12,
})

function finiteTimestamp(candle) {
  const value = Date.parse(candle?.timestamp)
  return Number.isFinite(value) ? value : null
}

function isContiguous(candles, timeframe) {
  if (!candles.length) return false
  for (let index = 1; index < candles.length; index += 1) {
    const previousEnd = historicalCandleEndTime(candles[index - 1].timestamp, timeframe)
    if (previousEnd === null || previousEnd !== finiteTimestamp(candles[index])) return false
  }
  return true
}

function completedSeries(candles, timeframe, cutoff) {
  const { candles: ordered, dataQuality } = validateAndOrderHistoricalCandles(candles ?? [])
  const completed = ordered.filter((candle) => candleCompletesBy(candle, timeframe, cutoff))
  return {
    candles: completed,
    dataQuality: {
      ...dataQuality,
      incompleteCandleCount: ordered.length - completed.length,
    },
  }
}

function latestCompletedAtOrBefore(candles, timeframe, timestamp) {
  const limit = Date.parse(timestamp)
  if (!Number.isFinite(limit)) return null
  for (let index = candles.length - 1; index >= 0; index -= 1) {
    const end = historicalCandleEndTime(candles[index].timestamp, timeframe)
    if (end !== null && end <= limit) return { candle: candles[index], index }
  }
  return null
}

function dailyBiasAt(dailyCandles, dailyEma20, dailyEma50, decisionTimestamp) {
  const current = latestCompletedAtOrBefore(dailyCandles, '1Day', decisionTimestamp)
  if (!current) return { bias: 'neutral', reason: 'daily-context-unavailable' }
  const { candle, index } = current
  const ema20 = dailyEma20[index]
  const ema50 = dailyEma50[index]
  if (![candle.close, ema20, ema50].every(Number.isFinite)) {
    return { bias: 'neutral', reason: 'daily-ema-warmup', candle, index, ema20, ema50 }
  }
  if (candle.close > ema20 && ema20 > ema50) return { bias: 'long', candle, index, ema20, ema50 }
  if (candle.close < ema20 && ema20 < ema50) return { bias: 'short', candle, index, ema20, ema50 }
  return { bias: 'neutral', reason: 'daily-neutral', candle, index, ema20, ema50 }
}

function fourHourSetupAt(fourHourCandles, ema9, ema21, decisionTimestamp, options) {
  const current = latestCompletedAtOrBefore(fourHourCandles, '4Hour', decisionTimestamp)
  if (!current) return { direction: null, reason: 'four-hour-context-unavailable' }
  const { candle, index } = current
  if (index < options.breakoutLookbackBars) return { direction: null, reason: 'four-hour-warmup' }
  const prior = fourHourCandles.slice(index - options.breakoutLookbackBars, index)
  const highestHigh = Math.max(...prior.map((item) => item.high))
  const lowestLow = Math.min(...prior.map((item) => item.low))
  const fast = ema9[index]
  const slow = ema21[index]
  if (![highestHigh, lowestLow, fast, slow, candle.close].every(Number.isFinite)) {
    return { direction: null, reason: 'four-hour-indicator-unavailable' }
  }
  if (candle.close > highestHigh && fast > slow) {
    return { direction: 'long', candle, index, highestHigh, lowestLow, ema9: fast, ema21: slow }
  }
  if (candle.close < lowestLow && fast < slow) {
    return { direction: 'short', candle, index, highestHigh, lowestLow, ema9: fast, ema21: slow }
  }
  return { direction: null, reason: 'four-hour-no-setup', candle, index, highestHigh, lowestLow, ema9: fast, ema21: slow }
}

function fiveMinuteConfirmationAt(candles, index, options) {
  if (index < options.breakoutLookbackBars) return { direction: null, reason: 'five-minute-warmup' }
  const confirmation = candles[index]
  const prior = candles.slice(index - options.breakoutLookbackBars, index)
  const requiredWindow = prior.concat(confirmation)
  if (!isContiguous(requiredWindow, '5Min')) return { direction: null, reason: 'five-minute-gap' }
  if (!Number.isFinite(confirmation.vwap)) return { direction: null, reason: 'vwap-unavailable' }
  const highestHigh = Math.max(...prior.map((item) => item.high))
  const lowestLow = Math.min(...prior.map((item) => item.low))
  if (confirmation.close > highestHigh && confirmation.close > confirmation.vwap) {
    return { direction: 'long', confirmation, highestHigh, lowestLow }
  }
  if (confirmation.close < lowestLow && confirmation.close < confirmation.vwap) {
    return { direction: 'short', confirmation, highestHigh, lowestLow }
  }
  return { direction: null, reason: 'five-minute-no-confirmation', confirmation, highestHigh, lowestLow }
}

function structuralStop(candles, confirmationIndex, entryPrice, direction, options) {
  const start = confirmationIndex - options.structuralStopLookbackBars + 1
  if (start < 0) return null
  const window = candles.slice(start, confirmationIndex + 1)
  if (window.length !== options.structuralStopLookbackBars || !isContiguous(window, '5Min')) return null
  const level = direction === 'long'
    ? Math.min(...window.map((candle) => candle.low))
    : Math.max(...window.map((candle) => candle.high))
  if (!Number.isFinite(level)) return null
  if (direction === 'long' && !(level < entryPrice)) return null
  if (direction === 'short' && !(level > entryPrice)) return null
  return level
}

function closeTrade(trade, candle, exitPrice, exitReason, holdingBars) {
  const rMultiple = trade.direction === 'long'
    ? (exitPrice - trade.entryPrice) / trade.initialRisk
    : (trade.entryPrice - exitPrice) / trade.initialRisk
  return {
    ...trade,
    status: 'closed',
    exitTimestamp: candle.timestamp,
    exitPrice,
    exitReason,
    holdingBars,
    rMultiple,
  }
}

function evaluateTrade(trade, fiveMinuteCandles, entryIndex, options) {
  if (entryIndex + options.maxHoldingBars > fiveMinuteCandles.length) {
    return { trade: null, exclusion: 'end-of-dataset-before-time-exit' }
  }
  for (let offset = 0; offset < options.maxHoldingBars; offset += 1) {
    const candle = fiveMinuteCandles[entryIndex + offset]
    const holdingBars = offset + 1
    if (trade.direction === 'long') {
      if (offset > 0 && candle.open <= trade.stopPrice) return { trade: closeTrade(trade, candle, candle.open, 'Stop', holdingBars) }
      if (offset > 0 && candle.open >= trade.targetPrice) return { trade: closeTrade(trade, candle, trade.targetPrice, 'Target', holdingBars) }
      if (candle.low <= trade.stopPrice) return { trade: closeTrade(trade, candle, trade.stopPrice, 'Stop', holdingBars) }
      if (candle.high >= trade.targetPrice) return { trade: closeTrade(trade, candle, trade.targetPrice, 'Target', holdingBars) }
    } else {
      if (offset > 0 && candle.open >= trade.stopPrice) return { trade: closeTrade(trade, candle, candle.open, 'Stop', holdingBars) }
      if (offset > 0 && candle.open <= trade.targetPrice) return { trade: closeTrade(trade, candle, trade.targetPrice, 'Target', holdingBars) }
      if (candle.high >= trade.stopPrice) return { trade: closeTrade(trade, candle, trade.stopPrice, 'Stop', holdingBars) }
      if (candle.low <= trade.targetPrice) return { trade: closeTrade(trade, candle, trade.targetPrice, 'Target', holdingBars) }
    }
  }
  const finalCandle = fiveMinuteCandles[entryIndex + options.maxHoldingBars - 1]
  return { trade: closeTrade(trade, finalCandle, finalCandle.close, 'Time', options.maxHoldingBars) }
}

function summarize(trades) {
  const rValues = trades.map((trade) => trade.rMultiple)
  const wins = rValues.filter((value) => value > 0)
  const losses = rValues.filter((value) => value < 0)
  const grossProfit = wins.reduce((sum, value) => sum + value, 0)
  const grossLoss = Math.abs(losses.reduce((sum, value) => sum + value, 0))
  return {
    tradeCount: trades.length,
    longTradeCount: trades.filter((trade) => trade.direction === 'long').length,
    shortTradeCount: trades.filter((trade) => trade.direction === 'short').length,
    expectancy: trades.length ? rValues.reduce((sum, value) => sum + value, 0) / trades.length : null,
    winRate: trades.length ? wins.length / trades.length : null,
    profitFactor: !trades.length ? null : grossLoss ? grossProfit / grossLoss : grossProfit ? Infinity : null,
    cumulativeR: trades.length ? rValues.reduce((sum, value) => sum + value, 0) : null,
  }
}

/**
 * Research-only Daily / 4-hour / 5-minute strategy.
 *
 * Provider 4-hour timestamps are treated as bar starts and complete exactly four elapsed hours
 * later. This is conservative for regular sessions but does not model provider-specific early
 * closes or session aggregation; callers should treat such periods as a documented limitation.
 */
export function runDailyFourHourFiveMinuteResearch({
  symbol,
  dailyCandles,
  fourHourCandles,
  fiveMinuteCandles,
  cutoff,
  source = 'ALPACA HISTORICAL',
  settings = {},
} = {}) {
  const options = { ...dailyFourHourFiveMinuteDefaults, ...settings }
  if (typeof symbol !== 'string' || !symbol.trim()) throw new Error('A symbol is required for multi-timeframe research')
  if (!cutoff || !Number.isFinite(Date.parse(cutoff))) throw new Error('A valid research cutoff is required for multi-timeframe research')

  const daily = completedSeries(dailyCandles, options.dailyTimeframe, cutoff)
  const fourHour = completedSeries(fourHourCandles, options.setupTimeframe, cutoff)
  const fiveMinute = completedSeries(fiveMinuteCandles, options.entryTimeframe, cutoff)
  const enrichedFiveMinute = enrichHistoricalCandles(fiveMinute.candles, options.entryTimeframe)
  const dailyEma20 = calculateEmaSeries(daily.candles, options.dailyFastEmaPeriod)
  const dailyEma50 = calculateEmaSeries(daily.candles, options.dailySlowEmaPeriod)
  const fourHourEma9 = calculateEmaSeries(fourHour.candles, options.setupFastEmaPeriod)
  const fourHourEma21 = calculateEmaSeries(fourHour.candles, options.setupSlowEmaPeriod)
  const exclusions = {}
  const trades = []
  const seenConfirmations = new Set()

  function exclude(reason) { exclusions[reason] = (exclusions[reason] ?? 0) + 1 }

  for (let index = 0; index < enrichedFiveMinute.length; index += 1) {
    const confirmation = fiveMinuteConfirmationAt(enrichedFiveMinute, index, options)
    if (!confirmation.direction) {
      if (confirmation.reason === 'vwap-unavailable' || confirmation.reason === 'five-minute-gap') exclude(confirmation.reason)
      continue
    }
    const confirmationEnd = historicalCandleEndTime(confirmation.confirmation.timestamp, options.entryTimeframe)
    if (confirmationEnd === null) { exclude('confirmation-time-invalid'); continue }
    const dailyContext = dailyBiasAt(daily.candles, dailyEma20, dailyEma50, new Date(confirmationEnd).toISOString())
    if (dailyContext.bias !== confirmation.direction) { exclude(dailyContext.reason ?? 'daily-direction-conflict'); continue }
    const setup = fourHourSetupAt(fourHour.candles, fourHourEma9, fourHourEma21, new Date(confirmationEnd).toISOString(), options)
    if (setup.direction !== confirmation.direction) { exclude(setup.reason ?? 'four-hour-direction-conflict'); continue }
    const entryIndex = index + 1
    const entryCandle = enrichedFiveMinute[entryIndex]
    if (!entryCandle || finiteTimestamp(entryCandle) !== confirmationEnd || !Number.isFinite(entryCandle.open)) {
      exclude('next-entry-candle-unavailable')
      continue
    }
    const confirmationKey = confirmation.confirmation.timestamp
    if (seenConfirmations.has(confirmationKey)) { exclude('duplicate-confirmation'); continue }
    const stopPrice = structuralStop(enrichedFiveMinute, index, entryCandle.open, confirmation.direction, options)
    if (stopPrice === null) { exclude('structural-stop-invalid'); continue }
    const initialRisk = Math.abs(entryCandle.open - stopPrice)
    if (!(initialRisk > 0)) { exclude('initial-risk-invalid'); continue }
    const targetPrice = confirmation.direction === 'long'
      ? entryCandle.open + initialRisk * options.targetR
      : entryCandle.open - initialRisk * options.targetR
    const candidate = {
      strategyId: DAILY_FOUR_HOUR_FIVE_MINUTE_STRATEGY_ID,
      symbol: symbol.trim().toUpperCase(),
      direction: confirmation.direction,
      dailyTimestamp: dailyContext.candle.timestamp,
      fourHourTimestamp: setup.candle.timestamp,
      confirmationTimestamp: confirmation.confirmation.timestamp,
      entryTimestamp: entryCandle.timestamp,
      entryPrice: entryCandle.open,
      stopPrice,
      targetPrice,
      initialRisk,
      dailyBias: dailyContext.bias,
      fourHourSetup: setup.direction,
      vwap: confirmation.confirmation.vwap,
      status: 'open',
    }
    seenConfirmations.add(confirmationKey)
    const result = evaluateTrade(candidate, enrichedFiveMinute, entryIndex, options)
    if (!result.trade) { exclude(result.exclusion); continue }
    trades.push(result.trade)
  }

  return {
    strategyId: DAILY_FOUR_HOUR_FIVE_MINUTE_STRATEGY_ID,
    methodologyVersion: DAILY_FOUR_HOUR_FIVE_MINUTE_METHODOLOGY_VERSION,
    symbol: symbol.trim().toUpperCase(),
    source,
    cutoff,
    timeframes: {
      daily: options.dailyTimeframe,
      setup: options.setupTimeframe,
      entry: options.entryTimeframe,
    },
    parameters: {
      dailyBias: 'close > EMA20 > EMA50 for long; close < EMA20 < EMA50 for short',
      fourHourSetup: '20-bar breakout excluding current candle plus EMA9/EMA21 alignment',
      fiveMinuteConfirmation: '20-bar breakout excluding current candle plus regular-session VWAP agreement',
      structuralStopLookbackBars: options.structuralStopLookbackBars,
      targetR: options.targetR,
      maxHoldingBars: options.maxHoldingBars,
    },
    timestampConvention: 'Provider timestamps mark bar starts. Daily context and four-hour setup must have completed by the five-minute confirmation bar end; entry is the immediately following five-minute bar open.',
    limitations: ['Provider-supplied four-hour bars are treated as fixed four-hour elapsed intervals. Early-close and provider session-aggregation behavior are not independently verified.'],
    dataQuality: {
      daily: daily.dataQuality,
      fourHour: fourHour.dataQuality,
      fiveMinute: fiveMinute.dataQuality,
    },
    exclusions,
    trades,
    metrics: summarize(trades),
  }
}
