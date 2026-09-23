import React, { useMemo } from 'react'
import { enrichHistoricalCandles } from '../data/marketData.js'
import { getRobustnessWarnings, runMarketConditionResearch, runThresholdResearch } from './robustness.js'
import { StrategyComparisonLab } from './StrategyComparisonLab.jsx'
import './robustness.css'

const formatPercent = (value) => `${(value * 100).toFixed(1)}%`
const formatR = (value) => `${value === Infinity ? '∞' : value.toFixed(2)}R`
const formatDate = (value) => value ? new Date(value).toLocaleDateString('en-US', { timeZone: 'UTC' }) : '—'
const emptyMetrics = { totalTrades: 0, winRate: 0, profitFactor: 0, expectancy: 0, averageR: 0, maximumDrawdown: 0, averageHoldingTime: 0, averageWinner: 0, averageLoser: 0 }

function MetricCells({ metrics }) {
  return <><td>{metrics.totalTrades}</td><td>{formatPercent(metrics.winRate)}</td><td>{metrics.profitFactor === Infinity ? '∞' : metrics.profitFactor.toFixed(2)}</td><td>{formatR(metrics.expectancy)}</td><td>{formatR(metrics.averageR)}</td><td>{formatR(metrics.maximumDrawdown)}</td><td>{metrics.averageHoldingTime.toFixed(0)}m</td><td>{formatR(metrics.averageWinner)}</td><td>{formatR(metrics.averageLoser)}</td></>
}

function CumulativeRChart({ result }) {
  const values = []
  let cumulative = 0
  result.trades.forEach((trade) => { cumulative += trade.rMultiple; values.push(cumulative) })
  const min = Math.min(0, ...values)
  const max = Math.max(0, ...values)
  const range = max - min || 1
  const points = values.map((value, index) => `${(index / Math.max(values.length - 1, 1)) * 238 + 1},${68 - ((value - min) / range) * 64}`).join(' ')
  return <div className="robustness-chart"><svg viewBox="0 0 240 70" role="img" aria-label={`${result.minimumScore}+ cumulative R chart`}><line x1="1" x2="239" y1={68 - ((0 - min) / range) * 64} y2={68 - ((0 - min) / range) * 64} /><polyline points={points} /></svg><span>{result.minimumScore}+ · {formatR(values.at(-1) ?? 0)} cumulative R</span></div>
}

function ThresholdTable({ results }) {
  return <div className="robustness-table-wrap"><table className="robustness-table threshold-research-table"><thead><tr><th>Threshold</th><th>Total</th><th>In-sample</th><th>Out-of-sample</th><th>Win rate</th><th>Profit factor</th><th>Expectancy</th><th>Average R</th><th>Max DD</th><th>Avg hold</th><th>Avg win</th><th>Avg loss</th></tr></thead><tbody>{results.map((result) => <tr key={result.minimumScore}><td>{result.minimumScore}+</td><MetricCells metrics={result.metrics} /><td>{result.inSampleMetrics.totalTrades}</td><td>{result.outOfSampleMetrics.totalTrades}</td></tr>)}</tbody></table></div>
}

function DirectionTable({ result }) {
  const rows = [{ label: 'Long', metrics: result.metrics }, { label: 'Short', metrics: emptyMetrics }, { label: 'Combined', metrics: result.metrics }]
  return <div className="robustness-table-wrap"><table className="robustness-table"><thead><tr><th>Direction</th><th>Total</th><th>Win rate</th><th>Profit factor</th><th>Expectancy</th><th>Average R</th><th>Max DD</th><th>Avg hold</th></tr></thead><tbody>{rows.map(({ label, metrics }) => <tr key={label}><td>{label}</td><td>{metrics.totalTrades}</td><td>{formatPercent(metrics.winRate)}</td><td>{metrics.profitFactor === Infinity ? '∞' : metrics.profitFactor.toFixed(2)}</td><td>{formatR(metrics.expectancy)}</td><td>{formatR(metrics.averageR)}</td><td>{formatR(metrics.maximumDrawdown)}</td><td>{metrics.averageHoldingTime.toFixed(0)}m</td></tr>)}</tbody></table></div>
}

function ResearchSection({ title, children }) { return <div className="robustness-section"><h3>{title}</h3>{children}</div> }

