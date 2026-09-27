import { formatMarketTime } from '../marketTime.js'

function timestampForSort(trade) {
  return trade?.entryTimestamp == null || trade.entryTimestamp === ''
    ? trade?.signalTimestamp
    : trade.entryTimestamp
}

export function sortPaperTradesNewestFirst(trades) {
  if (!Array.isArray(trades)) return []
  return trades
    .map((trade, index) => ({ trade, index, timestamp: Date.parse(timestampForSort(trade)) }))
    .sort((left, right) => {
      const leftTime = Number.isFinite(left.timestamp) ? left.timestamp : Number.NEGATIVE_INFINITY
      const rightTime = Number.isFinite(right.timestamp) ? right.timestamp : Number.NEGATIVE_INFINITY
      return rightTime - leftTime || left.index - right.index
    })
    .map(({ trade }) => trade)
}

export function projectPaperTrade(trade) {
  const isClosed = trade?.status === 'closed'
  const isExpired = isClosed && trade.exitReason === 'Expired'
  return {
    trade,
    signalTime: formatMarketTime(trade?.signalTimestamp, { includeDate: true }),
    entryTime: formatMarketTime(trade?.entryTimestamp, { includeDate: true }),
    exitLabel: isExpired ? 'Expired' : isClosed ? 'Closed' : trade?.status === 'open' ? 'Open' : 'Unavailable',
    exitReason: isClosed && !isExpired ? trade.exitReason ?? null : null,
    exitTime: isClosed ? formatMarketTime(trade?.exitTimestamp, { includeDate: true }) : null,
  }
}

export function projectPaperTrades(trades) {
  return sortPaperTradesNewestFirst(trades).map(projectPaperTrade)
}