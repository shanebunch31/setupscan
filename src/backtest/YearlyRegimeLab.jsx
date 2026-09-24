import React, { useMemo } from 'react'
import { runYearlyRegimeResearch } from './yearlyRegimeBacktest.js'
import { HowToReadResults, MetricsGlossary, PlainEnglishTakeaway } from './MetricsGlossary.jsx'
import './robustness.css'

const formatPercent = (value) => `${(value * 100).toFixed(1)}%`
const formatR = (value) => (value === Infinity ? '∞' : `${value.toFixed(2)}R`)
const formatPf = (value) => (value === Infinity ? '∞' : value.toFixed(2))
const formatDate = (value) => (value ? new Date(value).toLocaleDateString('en-US', { timeZone: 'UTC' }) : '—')
const formatSignedPercent = (value) => (value === null || value === undefined ? '—' : `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)}%`)

const YEARLY_REGIME_DEFINITIONS = [
  { term: 'Calendar year grouping', description: 'Trades are grouped by the UTC calendar year each signal occurred in, so results can be compared year over year using the same frozen scanner rules.' },
  { term: 'Baseline / RV-confirmed', description: '\u201cBaseline\u201d is the existing 75+ bullish signal. \u201cRV-confirmed\u201d additionally requires the Experiment #1 relative-value confirmation on the same candle. Neither rule is changed here.' },
  { term: 'Regime proxy (buy-and-hold return, volatility)', description: 'A simple, descriptive read of what the underlying symbol did that year \u2014 its buy-and-hold return and an annualized volatility estimate \u2014 shown for context, not used to filter or change any trade.' },
  { term: 'Small sample', description: 'A year or score bucket is flagged when it has fewer trades than a fixed threshold, since small counts make win rate, profit factor, and other stats far less reliable.' },
  { term: 'Score bucket / monotonicity', description: 'Buckets group trades by SetupScan score range; monotonicity checks whether average R rose step-by-step from lower to higher buckets within that year.' },
  { term: 'Trade count, win rate, profit factor, expectancy, max drawdown', description: 'Trade count is how many trades occurred; win rate is the share that won; profit factor is total wins divided by total losses; expectancy is the average R-multiple result per trade; max drawdown is the worst peak-to-trough decline in cumulative R.' },
]

