import { scanSetups } from '../src/logic/scanner.js'
import { validateAndOrderHistoricalCandles } from '../src/data/marketData.js'
import { historicalCandleEndTime } from '../src/data/historicalDataContract.js'
import { DEFAULT_PAPER_SYMBOLS } from './paperSymbols.js'

const STARTING_EQUITY = 10000
const RISK_DOLLARS = 100
const MAX_HOLDING_BARS = 12
const STOP_DISTANCE_PERCENT = 0.005
const TARGET_R = 2
const PAPER_FILL_MODEL_VERSION = 'paper-first-post-signal-close-v1'
const PAPER_ENTRY_PRICE_SOURCE = 'Completed OHLC candle close at interval end; delayed approximation, not a first quote or executable fill'
const DEFAULT_TRAILING_STOP = {
  enabled: true,
  activationR: 1,
  trailDistancePercent: 0.003,
}

function tradeKey(symbol, timestamp) {
  return `${symbol}:${timestamp}`
}

function calculatePaperMetrics(trades) {
  const closed = trades.filter((trade) => trade.status === 'closed')
  const wins = closed.filter((trade) => trade.rMultiple > 0)
  const losses = closed.filter((trade) => trade.rMultiple < 0)
  const grossProfit = wins.reduce((total, trade) => total + trade.rMultiple, 0)
  const grossLoss = Math.abs(losses.reduce((total, trade) => total + trade.rMultiple, 0))
  let equity = STARTING_EQUITY
  let peak = STARTING_EQUITY
  let maximumDrawdown = 0
  for (const trade of closed.sort((a, b) => a.exitTimestamp.localeCompare(b.exitTimestamp))) {
    equity += trade.pnl
    peak = Math.max(peak, equity)
    maximumDrawdown = Math.max(maximumDrawdown, peak - equity)
  }
  return {
    totalTrades: trades.length,
    closedTrades: closed.length,
    openTrades: trades.length - closed.length,
    wins: wins.length,
    losses: losses.length,
    winRate: closed.length ? wins.length / closed.length : 0,
    profitFactor: grossLoss ? grossProfit / grossLoss : grossProfit ? Infinity : 0,
    expectancy: closed.length ? closed.reduce((total, trade) => total + trade.rMultiple, 0) / closed.length : 0,
    averageR: closed.length ? closed.reduce((total, trade) => total + trade.rMultiple, 0) / closed.length : 0,
    maximumDrawdown,
    currentEquity: equity,
    cumulativeR: closed.reduce((total, trade) => total + trade.rMultiple, 0),
    cumulativePnl: closed.reduce((total, trade) => total + trade.pnl, 0),
    averageHoldingTime: closed.length ? closed.reduce((total, trade) => total + trade.holdingTime, 0) / closed.length : 0,
  }
}

function createPaperTradeFromCandle(symbol, signal, entryCandle, signalDetectedAt, timeframe = '1Hour') {
  const entryPrice = entryCandle.close
  const entryTimestampMs = historicalCandleEndTime(entryCandle.timestamp, timeframe)
  const entryTimestamp = Number.isFinite(entryTimestampMs) ? new Date(entryTimestampMs).toISOString() : null
  const initialRisk = entryPrice * STOP_DISTANCE_PERCENT
  const stopPrice = entryPrice - initialRisk
  const targetPrice = entryPrice + initialRisk * TARGET_R
  if (![entryPrice, entryTimestampMs, initialRisk, stopPrice, targetPrice, Date.parse(signalDetectedAt)].every(Number.isFinite) || entryTimestampMs <= Date.parse(signalDetectedAt) || initialRisk <= 0 || stopPrice <= 0) return null
  return {
    id: tradeKey(symbol, signal.timestamp),
    symbol,
    status: 'open',
    fillModelVersion: PAPER_FILL_MODEL_VERSION,
    signalTimestamp: signal.timestamp,
    signalDetectedAt,
    signalScore: signal.score,
    score: signal.score,
    setupType: signal.setupType,
    signalPrice: signal.close,
    theoreticalEntryPrice: entryPrice,
    observedMarketPrice: entryPrice,
    entryCandleTimestamp: entryCandle.timestamp,
    observedMarketTimestamp: entryTimestamp,
    observedPriceSource: PAPER_ENTRY_PRICE_SOURCE,
    entryTimestamp,
    // The modeled fill is at this completed bar's close. Its earlier high/low
    // cannot be used to exit a position that did not yet exist.
    lastEvaluatedCandleTimestamp: entryCandle.timestamp,
    entryPrice,
    stopPrice,
    targetPrice,
    initialRiskDollars: RISK_DOLLARS,
    initialRiskR: 1,
    trailingStopActive: false,
    highestPrice: entryPrice,
    exitTimestamp: null,
    exitPrice: null,
    exitReason: null,
    rMultiple: null,
    pnl: null,
    holdingTime: 0,
    holdingBars: 0,
  }
}

