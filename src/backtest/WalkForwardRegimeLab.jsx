import React, { useMemo } from 'react'
import { runWalkForwardRegimeResearch } from './walkForwardRegimeBacktest.js'
import { HowToReadResults, MetricsGlossary, PlainEnglishTakeaway } from './MetricsGlossary.jsx'
import './robustness.css'

const formatPercent = (value) => `${(value * 100).toFixed(1)}%`
const formatR = (value) => (value === Infinity ? '∞' : `${value.toFixed(2)}R`)
const formatPf = (value) => (value === Infinity ? '∞' : value.toFixed(2))
const formatDate = (value) => (value ? new Date(value).toLocaleDateString('en-US', { timeZone: 'UTC' }) : '—')

const WALK_FORWARD_DEFINITIONS = [
  { term: 'Training period', description: 'The earlier stretch of historical data used only to compute that window\u2019s volatility tercile boundaries (Low/Medium/High cutoffs) \u2014 it never sees or uses the following test period.' },
  { term: 'Test period', description: 'The later, separate stretch of data that gets classified against the boundaries frozen from the training period, and where the frozen scanner\u2019s trades are actually measured.' },
  { term: 'Walk-forward window', description: 'One training-period-plus-test-period pair. Multiple windows step forward in time, so each test period is checked using only boundaries learned from data before it.' },
  { term: 'Volatility regime (Low / Medium / High)', description: 'Each test-period bar is classified using volatility tercile boundaries computed only from that window\u2019s own training period \u2014 never from the test period itself or from later data.' },
  { term: 'Insufficient-Training-History', description: 'A test-period bar is labeled this way when its window\u2019s training period didn\u2019t have enough volatility observations to set reliable boundaries.' },
  { term: 'Pooled results', description: 'All test periods\u2019 trades combined together, after each was classified using its own window\u2019s frozen boundaries.' },
  { term: 'Baseline / RV-confirmed', description: '\u201cBaseline\u201d is the existing 75+ bullish signal. \u201cRV-confirmed\u201d additionally requires the Experiment #1 relative-value confirmation on the same candle. Neither rule is changed here.' },
  { term: 'Small sample', description: 'A regime slice is flagged when it has fewer trades than a fixed threshold, since small counts make win rate, profit factor, and other stats far less reliable.' },
  { term: 'Trade count, win rate, profit factor, expectancy, max drawdown', description: 'Trade count is how many trades occurred; win rate is the share that won; profit factor is total wins divided by total losses; expectancy is the average R-multiple result per trade; max drawdown is the worst peak-to-trough decline in cumulative R.' },
]

const WALK_FORWARD_HOW_TO_READ = [
  'Walk-forward testing is different from just looking at the whole historical period at once: each test period is only ever classified using volatility boundaries learned from data before it, so nothing from a test period (or later) leaks into how it gets classified.',
  'This checks whether Experiment #5\u2019s descriptive volatility-regime pattern would have still shown up if it had been evaluated sequentially, window by window, rather than all at once with full hindsight.',
  'Each window\u2019s training and test dates are shown separately \u2014 look at them side by side rather than only at the pooled, combined results.',
  'Some regimes within a window have very few trades; those are flagged as a small sample and should be read with extra caution.',
  'This is historical research only. It does not change the walk-forward methodology, and it does not change production scoring, paper trading, the Render worker, or Supabase.',
]

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

