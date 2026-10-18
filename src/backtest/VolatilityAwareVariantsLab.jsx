import React, { useMemo } from 'react'
import { runVolatilityAwareVariantsResearch, variantDefinitions } from './volatilityAwareVariantsBacktest.js'
import { HowToReadResults, LearningDetails, MetricsGlossary, ResearchFirstAnswer } from './MetricsGlossary.jsx'
import { hasPerformanceObservations } from './labEvidence.js'
import { AmbiguousCandleDisclosure, ResearchDataStatus } from './LabEvidence.jsx'
import { InspectableBarChart } from './LabsCharts.jsx'
import { buildVolatilityAwareControlDifferenceObservations, buildVolatilityAwareExpectancyObservations } from './labChartData.js'
import './robustness.css'

const formatPercent = (value) => `${(value * 100).toFixed(1)}%`
const formatR = (value) => (value === Infinity || value === null ? '∞' : `${value.toFixed(2)}R`)
const formatPf = (value) => (value === Infinity || value === null ? '∞' : value.toFixed(2))
const formatDate = (value) => (value ? new Date(value).toLocaleDateString('en-US', { timeZone: 'UTC' }) : '—')
const formatSigned = (value) => (value === null || value === undefined ? '—' : `${value >= 0 ? '+' : ''}${value.toFixed(2)}`)

const VOLATILITY_AWARE_DEFINITIONS = [
  { term: 'Control', description: 'The existing, unmodified 75+ bullish baseline rule, applied to the same walk-forward test periods and volatility boundaries as the other variants for comparison.' },
  { term: 'Skip High Vol', description: 'A predefined variant that takes the same 75+ signals as Control in Low/Medium volatility, but takes no new trades at all when a bar is classified High volatility (using that window\u2019s frozen, training-only boundaries).' },
  { term: 'High Vol >=90 / >=95', description: 'Predefined variants that still take High-volatility trades, but only when the score is 90+ (or 95+) rather than 75+. Low/Medium volatility signals are unaffected.' },
  { term: 'High volatility (per this experiment)', description: 'A test-period bar whose trailing realized volatility falls in the top third of that window\u2019s own training-period volatility observations \u2014 not a fixed number, and never based on the test period itself.' },
  { term: 'Pooled results', description: 'A variant\u2019s trades from every walk-forward test period combined together.' },
  { term: 'Diff vs. Control', description: 'How a variant\u2019s overall metrics differ from Control\u2019s, in the same units (e.g. an expectancy diff of +0.05R means 0.05R higher than Control over this sample).' },
  { term: 'Consistency (positive/negative periods)', description: 'How many of the walk-forward test years had positive vs. negative expectancy for that variant \u2014 a way to see whether a result held up across periods or came from one strong year.' },
  { term: 'Trade count, win rate, profit factor, expectancy, max drawdown', description: 'Trade count is how many trades occurred; win rate is the share that won; profit factor is total wins divided by total losses; expectancy is the average R-multiple result per trade; max drawdown is the worst peak-to-trough decline in cumulative R.' },
]