export function StrategyRobustnessLab({ datasets }) {
  const availableSpy = datasets.find((dataset) => dataset.symbol === 'SPY' && dataset.status === 'AVAILABLE')
  const spyCandles = useMemo(() => availableSpy ? enrichHistoricalCandles(availableSpy.data.candles) : [], [availableSpy])
  const thresholdResults = useMemo(() => spyCandles.length ? runThresholdResearch(spyCandles) : [], [spyCandles])
  const periodResults = useMemo(() => spyCandles.length ? runMarketConditionResearch(spyCandles) : [], [spyCandles])
  const warnings = useMemo(() => getRobustnessWarnings(thresholdResults), [thresholdResults])
  const baseline = thresholdResults[0]
  const symbolRows = datasets.map((dataset) => {
    if (dataset.status !== 'AVAILABLE') return { symbol: dataset.symbol, unavailable: true }
    const candles = enrichHistoricalCandles(dataset.data.candles)
    const result = runThresholdResearch(candles)[0]
    return { symbol: dataset.symbol, unavailable: false, result }
  })

  return <section className="robustness-lab panel"><div className="panel-heading compact"><div><p className="eyebrow">RESEARCH / ROBUSTNESS</p><h2>Strategy Robustness Lab</h2></div><span className="coming-soon">NOT A VALIDATED TRADING EDGE</span></div><p className="robustness-disclaimer">Research / Robustness — Not a validated trading edge. Real Alpaca historical data only; unavailable symbols are not replaced with demo data.</p><ResearchSection title="Control vs Trend/Momentum · research only"><StrategyComparisonLab datasets={datasets} /></ResearchSection>{!availableSpy ? <div className="robustness-error">SPY robustness data is unavailable, so no robustness backtest was run.</div> : <><ResearchSection title="Score threshold comparison · existing rules unchanged"><ThresholdTable results={thresholdResults} /></ResearchSection><ResearchSection title="Cumulative R by threshold"><div className="robustness-charts">{thresholdResults.map((result) => <CumulativeRChart key={result.minimumScore} result={result} />)}</div></ResearchSection><ResearchSection title="Direction · current strategy is long-only"><DirectionTable result={baseline} /><p className="robustness-muted">Short logic has not been implemented: qualifying signals are bullish-only and trade construction uses a long entry, lower stop, and higher target.</p></ResearchSection><ResearchSection title="Market conditions · chronological SPY periods"><div className="robustness-table-wrap"><table className="robustness-table"><thead><tr><th>Period</th><th>Date range</th><th>Candles</th><th>Trades</th><th>Win rate</th><th>Profit factor</th><th>Expectancy</th><th>Average R</th><th>Max DD</th></tr></thead><tbody>{periodResults.map((period) => <tr key={period.label}><td>{period.label}</td><td>{formatDate(period.start)} – {formatDate(period.end)}</td><td>{period.candleCount}</td><td>{period.metrics.totalTrades}</td><td>{formatPercent(period.metrics.winRate)}</td><td>{period.metrics.profitFactor === Infinity ? '∞' : period.metrics.profitFactor.toFixed(2)}</td><td>{formatR(period.metrics.expectancy)}</td><td>{formatR(period.metrics.averageR)}</td><td>{formatR(period.metrics.maximumDrawdown)}</td></tr>)}</tbody></table></div></ResearchSection><ResearchSection title="Symbol comparison · 75+ baseline"><div className="robustness-table-wrap"><table className="robustness-table"><thead><tr><th>Symbol</th><th>Provider</th><th>Date range</th><th>Candles</th><th>Trades</th><th>Win rate</th><th>Profit factor</th><th>Expectancy</th><th>Average R</th></tr></thead><tbody>{symbolRows.map((row) => row.unavailable ? <tr key={row.symbol}><td>{row.symbol}</td><td colSpan="8" className="unavailable">UNAVAILABLE · no demo substitution</td></tr> : <tr key={row.symbol}><td>{row.symbol}</td><td>{row.result.candles ? 'ALPACA HISTORICAL' : '—'}</td><td>{formatDate(row.result.candles?.[0]?.timestamp)} – {formatDate(row.result.candles?.at(-1)?.timestamp)}</td><td>{row.result.candles?.length ?? 0}</td><td>{row.result.metrics.totalTrades}</td><td>{formatPercent(row.result.metrics.winRate)}</td><td>{row.result.metrics.profitFactor === Infinity ? '∞' : row.result.metrics.profitFactor.toFixed(2)}</td><td>{formatR(row.result.metrics.expectancy)}</td><td>{formatR(row.result.metrics.averageR)}</td></tr>)}</tbody></table></div></ResearchSection><ResearchSection title="Robustness warnings"><div className="robustness-warnings"><div>Threshold selection warning: no threshold selector is implemented; this lab does not choose a winner.</div>{warnings.length ? warnings.map((warning) => <div key={warning}>{warning}</div>) : <div>No heuristic warnings triggered for the available results.</div>}{symbolRows.filter((row) => row.unavailable).map((row) => <div key={row.symbol}>{row.symbol} data is unavailable and was excluded from robustness results.</div>)}</div></ResearchSection></>}</section>
}
