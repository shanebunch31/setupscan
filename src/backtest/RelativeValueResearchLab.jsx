import React, { useMemo, useState } from 'react'
import {
  runRelativeValueResearch,
  computeCanonicalRelativeStrength,
  runMeanReversionTest,
  relativeValueDefaults,
} from './relativeValueBacktest.js'
import { HowToReadResults, MetricsGlossary, PlainEnglishTakeaway } from './MetricsGlossary.jsx'
import './robustness.css'

const formatPercent = (value) => `${(value * 100).toFixed(1)}%`
const formatR = (value) => (value === Infinity ? '∞' : `${value.toFixed(2)}R`)

const RELATIVE_VALUE_DEFINITIONS = [
  { term: 'Ratio', description: 'The primary symbol\u2019s price divided by a peer\u2019s price. Rising means the primary is gaining on the peer; falling means it\u2019s lagging.' },
  { term: 'Z-score', description: 'How many standard deviations the current ratio sits from its own recent trailing average. \u00b12 means the ratio is unusually stretched relative to its own history.' },
  { term: 'Divergent candles', description: 'Bars where the ratio\u2019s z-score crossed the \u00b12 threshold \u2014 a statistically stretched reading between two symbols.' },
  { term: 'Reversion rate', description: 'Of the divergences that could be checked, the share where the ratio moved back toward its recent average within the forward horizon.' },
  { term: 'Lookback bars', description: 'How many past bars are used to calculate the rolling average and z-score.' },
  { term: 'Forward horizon', description: 'How many bars ahead are checked to see whether a divergence reverted.' },
  { term: 'Trade count', description: 'How many trades a variant produced over the tested history.' },
  { term: 'Win rate', description: 'The share of trades that closed as winners. On its own it doesn\u2019t say how big the wins or losses were.' },
  { term: 'Profit factor', description: 'Total profit from winners divided by total loss from losers. Above 1 means winners outweighed losers over this sample.' },
  { term: 'Expectancy', description: 'The average result per trade, in R-multiples, before real-world costs and slippage.' },
  { term: 'Total R', description: 'Every trade\u2019s result, in R-multiples, added together across the whole tested history.' },
  { term: 'Max drawdown', description: 'The worst peak-to-trough decline in cumulative R across the trade sequence \u2014 the roughest stretch this history included.' },
  { term: 'Before / after execution costs', description: '\u201cBefore costs\u201d ignores trading frictions; \u201cafter costs\u201d applies an estimated cost per trade so you can see how results shift once frictions are included.' },
]

const RELATIVE_VALUE_HOW_TO_READ = [
  'This test asks two separate questions: do relative-strength or mean-reversion patterns show up between SPY, QQQ, and IWM, and would combining them with the existing baseline signal have changed historical results?',
  'Four variants (A\u2013D) are shown side by side. None is marked as a winner \u2014 compare them the way you\u2019d compare any two research notes.',
  'Results are broken out by symbol, by market period, and before/after estimated execution costs, because a relative-value effect can look different depending on which slice you check.',
  'Divergences and reversion rates are shown separately from the trade variants \u2014 a ratio reverting historically doesn\u2019t guarantee it will revert going forward.',
  'This is research on synchronized historical data only. It is not connected to live paper trading and is not financial advice.',
]


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
  const takeawayText = useMemo(() => {
    if (!research) return null
    const evaluablePairs = meanReversion.filter((row) => row.evaluatedCount > 0)
    const avgReversionRate = evaluablePairs.length
      ? evaluablePairs.reduce((sum, row) => sum + row.reversionRate, 0) / evaluablePairs.length
      : null
    const variantTradeCounts = variantMeta.map(([key]) => research.summaries[key].overallBeforeCosts.tradeCount)
    const minTrades = Math.min(...variantTradeCounts)
    const maxTrades = Math.max(...variantTradeCounts)
    return `At a ${lookback}-bar lookback and ${forwardHorizon}-bar forward horizon, tested SPY/QQQ/IWM divergences reverted within the forward horizon in an average of ${avgReversionRate !== null ? formatPercent(avgReversionRate) : 'an unavailable share'} of evaluated cases across the pairs shown above. Across the four tested variants, trade counts before costs ranged from ${minTrades} to ${maxTrades}, with win rate, profit factor, expectancy, and drawdown differing by variant, symbol, and market period as shown in the tables above. This side-by-side comparison does not identify any variant as more successful, profitable, or validated than another.`
  }, [research, meanReversion, lookback, forwardHorizon])

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
      <div className="robustness-section"><MetricsGlossary title="What does this mean?" intro="Plain-English explanations for the terms used in this relative-value research." definitions={RELATIVE_VALUE_DEFINITIONS} /></div>
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

          <div className="robustness-section"><PlainEnglishTakeaway>{takeawayText}</PlainEnglishTakeaway></div>
        </>
      )}
      <div className="robustness-section"><HowToReadResults title="How to read this test" items={RELATIVE_VALUE_HOW_TO_READ} /></div>
    </section>
  )
}
