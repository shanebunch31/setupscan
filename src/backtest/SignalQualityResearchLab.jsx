import React, { useMemo } from 'react'
import { runSignalQualityResearch, assessScoreMonotonicity } from './signalQualityBacktest.js'
import './robustness.css'

const formatPercent = (value) => `${(value * 100).toFixed(1)}%`
const formatR = (value) => (value === Infinity ? '∞' : `${value.toFixed(2)}R`)
const formatPf = (value) => (value === Infinity ? '∞' : value.toFixed(2))

function MetricCells({ metrics }) {
  return (
    <>
      <td>{metrics.tradeCount}</td>
      <td>{formatPercent(metrics.winRate)}</td>
      <td>{formatPf(metrics.profitFactor)}</td>
      <td>{formatR(metrics.expectancy)}</td>
      <td>{formatR(metrics.totalR)}</td>
      <td>{formatR(metrics.maximumDrawdown)}</td>
      <td>{metrics.averageHoldingTime.toFixed(0)}m</td>
    </>
  )
}

function BreakdownTables({ summary }) {
  return (
    <>
      <div className="robustness-table-wrap">
        <table className="robustness-table">
          <thead><tr><th>Symbol</th><th>Trades</th><th>Win rate</th><th>PF</th><th>Expectancy</th><th>Total R</th><th>Max DD</th><th>Avg hold</th></tr></thead>
          <tbody>{summary.bySymbol.map((row) => <tr key={row.symbol}><td>{row.symbol}</td><MetricCells metrics={row.metrics} /></tr>)}</tbody>
        </table>
      </div>
      <div className="robustness-table-wrap">
        <table className="robustness-table">
          <thead><tr><th>Period</th><th>Trades</th><th>Win rate</th><th>PF</th><th>Expectancy</th><th>Total R</th><th>Max DD</th><th>Avg hold</th></tr></thead>
          <tbody>{summary.byPeriod.map((row) => <tr key={row.label}><td>{row.label}</td><MetricCells metrics={row.metrics} /></tr>)}</tbody>
        </table>
      </div>
      <div className="robustness-table-wrap">
        <table className="robustness-table">
          <thead><tr><th>Cost tier</th><th>Trades</th><th>Win rate</th><th>PF</th><th>Expectancy</th><th>Total R</th><th>Max DD</th><th>Avg hold</th></tr></thead>
          <tbody>{summary.costTiers.map((row) => <tr key={row.label}><td>{row.label}</td><MetricCells metrics={row.metrics} /></tr>)}</tbody>
        </table>
      </div>
    </>
  )
}

