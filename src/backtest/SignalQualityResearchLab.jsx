import React, { useMemo } from 'react'
import { runSignalQualityResearch, assessScoreMonotonicity } from './signalQualityBacktest.js'
import { HowToReadResults, MetricsGlossary, PlainEnglishTakeaway } from './MetricsGlossary.jsx'
import './robustness.css'

const formatPercent = (value) => `${(value * 100).toFixed(1)}%`
const formatR = (value) => (value === Infinity ? '∞' : `${value.toFixed(2)}R`)
const formatPf = (value) => (value === Infinity ? '∞' : value.toFixed(2))

const SIGNAL_QUALITY_DEFINITIONS = [
  { term: 'Score bucket', description: 'A range of SetupScan scores (e.g. 75-79, 95-100) grouped together so trades that scored similarly can be compared as a set.' },
  { term: 'Trade count', description: 'How many trades fell into a bucket, component, or slice. Small counts make any other statistic less reliable.' },
  { term: 'Win rate', description: 'The share of trades in that bucket that closed as winners. On its own it doesn\u2019t say how big the wins or losses were.' },
  { term: 'Profit factor', description: 'Total profit from winners divided by total loss from losers within that group. Above 1 means winners outweighed losers over this sample.' },
  { term: 'Expectancy', description: 'The average result per trade, in R-multiples, before real-world costs and slippage.' },
  { term: 'Average R / median R', description: 'The mean and the middle value of each trade\u2019s result, in R-multiples. Median is less swayed by one unusually large win or loss than average.' },
  { term: 'Correlation', description: 'A statistic between \u22121 and 1 describing whether two things moved together historically (here, bucket order vs. average R or win rate). It does not show that one caused the other.' },
  { term: 'Component contribution / decomposition', description: 'How average R differed between trades where one scoring component was present versus absent, among otherwise-similar 75+ signals. It is a historical comparison, not a causal measurement.' },
]

const SIGNAL_QUALITY_HOW_TO_READ = [
  'This test checks whether the existing SetupScan score, and its individual components, showed any historical relationship with what happened after a signal fired.',
  'A higher score bucket having stronger historical numbers does not mean a higher-scoring trade is guaranteed to do better \u2014 it describes what happened in this sample, not what will happen next.',
  'The score-vs-outcome relationship shown here is descriptive. Correlation does not prove causation \u2014 a bucket moving with better results doesn\u2019t mean the score caused those results.',
  'Sample size matters: buckets and components with few trades are far less reliable than ones with many, even when their numbers look different.',
  'This is historical research on past data, not a prediction engine, and it does not change how the production scanner scores or ranks setups.',
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
  const takeawayText = useMemo(() => {
    if (!research) return null
    const populatedBuckets = research.scoreBuckets.filter((bucket) => bucket.overall.tradeCount > 0)
    if (!populatedBuckets.length) return 'No score bucket had enough trades in this sample to describe a relationship between score and outcome.'
    const tradeCounts = populatedBuckets.map((bucket) => bucket.overall.tradeCount)
    const minTrades = Math.min(...tradeCounts)
    const maxTrades = Math.max(...tradeCounts)
    if (!monotonicity.evaluable) {
      return `Only ${populatedBuckets.length} score bucket(s) had enough trades to compare in this sample (${minTrades}\u2013${maxTrades} trades each), which isn\u2019t enough populated buckets to describe a score-vs-outcome relationship. This does not identify any bucket as proven, reliable, or a recommended threshold.`
    }
    const relationshipDescription = monotonicity.monotonicIncreasing
      ? 'average R rose step-by-step from the lowest to the highest populated bucket, with no higher bucket falling below a lower one'
      : 'average R did not rise step-by-step across every bucket \u2014 at least one higher-scoring bucket underperformed a lower-scoring one'
    return `In this sample, ${relationshipDescription}. The correlation between bucket order and average R was ${monotonicity.averageRCorrelation.toFixed(2)}, and between bucket order and win rate was ${monotonicity.winRateCorrelation.toFixed(2)}. Trade counts per bucket ranged from ${minTrades} to ${maxTrades}, so some buckets rest on far fewer trades than others. This describes a historical relationship only \u2014 it does not prove the score causes better outcomes, and no bucket or threshold is identified here as proven, reliable, profitable, or validated.`
  }, [research, monotonicity])

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
      <div className="robustness-section"><MetricsGlossary title="What does this mean?" intro="Plain-English explanations for the terms used in this signal-quality research." definitions={SIGNAL_QUALITY_DEFINITIONS} /></div>
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

          <div className="robustness-section"><PlainEnglishTakeaway>{takeawayText}</PlainEnglishTakeaway></div>
        </>
      )}
      <div className="robustness-section"><HowToReadResults title="How to read this test" items={SIGNAL_QUALITY_HOW_TO_READ} /></div>
    </section>
  )
}
