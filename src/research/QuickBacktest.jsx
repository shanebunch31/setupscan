import React from 'react'
import {
  METRIC_DEFINITIONS,
  MetricsGlossary,
} from '../backtest/MetricsGlossary.jsx'
import { BACKTEST_EXTRA_DEFINITIONS } from '../backtest/backtestLearning.js'
const BACKTEST_GLOSSARY_DEFINITIONS = [
  ...METRIC_DEFINITIONS,
  ...BACKTEST_EXTRA_DEFINITIONS,
]
const formatPercent = (value) => `${(value * 100).toFixed(1)}%`
const formatR = (value) => `${value === Infinity ? '∞' : value.toFixed(2)}R`
const formatDurationMinutes = (minutes) => {
const totalMinutes = Math.round(Number(minutes) || 0)
const hours = Math.floor(totalMinutes / 60)
const remainingMinutes = totalMinutes % 60

  if (hours === 0) return `${remainingMinutes}m`
  if (remainingMinutes === 0) return `${hours}h`

  return `${hours}h ${remainingMinutes}m`
}
const formatDate = (value) =>
  value ? new Date(value).toLocaleDateString('en-US', { timeZone: 'UTC' }) : '—'

function BacktestDiagnostics({ backtest, data, error }) {
  const { metrics } = backtest
  const checks = [
    ['Provider', data?.provider ?? 'LOADING'],
    [
      'Symbol',
      data?.provider === 'DEMO' ? 'SPY (demo)' : (data?.symbol ?? '—'),
    ],
    ['Timeframe', data?.timeframe ?? '1Hour'],
    ['Start date', formatDate(data?.start)],
    ['End date', formatDate(data?.end)],
    ['Candle count', data?.candleCount ?? 0],
    [
  'Data status',
  data?.complete === false
    ? 'INCOMPLETE'
    : data
      ? 'COMPLETE'
      : 'LOADING',
],
    ['Winning trades', metrics.winningTrades],
    ['Losing trades', metrics.losingTrades],
    ['Expired trades', metrics.expiredTrades],
    ['Total positive R', formatR(metrics.totalPositiveR)],
    ['Total negative R', formatR(metrics.totalNegativeR)],
    [
  'Calculated profit factor',
  metrics.calculatedProfitFactor === Infinity
    ? '∞'
    : metrics.calculatedProfitFactor.toFixed(2),
],
    ['Calculated expectancy', formatR(metrics.calculatedExpectancy)],
  ]
  return (
    <details className="backtest-calculation-details">
      <summary>How the results are calculated</summary>
      <p className="backtest-detail-intro">
        {data?.provider === 'DEMO'
          ? 'These checks show the demo data and calculations used for the illustrative metrics above.'
          : 'These checks show the historical data and calculations used to produce the backtest results above.'}
      </p>
      <section className="calculation-checks panel">
        <div className="panel-heading compact">
          <div>
            <p className="eyebrow">BACKTEST LAB · CALCULATION CHECKS</p>
            <h2>
              {data?.provider === 'DEMO'
                ? 'Demo calculation data'
                : 'Historical research data'}
            </h2>
            {error && <p className="data-error">{error}</p>}
          </div>
          <span className="coming-soon">{data?.provider ?? 'LOADING'}</span>
        </div>
        <div className="check-grid">
          {checks.map(([label, value]) => (
            <div key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
      </section>
    </details>
  )
}

function BacktestDataSummary({ data, error }) {
  const provider = data?.provider ?? 'Data loading'
  const status =
    data?.complete === false
      ? 'Incomplete'
      : data?.complete === true
        ? 'Complete'
        : error
          ? 'Unavailable'
          : 'Loading'

  return (
    <div className="backtest-data-context" aria-label="Historical data context">
      <p>
        <strong>
          {data?.provider === 'DEMO'
            ? 'SPY demo data'
            : `${provider} · ${data?.symbol ?? '—'}`}{' '}
          · {data?.timeframe ?? '1Hour'}
        </strong>
        <span>
          {formatDate(data?.start)} – {formatDate(data?.end)}
          {' · '}
          {(data?.candleCount ?? 0).toLocaleString()} candles
          {' · '}
          {status}
        </span>
      </p>
      {error ? (
        <p className="data-error" role="alert">
          {error}
        </p>
      ) : null}
      {data?.complete === false ? (
        <p className="data-error" role="alert">
          Historical data is incomplete; interpret these results with caution.
        </p>
      ) : null}
    </div>
  )
}

function CumulativeRChart({ trades, isDemo }) {
  const orderedTrades = [...trades].sort(
    (a, b) =>
      (Date.parse(a.timestamp) || 0) -
      (Date.parse(b.timestamp) || 0),
  )

  if (orderedTrades.length === 0) {
    return (
      <section className="quick-backtest-chart-panel">
        <div className="quick-backtest-chart-empty">
          No trades are available to plot.
        </div>
      </section>
    )
  }

  let cumulativeR = 0

  const tradePoints = orderedTrades.map((trade) => {
    cumulativeR += Number(trade.rMultiple) || 0

    return {
      value: cumulativeR,
      timestamp: trade.timestamp,
    }
  })

  const points = [
    {
      value: 0,
      timestamp: orderedTrades[0].timestamp,
    },
    ...tradePoints,
  ]

  const width = 1000
  const height = 270

  const padding = {
    top: 20,
    right: 24,
    bottom: 30,
    left: 58,
  }

  const plotWidth = width - padding.left - padding.right
  const plotHeight = height - padding.top - padding.bottom

  const values = points.map((point) => point.value)

  const rawMin = Math.min(0, ...values)
  const rawMax = Math.max(0, ...values)

  const valuePadding = Math.max(
    (rawMax - rawMin) * 0.12,
    0.5,
  )

  const minValue = rawMin - valuePadding
  const maxValue = rawMax + valuePadding
  const valueRange = Math.max(maxValue - minValue, 1)

  const getX = (index) =>
    padding.left +
    (index / Math.max(points.length - 1, 1)) * plotWidth

  const getY = (value) =>
    padding.top +
    ((maxValue - value) / valueRange) * plotHeight

  const path = points
    .map(
      (point, index) =>
        `${index === 0 ? 'M' : 'L'} ${getX(index)} ${getY(
          point.value,
        )}`,
    )
    .join(' ')

  const gridValues = Array.from({ length: 5 }, (_, index) => {
    const ratio = index / 4
    return maxValue - ratio * valueRange
  })

  const finalPoint = points[points.length - 1]
  const finalR = finalPoint.value

  const firstDate = orderedTrades[0]?.timestamp
  const lastDate =
    orderedTrades[orderedTrades.length - 1]?.timestamp

  return (
    <section
      className="quick-backtest-chart-panel"
      aria-label="Cumulative R performance"
    >
      <div className="quick-backtest-chart-heading">
        <div>
          <p className="eyebrow">
            PERFORMANCE PATH
            {isDemo ? ' · DEMO DATA' : ''}
          </p>

          <h3>Cumulative R</h3>

          <p>
            Running total of each simulated trade&apos;s R result.
          </p>
        </div>

        <div className="quick-backtest-chart-total">
          <span>Ending R</span>

          <strong
            className={
              finalR > 0
                ? 'positive'
                : finalR < 0
                  ? 'negative'
                  : ''
            }
          >
            {formatR(finalR)}
          </strong>
        </div>
      </div>

      <div className="quick-backtest-chart-wrap">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`Cumulative R chart ending at ${formatR(
            finalR,
          )}`}
        >
          {gridValues.map((value) => {
            const y = getY(value)

            return (
              <g key={value}>
                <line
                  className="quick-backtest-chart-grid"
                  x1={padding.left}
                  x2={width - padding.right}
                  y1={y}
                  y2={y}
                />

                <text
                  className="quick-backtest-chart-axis-label"
                  x={8}
                  y={y + 4}
                >
                  {value.toFixed(1)}R
                </text>
              </g>
            )
          })}

          <line
            className="quick-backtest-chart-zero"
            x1={padding.left}
            x2={width - padding.right}
            y1={getY(0)}
            y2={getY(0)}
          />

          <path
            className={`quick-backtest-chart-line ${
              finalR >= 0 ? 'positive' : 'negative'
            }`}
            d={path}
          />

          <circle
            className={`quick-backtest-chart-endpoint ${
              finalR >= 0 ? 'positive' : 'negative'
            }`}
            cx={getX(points.length - 1)}
            cy={getY(finalR)}
            r="5"
          />
        </svg>
      </div>

      <div className="quick-backtest-chart-dates">
        <span>{formatDate(firstDate)}</span>
        <span>{orderedTrades.length} simulated trades</span>
        <span>{formatDate(lastDate)}</span>
      </div>
    </section>
  )
}

function buildTradeDistribution(trades = []) {
  const buckets = [
    {
      label: '≤ -1R',
      tone: 'is-negative',
      match: (value) => value <= -1,
    },
    {
      label: '-1R to 0R',
      tone: 'is-negative-soft',
      match: (value) => value > -1 && value < 0,
    },
    {
      label: '0R to 1R',
      tone: 'is-neutral',
      match: (value) => value >= 0 && value < 1,
    },
    {
      label: '1R to 2R',
      tone: 'is-positive',
      match: (value) => value >= 1 && value < 2,
    },
    {
      label: '2R+',
      tone: 'is-positive-strong',
      match: (value) => value >= 2,
    },
  ]

  const total = trades.length

  return buckets.map((bucket) => {
    const count = trades.filter((trade) =>
      bucket.match(Number(trade.rMultiple ?? 0)),
    ).length

    return {
      ...bucket,
      count,
      percent: total ? count / total : 0,
    }
  })
}

function buildMonthlyR(trades = []) {
  const datedTrades = trades
    .map((trade) => ({
      ...trade,
      parsedTimestamp: Date.parse(trade.timestamp),
    }))
    .filter((trade) => Number.isFinite(trade.parsedTimestamp))

  if (!datedTrades.length) return []

  const latestTimestamp = Math.max(
    ...datedTrades.map((trade) => trade.parsedTimestamp),
  )

  const latestDate = new Date(latestTimestamp)

  const months = Array.from({ length: 12 }, (_, index) => {
    const monthsBack = 11 - index

    const date = new Date(
      Date.UTC(
        latestDate.getUTCFullYear(),
        latestDate.getUTCMonth() - monthsBack,
        1,
      ),
    )

    const year = date.getUTCFullYear()
    const month = date.getUTCMonth()

    return {
      key: `${year}-${String(month + 1).padStart(2, '0')}`,
      label: date.toLocaleDateString('en-US', {
        month: 'short',
        timeZone: 'UTC',
      }),
      fullLabel: date.toLocaleDateString('en-US', {
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      }),
      value: 0,
      trades: 0,
    }
  })

  const monthMap = new Map(
    months.map((month) => [month.key, month]),
  )

  datedTrades.forEach((trade) => {
    const date = new Date(trade.parsedTimestamp)

    const key = `${date.getUTCFullYear()}-${String(
      date.getUTCMonth() + 1,
    ).padStart(2, '0')}`

    const bucket = monthMap.get(key)

    if (!bucket) return

    bucket.value += Number(trade.rMultiple) || 0
    bucket.trades += 1
  })

  return months
}

function MonthlyRChart({ trades }) {
  const months = buildMonthlyR(trades)

  const maxAbsoluteR = Math.max(
    ...months.map((month) => Math.abs(month.value)),
    1,
  )

  return (
    <article className="quick-backtest-mini-panel">
      <div className="quick-backtest-mini-heading">
        <div>
          <p className="eyebrow">MONTHLY PERFORMANCE</p>
          <h3>Monthly R</h3>
          <p>
            Net simulated R by month for the latest 12 months
            of this tested sample.
          </p>
        </div>
      </div>

      <div className="monthly-r-chart">
        {months.map((month) => {
          const magnitude =
            (Math.abs(month.value) / maxAbsoluteR) * 46

          return (
            <div
              className="monthly-r-column"
              key={month.key}
              title={`${month.fullLabel}: ${formatR(
                month.value,
              )} · ${month.trades} trades`}
            >
              <div className="monthly-r-plot">
                <span className="monthly-r-zero-line" />

                {month.value !== 0 ? (
                  <span
                    className={`monthly-r-bar ${
                      month.value > 0
                        ? 'positive'
                        : 'negative'
                    }`}
                    style={{
                      height: `${magnitude}%`,
                      ...(month.value > 0
                        ? { bottom: '50%' }
                        : { top: '50%' }),
                    }}
                  />
                ) : null}
              </div>

              <span className="monthly-r-month">
                {month.label}
              </span>
            </div>
          )
        })}
      </div>

      <div className="monthly-r-legend">
        <span>Green = positive month</span>
        <span>Red = negative month</span>
      </div>
    </article>
  )
}

function TradeDistributionChart({ backtest }) {
  const distribution = buildTradeDistribution(backtest?.trades ?? [])
  const maxCount = Math.max(...distribution.map((item) => item.count), 1)

  return (
    <article className="quick-backtest-mini-panel">
      <div className="quick-backtest-mini-heading">
        <div>
          <p className="eyebrow">TRADE DISTRIBUTION</p>
          <h3>R multiple buckets</h3>
          <p>Where the simulated trades actually landed.</p>
        </div>
      </div>

      <div className="distribution-bars">
        {distribution.map((item) => (
          <div key={item.label} className="distribution-row">
            <div className="distribution-meta">
              <span>{item.label}</span>
              <strong>{item.count}</strong>
            </div>

            <div className="distribution-track">
              <div
                className={`distribution-fill ${item.tone}`}
                style={{ width: `${(item.count / maxCount) * 100}%` }}
              />
            </div>

            <small>{formatPercent(item.percent)}</small>
          </div>
        ))}
      </div>
    </article>
  )
}

export function QuickBacktest({
  watchlist,
  selectedSymbol,
  setSelectedSymbol,
  backtestRangeYears,
  setBacktestRangeYears,
  backtestLoading,
  historicalData,
  historicalError,
  backtest,
  onOpenLab,
}) {
  const isDemo = historicalData?.provider === 'DEMO'
  const displaySymbol = isDemo
    ? 'SPY'
    : (historicalData?.symbol ?? selectedSymbol)
  return (
    <>
            <section className="detail-grid single-column quick-backtest-page">
  <section className="backtest-panel panel quick-backtest-panel">
    <div className="quick-backtest-header">
      <div>
        <p className="eyebrow">
          QUICK BACKTEST · {displaySymbol} · 1H
          {isDemo ? ' · DEMO DATA' : ''}
        </p>

        <h2>Quick Backtest</h2>

        <p className="quick-backtest-subtitle">
          Test SetupScan&apos;s current rules against historical market data.
        </p>
      </div>

      <span
        className={`quick-backtest-run-status ${
          backtestLoading ? 'is-running' : ''
        }`}
      >
        {backtestLoading
          ? 'RUNNING BACKTEST'
          : `${backtest.trades.length} TRADES`}
      </span>
    </div>

    <div
      className="quick-backtest-controls"
      aria-label="Quick Backtest controls"
    >
      <label className="quick-backtest-control">
        <span>Symbol</span>
        <select
          className="quick-backtest-select"
          value={selectedSymbol}
          onChange={(event) => setSelectedSymbol(event.target.value)}
          aria-label="Backtest symbol"
          disabled={backtestLoading}
        >
          {watchlist.map((symbol) => (
            <option key={symbol} value={symbol}>
              {symbol}
            </option>
          ))}
        </select>
      </label>

      <label className="quick-backtest-control">
        <span>Range</span>
        <select
          className="quick-backtest-select"
          value={backtestRangeYears}
          onChange={(event) =>
            setBacktestRangeYears(Number(event.target.value))
          }
          aria-label="Backtest range"
          disabled={backtestLoading}
        >
          <option value={1}>1 year</option>
          <option value={2}>2 years</option>
          <option value={3}>3 years</option>
          <option value={5}>5 years</option>
        </select>
      </label>
    </div>

    {backtestLoading ? (
      <div className="backtest-loading" role="status" aria-live="polite">
        <span className="status-dot" />
        <div>
          <strong>Running backtest</strong>
          <small>
            Loading {backtestRangeYears}{' '}
            {backtestRangeYears === 1 ? 'year' : 'years'} of{' '}
            {selectedSymbol} historical data and recalculating results…
          </small>
        </div>
      </div>
    ) : null}

    <BacktestDataSummary
      data={historicalData}
      error={historicalError}
    />

    <section
      className={`backtest-result-evidence quick-backtest-results ${
        isDemo ? 'backtest-demo-results' : ''
      }`}
      aria-label={
        isDemo ? 'SPY demo metrics' : 'Historical backtest results'
      }
    >
      {isDemo ? (
        <div className="backtest-demo-notice" role="note">
          <h3>
            SPY demo data — illustrative only, not historical research
          </h3>
          <p>
            The historical-data request failed. These figures use built-in
            SPY example candles, regardless of the requested symbol. They
            are illustrative only and are not evidence of strategy
            performance. The original data-fetch error is shown above.
          </p>
        </div>
      ) : null}

      <p className="backtest-learning-intro">
        {isDemo
          ? 'These example results do not predict or measure future performance.'
          : 'Historical results describe this sample; they do not predict future performance.'}
      </p>

      <div className="sample-grid">
  <div>
    <span>In-sample · Average R per trade</span>
    <strong
      className={
        backtest.inSampleMetrics.averageR > 0
          ? 'positive'
          : backtest.inSampleMetrics.averageR < 0
            ? 'negative'
            : ''
      }
    >
      {backtest.inSampleMetrics.numberOfTrades} trades ·{' '}
      {formatR(backtest.inSampleMetrics.averageR)}
    </strong>
  </div>

  <div>
    <span>Out-of-sample · Average R per trade</span>
    <strong
      className={
        backtest.outOfSampleMetrics.averageR > 0
          ? 'positive'
          : backtest.outOfSampleMetrics.averageR < 0
            ? 'negative'
            : ''
      }
    >
      {backtest.outOfSampleMetrics.numberOfTrades} trades ·{' '}
      {formatR(backtest.outOfSampleMetrics.averageR)}
    </strong>
  </div>
</div>

      <div className="quick-backtest-summary-grid">
        <article className="quick-backtest-summary-card">
  <span>Win Rate</span>
  <strong>{formatPercent(backtest.metrics.winRate)}</strong>
  <small>
    {backtest.metrics.winningTrades} winning trades
  </small>
</article>

        <article className="quick-backtest-summary-card">
          <span>Expectancy</span>
          <strong
            className={
              backtest.metrics.expectancy > 0
                ? 'positive'
                : backtest.metrics.expectancy < 0
                  ? 'negative'
                  : ''
            }
          >
            {formatR(backtest.metrics.expectancy)}
          </strong>
          <small>Average expected result per trade</small>
        </article>

        <article className="quick-backtest-summary-card">
          <span>Profit Factor</span>
          <strong
            className={
              backtest.metrics.profitFactor > 1
                ? 'positive'
                : backtest.metrics.profitFactor < 1
                  ? 'negative'
                  : ''
            }
          >
            {backtest.metrics.profitFactor === Infinity
              ? '∞'
              : backtest.metrics.profitFactor.toFixed(2)}
          </strong>
          <small>Gross gains ÷ gross losses</small>
        </article>

        <article className="quick-backtest-summary-card">
          <span>Max Drawdown</span>
          <strong>{formatR(backtest.metrics.maximumDrawdown)}</strong>
          <small>Largest historical decline</small>
        </article>

        <article className="quick-backtest-summary-card">
  <span>Avg Hold</span>
  <strong>
    {formatDurationMinutes(backtest.metrics.averageHoldingTime)}
  </strong>
  <small>Average simulated trade duration</small>
</article>

        <article className="quick-backtest-summary-card">
          <span>Total Trades</span>
          <strong>{backtest.trades.length}</strong>
          <small>
            {backtestRangeYears}{' '}
            {backtestRangeYears === 1 ? 'year' : 'years'} tested
          </small>
        </article>
            </div>

      <CumulativeRChart
        trades={backtest.trades}
        isDemo={isDemo}
      />
      <div className="quick-backtest-mini-charts">
  <TradeDistributionChart backtest={backtest} />
  <MonthlyRChart trades={backtest.trades} />
</div>


            <details className="backtest-recent-details">
              <summary>Recent Backtest Trades</summary>
              <p className="backtest-detail-intro">
  Latest simulated trades generated by this historical test.
</p>
              <div className="trade-ledger">
                <div className="ledger-heading">
                  <span>Trade</span>
                  <span>Outcome / R</span>
                </div>
                {backtest.trades
                  .slice(-4)
                  .reverse()
                  .map((trade) => (
                    <div
                      className="ledger-row"
                      key={`${trade.timestamp}-${trade.symbol}`}
                    >
                      <span>
                        <strong>{isDemo ? 'SPY' : trade.symbol}</strong>
                        <small>
                          {trade.setupType} ·{' '}
                          {new Date(trade.timestamp).toLocaleDateString()}
                        </small>
                      </span>
                      <strong
                        className={
                          trade.outcome === 'Win'
                            ? 'positive'
                            : trade.outcome === 'Loss'
                              ? 'negative'
                              : ''
                        }
                      >
                        {trade.outcome} · {formatR(trade.rMultiple)}
                      </strong>
                    </div>
                  ))}
              </div>
            </details>
          </section>
        </section>
      </section>
      <section
  className="quick-backtest-next-steps"
  aria-labelledby="quick-backtest-next-heading"
>
  <div className="quick-backtest-next-copy">
    <p className="eyebrow">CONTINUE RESEARCH</p>

    <h3 id="quick-backtest-next-heading">
      Test this result further
    </h3>

    <p>
      A Quick Backtest is a first historical check. Use deeper Labs
      to test whether the result holds up and whether stronger signals
      actually correspond with better outcomes.
    </p>
  </div>

  <div className="quick-backtest-next-actions">
    <button
      type="button"
      className="quick-backtest-next-card is-resilience"
      onClick={() => onOpenLab('robustness')}
    >
      <span>Strategy Resilience</span>
      <small>
        Stress-test the result across thresholds, periods, symbols,
        and changing conditions.
      </small>
      <strong>Open Lab →</strong>
    </button>

    <button
      type="button"
      className="quick-backtest-next-card is-signal-quality"
      onClick={() => onOpenLab('signal-quality')}
    >
      <span>Signal Quality / Expected Value</span>
      <small>
        Check whether stronger SetupScan signals correspond with
        better historical outcomes.
      </small>
      <strong>Open Lab →</strong>
    </button>
  </div>
</section>
      <BacktestDiagnostics
        backtest={backtest}
        data={historicalData}
        error={historicalError}
      />
    </>
  )
}