const VOLATILITY_AWARE_HOW_TO_READ = [
  'These four variants (Control plus three volatility-aware rules) were all defined in advance, before seeing this experiment\u2019s results — none were chosen or tuned afterward.',
  '\u201cHigh volatility\u201d is defined the same way as the Walk-Forward Regime Validation experiment: relative to each window\u2019s own training-period history, not a fixed threshold.',
  'The variants are shown side by side across the exact same walk-forward test periods and boundaries \u2014 no variant is selected as a winner here.',
  'Some test periods have very few trades for a given variant; check the per-window and consistency tables, not just the pooled totals, before drawing conclusions.',
  'This is historical research only. No volatility filter has been changed or deployed, and results here do not automatically change production scoring, paper trading, the Render worker, or Supabase.',
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

function VariantDefinitionsList() {
  return (
    <div className="robustness-section">
      <h3>Predefined variants</h3>
      <ul className="how-to-read-list">
        {variantDefinitions.map((variant) => (
          <li key={variant.key}>
            <strong>{variant.label}</strong>: {variant.minimumScoreByRegime
              ? `Low ${variant.minimumScoreByRegime.Low ?? '—'}+, Medium ${variant.minimumScoreByRegime.Medium ?? '—'}+, High ${variant.minimumScoreByRegime.High === null ? 'no new trades' : `${variant.minimumScoreByRegime.High}+`}`
              : 'Same 75+ rule in every volatility regime (existing baseline, unchanged).'}
          </li>
        ))}
      </ul>
    </div>
  )
}

function PooledVariantsTable({ pooled }) {
  return (
    <div className="robustness-section">
      <h3>Pooled results (all test periods combined)</h3>
      <div className="robustness-table-wrap">
        <table className="robustness-table">
          <thead><tr><th>Variant</th><th>Trades</th><th>Win rate</th><th>PF</th><th>Expectancy</th><th>Total R</th><th>Max DD</th><th>Avg hold</th></tr></thead>
          <tbody>{pooled.map((variant) => <tr key={variant.key}><td>{variant.label}</td><MetricCells metrics={variant.summary.overall} /></tr>)}</tbody>
        </table>
      </div>
    </div>
  )
}

function WindowsVariantsTable({ windows }) {
  return (
    <div className="robustness-section">
      <h3>Variants by walk-forward window (test period only)</h3>
      {windows.map((window) => (
        <details key={window.label} className="robustness-section">
          <summary>{window.label} — {window.testYear} · test {formatDate(window.testRealizedStart)} – {formatDate(window.testRealizedEnd)}</summary>
          <div className="robustness-table-wrap">
            <table className="robustness-table">
              <thead><tr><th>Variant</th><th>Trades</th><th>Win rate</th><th>PF</th><th>Expectancy</th><th>Total R</th><th>Max DD</th><th>Avg hold</th></tr></thead>
              <tbody>{window.variants.map((variant) => <tr key={variant.key}><td>{variant.label}</td><MetricCells metrics={variant.summary.overall} /></tr>)}</tbody>
            </table>
          </div>
        </details>
      ))}
    </div>
  )
}

function DiffsTable({ windows }) {
  const nonControl = variantDefinitions.filter((variant) => variant.key !== 'control')
  return (
    <div className="robustness-section">
      <h3>Diff vs. Control, by window</h3>
      <div className="robustness-table-wrap">
        <table className="robustness-table">
          <thead><tr><th>Window</th><th>Variant</th><th>Trade count diff</th><th>Win rate diff</th><th>PF diff</th><th>Expectancy diff</th><th>Total R diff</th><th>Max DD diff</th></tr></thead>
          <tbody>{windows.flatMap((window) => nonControl.map((variant) => {
            const diffEntry = window.diffsVsControl.find((entry) => entry.key === variant.key)
            if (!diffEntry) return null
            const { diff } = diffEntry
            const hasBothSamples = window.variants.find((entry) => entry.key === 'control')?.summary.overall.tradeCount > 0
              && window.variants.find((entry) => entry.key === variant.key)?.summary.overall.tradeCount > 0
            return (
              <tr key={`${window.label}-${variant.key}`}>
                <td>{window.label}</td>
                <td>{variant.label}</td>
                <td>{formatSigned(diff.tradeCountChange)}</td>
                <td>{hasBothSamples ? `${diff.winRateChange >= 0 ? '+' : ''}${(diff.winRateChange * 100).toFixed(1)}%` : '—'}</td>
                <td>{!hasBothSamples || diff.profitFactorChange === null ? '—' : formatSigned(diff.profitFactorChange)}</td>
                <td>{hasBothSamples ? `${diff.expectancyChange >= 0 ? '+' : ''}${diff.expectancyChange.toFixed(2)}R` : '—'}</td>
                <td>{hasBothSamples ? `${diff.totalRChange >= 0 ? '+' : ''}${diff.totalRChange.toFixed(2)}R` : '—'}</td>
                <td>{hasBothSamples ? `${diff.maxDrawdownChange >= 0 ? '+' : ''}${diff.maxDrawdownChange.toFixed(2)}R` : '—'}</td>
              </tr>
            )
          }))}</tbody>
        </table>
      </div>
    </div>
  )
}

function ConsistencyTable({ consistency }) {
  return (
    <div className="robustness-section">
      <h3>Consistency across test periods</h3>
      <div className="robustness-table-wrap">
        <table className="robustness-table">
          <thead><tr><th>Variant</th><th>Positive periods</th><th>Negative periods</th><th>Years with trades (mean/median)</th><th>Mean yearly expectancy</th><th>Median yearly expectancy</th><th>Pooled expectancy</th><th>Pooled PF</th><th>Pooled max DD</th></tr></thead>
          <tbody>{consistency.map((row) => { const hasPooledTrades = row.pooledTradeCount > 0; return <tr key={row.key}><td>{row.label}</td><td>{row.positivePeriods}</td><td>{row.negativePeriods}</td><td>{row.expectancyYearsWithTrades}</td><td>{row.meanYearlyExpectancy === null ? '—' : formatR(row.meanYearlyExpectancy)}</td><td>{row.medianYearlyExpectancy === null ? '—' : formatR(row.medianYearlyExpectancy)}</td><td>{hasPooledTrades ? formatR(row.pooledExpectancy) : '—'}</td><td>{hasPooledTrades ? formatPf(row.pooledProfitFactor) : '—'}</td><td>{hasPooledTrades ? formatR(row.pooledMaxDrawdown) : '—'}</td></tr>})}</tbody>
        </table>
      </div>
    </div>
  )
}

export function VolatilityAwareVariantsLab({ datasets }) {
  const available = datasets.filter((dataset) => dataset.status === 'AVAILABLE')
  const rawSeriesBySymbol = useMemo(() => Object.fromEntries(available.map((dataset) => [dataset.symbol, dataset.data.candles])), [available])
  const hasAllSymbols = ['SPY', 'QQQ', 'IWM'].every((symbol) => rawSeriesBySymbol[symbol]?.length)

  const research = useMemo(() => (hasAllSymbols ? runVolatilityAwareVariantsResearch(rawSeriesBySymbol) : null), [hasAllSymbols, rawSeriesBySymbol])
  const variantExpectancyObservations = useMemo(() => buildVolatilityAwareExpectancyObservations(research?.windows), [research])
  const controlDifferenceObservations = useMemo(() => buildVolatilityAwareControlDifferenceObservations(research?.windows), [research])
  const variantSeries = useMemo(() => variantDefinitions.map((variant) => ({
    key: variant.key,
    label: variant.label,
    metricLabel: 'Expectancy (R/trade)',
  })), [])
  const differenceSeries = useMemo(() => variantDefinitions.filter((variant) => variant.key !== 'control').map((variant) => ({
    key: variant.key,
    label: variant.label,
    metricLabel: 'Expectancy difference (R/trade)',
    countLabel: 'Trades (variant / Control)',
  })), [])

  const takeawayText = useMemo(() => {
    if (!research) return null
    const control = research.consistency.find((row) => row.key === 'control')
    const others = research.consistency.filter((row) => row.key !== 'control' && row.pooledTradeCount > 0)
    if (!control) return 'Not enough pooled trades were available in this sample to compare the variants.'
    if (!control.pooledTradeCount) return 'Control has no resolved pooled trades, so performance comparisons with the variants are unavailable.'
    if (!others.length) return 'No volatility-aware variants had resolved pooled trades, so their performance comparisons are unavailable.'
    const better = others.filter((row) => row.pooledExpectancy > control.pooledExpectancy).length
    const worse = others.filter((row) => row.pooledExpectancy < control.pooledExpectancy).length
    const mixedNote = better > 0 && worse > 0
      ? 'Among variants with trades, pooled expectancy was mixed relative to Control \u2014 some pooled higher, others lower.'
      : better > 0
        ? 'Every volatility-aware variant with trades pooled a higher expectancy than Control in this sample.'
        : worse > 0
          ? 'Every volatility-aware variant with trades pooled a lower expectancy than Control in this sample.'
          : 'Pooled expectancy was effectively the same among populated variants in this sample.'
    const noTradeVariants = research.consistency.filter((row) => row.pooledTradeCount === 0).map((row) => row.label)
    const inconsistentVariants = others.filter((row) => row.positivePeriods > 0 && row.negativePeriods > 0).map((row) => row.label)
    return `Control pooled ${control.pooledExpectancy >= 0 ? '+' : ''}${control.pooledExpectancy.toFixed(2)}R expectancy across all test periods. ${mixedNote}${noTradeVariants.length ? ` Performance for ${noTradeVariants.join(', ')} is unavailable because there were no pooled trades.` : ''}${inconsistentVariants.length ? ` ${inconsistentVariants.join(', ')} had both positive and negative expectancy years, so their pooled result did not come from consistently positive periods.` : ''} This compares four predefined, non-optimized rules against the same frozen walk-forward test periods; it does not identify a best or validated variant, and no volatility filter has been changed or deployed based on this comparison.`
  }, [research])

  return (
    <section className="robustness-lab panel">
      <div className="panel-heading compact">
        <div><p className="eyebrow">RESEARCH EXPERIMENT #7</p><h2>Research Experiment — Volatility-Aware Variants</h2></div>
        <span className="coming-soon">RESEARCH ONLY · DOES NOT AFFECT PAPER TRADING OR SCORING</span>
      </div>
      {!hasAllSymbols ? (
        <ResearchDataStatus datasets={datasets} requiredSymbols={['SPY', 'QQQ', 'IWM']} />
      ) : (
        <>
          <ResearchFirstAnswer
            question="How did three predefined volatility-aware entry rules compare with the unchanged Control across walk-forward test periods?"
            sample={`${research.pooled.find((variant) => variant.key === 'control')?.summary.overall.tradeCount ?? 'unavailable'} Control trades across the pooled test periods.`}
            takeaway={takeawayText}
            limitation="Variants are predefined research only; no live filter is changed or automatically adapted."
          />
          <AmbiguousCandleDisclosure label="Pooled Control" metrics={research.pooled.find((variant) => variant.key === 'control')?.summary.overall} />
          <section className="research-primary-visual">
          <InspectableBarChart
            id="volatility-variant-expectancy"
            title="Expectancy across walk-forward test windows"
            question="Grouped bars compare each predefined variant within the same actual test window. The count beside each value shows how many trades support it; zero expectancy with trades is marked on the zero line, while an empty window is shown as unavailable."
            observations={variantExpectancyObservations}
            series={variantSeries}
            sampleThreshold={research.options.smallSampleThreshold}
            sampleUnit="trades"
            xAxisLabel="Walk-forward test window"
            formatValue={(value) => `${value >= 0 ? '+' : ''}${value.toFixed(2)}R`}
            layout="grouped"
          />
          <InspectableBarChart
            id="volatility-variant-control-difference"
            title="Expectancy difference versus Control"
            question="These diverging bars show each variant’s existing expectancy difference from Control in the same test window. Positive values extend right and negative values left. A difference is available only when both that variant and Control have trades; counts show variant / Control."
            observations={controlDifferenceObservations}
            series={differenceSeries}
            sampleThreshold={research.options.smallSampleThreshold}
            sampleUnit="trades"
            xAxisLabel="Walk-forward test window"
            formatValue={(value) => `${value >= 0 ? '+' : ''}${value.toFixed(2)}R`}
            layout="diverging"
          />
          </section>
          <p className="research-note">Expectancy is the average result per trade, measured in R (multiples of the trade’s initial risk). “High volatility” is classified using each window’s training-period boundaries. These are historical, repeatedly explored research comparisons; repeated exploration can make apparent test results less independent. They do not establish future profitability.</p>
          <LearningDetails label="More details">
          <VariantDefinitionsList />
          <PooledVariantsTable pooled={research.pooled} />
          <WindowsVariantsTable windows={research.windows} />
          <DiffsTable windows={research.windows} />
          <ConsistencyTable consistency={research.consistency} />

          </LearningDetails>
        </>
      )}
      <LearningDetails label="What does this mean?">
        <MetricsGlossary title="Volatility-Aware terms" intro="Plain-English explanations for terms used in this test." definitions={VOLATILITY_AWARE_DEFINITIONS} />
      </LearningDetails>
      <LearningDetails label="How was this tested?">
        <HowToReadResults title="How to read this test" items={VOLATILITY_AWARE_HOW_TO_READ} />
      </LearningDetails>
      <LearningDetails label="Research scope and safeguards"><p className="robustness-disclaimer">This compares four predefined, non-optimized entry rules against the same frozen walk-forward test periods and boundaries. The scanner score is unchanged; no thresholds were searched after results were seen. No result automatically selects a winner or changes production scoring, paper trading, workers, or stored records.</p></LearningDetails>
      <p className="research-note">Descriptive historical research only; comparisons do not guarantee future performance.</p>
    </section>
  )
}
