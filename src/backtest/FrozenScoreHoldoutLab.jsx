import React, { useMemo } from 'react'
import { runFrozenScoreHoldoutResearch, assessScoreMonotonicity } from './frozenScoreHoldoutBacktest.js'
import { HowToReadResults, LearningDetails, MetricsGlossary, ResearchFirstAnswer } from './MetricsGlossary.jsx'
import { hasPerformanceObservations } from './labEvidence.js'
import { AmbiguousCandleDisclosure, ResearchDataStatus } from './LabEvidence.jsx'
import './robustness.css'

const formatPercent = (value) => `${(value * 100).toFixed(1)}%`
const formatR = (value) => (value === Infinity ? '∞' : `${value.toFixed(2)}R`)
const formatPf = (value) => (value === Infinity ? '∞' : value.toFixed(2))
const formatDate = (value) => (value ? new Date(value).toLocaleDateString('en-US', { timeZone: 'UTC' }) : '—')

const FROZEN_SCORE_DEFINITIONS = [
  { term: 'Frozen score', description: 'The existing SetupScan scoring formula, used here exactly as-is \u2014 no weights, thresholds, or rules are changed or re-tuned for this test.' },
  { term: 'Development period', description: 'In this experiment, development uses data after the fixed 2022\u20132024 window. It is later in time than the window labeled holdout.' },
  { term: 'Holdout period', description: 'The fixed 2022\u20132024 historical window. It is an older retrospective comparison slice, not a forward-in-time test against later data.' },
  { term: 'Out-of-sample', description: 'Here this only means that the 2022\u20132024 window is separated from the later development data in this calculation. The code cannot establish whether people had already inspected this period while choosing the experiment.' },
  { term: 'Score bucket', description: 'A range of SetupScan scores (e.g. 75-79, 95-100) grouped together so trades that scored similarly can be compared as a set.' },
  { term: 'Trade count', description: 'How many trades fell into a bucket, period, or variant. Small counts make any other statistic less reliable.' },
  { term: 'Win rate', description: 'The share of trades that closed as winners. On its own it doesn\u2019t say how big the wins or losses were.' },
  { term: 'Profit factor', description: 'Total profit from winners divided by total loss from losers. Above 1 means winners outweighed losers over this sample.' },
  { term: 'Expectancy', description: 'The average result per trade, in R-multiples, before real-world costs and slippage.' },
  { term: 'Max drawdown', description: 'The worst peak-to-trough decline in cumulative R across the trade sequence \u2014 the roughest stretch this history included.' },
]

