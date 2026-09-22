import { scanSetups } from '../src/logic/scanner.js'

const STARTING_EQUITY = 10000
const RISK_DOLLARS = 100
const MAX_HOLDING_BARS = 12
const STOP_DISTANCE_PERCENT = 0.005
const TARGET_R = 2

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

function createPaperTrade(symbol, signal, signalIndex, candles) {
  const entryCandle = candles[signalIndex + 1]
  const entryPrice = entryCandle.open
  const initialRisk = entryPrice * STOP_DISTANCE_PERCENT
  return {
    id: tradeKey(symbol, signal.timestamp),
    symbol,
    status: 'open',
    signalTimestamp: signal.timestamp,
    signalScore: signal.score,
    setupType: signal.setupType,
    signalPrice: signal.close,
    theoreticalEntryPrice: entryPrice,
    observedMarketPrice: entryPrice,
    observedMarketTimestamp: entryCandle.timestamp,
    observedPriceSource: 'Alpaca OHLCV bar open; bid/ask unavailable',
    entryTimestamp: entryCandle.timestamp,
    entryPrice,
    stopPrice: entryPrice - initialRisk,
    targetPrice: entryPrice + initialRisk * TARGET_R,
    initialRiskDollars: RISK_DOLLARS,
    initialRiskR: 1,
    exitTimestamp: null,
    exitPrice: null,
    exitReason: null,
    rMultiple: null,
    pnl: null,
    holdingTime: null,
  }
}

function closeTrade(trade, candle, exitPrice, exitReason, holdingBars) {
  const rMultiple = (exitPrice - trade.entryPrice) / (trade.entryPrice * STOP_DISTANCE_PERCENT)
  return { ...trade, status: 'closed', exitTimestamp: candle.timestamp, exitPrice, exitReason, rMultiple, pnl: rMultiple * RISK_DOLLARS, holdingTime: holdingBars * 60 }
}

function updateTrade(trade, candles, signalIndex) {
  if (trade.status === 'closed') return trade
  const maxBars = Math.min(MAX_HOLDING_BARS, candles.length - signalIndex - 1)
  let updated = trade
  for (let offset = 1; offset <= maxBars; offset += 1) {
    const candle = candles[signalIndex + offset]
    if (candle.low <= trade.stopPrice) return closeTrade(trade, candle, trade.stopPrice, 'Stop', offset)
    if (candle.high >= trade.targetPrice) return closeTrade(trade, candle, trade.targetPrice, 'Target', offset)
    updated = { ...trade, holdingTime: offset * 60 }
  }
  if (maxBars > 0 && maxBars === MAX_HOLDING_BARS) {
    const candle = candles[signalIndex + maxBars]
    return closeTrade(trade, candle, candle.close, 'Expired', maxBars)
  }
  return updated
}

export function createPaperTradingEngine({ state = { trades: [] }, saveState = () => {} } = {}) {
  const journal = { trades: [...(state.trades ?? [])] }

  function processCandles(symbol, candles) {
    const sortedCandles = [...candles].sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    const signals = scanSetups(sortedCandles).filter((signal) => signal.score >= 75 && signal.status === 'Bullish')
    const existing = new Set(journal.trades.map((trade) => trade.id))
    for (const signal of signals) {
      const signalIndex = sortedCandles.findIndex((candle) => candle.timestamp === signal.timestamp)
      if (signalIndex < 0 || signalIndex >= sortedCandles.length - 1) continue
      const id = tradeKey(symbol, signal.timestamp)
      if (!existing.has(id)) {
        journal.trades.push(createPaperTrade(symbol, signal, signalIndex, sortedCandles))
        existing.add(id)
      }
    }
    journal.trades = journal.trades.map((trade) => {
      if (trade.symbol !== symbol || trade.status === 'closed') return trade
      const signalIndex = sortedCandles.findIndex((candle) => candle.timestamp === trade.signalTimestamp)
      return signalIndex >= 0 ? updateTrade(trade, sortedCandles, signalIndex) : trade
    })
    saveState(journal)
    return journal
  }

  function getJournal() {
    const bySymbol = Object.fromEntries(['SPY', 'QQQ', 'IWM'].map((symbol) => {
      const trades = journal.trades.filter((trade) => trade.symbol === symbol)
      return [symbol, { trades, metrics: calculatePaperMetrics(trades) }]
    }))
    return { mode: 'LIVE PAPER MODE — NO REAL ORDERS', timeframe: '1Hour', account: { startingEquity: STARTING_EQUITY, riskPerTrade: RISK_DOLLARS }, bidAskAvailable: false, limitation: 'Observed entry price uses the Alpaca OHLCV bar open; bid/ask data is unavailable.', trades: journal.trades, metrics: calculatePaperMetrics(journal.trades), bySymbol }
  }

  return { processCandles, getJournal, getState: () => ({ trades: journal.trades.map((trade) => ({ ...trade })) }) }
}

export { calculatePaperMetrics, createPaperTrade, STARTING_EQUITY, RISK_DOLLARS }
