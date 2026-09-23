import React, { useMemo, useState } from 'react'
import {
  runRelativeValueResearch,
  computeCanonicalRelativeStrength,
  runMeanReversionTest,
  relativeValueDefaults,
} from './relativeValueBacktest.js'
import './robustness.css'

const formatPercent = (value) => `${(value * 100).toFixed(1)}%`
const formatR = (value) => (value === Infinity ? '∞' : `${value.toFixed(2)}R`)

function MetricCells({ metrics }) {
  return (
    <>
      <td>{metrics.tradeCount}</td>
      <td>{formatPercent(metrics.winRate)}</td>
      <td>{metrics.profitFactor === Infinity ? '∞' : metrics.profitFactor.toFixed(2)}</td>
      <td>{formatR(metrics.expectancy)}</td>
      <td>{formatR(metrics.totalR)}</td>
      <td>{formatR(metrics.maximumDrawdown)}</td>
      <td>{metrics.averageHoldingTime.toFixed(0)}m</td>
    </>
  )
}

const variantMeta = [
  ['A', 'Baseline existing strategy', 'Unmodified SetupScan bullish signal (score ≥ 75) — no relative-value logic involved.'],
  ['B', 'Relative-value confirmation filter (standalone)', 'Enters whenever the primary symbol starts outperforming the average of its peers over the lookback window, independent of the baseline scanner.'],
  ['C', 'Relative-value mean-reversion signal', 'Enters long when a symbol becomes unusually cheap relative to a peer (rolling z-score ≤ −2) and tests whether the relationship mean-reverts.'],
  ['D', 'Combined: baseline + relative-value confirmation', 'Requires both the baseline bullish signal and the relative-value confirmation filter to be true on the same candle.'],
]

function VariantSection({ variantKey, label, description, summary }) {
  return (
    <div className="robustness-section">
      <h3>Variant {variantKey} — {label}</h3>
      <p className="robustness-muted">{description}</p>
      <div className="robustness-table-wrap">
        <table className="robustness-table">
          <thead><tr><th>Cost basis</th><th>Trades</th><th>Win rate</th><th>Profit factor</th><th>Expectancy</th><th>Total R</th><th>Max DD</th><th>Avg hold</th></tr></thead>
          <tbody>
            <tr><td>Before execution costs</td><MetricCells metrics={summary.overallBeforeCosts} /></tr>
            <tr><td>After execution costs</td><MetricCells metrics={summary.overallAfterCosts} /></tr>
          </tbody>
        </table>
      </div>
      <div className="robustness-table-wrap">
        <table className="robustness-table">
          <thead><tr><th>Symbol</th><th>Trades</th><th>Win rate</th><th>Profit factor</th><th>Expectancy</th><th>Total R</th><th>Max DD</th><th>Avg hold</th></tr></thead>
          <tbody>{summary.bySymbol.map((row) => <tr key={row.symbol}><td>{row.symbol}</td><MetricCells metrics={row.beforeCosts} /></tr>)}</tbody>
        </table>
      </div>
      <div className="robustness-table-wrap">
        <table className="robustness-table">
          <thead><tr><th>Market period</th><th>Trades</th><th>Win rate</th><th>Profit factor</th><th>Expectancy</th><th>Total R</th><th>Max DD</th><th>Avg hold</th></tr></thead>
          <tbody>{summary.byPeriod.map((row) => <tr key={row.label}><td>{row.label}</td><MetricCells metrics={row.beforeCosts} /></tr>)}</tbody>
        </table>
      </div>
    </div>
  )
}