const FROZEN_SCORE_HOW_TO_READ = [
  'The scoring rules are frozen for this calculation. The fixed holdout slice is 2022\u20132024, while development uses later data, so this is a retrospective comparison and not a forward-in-time test.',
  'The code keeps the two date ranges separate, but it cannot show whether the older 2022\u20132024 period was previously inspected when this experiment was selected. Treat it as a historical comparison, not as an untouched future-period holdout.',
  'Comparing development to holdout side by side shows whether the bucket-to-outcome pattern looks similar in both, not just in one.',
  'A bucket or variant with few trades in either period is less reliable than one with many, even if its numbers look stronger.',
  'This is historical research only. It does not prove future performance, and it does not automatically change production scoring, thresholds, or trade construction.',
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

function BucketTable({ title, buckets, monotonicity }) {
  return (
    <div className="robustness-section">
      <h3>{title}</h3>
      <div className="robustness-table-wrap">
        <table className="robustness-table">
          <thead><tr><th>Bucket</th><th>Trades</th><th>Win rate</th><th>PF</th><th>Expectancy</th><th>Avg R</th><th>Median R</th><th>Total R</th><th>Max DD</th><th>Avg hold</th></tr></thead>
          <tbody>{buckets.map((bucket) => { const hasTrades = hasPerformanceObservations(bucket.overall); return <tr key={bucket.label}><td>{bucket.label}</td><td>{bucket.overall.tradeCount}</td><td>{hasTrades ? formatPercent(bucket.overall.winRate) : '—'}</td><td>{hasTrades ? formatPf(bucket.overall.profitFactor) : '—'}</td><td>{hasTrades ? formatR(bucket.overall.expectancy) : '—'}</td><td>{hasTrades ? formatR(bucket.overall.averageR) : '—'}</td><td>{hasTrades ? formatR(bucket.overall.medianR) : '—'}</td><td>{hasTrades ? formatR(bucket.overall.totalR) : '—'}</td><td>{hasTrades ? formatR(bucket.overall.maximumDrawdown) : '—'}</td><td>{hasTrades ? `${bucket.overall.averageHoldingTime.toFixed(0)}m` : '—'}</td></tr>})}</tbody>
        </table>
      </div>
      <p className="robustness-muted">
        {monotonicity.evaluable
          ? `Average-R vs. bucket-order correlation: ${monotonicity.averageRCorrelation.toFixed(2)} · Win-rate correlation: ${monotonicity.winRateCorrelation.toFixed(2)} · Monotonically non-decreasing average R across all buckets: ${monotonicity.monotonicIncreasing ? 'YES' : 'NO'}. This is a descriptive correlation, not a claim of a validated edge.`
          : 'Not enough populated buckets to assess monotonicity.'}
      </p>
    </div>
  )
}

function BucketComparisonTable({ holdoutBuckets, developmentBuckets }) {
  return (
    <div className="robustness-section">
      <h3>Development vs. holdout — bucket by bucket</h3>
      {holdoutBuckets.map((holdoutBucket, index) => {
        const developmentBucket = developmentBuckets[index]
        return (
          <div key={holdoutBucket.label} className="robustness-table-wrap">
            <p className="robustness-muted">Bucket {holdoutBucket.label}</p>
            <table className="robustness-table">
              <thead><tr><th>Period</th><th>Trades</th><th>Win rate</th><th>PF</th><th>Expectancy</th><th>Total R</th><th>Max DD</th><th>Avg hold</th></tr></thead>
              <tbody>
                <tr><td>Development</td><MetricCells metrics={developmentBucket.overall} /></tr>
                <tr><td>Holdout</td><MetricCells metrics={holdoutBucket.overall} /></tr>
              </tbody>
            </table>
          </div>
        )
      })}
    </div>
  )
}

function VariantComparisonTable({ title, developmentSummary, holdoutSummary }) {
  return (
    <div className="robustness-section">
      <h3>{title}</h3>
      <div className="robustness-table-wrap">
        <table className="robustness-table">
          <thead><tr><th>Period</th><th>Trades</th><th>Win rate</th><th>PF</th><th>Expectancy</th><th>Total R</th><th>Max DD</th><th>Avg hold</th></tr></thead>
          <tbody>
            <tr><td>Development</td><MetricCells metrics={developmentSummary.overall} /></tr>
            <tr><td>Holdout</td><MetricCells metrics={holdoutSummary.overall} /></tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function FrozenScoreHoldoutLab({ datasets }) {
  const available = datasets.filter((dataset) => dataset.status === 'AVAILABLE')
  const rawSeriesBySymbol = useMemo(() => Object.fromEntries(available.map((dataset) => [dataset.symbol, dataset.data.candles])), [available])
  const hasAllSymbols = ['SPY', 'QQQ', 'IWM'].every((symbol) => rawSeriesBySymbol[symbol]?.length)

  const research = useMemo(() => (hasAllSymbols ? runFrozenScoreHoldoutResearch(rawSeriesBySymbol) : null), [hasAllSymbols, rawSeriesBySymbol])
  const holdoutMonotonicity = useMemo(() => (research ? assessScoreMonotonicity(research.holdoutBuckets) : { evaluable: false }), [research])
  const developmentMonotonicity = useMemo(() => (research ? assessScoreMonotonicity(research.developmentBuckets) : { evaluable: false }), [research])

  const takeawayText = useMemo(() => {
    if (!research) return null
    const { holdoutBaseline, developmentBaseline, holdoutRange, developmentRange } = research
    if (!holdoutBaseline.overall.tradeCount || !developmentBaseline.overall.tradeCount) {
      return 'One of the two periods did not have enough frozen-baseline trades in this sample to compare development against holdout results.'
    }
    const winRateDelta = holdoutBaseline.overall.winRate - developmentBaseline.overall.winRate
    const expectancyDelta = holdoutBaseline.overall.expectancy - developmentBaseline.overall.expectancy
    const direction = (value) => (value > 0.001 ? 'higher' : value < -0.001 ? 'lower' : 'about the same')
    const monotonicitySummary = holdoutMonotonicity.evaluable && developmentMonotonicity.evaluable
      ? ` Score-bucket order correlated with average R at ${developmentMonotonicity.averageRCorrelation.toFixed(2)} in development and ${holdoutMonotonicity.averageRCorrelation.toFixed(2)} in the holdout window.`
      : ' At least one period did not have enough populated score buckets to assess a bucket-order correlation.'
    return `Using the frozen 75+ baseline rule, the holdout window (${formatDate(holdoutRange.start)} \u2013 ${formatDate(holdoutRange.end)}, ${holdoutBaseline.overall.tradeCount} trades) showed a win rate ${direction(winRateDelta)} than the development window (${formatDate(developmentRange.start)} \u2013 ${formatDate(developmentRange.end)}, ${developmentBaseline.overall.tradeCount} trades), and expectancy ${direction(expectancyDelta)}.${monotonicitySummary} This compares two historical slices of the same frozen rule set; it does not prove the rules will perform the same way going forward, and no bucket, period, or variant is identified here as proven or validated.`
  }, [research, holdoutMonotonicity, developmentMonotonicity])

  return (
    <section className="robustness-lab panel">
      <div className="panel-heading compact">
        <div><p className="eyebrow">RESEARCH EXPERIMENT #3A</p><h2>Research Experiment — Frozen Score Holdout</h2></div>
        <span className="coming-soon">RESEARCH ONLY · DOES NOT AFFECT PAPER TRADING OR SCORING</span>
      </div>
      <p className="robustness-disclaimer">
        Compares the existing, unmodified SetupScan score/threshold relationship across an older retrospective 2022–2024 window
        and later development data, using the existing baseline entry/exit methodology on synchronized SPY/QQQ/IWM data. This is not
        a forward-in-time test, and the code cannot establish that the older window was never previously inspected. No scoring weights, thresholds,
        or trade construction rules were changed or optimized for this test. Descriptive research only — does not change production
        scoring, paper trading, the Render worker, or Supabase. No winner is auto-selected.
      </p>
      {!hasAllSymbols ? (
        <ResearchDataStatus datasets={datasets} requiredSymbols={['SPY', 'QQQ', 'IWM']} />
      ) : (
        <>
          <ResearchFirstAnswer
            question="How did the existing frozen score rule compare across an older 2022–2024 slice and later development data?"
            sample={`${research.developmentBaseline.overall.tradeCount} development trades and ${research.holdoutBaseline.overall.tradeCount} holdout trades.`}
            takeaway={takeawayText}
            limitation="This is a retrospective historical comparison, not a forward-in-time holdout. It does not prove future performance."
          />
          <LearningDetails label="More details">
          <div className="robustness-section">
            <h3>Development vs. holdout windows</h3>
            <div className="robustness-table-wrap">
              <table className="robustness-table">
                <thead><tr><th>Window</th><th>Date range</th><th>Candles</th></tr></thead>
                <tbody>
                  <tr><td>Development</td><td>{formatDate(research.developmentRange.start)} – {formatDate(research.developmentRange.end)}</td><td>{research.developmentRange.candleCount}</td></tr>
                  <tr><td>Holdout</td><td>{formatDate(research.holdoutRange.start)} – {formatDate(research.holdoutRange.end)}</td><td>{research.holdoutRange.candleCount}</td></tr>
                </tbody>
              </table>
            </div>
          </div>

          <BucketTable title="Frozen score buckets — development period" buckets={research.developmentBuckets} monotonicity={developmentMonotonicity} />
          <BucketTable title="Frozen score buckets — holdout period" buckets={research.holdoutBuckets} monotonicity={holdoutMonotonicity} />
          <BucketComparisonTable holdoutBuckets={research.holdoutBuckets} developmentBuckets={research.developmentBuckets} />

          <VariantComparisonTable
            title="Baseline (75+ bullish) — development vs. holdout"
            developmentSummary={research.developmentBaseline}
            holdoutSummary={research.holdoutBaseline}
          />
          <AmbiguousCandleDisclosure label="Development baseline" metrics={research.developmentBaseline.overall} />
          <AmbiguousCandleDisclosure label="Retrospective comparison baseline" metrics={research.holdoutBaseline.overall} />
          <VariantComparisonTable
            title="RV-confirmed (75+ AND relative-value confirmation) — development vs. holdout"
            developmentSummary={research.developmentRvConfirmed}
            holdoutSummary={research.holdoutRvConfirmed}
          />

          </LearningDetails>
        </>
      )}
      <LearningDetails label="What does this mean?">
        <MetricsGlossary title="Frozen Score Holdout terms" intro="Plain-English explanations for terms used in this test." definitions={FROZEN_SCORE_DEFINITIONS} />
      </LearningDetails>
      <LearningDetails label="How was this tested?">
        <HowToReadResults title="How to read this test" items={FROZEN_SCORE_HOW_TO_READ} />
      </LearningDetails>
      <p className="research-note">Descriptive research only, on historical data. The holdout does not prove future performance or change production scoring.</p>
    </section>
  )
}
