import React, { useMemo } from 'react'
import { runSignalQualityResearch, assessScoreMonotonicity } from './signalQualityBacktest.js'
import { HowToReadResults, LearningDetails, MetricsGlossary, ResearchFirstAnswer } from './MetricsGlossary.jsx'
import { hasPerformanceObservations } from './labEvidence.js'
import { AmbiguousCandleDisclosure, ResearchDataStatus } from './LabEvidence.jsx'
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
  { term: 'Component contribution / decomposition', description: 'How average R differed between research-eligible 75+ signals where one component was present versus absent. Unavailable means the input could not be evaluated; it is not counted as absent. This is a historical comparison, not a causal measurement.' },
  { term: 'Research-eligible 75+', description: 'Includes Potential Setups scoring 75 or more as well as Qualified Setups. A Qualified-only population is narrower because every required scanner condition must pass.' },
  { term: 'Exploratory', description: 'Both comparison groups have at least 30 resolved observations, but at least one has fewer than 100. The directional label remains a small-sample research observation, not strong evidence.' },
]

const SIGNAL_QUALITY_HOW_TO_READ = [
  'This test checks whether the existing SetupScan score, and its individual components, showed any historical relationship with what happened after a signal fired.',
  'A higher score bucket having stronger historical numbers does not mean a higher-scoring trade is guaranteed to do better \u2014 it describes what happened in this sample, not what will happen next.',
  'The score-vs-outcome relationship shown here is descriptive. Correlation does not prove causation \u2014 a bucket moving with better results doesn\u2019t mean the score caused those results.',
  'Sample size matters: buckets and components with few trades are far less reliable than ones with many, even when their numbers look different.',
  'This is historical research on past data, not a prediction engine, and it does not change how the production scanner scores or ranks setups.',
]


function MetricCells({ metrics }) {
  const hasTrades = hasPerformanceObservations(metrics)
  return (
    <>
      <td>{metrics.tradeCount}</td>
      <td>{hasTrades ? formatPercent(metrics.winRate) : '—'}</td>
      <td>{hasTrades ? formatPf(metrics.profitFactor) : '—'}</td>
      <td>{hasTrades ? formatR(metrics.expectancy) : '—'}</td>
      <td>{hasTrades ? formatR(metrics.totalR) : '—'}</td>
      <td>{hasTrades ? formatR(metrics.maximumDrawdown) : '—'}</td>
      <td>{hasTrades ? `${metrics.averageHoldingTime.toFixed(0)}m` : '—'}</td>
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
      {!hasAllSymbols ? (
        <ResearchDataStatus datasets={datasets} requiredSymbols={['SPY', 'QQQ', 'IWM']} />
      ) : (
        <>
          <ResearchFirstAnswer
            question="Did the existing setup score and its components relate to later outcomes in this historical sample?"
            sample={`${research.scoreBuckets.reduce((total, bucket) => total + bucket.overall.tradeCount, 0)} baseline trades across the displayed score buckets.`}
            takeaway={takeawayText}
            limitation="The score/outcome comparison is descriptive; correlation does not prove cause or predict the next trade."
          />
          <LearningDetails label="More details">
          <div className="robustness-section">
            <h3>Score buckets — trade count, win rate, profit factor, expectancy, average/median R, loss rate</h3>
            <div className="robustness-table-wrap">
              <table className="robustness-table">
                <thead><tr><th>Bucket</th><th>Trades</th><th>Win rate</th><th>PF</th><th>Expectancy</th><th>Avg R</th><th>Median R</th><th>Loss rate</th><th>Total R</th><th>Max DD</th><th>Avg hold</th></tr></thead>
                <tbody>{research.scoreBuckets.map((bucket) => { const hasTrades = hasPerformanceObservations(bucket.overall); return <tr key={bucket.label}><td>{bucket.label}</td><td>{bucket.overall.tradeCount}</td><td>{hasTrades ? formatPercent(bucket.overall.winRate) : '—'}</td><td>{hasTrades ? formatPf(bucket.overall.profitFactor) : '—'}</td><td>{hasTrades ? formatR(bucket.overall.expectancy) : '—'}</td><td>{hasTrades ? formatR(bucket.overall.averageR) : '—'}</td><td>{hasTrades ? formatR(bucket.overall.medianR) : '—'}</td><td>{hasTrades ? formatPercent(bucket.overall.lossRate) : '—'}</td><td>{hasTrades ? formatR(bucket.overall.totalR) : '—'}</td><td>{hasTrades ? formatR(bucket.overall.maximumDrawdown) : '—'}</td><td>{hasTrades ? `${bucket.overall.averageHoldingTime.toFixed(0)}m` : '—'}</td></tr>})}</tbody>
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
                <AmbiguousCandleDisclosure metrics={bucket.overall} />
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
            <h3>Decomposition — present vs. absent among research-eligible 75+ signals</h3>
            <div className="robustness-table-wrap">
              <table className="robustness-table">
                <thead><tr><th>Component</th><th>Baseline</th><th>Present: total / resolved</th><th>Present: avg R</th><th>Absent: total / resolved</th><th>Absent: avg R</th><th>Unavailable</th><th>Outcome excluded</th><th>Contribution (R)</th><th>Evidence label</th><th>Accounting</th></tr></thead>
                <tbody>{research.decomposition.map((entry) => { const hasPresent = hasPerformanceObservations(entry.present.overall); const hasAbsent = hasPerformanceObservations(entry.absent.overall); const hasBoth = hasPresent && hasAbsent; const label = entry.classification === 'insufficient-evidence' ? 'Insufficient evidence' : `${entry.classification}${entry.exploratory ? ' · exploratory' : ''}`; return <tr key={entry.key}><td>{entry.label}</td><td>{entry.accounting.baselineCount}</td><td>{entry.accounting.presentCount} / {entry.accounting.presentResolvedCount}</td><td>{hasPresent ? formatR(entry.present.overall.averageR) : '—'}</td><td>{entry.accounting.absentCount} / {entry.accounting.absentResolvedCount}</td><td>{hasAbsent ? formatR(entry.absent.overall.averageR) : '—'}</td><td>{entry.accounting.unavailableCount}</td><td>{entry.accounting.outcomeExcludedCount}</td><td>{hasBoth ? formatR(entry.contributionR) : '—'}</td><td>{label}</td><td>{entry.accounting.reconciliationStatus}</td></tr>})}</tbody>
              </table>
            </div>
            <p className="research-note">
              Descriptive comparison only. "Contribution" is present-group average R minus absent-group average R among research-eligible
              75+ signals, which include Potential and Qualified Setups. Unavailable inputs are kept separate from observed absences.
              A positive or negative label requires at least 30 resolved observations on each side; a side below 100 remains exploratory.
              This is not a causal estimate and no component is optimized or removed from production scoring based on this table.
            </p>
          </div>
          <p className="robustness-muted">Period rows group trades by the signal candle’s period. Their simulated outcomes may finish after that period ends.</p>

          </LearningDetails>
        </>
      )}
      <LearningDetails label="What does this mean?">
        <MetricsGlossary title="Signal Quality terms" intro="Plain-English explanations for terms used in this test." definitions={SIGNAL_QUALITY_DEFINITIONS} />
      </LearningDetails>
      <LearningDetails label="How was this tested?">
        <HowToReadResults title="How to read this test" items={SIGNAL_QUALITY_HOW_TO_READ} />
      </LearningDetails>
    </section>
  )
}