export function RelativeValueResearchLab({ datasets }) {
  const [lookback, setLookback] = useState(relativeValueDefaults.lookback)
  const [forwardHorizon, setForwardHorizon] = useState(relativeValueDefaults.forwardHorizon)

  const available = datasets.filter((dataset) => dataset.status === 'AVAILABLE')
  const rawSeriesBySymbol = useMemo(() => Object.fromEntries(available.map((dataset) => [dataset.symbol, dataset.data.candles])), [available])
  const hasAllSymbols = ['SPY', 'QQQ', 'IWM'].every((symbol) => rawSeriesBySymbol[symbol]?.length)

  const research = useMemo(
    () => (hasAllSymbols ? runRelativeValueResearch(rawSeriesBySymbol, { lookback, forwardHorizon }) : null),
    [hasAllSymbols, rawSeriesBySymbol, lookback, forwardHorizon],
  )
  const canonical = useMemo(() => (research ? computeCanonicalRelativeStrength(research.aligned.raw, lookback) : []), [research, lookback])
  const meanReversion = useMemo(
    () => (research ? runMeanReversionTest(research.aligned.raw, { lookback, divergenceZThreshold: relativeValueDefaults.divergenceZThreshold, forwardHorizon }) : []),
    [research, lookback, forwardHorizon],
  )

  return (
    <section className="robustness-lab panel">
      <div className="panel-heading compact">
        <div><p className="eyebrow">RESEARCH EXPERIMENT #1</p><h2>Research Experiment — Relative Value</h2></div>
        <span className="coming-soon">RESEARCH ONLY · DOES NOT AFFECT PAPER TRADING</span>
      </div>
      <p className="robustness-disclaimer">
        Thorp-inspired relative-value research on synchronized SPY / QQQ / IWM hourly candles from the existing Alpaca historical pipeline.
        This experiment is separate from — and does not modify, weaken, or feed into — the production scanner, the paper trading worker, or Alpaca credentials.
        No variant is selected as a winner; all results are reported side by side.
      </p>
      {!hasAllSymbols ? (
        <div className="robustness-error">Waiting for real Alpaca historical data for SPY, QQQ, and IWM. This experiment never substitutes demo data.</div>
      ) : (
        <>
          <div className="robustness-section">
            <h3>Research parameters</h3>
            <p className="robustness-muted">
              Lookback bars: <input type="number" min="5" max="200" value={lookback} onChange={(event) => setLookback(Math.max(5, Number(event.target.value) || relativeValueDefaults.lookback))} style={{ width: 60 }} />
              {' '}· Forward horizon bars: <input type="number" min="1" max="100" value={forwardHorizon} onChange={(event) => setForwardHorizon(Math.max(1, Number(event.target.value) || relativeValueDefaults.forwardHorizon))} style={{ width: 60 }} />
            </p>
          </div>

          <div className="robustness-section">
            <h3>Relative-strength relationships</h3>
            <div className="robustness-table-wrap">
              <table className="robustness-table">
                <thead><tr><th>Pair</th><th>Latest ratio</th><th>Latest z-score</th><th>Divergent candles (|z| ≥ 2)</th><th>Synchronized candles</th></tr></thead>
                <tbody>{canonical.map((row) => <tr key={row.pair}><td>{row.pair}</td><td>{row.latestRatio?.toFixed(4) ?? '—'}</td><td>{row.latestZScore?.toFixed(2) ?? '—'}</td><td>{row.divergentCandleCount}</td><td>{row.candleCount}</td></tr>)}</tbody>
              </table>
            </div>
          </div>

          <div className="robustness-section">
            <h3>Mean-reversion test — divergences reverting within {forwardHorizon} bars</h3>
            <div className="robustness-table-wrap">
              <table className="robustness-table">
                <thead><tr><th>Pair</th><th>Divergences</th><th>Evaluated</th><th>Reverted</th><th>Reversion rate</th></tr></thead>
                <tbody>{meanReversion.map((row) => <tr key={row.pair}><td>{row.pair}</td><td>{row.divergenceCount}</td><td>{row.evaluatedCount}</td><td>{row.revertedCount}</td><td>{formatPercent(row.reversionRate)}</td></tr>)}</tbody>
              </table>
            </div>
          </div>

          {variantMeta.map(([key, label, description]) => (
            <VariantSection key={key} variantKey={key} label={label} description={description} summary={research.summaries[key]} />
          ))}

          <p className="research-note">
            Descriptive research only. Trade construction (next-candle entry, percent-based stop, R-multiple target, max holding bars) mirrors the
            existing baseline strategy for comparability but is computed independently. No results here alter live paper trading.
          </p>
        </>
      )}
    </section>
  )
}
