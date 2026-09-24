import React, { useMemo } from 'react'
import { runVolatilityAwareVariantsResearch, variantDefinitions } from './volatilityAwareVariantsBacktest.js'
import { HowToReadResults, MetricsGlossary, PlainEnglishTakeaway } from './MetricsGlossary.jsx'
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
            return (
              <tr key={`${window.label}-${variant.key}`}>
                <td>{window.label}</td>
                <td>{variant.label}</td>
                <td>{formatSigned(diff.tradeCountChange)}</td>
                <td>{diff.winRateChange >= 0 ? '+' : ''}{(diff.winRateChange * 100).toFixed(1)}%</td>
                <td>{diff.profitFactorChange === null ? '—' : formatSigned(diff.profitFactorChange)}</td>
                <td>{diff.expectancyChange >= 0 ? '+' : ''}{diff.expectancyChange.toFixed(2)}R</td>
                <td>{diff.totalRChange >= 0 ? '+' : ''}{diff.totalRChange.toFixed(2)}R</td>
                <td>{diff.maxDrawdownChange >= 0 ? '+' : ''}{diff.maxDrawdownChange.toFixed(2)}R</td>
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
          <thead><tr><th>Variant</th><th>Positive periods</th><th>Negative periods</th><th>Mean yearly expectancy</th><th>Median yearly expectancy</th><th>Pooled expectancy</th><th>Pooled PF</th><th>Pooled max DD</th></tr></thead>
          <tbody>{consistency.map((row) => <tr key={row.key}><td>{row.label}</td><td>{row.positivePeriods}</td><td>{row.negativePeriods}</td><td>{row.meanYearlyExpectancy === null ? '—' : formatR(row.meanYearlyExpectancy)}</td><td>{row.medianYearlyExpectancy === null ? '—' : formatR(row.medianYearlyExpectancy)}</td><td>{formatR(row.pooledExpectancy)}</td><td>{formatPf(row.pooledProfitFactor)}</td><td>{formatR(row.pooledMaxDrawdown)}</td></tr>)}</tbody>
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

  const takeawayText = useMemo(() => {
    if (!research) return null
    const control = research.consistency.find((row) => row.key === 'control')
    const others = research.consistency.filter((row) => row.key !== 'control')
    if (!control || !others.length) return 'Not enough pooled trades were available in this sample to compare the variants.'
    const better = others.filter((row) => row.pooledExpectancy > control.pooledExpectancy).length
    const worse = others.filter((row) => row.pooledExpectancy < control.pooledExpectancy).length
    const mixedNote = better > 0 && worse > 0
      ? 'Pooled expectancy was mixed relative to Control \u2014 some volatility-aware variants pooled higher, others lower.'
      : better > 0
        ? 'Every volatility-aware variant pooled a higher expectancy than Control in this sample.'
        : worse > 0
          ? 'Every volatility-aware variant pooled a lower expectancy than Control in this sample.'
          : 'Pooled expectancy was effectively the same across variants in this sample.'
    const inconsistentVariants = others.filter((row) => row.positivePeriods > 0 && row.negativePeriods > 0).map((row) => row.label)
    return `Control pooled ${control.pooledExpectancy >= 0 ? '+' : ''}${control.pooledExpectancy.toFixed(2)}R expectancy across all test periods. ${mixedNote}${inconsistentVariants.length ? ` ${inconsistentVariants.join(', ')} had both positive and negative expectancy years, so their pooled result did not come from consistently positive periods.` : ''} This compares four predefined, non-optimized rules against the same frozen walk-forward test periods; it does not identify a best or validated variant, and no volatility filter has been changed or deployed based on this comparison.`
  }, [research])

  return (
    <section className="robustness-lab panel">
      <div className="panel-heading compact">
        <div><p className="eyebrow">RESEARCH EXPERIMENT #7</p><h2>Research Experiment — Volatility-Aware Variants</h2></div>
        <span className="coming-soon">RESEARCH ONLY · DOES NOT AFFECT PAPER TRADING OR SCORING</span>
      </div>
      <p className="robustness-disclaimer">
        Tests whether three predefined, non-optimized volatility-aware entry rules change the Experiment #6 walk-forward results.
        The scanner scoring itself is completely frozen — variants only change which already-scored signals are accepted, based on
        the frozen Experiment #6 walk-forward volatility classification. Descriptive research only — no production files are
        touched, no variant is deployed, and no thresholds are searched or optimized after seeing results. No winner is
        auto-selected.
      </p>
      <div className="robustness-section"><MetricsGlossary title="What does this mean?" intro="Plain-English explanations for the terms used in this volatility-aware variants research." definitions={VOLATILITY_AWARE_DEFINITIONS} /></div>
      <div className="robustness-section"><HowToReadResults title="How to read this test" items={VOLATILITY_AWARE_HOW_TO_READ} /></div>
      {!hasAllSymbols ? (
        <div className="robustness-error">Waiting for real Alpaca historical data for SPY, QQQ, and IWM. This experiment never substitutes demo data.</div>
      ) : (
        <>
          <VariantDefinitionsList />
          <PooledVariantsTable pooled={research.pooled} />
          <WindowsVariantsTable windows={research.windows} />
          <DiffsTable windows={research.windows} />
          <ConsistencyTable consistency={research.consistency} />

          <div className="robustness-section"><PlainEnglishTakeaway>{takeawayText}</PlainEnglishTakeaway></div>

          <p className="research-note">
            Descriptive research only, on the same frozen walk-forward test periods as Experiment #6. Comparing predefined variants
            side by side does not guarantee future performance, and results here do not automatically change production scoring,
            paper trading, or any live volatility filter.
          </p>
        </>
      )}
    </section>
  )
}