function WindowsOverview({ windows }) {
  return (
    <div className="robustness-section">
      <h3>Walk-forward windows — training vs. test periods</h3>
      <div className="robustness-table-wrap">
        <table className="robustness-table">
          <thead><tr><th>Window</th><th>Test year</th><th>Training range</th><th>Test range</th><th>Training candles</th><th>Test candles</th></tr></thead>
          <tbody>{windows.map((window) => <tr key={window.label}><td>{window.label}</td><td>{window.testYear}</td><td>{formatDate(window.trainRealizedStart)} – {formatDate(window.trainRealizedEnd)}</td><td>{formatDate(window.testRealizedStart)} – {formatDate(window.testRealizedEnd)}</td><td>{window.trainCandleCount}</td><td>{window.testCandleCount}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  )
}

function WindowBaselineTable({ windows }) {
  return (
    <div className="robustness-section">
      <h3>Baseline vs. RV-confirmed, per window (test period only)</h3>
      <div className="robustness-table-wrap">
        <table className="robustness-table">
          <thead><tr><th>Window</th><th>Variant</th><th>Trades</th><th>Win rate</th><th>PF</th><th>Expectancy</th><th>Total R</th><th>Max DD</th><th>Avg hold</th></tr></thead>
          <tbody>{windows.flatMap((window) => [
            <tr key={`${window.label}-baseline`}><td>{window.label}</td><td>Baseline</td><MetricCells metrics={window.baseline.overall} /></tr>,
            <tr key={`${window.label}-rv`}><td>{window.label}</td><td>RV-confirmed</td><MetricCells metrics={window.rvConfirmed.overall} /></tr>,
          ])}</tbody>
        </table>
      </div>
    </div>
  )
}

function WindowVolatilityGroups({ windows, smallSampleThreshold }) {
  return (
    <div className="robustness-section">
      <h3>Baseline by volatility regime, per window (test period only)</h3>
      {windows.map((window) => (
        <details key={window.label} className="robustness-section">
          <summary>{window.label} — {window.testYear}</summary>
          <div className="robustness-table-wrap">
            <table className="robustness-table">
              <thead><tr><th>Volatility regime</th><th>Trades</th><th>Win rate</th><th>PF</th><th>Expectancy</th><th>Total R</th><th>Max DD</th><th>Avg hold</th><th>Small sample</th></tr></thead>
              <tbody>{window.volatilityGroups.map((group) => <tr key={group.label}><td>{group.label}</td><MetricCells metrics={group.baseline.overall} /><td>{group.baseline.smallSample ? `< ${smallSampleThreshold}` : '—'}</td></tr>)}</tbody>
            </table>
          </div>
        </details>
      ))}
    </div>
  )
}

function PooledVolatilityGroups({ groups, smallSampleThreshold }) {
  return (
    <div className="robustness-section">
      <h3>Pooled baseline by volatility regime (all test periods combined)</h3>
      <div className="robustness-table-wrap">
        <table className="robustness-table">
          <thead><tr><th>Volatility regime</th><th>Trades</th><th>Win rate</th><th>PF</th><th>Expectancy</th><th>Total R</th><th>Max DD</th><th>Avg hold</th><th>Small sample</th></tr></thead>
          <tbody>{groups.map((group) => <tr key={group.label}><td>{group.label}</td><MetricCells metrics={group.baseline.overall} /><td>{group.baseline.smallSample ? `< ${smallSampleThreshold}` : '—'}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  )
}

function EvidenceTable({ evidenceTable }) {
  return (
    <div className="robustness-section">
      <h3>Baseline expectancy by test year and volatility regime</h3>
      <div className="robustness-table-wrap">
        <table className="robustness-table">
          <thead><tr><th>Test year</th><th>Low vol expectancy</th><th>Medium vol expectancy</th><th>High vol expectancy</th></tr></thead>
          <tbody>{evidenceTable.map((row) => <tr key={row.testYear}><td>{row.testYear}</td><td>{formatR(row.low.expectancy)}</td><td>{formatR(row.medium.expectancy)}</td><td>{formatR(row.high.expectancy)}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  )
}

export function WalkForwardRegimeLab({ datasets }) {
  const available = datasets.filter((dataset) => dataset.status === 'AVAILABLE')
  const rawSeriesBySymbol = useMemo(() => Object.fromEntries(available.map((dataset) => [dataset.symbol, dataset.data.candles])), [available])
  const hasAllSymbols = ['SPY', 'QQQ', 'IWM'].every((symbol) => rawSeriesBySymbol[symbol]?.length)

  const research = useMemo(() => (hasAllSymbols ? runWalkForwardRegimeResearch(rawSeriesBySymbol) : null), [hasAllSymbols, rawSeriesBySymbol])

  const takeawayText = useMemo(() => {
    if (!research) return null
    const { criticalTest, pooledVolatilityGroups } = research
    const highGroup = pooledVolatilityGroups.find((group) => group.label === 'High')
    if (!highGroup || !highGroup.baseline.overall.tradeCount) return 'Not enough high-volatility test-period trades were available in this sample to compare against low/medium volatility.'
    const highDirection = criticalTest.highVolatilityPositiveCount > criticalTest.highVolatilityNegativeCount
      ? 'positive in more test years than negative'
      : criticalTest.highVolatilityNegativeCount > criticalTest.highVolatilityPositiveCount
        ? 'negative in more test years than positive'
        : 'split evenly between positive and negative across test years'
    const mediumVsLow = criticalTest.mediumExceedsLowCount === criticalTest.lowExceedsMediumCount
      ? 'medium-volatility expectancy exceeded low-volatility expectancy in as many test years as the reverse'
      : criticalTest.mediumExceedsLowCount > criticalTest.lowExceedsMediumCount
        ? 'medium-volatility expectancy exceeded low-volatility expectancy in more test years than the reverse'
        : 'low-volatility expectancy exceeded medium-volatility expectancy in more test years than the reverse'
    return `Pooled across all walk-forward test periods, the high-volatility regime had ${highGroup.baseline.overall.tradeCount} baseline trades with expectancy ${formatR(highGroup.baseline.overall.expectancy)}${highGroup.baseline.smallSample ? ' (flagged as a small sample)' : ''}. Year by year, high-volatility expectancy was ${highDirection}, and ${mediumVsLow}. This describes how the frozen scanner behaved when volatility regimes were classified sequentially, using only training-period information; it does not prove a volatility-based edge and does not identify a winning regime or variant.`
  }, [research])

  return (
    <section className="robustness-lab panel">
      <div className="panel-heading compact">
        <div><p className="eyebrow">RESEARCH EXPERIMENT #6</p><h2>Research Experiment — Walk-Forward Regime Validation</h2></div>
        <span className="coming-soon">RESEARCH ONLY · DOES NOT AFFECT PAPER TRADING OR SCORING</span>
      </div>
      <p className="robustness-disclaimer">
        Tests whether Experiment #5’s descriptive volatility-regime pattern remains observable when evaluated sequentially,
        window by window, using only information available before each test period. The scanner itself is completely frozen — this
        only classifies already-frozen baseline/RV-confirmed trades into regimes whose boundaries were fixed from training data
        alone. Descriptive research only — does not change production scoring, paper trading, the Render worker, or Supabase. No
        winner is auto-selected.
      </p>
      <div className="robustness-section"><MetricsGlossary title="What does this mean?" intro="Plain-English explanations for the terms used in this walk-forward research." definitions={WALK_FORWARD_DEFINITIONS} /></div>
      <div className="robustness-section"><HowToReadResults title="How to read this test" items={WALK_FORWARD_HOW_TO_READ} /></div>
      {!hasAllSymbols ? (
        <div className="robustness-error">Waiting for real Alpaca historical data for SPY, QQQ, and IWM. This experiment never substitutes demo data.</div>
      ) : (
        <>
          <WindowsOverview windows={research.windows} />
          <WindowBaselineTable windows={research.windows} />
          <WindowVolatilityGroups windows={research.windows} smallSampleThreshold={research.options.smallSampleThreshold} />
          <PooledVolatilityGroups groups={research.pooledVolatilityGroups} smallSampleThreshold={research.options.smallSampleThreshold} />
          <EvidenceTable evidenceTable={research.evidenceTable} />

          <div className="robustness-section">
            <h3>Combined (all test periods) — baseline vs. RV-confirmed</h3>
            <div className="robustness-table-wrap">
              <table className="robustness-table">
                <thead><tr><th>Variant</th><th>Trades</th><th>Win rate</th><th>PF</th><th>Expectancy</th><th>Total R</th><th>Max DD</th><th>Avg hold</th></tr></thead>
                <tbody>
                  <tr><td>Baseline</td><MetricCells metrics={research.combinedBaseline.overall} /></tr>
                  <tr><td>RV-confirmed</td><MetricCells metrics={research.combinedRvConfirmed.overall} /></tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="robustness-section"><PlainEnglishTakeaway>{takeawayText}</PlainEnglishTakeaway></div>

          <p className="research-note">
            Descriptive research only, on historical data evaluated sequentially. Walk-forward results do not guarantee future
            performance, and results here do not automatically change production scoring, thresholds, or trade construction.
          </p>
        </>
      )}
    </section>
  )
}
