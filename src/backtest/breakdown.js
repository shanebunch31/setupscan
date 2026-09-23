const average = (values) => values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0

function calculateMetrics(trades) {
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
  const averageWinner = average(wins.map((trade) => trade.rMultiple))
  const averageLoser = average(losses.map((trade) => trade.rMultiple))
  const winRate = trades.length ? wins.length / trades.length : 0
  const lossRate = trades.length ? losses.length / trades.length : 0
  return {
    tradeCount: trades.length,
    winRate,
    profitFactor: grossLoss ? grossProfit / grossLoss : grossProfit ? Infinity : 0,
    expectancy: winRate * averageWinner + lossRate * averageLoser,
    averageR: average(trades.map((trade) => trade.rMultiple)),
    maximumDrawdown,
  }
}

const scoreBuckets = [
  ['75-79', (trade) => trade.score >= 75 && trade.score <= 79],
  ['80-89', (trade) => trade.score >= 80 && trade.score <= 89],
  ['90-100', (trade) => trade.score >= 90 && trade.score <= 100],
]
const setupTypes = ['Breakout reclaim', 'Trend continuation']
const directions = ['Long', 'Short']

function groupsForTrades(trades, definitions) {
  return definitions.map(([label, predicate]) => ({ label, metrics: calculateMetrics(trades.filter(predicate)) }))
}

export function getBacktestBreakdown(backtest) {
  const trades = backtest.trades
  return {
    overall: calculateMetrics(trades),
    scoreBuckets: groupsForTrades(trades, scoreBuckets),
    setupTypes: groupsForTrades(trades, setupTypes.map((label) => [label, (trade) => trade.setupType === label])),
    directions: groupsForTrades(trades, directions.map((label) => [label, (trade) => (trade.direction ?? 'Long') === label])),
    partitions: [
      { label: 'In-sample', metrics: calculateMetrics(backtest.partitions.inSample) },
      { label: 'Out-of-sample', metrics: calculateMetrics(backtest.partitions.outOfSample) },
    ],
  }
}
