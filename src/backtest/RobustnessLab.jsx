import React, { useMemo, useState } from 'react'
import { enrichHistoricalCandles } from '../data/marketData.js'
import { getRobustnessWarnings, runMarketConditionResearch, runThresholdResearch } from './robustness.js'
import { StrategyComparisonLab } from './StrategyComparisonLab.jsx'
import { HowToReadResults, LearningDetails, MetricsGlossary, ResearchFirstAnswer } from './MetricsGlossary.jsx'
import { buildThresholdTableCells, thresholdTableHeadings } from './thresholdTablePresentation.js'
import { hasPerformanceObservations } from './labEvidence.js'
import { buildCumulativeRObservations } from './cumulativeRChartData.js'
import { AmbiguousCandleDisclosure, ResearchDataStatus } from './LabEvidence.jsx'
import './robustness.css'

const formatPercent = (value) => `${(value * 100).toFixed(1)}%`
const formatR = (value) => `${value === Infinity ? '∞' : value.toFixed(2)}R`
const formatDate = (value) => value ? new Date(value).toLocaleDateString('en-US', { timeZone: 'UTC' }) : '—'
function MetricCells({ metrics }) {
  const hasTrades = hasPerformanceObservations(metrics)
  return <><td>{metrics.totalTrades}</td><td>{hasTrades ? formatPercent(metrics.winRate) : '—'}</td><td>{hasTrades ? (metrics.profitFactor === Infinity ? '∞' : metrics.profitFactor.toFixed(2)) : '—'}</td><td>{hasTrades ? formatR(metrics.expectancy) : '—'}</td><td>{hasTrades ? formatR(metrics.averageR) : '—'}</td><td>{hasTrades ? formatR(metrics.maximumDrawdown) : '—'}</td><td>{hasTrades ? `${metrics.averageHoldingTime.toFixed(0)}m` : '—'}</td><td>{hasTrades ? formatR(metrics.averageWinner) : '—'}</td><td>{hasTrades ? formatR(metrics.averageLoser) : '—'}</td></>
}

