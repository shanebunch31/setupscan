import React, { useMemo } from 'react'
import { runFrozenScoreHoldoutResearch, assessScoreMonotonicity } from './frozenScoreHoldoutBacktest.js'
import { HowToReadResults, MetricsGlossary, PlainEnglishTakeaway } from './MetricsGlossary.jsx'
import './robustness.css'

const formatPercent = (value) => `${(value * 100).toFixed(1)}%`
const formatR = (value) => (value === Infinity ? '∞' : `${value.toFixed(2)}R`)
const formatPf = (value) => (value === Infinity ? '∞' : value.toFixed(2))
const formatDate = (value) => (value ? new Date(value).toLocaleDateString('en-US', { timeZone: 'UTC' }) : '—')

const FROZEN_SCORE_DEFINITIONS = [
  { term: 'Frozen score', description: 'The existing SetupScan scoring formula, used here exactly as-is \u2014 no weights, thresholds, or rules are changed or re-tuned for this test.' },
  { term: 'Development period', description: 'The portion of the historical data outside the holdout window \u2014 the comparison baseline against which the holdout results are checked.' },
  { term: 'Holdout period', description: 'A separate, fixed historical window carved out and analyzed on its own, using the same frozen scoring rules, to see if results look similar to the development period.' },
  { term: 'Out-of-sample', description: 'Results from data that was not used to build or tune the rules. Here, the holdout window plays that role \u2014 it\u2019s still historical, not a guarantee.' },
  { term: 'Score bucket', description: 'A range of SetupScan scores (e.g. 75-79, 95-100) grouped together so trades that scored similarly can be compared as a set.' },
  { term: 'Trade count', description: 'How many trades fell into a bucket, period, or variant. Small counts make any other statistic less reliable.' },
  { term: 'Win rate', description: 'The share of trades that closed as winners. On its own it doesn\u2019t say how big the wins or losses were.' },
  { term: 'Profit factor', description: 'Total profit from winners divided by total loss from losers. Above 1 means winners outweighed losers over this sample.' },
  { term: 'Expectancy', description: 'The average result per trade, in R-multiples, before real-world costs and slippage.' },
  { term: 'Max drawdown', description: 'The worst peak-to-trough decline in cumulative R across the trade sequence \u2014 the roughest stretch this history included.' },
]

const FROZEN_SCORE_HOW_TO_READ = [
  'The scoring rules are frozen \u2014 held completely unchanged \u2014 so that this test checks whether the existing rules hold up on data they were never adjusted around, instead of testing a rule set re-tuned to look good.',
  'The holdout period is kept separate from the development period on purpose: if a result only looks good in the period the rules were built around, that is a very different finding than a result that also holds up on a period set aside from that process.',
  'Comparing development to holdout side by side shows whether the bucket-to-outcome pattern looks similar in both, not just in one.',
  'A bucket or variant with few trades in either period is less reliable than one with many, even if its numbers look stronger.',
  'This is historical research only. It does not prove future performance, and it does not automatically change production scoring, thresholds, or trade construction.',
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

function BucketTable({ title, buckets, monotonicity }) {
  return (
    <div className="robustness-section">
      <h3>{title}</h3>
      <div className="robustness-table-wrap">
        <table className="robustness-table">
          <thead><tr><th>Bucket</th><th>Trades</th><th>Win rate</th><th>PF</th><th>Expectancy</th><th>Avg R</th><th>Median R</th><th>Total R</th><th>Max DD</th><th>Avg hold</th></tr></thead>
          <tbody>{buckets.map((bucket) => <tr key={bucket.label}><td>{bucket.label}</td><td>{bucket.overall.tradeCount}</td><td>{formatPercent(bucket.overall.winRate)}</td><td>{formatPf(bucket.overall.profitFactor)}</td><td>{formatR(bucket.overall.expectancy)}</td><td>{formatR(bucket.overall.averageR)}</td><td>{formatR(bucket.overall.medianR)}</td><td>{formatR(bucket.overall.totalR)}</td><td>{formatR(bucket.overall.maximumDrawdown)}</td><td>{bucket.overall.averageHoldingTime.toFixed(0)}m</td></tr>)}</tbody>
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
      <h3>Development vs. holdout \u2014 bucket by bucket</h3>
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
        Tests whether the existing, unmodified SetupScan score/threshold relationship survives on a genuinely held-out historical
        window, using the existing baseline entry/exit methodology on synchronized SPY/QQQ/IWM data. No scoring weights, thresholds,
        or trade construction rules were changed or optimized for this test. Descriptive research only — does not change production
        scoring, paper trading, the Render worker, or Supabase. No winner is auto-selected.
      </p>
      <div className="robustness-section"><MetricsGlossary title="What does this mean?" intro="Plain-English explanations for the terms used in this frozen-score holdout research." definitions={FROZEN_SCORE_DEFINITIONS} /></div>
      <div className="robustness-section"><HowToReadResults title="How to read this test" items={FROZEN_SCORE_HOW_TO_READ} /></div>
      {!hasAllSymbols ? (
        <div className="robustness-error">Waiting for real Alpaca historical data for SPY, QQQ, and IWM. This experiment never substitutes demo data.</div>
      ) : (
        <>
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
          <VariantComparisonTable
            title="RV-confirmed (75+ AND relative-value confirmation) — development vs. holdout"
            developmentSummary={research.developmentRvConfirmed}
            holdoutSummary={research.holdoutRvConfirmed}
          />

          <div className="robustness-section"><PlainEnglishTakeaway>{takeawayText}</PlainEnglishTakeaway></div>

          <p className="research-note">
            Descriptive research only, on historical data. Splitting into development and holdout windows does not prove future
            performance, and results here do not automatically change production scoring, thresholds, or trade construction.
          </p>
        </>
      )}
    </section>
  )
}
