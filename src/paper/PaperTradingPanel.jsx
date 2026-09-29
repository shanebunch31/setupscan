import React, { useEffect, useState } from 'react'
import { apiUrl } from '../config/apiBase.js'
import { projectPaperTrades } from './paperTradingModel.js'
import { PaperTradeRow } from './PaperTradeRow.js'
import { PaperMetrics, PaperTradingEducation } from './PaperTradingEducation.js'
import { TermHelp } from '../TermHelp.js'
import './paperTrading.css'

const formatR = (value) => `${value === Infinity ? '∞' : value.toFixed(2)}R`
const formatMoney = (value) => `$${value.toFixed(2)}`
export function PaperTradingPanel() {
  const [snapshot, setSnapshot] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const refresh = () => {
    setLoading(true)
    fetch(apiUrl('/api/paper-trading')).then((response) => response.json().then((data) => ({ response, data }))).then(({ response, data }) => {
      if (!response.ok) throw new Error(data.error || 'Paper data unavailable')
      setSnapshot(data)
      setError(null)
    }).catch((requestError) => setError(requestError.message)).finally(() => setLoading(false))
  }
  useEffect(() => { refresh() }, [])
  const trades = projectPaperTrades(snapshot?.trades ?? [])
  return <section className="paper-panel panel">
    <div className="panel-heading compact">
      <div><p className="eyebrow">PAPER TRADING</p><h2>Live observation journal</h2></div>
      <span className="paper-mode">LIVE PAPER MODE — NO REAL ORDERS</span>
    </div>
    <PaperTradingEducation account={snapshot?.account} />
    {loading && !snapshot && <p className="paper-state">Loading real Alpaca market data...</p>}
    {error && <p className="paper-error">{error}</p>}
    {snapshot && <>
      <p className="paper-disclaimer">Server-side Alpaca OHLCV only. {snapshot.limitation}</p>
      <PaperMetrics metrics={snapshot.metrics} />
      <div className="paper-symbol-grid">{Object.entries(snapshot.bySymbol).map(([symbol, data]) => <div key={symbol}><strong>{symbol}</strong><span>{data.metrics.totalTrades} trades · {data.metrics.closedTrades} closed · {formatR(data.metrics.cumulativeR)}</span></div>)}</div>
      <div className="paper-table-wrap"><table className="paper-table"><thead><tr>
        <th>Symbol</th><th>Signal · ET</th>
        <th>Entry · ET <TermHelp term="Entry" explanation="Modeled entry: the next bar's open." /></th>
        <th>Score</th><th>Setup</th>
        <th>Theoretical entry <TermHelp term="Theoretical entry" explanation="Modeled entry: the next bar's open." /></th>
        <th>Observed market <TermHelp term="Observed market" explanation="Observed bar-open price; this is not a real fill price." /></th>
        <th>Stop</th>
        <th>Risk status</th>
        <th>Exit <TermHelp term="Exit" explanation="The simulated trade closing event; Stop, Target, or Trailing Stop describes why it closed." /></th>
        <th>Close / expiration · ET</th>
        <th>R <TermHelp term="R" explanation="One unit of planned risk. In this paper model, 1R = $100." /></th>
        <th>Hypothetical P&amp;L</th>
      </tr></thead><tbody>{trades.length ? trades.map((row) => <PaperTradeRow key={row.trade.id} row={row} />) : <tr><td colSpan="13">No qualifying paper signals observed yet.</td></tr>}</tbody></table></div>
      <button className="refresh-button paper-refresh" onClick={refresh}>Refresh paper journal</button>
    </>}
  </section>
}
