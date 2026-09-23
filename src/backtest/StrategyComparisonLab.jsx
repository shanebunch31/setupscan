import React, { useMemo } from 'react'
import { enrichHistoricalCandles } from '../data/marketData.js'
import { calculateResearchMetrics, runStrategyComparison, trendMomentumParameters } from './strategyComparison.js'

const formatPercent = (value) => `${(value * 100).toFixed(1)}%`
const formatR = (value) => `${value === Infinity ? '∞' : value.toFixed(3)}R`
const formatDate = (value) => value ? new Date(value).toLocaleDateString('en-US', { timeZone: 'UTC' }) : '—'

function MetricCells({ metrics }) {
  return <><td>{metrics.totalTrades}</td><td>{formatPercent(metrics.winRate)}</td><td>{metrics.profitFactor === Infinity ? '∞' : metrics.profitFactor.toFixed(2)}</td><td>{formatR(metrics.expectancy)}</td><td>{formatR(metrics.averageR)}</td><td>{formatR(metrics.maximumDrawdown)}</td><td>{metrics.averageHoldingTime.toFixed(0)}m</td></>
}

function groupPeriods(rawCandles, result) {
  const periodSize = Math.ceil(rawCandles.length / 4)
  return Array.from({ length: 4 }, (_, index) => {
    const startIndex = index * periodSize
    const endIndex = Math.min((index + 1) * periodSize, rawCandles.length)
    const trades = result.trades.filter((trade) => {
      const tradeIndex = rawCandles.findIndex((candle) => candle.timestamp === trade.timestamp)
      return tradeIndex >= startIndex && tradeIndex < endIndex
    })
    return { label: `P${index + 1}`, start: rawCandles[startIndex]?.timestamp, end: rawCandles[endIndex - 1]?.timestamp, metrics: calculateResearchMetrics(trades) }
  })
}

export function StrategyComparisonLab({ datasets }) {
  const comparisons = useMemo(() => datasets.filter((dataset) => dataset.status === 'AVAILABLE').map((dataset) => {
    const rawCandles = dataset.data.candles
    const result = runStrategyComparison(rawCandles, enrichHistoricalCandles(rawCandles))
    return { symbol: dataset.symbol, candleCount: dataset.data.candleCount, start: dataset.data.start, end: dataset.data.end, control: result.control, trendMomentum: result.trendMomentum, controlPeriods: groupPeriods(rawCandles, result.control), trendMomentumPeriods: groupPeriods(rawCandles, result.trendMomentum) }
  }), [datasets])

  if (!comparisons.length) return <div className="robustness-error">Strategy comparison unavailable until real Alpaca datasets load.</div>
  return <div className="strategy-comparison"><div className="comparison-strategy-definition"><strong>RESEARCH ONLY — NOT PRODUCTION</strong><span>Trend/Momentum: long-only; close &gt; SMA50; rising SMA50; close &gt; SMA200; SMA50 &gt; SMA200; close &gt; close 20 bars ago; ATR14 stop = 2.0 ATR; target = 2R; max hold = 12 bars.</span></div><div className="robustness-table-wrap"><table className="robustness-table"><thead><tr><th>Symbol / strategy</th><th>Candles</th><th>Range</th><th>Trades</th><th>Win rate</th><th>Profit factor</th><th>Expectancy</th><th>Average R</th><th>Max DD</th><th>Avg hold</th></tr></thead><tbody>{comparisons.flatMap((comparison) => [{ label: `${comparison.symbol} · SetupScan 75+`, result: comparison.control }, { label: `${comparison.symbol} · Trend/Momentum`, result: comparison.trendMomentum }]).map(({ label, result }, index) => { const comparison = comparisons[Math.floor(index / 2)]; return <tr key={label}><td>{label}</td><td>{comparison.candleCount}</td><td>{formatDate(comparison.start)} – {formatDate(comparison.end)}</td><MetricCells metrics={result.metrics} /></tr> })}</tbody></table></div><div className="robustness-table-wrap"><table className="robustness-table"><thead><tr><th>Symbol / strategy</th><th>Sample</th><th>Trades</th><th>Win rate</th><th>Profit factor</th><th>Expectancy</th><th>Average R</th><th>Max DD</th></tr></thead><tbody>{comparisons.flatMap((comparison) => [{ label: `${comparison.symbol} · SetupScan 75+`, result: comparison.control }, { label: `${comparison.symbol} · Trend/Momentum`, result: comparison.trendMomentum }]).flatMap(({ label, result }) => [{ label, sample: 'In-sample', metrics: result.inSampleMetrics }, { label, sample: 'Out-of-sample', metrics: result.outOfSampleMetrics }]).map(({ label, sample, metrics }) => <tr key={`${label}-${sample}`}><td>{label}</td><td>{sample}</td><MetricCells metrics={metrics} /></tr>)}</tbody></table></div><div className="robustness-table-wrap"><table className="robustness-table"><thead><tr><th>Symbol / strategy</th><th>Period</th><th>Date range</th><th>Trades</th><th>Win rate</th><th>Profit factor</th><th>Expectancy</th><th>Average R</th><th>Max DD</th></tr></thead><tbody>{comparisons.flatMap((comparison) => [{ label: `${comparison.symbol} · SetupScan 75+`, periods: comparison.controlPeriods }, { label: `${comparison.symbol} · Trend/Momentum`, periods: comparison.trendMomentumPeriods }]).flatMap(({ label, periods }) => periods.map((period) => <tr key={`${label}-${period.label}`}><td>{label}</td><td>{period.label}</td><td>{formatDate(period.start)} – {formatDate(period.end)}</td><MetricCells metrics={period.metrics} /></tr>))}</tbody></table></div><p className="robustness-muted">Control and Trend/Momentum use next-candle-open entries and the same chronological 70/30 split. Parameters are fixed before evaluating results; no production threshold or strategy winner is selected.</p><p className="robustness-muted">Fixed parameters: momentum lookback {trendMomentumParameters.momentumLookback}, ATR period {trendMomentumParameters.atrPeriod}, stop {trendMomentumParameters.stopAtrMultiple} ATR, target {trendMomentumParameters.targetRMultiple}R.</p></div>
}