// Keep the existing exported helper signature while applying the new close-based model.
function createPaperTrade(symbol, signal, signalIndex, candles, signalDetectedAt = null, timeframe = '1Hour') {
  const entryCandle = candles[signalIndex + 1]
  const signalEnd = historicalCandleEndTime(signal.timestamp, timeframe)
  const detectedAt = signalDetectedAt ?? (signalEnd === null ? null : new Date(signalEnd).toISOString())
  return entryCandle && detectedAt ? createPaperTradeFromCandle(symbol, signal, entryCandle, detectedAt, timeframe) : null
}

function closeTrade(trade, candle, exitPrice, exitReason, holdingBars, timeframe = '1Hour', holdingTime = null) {
  const rMultiple = (exitPrice - trade.entryPrice) / (trade.entryPrice * STOP_DISTANCE_PERCENT)
  const pnl = rMultiple * RISK_DOLLARS
  if (![exitPrice, rMultiple, pnl].every(Number.isFinite)) throw new RangeError('Paper trade outcome is outside the finite numeric range')
  const intervalStart = Date.parse(candle.timestamp)
  const intervalEnd = historicalCandleEndTime(candle.timestamp, timeframe)
  const intervalMinutes = intervalEnd === null ? 60 : (intervalEnd - intervalStart) / 60000
  const priorMinutes = Number.isFinite(trade.holdingTime) ? trade.holdingTime : 0
  return { ...trade, status: 'closed', exitTimestamp: candle.timestamp, lastEvaluatedCandleTimestamp: candle.timestamp, exitPrice, exitReason, rMultiple, pnl, holdingTime: Number.isFinite(holdingTime) ? holdingTime : priorMinutes + intervalMinutes, holdingBars }
}

