import React, { useMemo } from 'react'
import { runCausalRegimeResearch } from './causalRegimeBacktest.js'
import { HowToReadResults, MetricsGlossary, PlainEnglishTakeaway } from './MetricsGlossary.jsx'
import './robustness.css'

const formatPercent = (value) => `${(value * 100).toFixed(1)}%`
const formatR = (value) => (value === Infinity ? '∞' : `${value.toFixed(2)}R`)
const formatPf = (value) => (value === Infinity ? '∞' : value.toFixed(2))

const CAUSAL_REGIME_DEFINITIONS = [
  { term: 'Trend regime (Uptrend / Mixed / Downtrend)', description: 'Classified at each bar from trailing moving averages and their slope, using only information available at that bar. It describes the market backdrop, it does not predict it.' },
  { term: 'Volatility regime (Low / Medium / High)', description: 'Each bar\u2019s trailing realized volatility is ranked only against volatility observed at or before that same bar, then split into thirds (terciles). \u201cHigh\u201d simply means unusually volatile relative to history up to that point, not a forecast of future volatility.' },
  { term: 'Breadth regime (Strong / Mixed / Weak)', description: 'Describes how many of the tracked symbols (SPY/QQQ/IWM) were above their own trailing average and posting positive recent returns at the same time \u2014 a simple read of how aligned the group was.' },
  { term: 'Insufficient-History', description: 'A bar is labeled this way when there isn\u2019t yet enough trailing data to classify it. These bars are excluded from regime comparisons rather than guessed at.' },
  { term: 'Combined regime (e.g. Uptrend + High volatility)', description: 'Two regime dimensions applied together, to see whether a combination \u2014 not just one dimension alone \u2014 relates differently to outcomes.' },
  { term: 'Baseline / RV-confirmed', description: '\u201cBaseline\u201d is the existing 75+ bullish signal. \u201cRV-confirmed\u201d additionally requires the Experiment #1 relative-value confirmation on the same candle. Neither rule is changed here.' },
  { term: 'Small sample', description: 'A regime slice is flagged when it has fewer trades than a fixed threshold, since small counts make win rate, profit factor, and other stats far less reliable.' },
  { term: 'Trade count, win rate, profit factor, expectancy, max drawdown', description: 'Trade count is how many trades occurred; win rate is the share that won; profit factor is total wins divided by total losses; expectancy is the average R-multiple result per trade; max drawdown is the worst peak-to-trough decline in cumulative R.' },
]