function CumulativeRChart({ result }) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const observations = useMemo(() => buildCumulativeRObservations(result?.trades), [result?.trades])
  const hasTrades = hasPerformanceObservations(result?.metrics)
  if (!hasTrades || !observations.length) {
    const hasMetrics = Boolean(result?.metrics)
    return (
      <div className="robustness-chart cumulative-r-chart-empty" role="status">
        <h4>{result?.minimumScore}+ score threshold</h4>
        <p>{hasMetrics && !hasTrades
          ? 'No resolved trade observations are available to chart at this threshold. Performance is unavailable, not a measured zero.'
          : 'The cumulative R chart is unavailable because individual trade observations are not available.'}</p>
        <span>Observations: {hasMetrics ? result.metrics.totalTrades : 'unavailable'}</span>
      </div>
    )
  }

  const chartWidth = 640
  const chartHeight = 280
  const plot = { left: 62, right: 620, top: 24, bottom: 220 }
  const values = observations.map((observation) => observation.cumulativeR).filter(Number.isFinite)
  const min = Math.min(0, ...values)
  const max = Math.max(0, ...values)
  const range = max - min || 1
  const xForIndex = (index) => plot.left + (index / Math.max(observations.length - 1, 1)) * (plot.right - plot.left)
  const yForValue = (value) => plot.bottom - ((value - min) / range) * (plot.bottom - plot.top)
  const points = observations
    .filter((observation) => Number.isFinite(observation.cumulativeR))
    .map((observation) => `${xForIndex(observation.sequence - 1)},${yForValue(observation.cumulativeR)}`)
    .join(' ')
  const selectedObservation = observations[Math.min(selectedIndex, observations.length - 1)]
  const zeroY = yForValue(0)
  const dateLabel = (timestamp) => {
    if (!timestamp || !Number.isFinite(Date.parse(timestamp))) return 'Date unavailable'
    return new Date(timestamp).toLocaleString('en-US', { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'short' }) + ' UTC'
  }
  const formatChartR = (value) => Number.isFinite(value) ? formatR(value) : '—'
  const chartId = `cumulative-r-${result.minimumScore}`

  return (
    <div className="robustness-chart cumulative-r-chart" aria-labelledby={`${chartId}-title`}>
      <h4 id={`${chartId}-title`}>{result.minimumScore}+ score threshold · cumulative R</h4>
      <p className="cumulative-r-chart-question">What happened when each resolved trade result was added in chronological trade order?</p>
      <p className="cumulative-r-chart-count">{observations.length} trade observations</p>
      <svg
        className="cumulative-r-chart-svg"
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
        role="img"
        aria-labelledby={`${chartId}-title ${chartId}-description`}
      >
        <desc id={`${chartId}-description`}>
          Cumulative R across {observations.length} resolved trades in the existing research order. The horizontal reference line marks zero R. This is not an account equity curve.
        </desc>
        {[max, (max + min) / 2, min].filter((value, index, ticks) => ticks.indexOf(value) === index).map((value) => (
          <g key={`y-${value}`} className="cumulative-r-axis-tick">
            <line x1={plot.left} x2={plot.right} y1={yForValue(value)} y2={yForValue(value)} />
            <text x={plot.left - 8} y={yForValue(value) + 4} textAnchor="end">{formatChartR(value)}</text>
          </g>
        ))}
        <line className="cumulative-r-zero-line" x1={plot.left} x2={plot.right} y1={zeroY} y2={zeroY} />
        {points && <polyline className="cumulative-r-line" points={points} />}
        <circle
          className="cumulative-r-selected-point"
          cx={xForIndex(selectedObservation.sequence - 1)}
          cy={yForValue(selectedObservation.cumulativeR)}
          r="5"
          aria-hidden="true"
        />
        <line className="cumulative-r-axis-line" x1={plot.left} x2={plot.left} y1={plot.top} y2={plot.bottom} />
        <line className="cumulative-r-axis-line" x1={plot.left} x2={plot.right} y1={plot.bottom} y2={plot.bottom} />
        <text className="cumulative-r-axis-title" x="15" y={(plot.top + plot.bottom) / 2} transform={`rotate(-90 15 ${(plot.top + plot.bottom) / 2})`}>Cumulative R</text>
        <text className="cumulative-r-axis-label" x={plot.left} y={plot.bottom + 22}>Trade 1</text>
        <text className="cumulative-r-axis-label" x={plot.right} y={plot.bottom + 22} textAnchor="end">Trade {observations.length}</text>
        <text className="cumulative-r-axis-title" x={(plot.left + plot.right) / 2} y={chartHeight - 8} textAnchor="middle">Trade sequence · chronological</text>
      </svg>
      <label className="cumulative-r-inspector-label" htmlFor={`${chartId}-inspector`}>Inspect a trade (use arrow keys)</label>
      <input
        id={`${chartId}-inspector`}
        className="cumulative-r-inspector"
        type="range"
        min="0"
        max={observations.length - 1}
        step="1"
        value={Math.min(selectedIndex, observations.length - 1)}
        onChange={(event) => setSelectedIndex(Number(event.target.value))}
        aria-valuetext={`Trade ${selectedObservation.sequence} of ${observations.length}; ${dateLabel(selectedObservation.timestamp)}; result ${formatChartR(selectedObservation.rMultiple)}; cumulative ${formatChartR(selectedObservation.cumulativeR)}`}
      />
      <output className="cumulative-r-selected-detail" aria-live="polite">
        <strong>Trade {selectedObservation.sequence} of {observations.length}</strong>
        <span>{dateLabel(selectedObservation.timestamp)}</span>
        <span>Trade result: {formatChartR(selectedObservation.rMultiple)}</span>
        <span>Cumulative: {formatChartR(selectedObservation.cumulativeR)}</span>
      </output>
      <details className="cumulative-r-data-details">
        <summary>View all {observations.length} trade observations</summary>
        <div className="cumulative-r-data-wrap">
          <table className="cumulative-r-data-table">
            <caption>{result.minimumScore}+ threshold: trade results and cumulative R in the same order as the chart</caption>
            <thead><tr><th scope="col">Trade sequence</th><th scope="col">Date (UTC)</th><th scope="col">Trade result (R)</th><th scope="col">Cumulative R</th></tr></thead>
            <tbody>{observations.map((observation) => (
              <tr key={observation.sequence} aria-current={observation.sequence === selectedObservation.sequence ? 'true' : undefined}>
                <th scope="row">{observation.sequence}</th>
                <td>{dateLabel(observation.timestamp)}</td>
                <td>{formatChartR(observation.rMultiple)}</td>
                <td>{formatChartR(observation.cumulativeR)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </details>
    </div>
  )
}

function ThresholdTable({ results }) {
  return <div className="robustness-table-wrap"><table className="robustness-table threshold-research-table"><thead><tr>{thresholdTableHeadings.map((heading) => <th key={heading}>{heading}</th>)}</tr></thead><tbody>{results.map((result) => <tr key={result.minimumScore}>{buildThresholdTableCells(result).map((value, index) => <td key={thresholdTableHeadings[index]}>{value}</td>)}</tr>)}</tbody></table></div>
}

function DirectionTable({ result }) {
  const rows = [{ label: 'Long', metrics: result.metrics }, { label: 'Short', metrics: null }, { label: 'Combined', metrics: result.metrics }]
  return <div className="robustness-table-wrap"><table className="robustness-table"><thead><tr><th>Direction</th><th>Total</th><th>Win rate</th><th>Profit factor</th><th>Expectancy</th><th>Average R</th><th>Max DD</th><th>Avg hold</th></tr></thead><tbody>{rows.map(({ label, metrics }) => { const hasTrades = metrics && hasPerformanceObservations(metrics); return <tr key={label}><td>{label}</td><td>{metrics ? metrics.totalTrades : '—'}</td><td>{hasTrades ? formatPercent(metrics.winRate) : '—'}</td><td>{hasTrades ? (metrics.profitFactor === Infinity ? '∞' : metrics.profitFactor.toFixed(2)) : '—'}</td><td>{hasTrades ? formatR(metrics.expectancy) : '—'}</td><td>{hasTrades ? formatR(metrics.averageR) : '—'}</td><td>{hasTrades ? formatR(metrics.maximumDrawdown) : '—'}</td><td>{hasTrades ? `${metrics.averageHoldingTime.toFixed(0)}m` : '—'}</td></tr>})}</tbody></table></div>
}

function ResearchSection({ title, children }) { return <div className="robustness-section"><h3>{title}</h3>{children}</div> }

export function StrategyRobustnessLab({ datasets }) {
  const availableSpy = datasets.find((dataset) => dataset.symbol === 'SPY' && dataset.status === 'AVAILABLE')
  const spyCandles = useMemo(() => availableSpy ? enrichHistoricalCandles(availableSpy.data.candles) : [], [availableSpy])
  const thresholdResults = useMemo(() => spyCandles.length ? runThresholdResearch(spyCandles) : [], [spyCandles])
  const periodResults = useMemo(() => spyCandles.length ? runMarketConditionResearch(spyCandles) : [], [spyCandles])
  const warnings = useMemo(() => getRobustnessWarnings(thresholdResults), [thresholdResults])
  const baseline = thresholdResults[0]
  const baselineTradeCount = baseline?.metrics.totalTrades ?? 0
  const symbolRows = datasets.map((dataset) => {
    if (dataset.status !== 'AVAILABLE') return { symbol: dataset.symbol, unavailable: true }
    const candles = enrichHistoricalCandles(dataset.data.candles)
    const result = runThresholdResearch(candles)[0]
    return { symbol: dataset.symbol, unavailable: false, result }
  })

  return (
    <section className="robustness-lab panel">
      <div className="panel-heading compact">
      <div>
        <p className="eyebrow">RESEARCH / RESILIENCE</p>
        <h2>Strategy Resilience Lab</h2>
        <p className="research-page-intro">
          Explore focused research tests for resilience, signal quality, regimes, and other questions.
        </p>
      </div>
        <span className="coming-soon">NOT A VALIDATED TRADING EDGE</span>
      </div>
      <ResearchFirstAnswer
        question="How sensitive are the existing SetupScan rules to score cutoff and chronological market periods?"
        sample={availableSpy ? `${baselineTradeCount} SPY trades at the baseline 75+ cutoff; ${symbolRows.filter((row) => row.unavailable).length} watchlist symbols unavailable.` : 'No SPY backtest has run; the data state is shown below.'}
        takeaway={availableSpy && baselineTradeCount > 0 ? 'Compare the historical trade counts and metrics across the displayed thresholds and periods. No threshold is selected as a winner.' : availableSpy ? 'No resolved trades are available at the baseline cutoff, so its performance cannot be described.' : null}
        limitation="Descriptive historical results, not a validated trading edge. Unavailable symbols are excluded."
      />
      {!availableSpy ? <ResearchDataStatus datasets={datasets} requiredSymbols={['SPY']} /> : null}
      {availableSpy ? (
        <section className="research-primary-visual">
          <h3>How did cumulative R change across the tested score cutoffs?</h3>
          <p className="research-primary-visual-note">An R-multiple measures a trade result relative to its initial risk. Cumulative R adds those trade results in sequence. It does not account for account size, capital allocation, overlapping positions, or actual execution costs beyond the assumptions in this research model. Historical results do not establish future profitability.</p>
          <div className="robustness-charts">{thresholdResults.map((result) => <CumulativeRChart key={result.minimumScore} result={result} />)}</div>
        </section>
      ) : null}
      {availableSpy ? (
        <LearningDetails label="More details">
          <ResearchSection title="Stop Management & Strategy Comparison · research only"><StrategyComparisonLab datasets={datasets} /></ResearchSection>
          <ResearchSection title="Score threshold comparison · existing rules unchanged"><ThresholdTable results={thresholdResults} /></ResearchSection>
          <AmbiguousCandleDisclosure metrics={baseline?.metrics} />
          <ResearchSection title="Direction · current strategy is long-only"><DirectionTable result={baseline} /><p className="robustness-muted">Short strategy results are unavailable because short-entry and exit rules are not implemented.</p></ResearchSection>
          <ResearchSection title="Market conditions · chronological SPY periods"><div className="robustness-table-wrap"><table className="robustness-table"><thead><tr><th>Period</th><th>Date range</th><th>Candles</th><th>Trades</th><th>Win rate</th><th>Profit factor</th><th>Expectancy</th><th>Average R</th><th>Max DD</th></tr></thead><tbody>{periodResults.map((period) => { const hasTrades = hasPerformanceObservations(period.metrics); return <tr key={period.label}><td>{period.label}</td><td>{formatDate(period.start)} – {formatDate(period.end)}</td><td>{period.candleCount}</td><td>{period.metrics.totalTrades}</td><td>{hasTrades ? formatPercent(period.metrics.winRate) : '—'}</td><td>{hasTrades ? (period.metrics.profitFactor === Infinity ? '∞' : period.metrics.profitFactor.toFixed(2)) : '—'}</td><td>{hasTrades ? formatR(period.metrics.expectancy) : '—'}</td><td>{hasTrades ? formatR(period.metrics.averageR) : '—'}</td><td>{hasTrades ? formatR(period.metrics.maximumDrawdown) : '—'}</td></tr>})}</tbody></table></div></ResearchSection>
          <ResearchSection title="Symbol comparison · 75+ baseline"><div className="robustness-table-wrap"><table className="robustness-table"><thead><tr><th>Symbol</th><th>Provider</th><th>Date range</th><th>Candles</th><th>Trades</th><th>Win rate</th><th>Profit factor</th><th>Expectancy</th><th>Average R</th></tr></thead><tbody>{symbolRows.map((row) => { if (row.unavailable) return <tr key={row.symbol}><td>{row.symbol}</td><td colSpan="8" className="unavailable">UNAVAILABLE · no demo substitution</td></tr>; const hasTrades = hasPerformanceObservations(row.result.metrics); return <tr key={row.symbol}><td>{row.symbol}</td><td>{row.result.candles ? 'ALPACA HISTORICAL' : '—'}</td><td>{formatDate(row.result.candles?.[0]?.timestamp)} – {formatDate(row.result.candles?.at(-1)?.timestamp)}</td><td>{row.result.candles?.length ?? 0}</td><td>{row.result.metrics.totalTrades}</td><td>{hasTrades ? formatPercent(row.result.metrics.winRate) : '—'}</td><td>{hasTrades ? (row.result.metrics.profitFactor === Infinity ? '∞' : row.result.metrics.profitFactor.toFixed(2)) : '—'}</td><td>{hasTrades ? formatR(row.result.metrics.expectancy) : '—'}</td><td>{hasTrades ? formatR(row.result.metrics.averageR) : '—'}</td></tr>})}</tbody></table></div></ResearchSection>
          <ResearchSection title="Resilience warnings"><div className="robustness-warnings"><div>Threshold selection warning: no threshold selector is implemented; this lab does not choose a winner.</div>{warnings.length ? warnings.map((warning) => <div key={warning}>{warning}</div>) : <div>No heuristic warnings triggered for the available results.</div>}{symbolRows.filter((row) => row.unavailable).map((row) => <div key={row.symbol}>{row.symbol} data is unavailable and was excluded from resilience results.</div>)}</div></ResearchSection>
        </LearningDetails>
      ) : null}
      <LearningDetails label="What does this mean?"><MetricsGlossary /></LearningDetails>
      <LearningDetails label="How was this tested?"><HowToReadResults /></LearningDetails>
      <LearningDetails label="Research scope and safeguards"><p className="robustness-disclaimer">This tests the existing rules across score cutoffs and historical periods using real Alpaca historical data. Unavailable symbols are not replaced with demo data. No threshold selector is implemented, and no result changes production scoring, paper trading, workers, or stored records.</p></LearningDetails>
    </section>
  )
}