function updateTrade(
  trade,
  candles,
  signalIndex,
  trailingStop = DEFAULT_TRAILING_STOP,
  timeframe = '1Hour',
) {
  if (trade.status === 'closed') return trade
  let updated = trade
  const legacyCursor = trade.lastEvaluatedCandleTimestamp ?? trade.entryTimestamp ?? candles[signalIndex]?.timestamp
  const legacyBarMinutes = historicalCandleEndTime(candles[signalIndex + 1]?.timestamp, timeframe)
    ? (historicalCandleEndTime(candles[signalIndex + 1].timestamp, timeframe) - Date.parse(candles[signalIndex + 1].timestamp)) / 60000
    : 60
  const alreadyHeldBars = Math.min(MAX_HOLDING_BARS, Math.max(0, Number.isInteger(trade.holdingBars)
    ? trade.holdingBars
    : Math.floor((Number(trade.holdingTime) || 0) / legacyBarMinutes)))
  let heldMinutes = Number.isFinite(trade.holdingTime) ? trade.holdingTime : 0
  const remainingBars = MAX_HOLDING_BARS - alreadyHeldBars
  const nextCandles = candles.filter((candle) => Date.parse(candle.timestamp) > Date.parse(legacyCursor))
    .slice(0, remainingBars)

  for (let index = 0; index < nextCandles.length; index += 1) {
    const candle = nextCandles[index]
    const holdingBars = alreadyHeldBars + index + 1
    const candleEnd = historicalCandleEndTime(candle.timestamp, timeframe)
    const candleMinutes = candleEnd === null ? legacyBarMinutes : (candleEnd - Date.parse(candle.timestamp)) / 60000
    heldMinutes += candleMinutes

    const highestPrice = Math.max(
      updated.highestPrice ?? updated.entryPrice,
      candle.high,
    )

    const riskPerShare =
      updated.entryPrice * STOP_DISTANCE_PERCENT

    const currentR =
      (highestPrice - updated.entryPrice) /
      riskPerShare

    // Use the stop that was already active before this candle.
    // A stop gap fills at the first observed price, not at a barrier the market skipped.
    if (
      Number.isFinite(candle.open) &&
      candle.open <= updated.stopPrice
    ) {
      return closeTrade(
        updated,
        candle,
        candle.open,
        updated.trailingStopActive
          ? 'Trailing Stop'
          : 'Stop',
        holdingBars,
        timeframe,
        heldMinutes,
      )
    }

    // An opening gap through a target determines the outcome at the open. The model
    // records the target price and does not assume price improvement.
    if (Number.isFinite(candle.open) && candle.open >= updated.targetPrice) {
      return closeTrade(updated, candle, updated.targetPrice, 'Target', holdingBars, timeframe, heldMinutes)
    }

    if (candle.low <= updated.stopPrice) {
      return closeTrade(
        updated,
        candle,
        updated.stopPrice,
        updated.trailingStopActive
          ? 'Trailing Stop'
          : 'Stop',
        holdingBars,
        timeframe,
        heldMinutes,
      )
    }

    // If both target and stop are touched, the stop check above wins.
    if (candle.high >= updated.targetPrice) {
      return closeTrade(
        updated,
        candle,
        updated.targetPrice,
        'Target',
        holdingBars,
        timeframe,
        heldMinutes,
      )
    }

    // The current candle's high can activate or ratchet the
    // trailing stop, but only for future candles.
    let stopPrice = updated.stopPrice
    let trailingStopActive =
      updated.trailingStopActive ?? false

    if (
      trailingStop.enabled &&
      currentR >= trailingStop.activationR
    ) {
      trailingStopActive = true

      const candidateStop =
        highestPrice *
        (1 - trailingStop.trailDistancePercent)

      stopPrice = Math.max(
        stopPrice,
        candidateStop,
      )
    }

    updated = {
      ...updated,
      highestPrice,
      stopPrice,
      trailingStopActive,
      holdingTime: heldMinutes,
      holdingBars,
      lastEvaluatedCandleTimestamp: candle.timestamp,
    }
  }

  if (
    nextCandles.length > 0 &&
    alreadyHeldBars + nextCandles.length >= MAX_HOLDING_BARS
  ) {
    const candle = nextCandles.at(-1)

    return closeTrade(
      updated,
      candle,
      candle.close,
      'Expired',
      MAX_HOLDING_BARS,
      timeframe,
      heldMinutes,
    )
  }

  return updated
}
export function createPaperTradingEngine({
  state = { trades: [] },
  saveState = () => {},
  trailingStop = DEFAULT_TRAILING_STOP,
  timeframe = '1Hour',
} = {}) {
  const journal = { trades: [...(state.trades ?? [])] }
  // Pending entries are deliberately in-memory only. A restart drops an entry
  // opportunity rather than replaying a price from before the new process saw it.
  const pendingEntries = new Map()

  function retainPendingEntrySymbols(symbols) {
    const enabled = new Set(symbols)
    for (const symbol of pendingEntries.keys()) {
      if (!enabled.has(symbol)) pendingEntries.delete(symbol)
    }
  }

  function processCandles(symbol, candles, { newEntrySignalTimestamp = null, signalDetectedAt = null, allowNewEntries = true } = {}) {
    const { candles: sortedCandles } = validateAndOrderHistoricalCandles(candles)
    // Paper trading currently supports long, qualified setups only.
    const signals = scanSetups(sortedCandles).filter((signal) => signal.qualifiedSetup === true)
    // Callers may provide a clock so detection is timestamped after the scanner has
    // evaluated the fetched bars, rather than before that calculation begins.
    const detectionTimeValue = typeof signalDetectedAt === 'function' ? signalDetectedAt() : signalDetectedAt
    const existing = new Set(journal.trades.map((trade) => trade.id))
    const latestIndex = sortedCandles.length - 1
    const candidates = allowNewEntries ? (pendingEntries.get(symbol) ?? []) : []
    const remaining = []
    for (const pending of candidates) {
      const detectionIndex = sortedCandles.findIndex((candle) => candle.timestamp === pending.detectionCandleTimestamp)
      if (detectionIndex < 0 || detectionIndex < latestIndex - 1) continue
      if (detectionIndex === latestIndex) {
        remaining.push(pending)
        continue
      }
      const entryCandle = sortedCandles[detectionIndex + 1]
      const detectedAtMs = Date.parse(pending.signalDetectedAt)
      const entryEndMs = historicalCandleEndTime(entryCandle.timestamp, timeframe)
      if (detectionIndex !== latestIndex - 1 || historicalCandleEndTime(sortedCandles[detectionIndex].timestamp, timeframe) !== Date.parse(entryCandle.timestamp) || entryEndMs === null || entryEndMs <= detectedAtMs) continue
      const signal = signals.find((item) => item.timestamp === pending.signalTimestamp)
      const id = tradeKey(symbol, pending.signalTimestamp)
      if (!signal || existing.has(id)) continue
      const trade = createPaperTradeFromCandle(symbol, signal, entryCandle, pending.signalDetectedAt, timeframe)
      if (trade) {
        journal.trades.push(trade)
        existing.add(id)
      }
    }
    pendingEntries.set(symbol, remaining)

    // A service/observer only authorizes the immediately preceding processed
    // signal candle. The detection time is captured after fetching the completed
    // bars. If the latest bar had already closed by then, defer to the next
    // adjacent completed bar's close instead of using that stale close/open.
    const signal = allowNewEntries ? signals.find((item) => item.timestamp === newEntrySignalTimestamp) : null
    const signalIndex = signal ? sortedCandles.findIndex((candle) => candle.timestamp === signal.timestamp) : -1
    const detectedAt = detectionTimeValue == null
      ? (signalIndex >= 0 ? historicalCandleEndTime(signal.timestamp, timeframe) : null)
      : Date.parse(detectionTimeValue)
    if (signal && signalIndex === latestIndex - 1 && detectedAt !== null && Number.isFinite(detectedAt) &&
      historicalCandleEndTime(signal.timestamp, timeframe) === Date.parse(sortedCandles[signalIndex + 1].timestamp)) {
      const detectionCandle = sortedCandles.at(-1)
      const id = tradeKey(symbol, signal.timestamp)
      const entryEndMs = historicalCandleEndTime(detectionCandle.timestamp, timeframe)
      if (!existing.has(id) && entryEndMs !== null && entryEndMs > detectedAt) {
        const detectionTime = new Date(detectedAt).toISOString()
        const trade = createPaperTradeFromCandle(symbol, signal, detectionCandle, detectionTime, timeframe)
        if (trade) {
          journal.trades.push(trade)
          existing.add(id)
        }
      } else if (!existing.has(id) && entryEndMs !== null) {
        const list = pendingEntries.get(symbol) ?? []
        if (!list.some((item) => item.signalTimestamp === signal.timestamp)) {
          list.push({ signalTimestamp: signal.timestamp, signalDetectedAt: new Date(detectedAt).toISOString(), detectionCandleTimestamp: detectionCandle.timestamp })
          pendingEntries.set(symbol, list)
        }
      }
    }
    journal.trades = journal.trades.map((trade) => {
      if (trade.symbol !== symbol || trade.status === 'closed') return trade
      const signalIndex = sortedCandles.findIndex((candle) => candle.timestamp === trade.signalTimestamp)
      return signalIndex >= 0
  ? updateTrade(
      trade,
      sortedCandles,
      signalIndex,
      trailingStop,
      timeframe,
    )
  : trade
    })
    saveState(journal)
    return journal
  }

  function getJournal({ symbols = DEFAULT_PAPER_SYMBOLS } = {}) {
    const summarySymbols = [...new Set([...symbols, ...journal.trades.map((trade) => trade.symbol)])].sort()
    const bySymbol = Object.fromEntries(summarySymbols.map((symbol) => {
      const trades = journal.trades.filter((trade) => trade.symbol === symbol)
      return [symbol, { trades, metrics: calculatePaperMetrics(trades) }]
    }))
    return { mode: 'LIVE PAPER MODE — NO REAL ORDERS', timeframe, account: { startingEquity: STARTING_EQUITY, riskPerTrade: RISK_DOLLARS }, bidAskAvailable: false, limitation: 'New entries use the close of the first adjacent completed OHLC bar whose interval ends after signal detection. This delayed historical approximation is not the exact first available quote or a guaranteed fill; bid/ask data is unavailable.', trades: journal.trades, metrics: calculatePaperMetrics(journal.trades), bySymbol }
  }

  return { processCandles, retainPendingEntrySymbols, getJournal, getState: () => ({ trades: journal.trades.map((trade) => ({ ...trade })) }) }
}

export { calculatePaperMetrics, createPaperTrade, PAPER_ENTRY_PRICE_SOURCE, PAPER_FILL_MODEL_VERSION, STARTING_EQUITY, RISK_DOLLARS }