const CAUSAL_REGIME_HOW_TO_READ = [
  'This test checks whether calendar-year differences seen in Experiment #4 can instead be explained by causal, at-the-time market conditions \u2014 trend, volatility, and breadth \u2014 rather than just which year it happened to be.',
  'All regime classifications shown here are fixed and predefined; none were searched for or tuned after seeing which one performed best.',
  'Every classification only uses information available at or before that bar (no look-ahead), but that still describes the past \u2014 it is not a live filter and does not predict which regime comes next.',
  'Regime slices with few trades are flagged as a small sample and should be read with extra caution, even if their win rate or expectancy looks different from other slices.',
  'This is historical research only. It does not create a new regime filter and does not change production scoring, paper trading, the Render worker, or Supabase.',
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

function RegimeGroupTable({ title, groups, smallSampleThreshold }) {
  return (
    <div className="robustness-section">
      <h3>{title}</h3>
      <div className="robustness-table-wrap">
        <table className="robustness-table">
          <thead><tr><th>Regime</th><th>Trades</th><th>Win rate</th><th>PF</th><th>Expectancy</th><th>Total R</th><th>Max DD</th><th>Avg hold</th><th>Small sample</th></tr></thead>
          <tbody>{groups.map((group) => <tr key={group.label}><td>{group.label}</td><MetricCells metrics={group.baseline.overall} /><td>{group.baseline.smallSample ? `< ${smallSampleThreshold}` : '—'}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  )
}

function YearRegimeDistribution({ distribution }) {
  return (
    <div className="robustness-section">
      <h3>Baseline trades by regime, per calendar year</h3>
      <div className="robustness-table-wrap">
        <table className="robustness-table">
          <thead><tr><th>Year</th><th>Baseline trades</th><th>Uptrend</th><th>Mixed trend</th><th>Downtrend</th><th>Low vol</th><th>Medium vol</th><th>High vol</th></tr></thead>
          <tbody>{distribution.map((row) => <tr key={row.year}><td>{row.year}</td><td>{row.totalBaselineTrades}</td><td>{formatPercent(row.trend.percentages.Uptrend)}</td><td>{formatPercent(row.trend.percentages.Mixed)}</td><td>{formatPercent(row.trend.percentages.Downtrend)}</td><td>{formatPercent(row.volatility.percentages.Low)}</td><td>{formatPercent(row.volatility.percentages.Medium)}</td><td>{formatPercent(row.volatility.percentages.High)}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  )
}

function RvByRegime({ rows }) {
  return (
    <div className="robustness-section">
      <h3>Baseline vs. RV-confirmed, by regime</h3>
      <div className="robustness-table-wrap">
        <table className="robustness-table">
          <thead><tr><th>Regime</th><th>Variant</th><th>Trades</th><th>Win rate</th><th>PF</th><th>Expectancy</th><th>Total R</th><th>Max DD</th><th>Avg hold</th></tr></thead>
          <tbody>{rows.flatMap((row) => [
            <tr key={`${row.dimension}-${row.label}-baseline`}><td>{row.dimension}: {row.label}</td><td>Baseline</td><MetricCells metrics={row.baseline.overall} /></tr>,
            <tr key={`${row.dimension}-${row.label}-rv`}><td>{row.dimension}: {row.label}</td><td>RV-confirmed</td><MetricCells metrics={row.rvConfirmed.overall} /></tr>,
          ])}</tbody>
        </table>
      </div>
    </div>
  )
}

function ScoreByRegime({ rows }) {
  return (
    <div className="robustness-section">
      <h3>Score bucket stability, by regime</h3>
      {rows.map((row) => (
        <details key={`${row.dimension}-${row.label}`} className="robustness-section">
          <summary>{row.dimension}: {row.label}</summary>
          <div className="robustness-table-wrap">
            <table className="robustness-table">
              <thead><tr><th>Bucket</th><th>Trades</th><th>Win rate</th><th>PF</th><th>Expectancy</th><th>Avg R</th><th>Max DD</th><th>Small sample</th></tr></thead>
              <tbody>{row.buckets.map((bucket) => <tr key={bucket.label}><td>{bucket.label}</td><td>{bucket.overall.tradeCount}</td><td>{formatPercent(bucket.overall.winRate)}</td><td>{formatPf(bucket.overall.profitFactor)}</td><td>{formatR(bucket.overall.expectancy)}</td><td>{formatR(bucket.overall.averageR)}</td><td>{formatR(bucket.overall.maximumDrawdown)}</td><td>{bucket.smallSample ? 'YES' : '—'}</td></tr>)}</tbody>
            </table>
          </div>
          <p className="robustness-muted">
            {row.monotonicity.evaluable
              ? `Average-R vs. bucket-order correlation: ${row.monotonicity.averageRCorrelation.toFixed(2)} · Monotonically non-decreasing average R: ${row.monotonicity.monotonicIncreasing ? 'YES' : 'NO'}.`
              : 'Not enough sufficiently-populated buckets to assess monotonicity in this regime.'}
          </p>
        </details>
      ))}
    </div>
  )
}

export function CausalRegimeLab({ datasets }) {
  const available = datasets.filter((dataset) => dataset.status === 'AVAILABLE')
  const rawSeriesBySymbol = useMemo(() => Object.fromEntries(available.map((dataset) => [dataset.symbol, dataset.data.candles])), [available])
  const hasAllSymbols = ['SPY', 'QQQ', 'IWM'].every((symbol) => rawSeriesBySymbol[symbol]?.length)

  const research = useMemo(() => (hasAllSymbols ? runCausalRegimeResearch(rawSeriesBySymbol) : null), [hasAllSymbols, rawSeriesBySymbol])

  const takeawayText = useMemo(() => {
    if (!research) return null
    const groupsWithTrades = [...research.trendGroups, ...research.volatilityGroups, ...research.breadthGroups].filter((group) => group.baseline.overall.tradeCount > 0)
    if (!groupsWithTrades.length) return 'No trend, volatility, or breadth regime had enough baseline trades in this sample to compare.'
    const expectancies = groupsWithTrades.map((group) => group.baseline.overall.expectancy)
    const minExpectancy = Math.min(...expectancies)
    const maxExpectancy = Math.max(...expectancies)
    const positive = groupsWithTrades.filter((group) => group.baseline.overall.expectancy > 0).length
    const negative = groupsWithTrades.filter((group) => group.baseline.overall.expectancy < 0).length
    const smallSampleCount = groupsWithTrades.filter((group) => group.baseline.smallSample).length
    const mixedNote = positive > 0 && negative > 0
      ? 'Baseline expectancy was mixed across trend, volatility, and breadth regimes \u2014 positive in some, negative in others.'
      : positive > 0
        ? 'Baseline expectancy was positive across every populated trend, volatility, and breadth regime in this sample.'
        : 'Baseline expectancy was not positive in any populated trend, volatility, or breadth regime in this sample.'
    return `Across ${groupsWithTrades.length} populated regime slice(s), baseline expectancy ranged from ${formatR(minExpectancy)} to ${formatR(maxExpectancy)}. ${mixedNote}${smallSampleCount ? ` ${smallSampleCount} of those slices are flagged as a small sample and should be read with extra caution.` : ''} This describes how the frozen scanner behaved historically under each causal regime classification; it does not prove any regime causes better or worse outcomes, and no regime is identified as a validated filter.`
  }, [research])

  return (
    <section className="robustness-lab panel">
      <div className="panel-heading compact">
        <div><p className="eyebrow">RESEARCH EXPERIMENT #5</p><h2>Research Experiment — Causal Market-Regime Analysis</h2></div>
        <span className="coming-soon">RESEARCH ONLY · DOES NOT AFFECT PAPER TRADING OR SCORING</span>
      </div>
      <p className="robustness-disclaimer">
        Tests whether calendar-year differences can instead be described using causal, at-the-time market-state variables (trend,
        volatility, breadth) known at the moment of each signal, using the existing baseline entry/exit methodology on synchronized
        SPY/QQQ/IWM data. All regime classifications are fixed and predefined — none are searched or optimized. Descriptive research
        only — does not change production scoring, paper trading, the Render worker, or Supabase. No winner is auto-selected.
      </p>
      <div className="robustness-section"><MetricsGlossary title="What does this mean?" intro="Plain-English explanations for the terms used in this causal market-regime research." definitions={CAUSAL_REGIME_DEFINITIONS} /></div>
      <div className="robustness-section"><HowToReadResults title="How to read this test" items={CAUSAL_REGIME_HOW_TO_READ} /></div>
      {!hasAllSymbols ? (
        <div className="robustness-error">Waiting for real Alpaca historical data for SPY, QQQ, and IWM. This experiment never substitutes demo data.</div>
      ) : (
        <>
          <RegimeGroupTable title="Baseline by trend regime" groups={research.trendGroups} smallSampleThreshold={research.options.smallSampleThreshold} />
          <RegimeGroupTable title="Baseline by volatility regime" groups={research.volatilityGroups} smallSampleThreshold={research.options.smallSampleThreshold} />
          <RegimeGroupTable title="Baseline by breadth regime" groups={research.breadthGroups} smallSampleThreshold={research.options.smallSampleThreshold} />
          <RegimeGroupTable title="Combined: trend + volatility" groups={research.combinedTrendVolatility} smallSampleThreshold={research.options.smallSampleThreshold} />
          <RegimeGroupTable title="Combined: trend + breadth" groups={research.combinedTrendBreadth} smallSampleThreshold={research.options.smallSampleThreshold} />
          <YearRegimeDistribution distribution={research.yearRegimeDistribution} />
          <RvByRegime rows={research.rvByRegime} />
          <ScoreByRegime rows={research.scoreByRegime} />

          <div className="robustness-section">
            <h3>Combined (all regimes) — baseline vs. RV-confirmed</h3>
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
            Descriptive research only, on historical, causally-computed regime classifications. Regime-to-regime comparisons do not
            guarantee future performance, and results here do not automatically change production scoring, thresholds, or trade
            construction.
          </p>
        </>
      )}
    </section>
  )
}
