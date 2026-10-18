import React, { useMemo } from 'react'
import { runWalkForwardRegimeResearch } from './walkForwardRegimeBacktest.js'
import { HowToReadResults, LearningDetails, MetricsGlossary, ResearchFirstAnswer } from './MetricsGlossary.jsx'
import { hasPerformanceObservations } from './labEvidence.js'
import { InspectableBarChart, TrainingTestTimeline } from './LabsCharts.jsx'
import { buildWalkForwardRegimeExpectancyObservations, buildWalkForwardTimelineRows } from './labChartData.js'
import { AmbiguousCandleDisclosure, ResearchDataStatus } from './LabEvidence.jsx'
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
              <tbody>{window.volatilityGroups.map((group) => <tr key={group.label}><td>{group.label}</td><MetricCells metrics={group.baseline.overall} /><td>{group.baseline.overall.tradeCount > 0 && group.baseline.smallSample ? `< ${smallSampleThreshold}` : '—'}</td></tr>)}</tbody>
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
          <tbody>{groups.map((group) => <tr key={group.label}><td>{group.label}</td><MetricCells metrics={group.baseline.overall} /><td>{group.baseline.overall.tradeCount > 0 && group.baseline.smallSample ? `< ${smallSampleThreshold}` : '—'}</td></tr>)}</tbody>
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
  const timelineRows = useMemo(() => buildWalkForwardTimelineRows(research?.windows), [research])
  const regimeExpectancyObservations = useMemo(
    () => buildWalkForwardRegimeExpectancyObservations(research?.evidenceTable),
    [research],
  )

  const takeawayText = useMemo(() => {
    if (!research) return null
    const { criticalTest, pooledVolatilityGroups } = research
    const highGroup = pooledVolatilityGroups.find((group) => group.label === 'High')
    const highDescription = !highGroup || !highGroup.baseline.overall.tradeCount
      ? 'Not enough high-volatility test-period trades were available in this sample to describe that regime.'
      : `Pooled across all walk-forward test periods, the high-volatility regime had ${highGroup.baseline.overall.tradeCount} baseline trades with expectancy ${formatR(highGroup.baseline.overall.expectancy)}${highGroup.baseline.smallSample ? ' (flagged as a small sample)' : ''}. Year by year, high-volatility expectancy was ${criticalTest.highVolatilityPositiveCount > criticalTest.highVolatilityNegativeCount
      ? 'positive in more test years than negative'
      : criticalTest.highVolatilityNegativeCount > criticalTest.highVolatilityPositiveCount
        ? 'negative in more test years than positive'
        : 'split evenly between positive and negative across test years'}.`
    const mediumVsLow = criticalTest.comparableYearCount === 0
      ? 'There were 0 comparable test years with valid trades in both low- and medium-volatility regimes, so neither regime is counted as outperforming the other.'
      : `Among ${criticalTest.comparableYearCount} comparable test years, medium-volatility expectancy was higher in ${criticalTest.mediumExceedsLowCount}, low-volatility expectancy was higher in ${criticalTest.lowExceedsMediumCount}, and the two were tied in ${criticalTest.comparableYearCount - criticalTest.mediumExceedsLowCount - criticalTest.lowExceedsMediumCount}.`
    return `${highDescription} ${mediumVsLow}. This describes how the frozen scanner behaved when volatility regimes were classified sequentially, using only training-period information; it does not prove a volatility-based edge and does not identify a winning regime or variant.`
  }, [research])

  return (
    <section className="robustness-lab panel">
      <div className="panel-heading compact">
        <div><p className="eyebrow">RESEARCH EXPERIMENT #6</p><h2>Research Experiment — Walk-Forward Regime Validation</h2></div>
        <span className="coming-soon">RESEARCH ONLY · DOES NOT AFFECT PAPER TRADING OR SCORING</span>
      </div>
      {!hasAllSymbols ? (
        <ResearchDataStatus datasets={datasets} requiredSymbols={['SPY', 'QQQ', 'IWM']} />
      ) : (
        <>
          <ResearchFirstAnswer
            question="Did the frozen baseline show similar results in sequential test windows, with each volatility boundary set using earlier data?"
            sample={`${research.combinedBaseline.overall.tradeCount} baseline trades across the walk-forward test periods.`}
            takeaway={takeawayText}
            limitation="Sequential historical tests reduce look-ahead in classification; they do not prove future performance."
          />
          <AmbiguousCandleDisclosure label="Combined baseline" metrics={research.combinedBaseline.overall} />
          <section className="research-primary-visual">
            <TrainingTestTimeline windows={timelineRows} />
            <p className="robustness-muted">Training data is used to calculate volatility cutoffs, then the later test data is evaluated using those cutoffs. These historical periods may have been explored repeatedly, so they are not untouched future evidence.</p>
            <InspectableBarChart
              id="walk-forward-regime-expectancy"
              title="How did test-period expectancy vary by volatility regime?"
              question="Each point is the existing baseline expectancy for one walk-forward test year and regime. Counts are shown with every value; a missing or empty regime is a dash, while a genuine zero with trades is plotted on the zero line."
              observations={regimeExpectancyObservations}
              series={[
                { key: 'low', label: 'Low volatility', metricLabel: 'Expectancy (R/trade)' },
                { key: 'medium', label: 'Medium volatility', metricLabel: 'Expectancy (R/trade)' },
                { key: 'high', label: 'High volatility', metricLabel: 'Expectancy (R/trade)' },
              ]}
              sampleThreshold={research.options.smallSampleThreshold}
              xAxisLabel="Test year"
              formatValue={formatR}
              layout="grouped"
            />
          </section>
          <LearningDetails label="More details">
          <WindowBaselineTable windows={research.windows} />
          <WindowVolatilityGroups windows={research.windows} smallSampleThreshold={research.options.smallSampleThreshold} />
          <PooledVolatilityGroups groups={research.pooledVolatilityGroups} smallSampleThreshold={research.options.smallSampleThreshold} />

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

          </LearningDetails>
        </>
      )}
      <LearningDetails label="What does this mean?">
        <MetricsGlossary title="Walk-Forward terms" intro="Plain-English explanations for terms used in this test." definitions={WALK_FORWARD_DEFINITIONS} />
      </LearningDetails>
      <LearningDetails label="How was this tested?">
        <HowToReadResults title="How to read this test" items={WALK_FORWARD_HOW_TO_READ} />
      </LearningDetails>
      <LearningDetails label="Research scope and safeguards"><p className="robustness-disclaimer">The scanner rule stays frozen. This experiment classifies already-frozen baseline/RV-confirmed trades using volatility boundaries fixed from earlier training data only. No result automatically selects a winner or changes production scoring, paper trading, workers, or stored records.</p></LearningDetails>
      <p className="research-note">Descriptive historical research only; walk-forward results do not guarantee future performance.</p>
    </section>
  )
}