export function SignalQualityResearchLab({ datasets }) {
  const available = datasets.filter((dataset) => dataset.status === 'AVAILABLE')
  const rawSeriesBySymbol = useMemo(() => Object.fromEntries(available.map((dataset) => [dataset.symbol, dataset.data.candles])), [available])
  const hasAllSymbols = ['SPY', 'QQQ', 'IWM'].every((symbol) => rawSeriesBySymbol[symbol]?.length)

  const research = useMemo(() => (hasAllSymbols ? runSignalQualityResearch(rawSeriesBySymbol) : null), [hasAllSymbols, rawSeriesBySymbol])
  const monotonicity = useMemo(() => (research ? assessScoreMonotonicity(research.scoreBuckets) : { evaluable: false }), [research])

  return (
    <section className="robustness-lab panel">
      <div className="panel-heading compact">
        <div><p className="eyebrow">RESEARCH EXPERIMENT #2</p><h2>Research Experiment — Signal Quality / Expected Value</h2></div>
        <span className="coming-soon">RESEARCH ONLY · DOES NOT AFFECT PAPER TRADING OR SCORING</span>
      </div>
      <p className="robustness-disclaimer">
        Tests whether the existing SetupScan score and its individual components carry measurable information about subsequent
        outcomes, using the existing baseline entry/exit methodology on synchronized SPY/QQQ/IWM data. Descriptive research only —
        does not change production scoring, paper trading, the Render worker, or Supabase. No parameters were optimized and no
        winner is auto-selected.
      </p>
      {!hasAllSymbols ? (
        <div className="robustness-error">Waiting for real Alpaca historical data for SPY, QQQ, and IWM. This experiment never substitutes demo data.</div>
      ) : (
        <>
          <div className="robustness-section">
            <h3>Score buckets — trade count, win rate, profit factor, expectancy, average/median R, loss rate</h3>
            <div className="robustness-table-wrap">
              <table className="robustness-table">
                <thead><tr><th>Bucket</th><th>Trades</th><th>Win rate</th><th>PF</th><th>Expectancy</th><th>Avg R</th><th>Median R</th><th>Loss rate</th><th>Total R</th><th>Max DD</th><th>Avg hold</th></tr></thead>
                <tbody>{research.scoreBuckets.map((bucket) => <tr key={bucket.label}><td>{bucket.label}</td><td>{bucket.overall.tradeCount}</td><td>{formatPercent(bucket.overall.winRate)}</td><td>{formatPf(bucket.overall.profitFactor)}</td><td>{formatR(bucket.overall.expectancy)}</td><td>{formatR(bucket.overall.averageR)}</td><td>{formatR(bucket.overall.medianR)}</td><td>{formatPercent(bucket.overall.lossRate)}</td><td>{formatR(bucket.overall.totalR)}</td><td>{formatR(bucket.overall.maximumDrawdown)}</td><td>{bucket.overall.averageHoldingTime.toFixed(0)}m</td></tr>)}</tbody>
              </table>
            </div>
            <p className="robustness-muted">
              {monotonicity.evaluable
                ? `Average-R vs. bucket-order correlation: ${monotonicity.averageRCorrelation.toFixed(2)} · Win-rate correlation: ${monotonicity.winRateCorrelation.toFixed(2)} · Monotonically non-decreasing average R across all buckets: ${monotonicity.monotonicIncreasing ? 'YES' : 'NO'}. This is a descriptive correlation, not a claim of a validated edge.`
                : 'Not enough populated buckets to assess monotonicity.'}
            </p>
            {research.scoreBuckets.map((bucket) => (
              <details key={bucket.label} className="robustness-section">
                <summary>{bucket.label} — by symbol / period / cost tier</summary>
                <BreakdownTables summary={bucket} />
              </details>
            ))}
          </div>

          <div className="robustness-section">
            <h3>Individual components — A) independent vs. B) conditional on the existing 75+ baseline</h3>
            {research.components.map((component) => (
              <details key={component.key} className="robustness-section" open={false}>
                <summary>{component.label}</summary>
                <p className="robustness-muted">A) Independent (component alone, edge-triggered):</p>
                <div className="robustness-table-wrap">
                  <table className="robustness-table">
                    <thead><tr><th /><th>Trades</th><th>Win rate</th><th>PF</th><th>Expectancy</th><th>Total R</th><th>Max DD</th><th>Avg hold</th></tr></thead>
                    <tbody><tr><td>Overall</td><MetricCells metrics={component.independent.overall} /></tr></tbody>
                  </table>
                </div>
                <BreakdownTables summary={component.independent} />
                <p className="robustness-muted">B) Conditional (component AND existing 75+ bullish signal):</p>
                <div className="robustness-table-wrap">
                  <table className="robustness-table">
                    <thead><tr><th /><th>Trades</th><th>Win rate</th><th>PF</th><th>Expectancy</th><th>Total R</th><th>Max DD</th><th>Avg hold</th></tr></thead>
                    <tbody><tr><td>Overall</td><MetricCells metrics={component.conditional.overall} /></tr></tbody>
                  </table>
                </div>
                <BreakdownTables summary={component.conditional} />
              </details>
            ))}
          </div>

          <div className="robustness-section">
            <h3>Decomposition — present vs. absent among otherwise-comparable 75+ signals</h3>
            <div className="robustness-table-wrap">
              <table className="robustness-table">
                <thead><tr><th>Component</th><th>Present: trades</th><th>Present: avg R</th><th>Absent: trades</th><th>Absent: avg R</th><th>Contribution (R)</th><th>Classification</th></tr></thead>
                <tbody>{research.decomposition.map((entry) => <tr key={entry.key}><td>{entry.label}</td><td>{entry.present.overall.tradeCount}</td><td>{formatR(entry.present.overall.averageR)}</td><td>{entry.absent.overall.tradeCount}</td><td>{formatR(entry.absent.overall.averageR)}</td><td>{formatR(entry.contributionR)}</td><td>{entry.classification}</td></tr>)}</tbody>
              </table>
            </div>
            <p className="research-note">
              Descriptive comparison only. "Contribution" is present-group average R minus absent-group average R among trades that
              already qualify as 75+ bullish signals; it is not a causal estimate and no component is optimized or removed from
              production scoring based on this table.
            </p>
          </div>
        </>
      )}
    </section>
  )
}
