import React, { useEffect, useState } from 'react'
import './paperTrading.css'

const formatR = (value) => `${value === Infinity ? '∞' : value.toFixed(2)}R`
const formatMoney = (value) => `$${value.toFixed(2)}`
const formatPercent = (value) => `${(value * 100).toFixed(1)}%`

function TradeRow({ trade }) {
  return <tr><td>{trade.symbol}</td><td>{new Date(trade.signalTimestamp).toLocaleString()}</td><td>{trade.signalScore}</td><td>{trade.setupType}</td><td>{formatMoney(trade.theoreticalEntryPrice)}</td><td>{trade.observedMarketPrice ? formatMoney(trade.observedMarketPrice) : '—'}</td><td>{trade.status === 'closed' ? trade.exitReason : 'Open'}</td><td>{trade.rMultiple === null ? '—' : formatR(trade.rMultiple)}</td><td>{trade.pnl === null ? '—' : formatMoney(trade.pnl)}</td></tr>
}

function Metrics({ metrics }) {
  return <div className="paper-metrics"><div><span>Total trades</span><strong>{metrics.totalTrades}</strong></div><div><span>Wins / losses</span><strong>{metrics.wins} / {metrics.losses}</strong></div><div><span>Win rate</span><strong>{formatPercent(metrics.winRate)}</strong></div><div><span>Profit factor</span><strong>{metrics.profitFactor === Infinity ? '∞' : metrics.profitFactor.toFixed(2)}</strong></div><div><span>Expectancy</span><strong>{formatR(metrics.expectancy)}</strong></div><div><span>Average R</span><strong>{formatR(metrics.averageR)}</strong></div><div><span>Max drawdown</span><strong>{formatMoney(metrics.maximumDrawdown)}</strong></div><div><span>Paper equity</span><strong>{formatMoney(metrics.currentEquity)}</strong></div><div><span>Cumulative R</span><strong>{formatR(metrics.cumulativeR)}</strong></div><div><span>Hypothetical P&amp;L</span><strong>{formatMoney(metrics.cumulativePnl)}</strong></div></div>
}

export function PaperTradingPanel() {
  const [snapshot, setSnapshot] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const refresh = () => {
    setLoading(true)
    fetch('/api/paper-trading').then((response) => response.json().then((data) => ({ response, data }))).then(({ response, data }) => {
      if (!response.ok) throw new Error(data.error || 'Paper data unavailable')
      setSnapshot(data)
      setError(null)
    }).catch((requestError) => setError(requestError.message)).finally(() => setLoading(false))
  }
  useEffect(() => { refresh() }, [])
  const trades = snapshot?.trades ?? []
  return <section className="paper-panel panel"><div className="panel-heading compact"><div><p className="eyebrow">PAPER TRADING</p><h2>Live observation journal</h2></div><span className="paper-mode">LIVE PAPER MODE — NO REAL ORDERS</span></div>{loading && !snapshot && <p className="paper-state">Loading real Alpaca market data...</p>}{error && <p className="paper-error">{error}</p>}{snapshot && <><p className="paper-disclaimer">PAPER TRADING — RESEARCH ONLY — NO REAL ORDERS. Server-side Alpaca OHLCV only. {snapshot.limitation}</p><Metrics metrics={snapshot.metrics} /><div className="paper-symbol-grid">{Object.entries(snapshot.bySymbol).map(([symbol, data]) => <div key={symbol}><strong>{symbol}</strong><span>{data.metrics.totalTrades} trades · {data.metrics.closedTrades} closed · {formatR(data.metrics.cumulativeR)}</span></div>)}</div><div className="paper-table-wrap"><table className="paper-table"><thead><tr><th>Symbol</th><th>Signal</th><th>Score</th><th>Setup</th><th>Theoretical entry</th><th>Observed market</th><th>Exit</th><th>R</th><th>Hypothetical P&amp;L</th></tr></thead><tbody>{trades.length ? trades.slice().reverse().map((trade) => <TradeRow key={trade.id} trade={trade} />) : <tr><td colSpan="9">No qualifying paper signals observed yet.</td></tr>}</tbody></table></div><button className="refresh-button paper-refresh" onClick={refresh}>Refresh paper journal</button></>}</section>
}