const YEARLY_REGIME_HOW_TO_READ = [
  'This test checks whether the existing, frozen SetupScan scanner\u2019s results look similar from one calendar year to the next, rather than being driven by one unusually good or bad year.',
  'The buy-and-hold return and volatility proxy shown per year and per symbol are descriptive context about that year\u2019s market \u2014 they are not filters and do not change which trades are counted.',
  'Some years have far fewer trades than others; a year (or score bucket within a year) flagged as a small sample should be read with extra caution regardless of how its win rate or expectancy look.',
  'Differences between years describe what already happened in that specific period \u2014 they are not a forecast for any future year.',
  'This is historical research only. It does not change production scoring, thresholds, paper trading, or the live scanner.',
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

function YearlyVariantTable({ title, years, variantKey }) {
  return (
    <div className="robustness-section">
      <h3>{title}</h3>
      <div className="robustness-table-wrap">
        <table className="robustness-table">
          <thead><tr><th>Year</th><th>Date range</th><th>Trades</th><th>Win rate</th><th>PF</th><th>Expectancy</th><th>Total R</th><th>Max DD</th><th>Avg hold</th></tr></thead>
          <tbody>{years.map((year) => <tr key={year.year}><td>{year.year}</td><td>{formatDate(year.start)} – {formatDate(year.end)}</td><MetricCells metrics={year[variantKey].overall} /></tr>)}</tbody>
        </table>
      </div>
    </div>
  )
}

function YearBuckets({ year, smallSampleThreshold }) {
  const { monotonicity } = year
  return (
    <details className="robustness-section">
      <summary>{year.year} — score buckets</summary>
      <div className="robustness-table-wrap">
        <table className="robustness-table">
          <thead><tr><th>Bucket</th><th>Trades</th><th>Win rate</th><th>PF</th><th>Expectancy</th><th>Avg R</th><th>Max DD</th><th>Small sample</th></tr></thead>
          <tbody>{year.buckets.map((bucket) => <tr key={bucket.label}><td>{bucket.label}</td><td>{bucket.overall.tradeCount}</td><td>{formatPercent(bucket.overall.winRate)}</td><td>{formatPf(bucket.overall.profitFactor)}</td><td>{formatR(bucket.overall.expectancy)}</td><td>{formatR(bucket.overall.averageR)}</td><td>{formatR(bucket.overall.maximumDrawdown)}</td><td>{bucket.smallSample ? `< ${smallSampleThreshold}` : '—'}</td></tr>)}</tbody>
        </table>
      </div>
      <p className="robustness-muted">
        {monotonicity.evaluable
          ? `Average-R vs. bucket-order correlation: ${monotonicity.averageRCorrelation.toFixed(2)} · Win-rate correlation: ${monotonicity.winRateCorrelation.toFixed(2)} · Monotonically non-decreasing average R: ${monotonicity.monotonicIncreasing ? 'YES' : 'NO'}.`
          : 'Not enough populated buckets this year to assess monotonicity.'}
      </p>
    </details>
  )
}

function YearRegimeProxy({ years }) {
  const rows = years.flatMap((year) => Object.entries(year.regime).map(([symbol, proxy]) => ({ year: year.year, symbol, ...proxy })))
  return (
    <div className="robustness-section">
      <h3>Regime proxy — buy-and-hold return &amp; volatility, by year and symbol</h3>
      <div className="robustness-table-wrap">
        <table className="robustness-table">
          <thead><tr><th>Year</th><th>Symbol</th><th>Candles</th><th>Buy-and-hold return</th><th>Annualized volatility proxy</th></tr></thead>
          <tbody>{rows.map((row) => <tr key={`${row.year}-${row.symbol}`}><td>{row.year}</td><td>{row.symbol}</td><td>{row.candleCount}</td><td>{formatSignedPercent(row.buyHoldReturn)}</td><td>{row.annualizedVolatilityProxy === null ? '—' : formatPercent(row.annualizedVolatilityProxy)}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  )
}

export function YearlyRegimeLab({ datasets }) {
  const available = datasets.filter((dataset) => dataset.status === 'AVAILABLE')
  const rawSeriesBySymbol = useMemo(() => Object.fromEntries(available.map((dataset) => [dataset.symbol, dataset.data.candles])), [available])
  const hasAllSymbols = ['SPY', 'QQQ', 'IWM'].every((symbol) => rawSeriesBySymbol[symbol]?.length)

  const research = useMemo(() => (hasAllSymbols ? runYearlyRegimeResearch(rawSeriesBySymbol) : null), [hasAllSymbols, rawSeriesBySymbol])

  const takeawayText = useMemo(() => {
    if (!research) return null
    const withTrades = research.years.filter((year) => year.baseline.overall.tradeCount > 0)
    if (!withTrades.length) return 'No calendar year had baseline trades in this sample.'
    const winRates = withTrades.map((year) => year.baseline.overall.winRate)
    const expectancies = withTrades.map((year) => year.baseline.overall.expectancy)
    const minWinRate = Math.min(...winRates)
    const maxWinRate = Math.max(...winRates)
    const minExpectancy = Math.min(...expectancies)
    const maxExpectancy = Math.max(...expectancies)
    const smallSampleYears = withTrades.filter((year) => year.baseline.overall.tradeCount < research.options.smallSampleThreshold).map((year) => year.year)
    const positiveYears = withTrades.filter((year) => year.baseline.overall.expectancy > 0).length
    const negativeYears = withTrades.filter((year) => year.baseline.overall.expectancy < 0).length
    const mixedNote = positiveYears > 0 && negativeYears > 0
      ? 'Results were mixed across years \u2014 some years had positive baseline expectancy and others negative.'
      : positiveYears > 0
        ? 'Every year with baseline trades in this sample had positive expectancy.'
        : 'No year with baseline trades in this sample had positive expectancy.'
    return `Across ${withTrades.length} calendar year(s) with baseline trades, win rate ranged from ${formatPercent(minWinRate)} to ${formatPercent(maxWinRate)} and expectancy ranged from ${formatR(minExpectancy)} to ${formatR(maxExpectancy)}. ${mixedNote}${smallSampleYears.length ? ` ${smallSampleYears.join(', ')} had fewer than ${research.options.smallSampleThreshold} trades and should be read with extra caution.` : ''} This describes what happened historically in each year; it does not identify any year, bucket, or regime as proven, reliable, or predictive of future results.`
  }, [research])

  return (
    <section className="robustness-lab panel">
      <div className="panel-heading compact">
        <div><p className="eyebrow">RESEARCH EXPERIMENT #4</p><h2>Research Experiment — Yearly / Regime Stability</h2></div>
        <span className="coming-soon">RESEARCH ONLY · DOES NOT AFFECT PAPER TRADING OR SCORING</span>
      </div>
      <p className="robustness-disclaimer">
        Tests whether the existing, frozen SetupScan scanner behaves consistently across individual calendar years and across
        descriptive market regimes, using the existing baseline entry/exit methodology on synchronized SPY/QQQ/IWM data. No scoring
        weights, thresholds, or trade construction rules were changed for this test. Descriptive research only — does not change
        production scoring, paper trading, the Render worker, or Supabase. No winner is auto-selected.
      </p>
      <div className="robustness-section"><MetricsGlossary title="What does this mean?" intro="Plain-English explanations for the terms used in this yearly/regime research." definitions={YEARLY_REGIME_DEFINITIONS} /></div>
      <div className="robustness-section"><HowToReadResults title="How to read this test" items={YEARLY_REGIME_HOW_TO_READ} /></div>
      {!hasAllSymbols ? (
        <div className="robustness-error">Waiting for real Alpaca historical data for SPY, QQQ, and IWM. This experiment never substitutes demo data.</div>
      ) : (
        <>
          <YearlyVariantTable title="Baseline (75+ bullish) by year" years={research.years} variantKey="baseline" />
          <YearlyVariantTable title="RV-confirmed (75+ AND relative-value confirmation) by year" years={research.years} variantKey="rvConfirmed" />
          <YearRegimeProxy years={research.years} />
          <div className="robustness-section">
            <h3>Score bucket stability by year</h3>
            {research.years.map((year) => <YearBuckets key={year.year} year={year} smallSampleThreshold={research.options.smallSampleThreshold} />)}
          </div>
          <div className="robustness-section">
            <h3>Combined (all years) — baseline vs. RV-confirmed</h3>
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
            Descriptive research only, on historical data. Year-to-year and regime-to-regime comparisons do not guarantee future
            performance, and results here do not automatically change production scoring, thresholds, or trade construction.
          </p>
        </>
      )}
    </section>
  )
}
