import React, { useState } from 'react'
import { PaperTradeChart } from './PaperTradeChart.jsx'
import { usePaperSnapshot } from './usePaperSnapshot.js'
import { PaperObserverStatus } from './PaperObserverStatus.jsx'
import { projectPaperTrades } from './paperTradingModel.js'
import { PaperTradingEducation } from './PaperTradingEducation.js'
import './paperTrading.css'

const formatR = (value) =>
  `${value === Infinity ? '∞' : Number(value ?? 0).toFixed(2)}R`

const formatMoney = (value) =>
  Number.isFinite(Number(value))
    ? `$${Number(value).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`
    : '—'

const formatPercent = (value) =>
  Number.isFinite(Number(value))
    ? `${(Number(value) * 100).toFixed(1)}%`
    : '—'

function PaperEquityChart({ points, startingEquity }) {
  const [hoveredIndex, setHoveredIndex] = useState(null)

  const values = [
    Number(startingEquity ?? 0),
    ...points.map((point) => Number(point.equity ?? 0)),
  ]

  if (values.length < 2) {
    return (
      <div className="paper-chart-empty">
        Not enough closed trades to draw the equity curve.
      </div>
    )
  }

  const width = 720
  const height = 230
const paddingLeft = 95
const paddingRight = 28
const paddingTop = 28
const paddingBottom = 28

const min = Math.min(...values)
const max = Math.max(...values)
const range = Math.max(max - min, 1)

const xFor = (index) =>
  paddingLeft +
  (index / Math.max(values.length - 1, 1)) *
    (width - paddingLeft - paddingRight)

const yFor = (value) =>
  height -
  paddingBottom -
  ((value - min) / range) *
    (height - paddingTop - paddingBottom)

  const coordinates = values.map(
    (value, index) => `${xFor(index)},${yFor(value)}`,
  )

  const startingY = yFor(Number(startingEquity ?? 0))

  const currentIndex = values.length - 1
  const currentX = xFor(currentIndex)
  const currentY = yFor(values[currentIndex])

  const hoveredPoint =
    hoveredIndex != null && hoveredIndex > 0
      ? points[hoveredIndex - 1]
      : null

  const hoveredTrade = hoveredPoint?.trade ?? null

  return (
    <div className="paper-equity-chart">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Paper account equity curve"
        onMouseLeave={() => setHoveredIndex(null)}
      >
        <line
  x1={paddingLeft}
  y1={height - paddingBottom}
  x2={width - paddingRight}
  y2={height - paddingBottom}
  className="paper-chart-axis"
/>

        <line
  x1={paddingLeft}
  y1={startingY}
        x2={width - paddingRight}
        y2={startingY}
       className="paper-chart-starting-line"
       />

        <text
  x={paddingLeft - 10}
  y={startingY + 3}
  textAnchor="end"
          className="paper-chart-starting-label"
        >
          Starting equity {formatMoney(startingEquity)}
        </text>

        <polyline
          points={coordinates.join(' ')}
          className="paper-equity-line"
        />

        {values.map((value, index) => {
          if (index === 0) return null

          return (
            <circle
              key={index}
              cx={xFor(index)}
              cy={yFor(value)}
              r="8"
              className="paper-equity-hover-target"
              onMouseEnter={() => setHoveredIndex(index)}
            />
          )
        })}

        <circle
          cx={currentX}
          cy={currentY}
          r="5"
          className="paper-equity-current-point"
        />

        {hoveredIndex != null && hoveredIndex > 0 && (
          <>
            <line
              x1={xFor(hoveredIndex)}
              x2={xFor(hoveredIndex)}
              y1={paddingTop}
y2={height - paddingBottom}
              className="paper-equity-hover-line"
            />

            <circle
              cx={xFor(hoveredIndex)}
              cy={yFor(values[hoveredIndex])}
              r="5"
              className="paper-equity-hover-point"
            />
          </>
        )}
      </svg>

      {hoveredPoint ? (
        <div className="paper-equity-tooltip">
          <strong>
            Trade {hoveredIndex}
            {hoveredTrade?.symbol
              ? ` · ${hoveredTrade.symbol}`
              : ''}
          </strong>

          <span>
            Equity {formatMoney(hoveredPoint.equity)}
          </span>

          <span>
            Trade P&amp;L{' '}
            {hoveredTrade?.pnl == null
              ? '—'
              : formatMoney(hoveredTrade.pnl)}
          </span>

          <span>
            Result{' '}
            {hoveredTrade?.rMultiple == null
              ? '—'
              : formatR(hoveredTrade.rMultiple)}
          </span>
        </div>
      ) : (
        <div className="paper-equity-hover-hint">
          Hover the equity curve to inspect a closed trade.
        </div>
      )}
    </div>
  )
}

export function PaperTradingPanel() {
  const {
    snapshot,
    operational,
    error,
    loading,
    refresh,
  } = usePaperSnapshot()

  const [showAllTrades, setShowAllTrades] = useState(false)
  const [selectedTradeId, setSelectedTradeId] = useState(null)
  const trades = projectPaperTrades(snapshot?.trades ?? [])

  const openTrades = trades.filter(
    ({ trade }) => trade.status === 'open',
  )

  const closedTrades = trades.filter(
    ({ trade }) => trade.status === 'closed',
  )

  const recentClosedTrades = closedTrades.slice(0, 5)
  const defaultSelectedRow =
  openTrades[0] ??
  recentClosedTrades[0] ??
  trades[0] ??
  null

const selectedRow =
  trades.find(
    ({ trade }) => trade.id === selectedTradeId,
  ) ??
  defaultSelectedRow

const selectedTrade = selectedRow?.trade ?? null

  const equitySeries = [...closedTrades]
    .reverse()
    .reduce(
      (points, { trade }) => {
        const previous =
          points.length
            ? points[points.length - 1].equity
            : snapshot?.account?.startingEquity ?? 10000

        points.push({
          equity: previous + Number(trade.pnl ?? 0),
          trade,
        })

        return points
      },
      [],
    )

  const metrics = snapshot?.metrics
  const account = snapshot?.account

  const startingEquity =
    account?.startingEquity ?? 0

  const currentEquity =
    metrics?.currentEquity ?? startingEquity

  const equityValues = [
  startingEquity,
  ...equitySeries.map((point) => point.equity),
]

const peakEquity = Math.max(...equityValues)

let runningPeak = startingEquity
let maxDrawdown = 0

equityValues.forEach((equity) => {
  runningPeak = Math.max(runningPeak, equity)

  maxDrawdown = Math.max(
    maxDrawdown,
    runningPeak - equity,
  )
})

  const totalReturn =
    startingEquity > 0
      ? (currentEquity - startingEquity) / startingEquity
      : null

  const healthLabel =
    operational?.label ?? 'Observer Health Unconfirmed'

  const healthClass =
    operational?.healthy === true
      ? 'healthy'
      : operational
        ? 'warning'
        : 'unknown'

  return (
    <section className="paper-dashboard">
      <div className="paper-dashboard-header">
        <div>
          <p className="eyebrow">PAPER TRADING</p>
          <p className="paper-dashboard-subtitle">
            Practice SetupScan&apos;s strategy rules with simulated
            trades using real market data.
          </p>
        </div>

        <div className={`paper-health-pill ${healthClass}`}>
          <span className="paper-health-dot" />
          <span>{healthLabel}</span>
        </div>
      </div>

      <PaperTradingEducation account={snapshot?.account} />

      {loading && !snapshot && (
        <p className="paper-state">
          Loading the persisted paper journal...
        </p>
      )}

      {error && <p className="paper-error">{error}</p>}

      {snapshot && (
        <>
          <div className="paper-summary-grid">
            <article className="paper-summary-card">
              <span>Paper Account Balance</span>
              <strong>{formatMoney(currentEquity)}</strong>
              <small>
                Starting: {formatMoney(startingEquity)}
              </small>
            </article>

            <article className="paper-summary-card">
              <span>Buying Power</span>
              <strong>Not modeled</strong>
              <small>Capital allocation model pending</small>
            </article>

            <article className="paper-summary-card">
              <span>Today&apos;s P/L</span>
              <strong>—</strong>
              <small>Daily P/L breakdown pending</small>
            </article>

            <article className="paper-summary-card">
              <span>Total Return</span>
              <strong>{formatPercent(totalReturn)}</strong>
              <small>
                {formatMoney(currentEquity - startingEquity)}
              </small>
            </article>

            <article className="paper-summary-card">
              <span>Win Rate</span>
              <strong>{formatPercent(metrics?.winRate)}</strong>
              <small>
                {metrics?.wins ?? 0} wins / {metrics?.losses ?? 0}{' '}
                losses
              </small>
            </article>

            <article className="paper-summary-card">
              <span>Open Positions</span>
              <strong>{openTrades.length}</strong>
              <small>
                {metrics?.totalTrades ?? 0} total paper trades
              </small>
            </article>
          </div>

          <section className="paper-section">
            <div className="paper-section-heading">
              <div>
                <p className="eyebrow">ACTIVE PAPER TRADES</p>
                <h3>Open Positions ({openTrades.length})</h3>
              </div>

              <button
                className="refresh-button"
                onClick={refresh}
              >
                Refresh
              </button>
            </div>

            <div className="paper-open-table-wrap">
              <table className="paper-open-table">
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th>Side</th>
                    <th>Entry</th>
                    <th>Stop</th>
                    <th>Protection</th>
                    <th>Score</th>
                    <th>Setup</th>
                    <th>Status</th>
                  </tr>
                </thead>

                <tbody>
                  {openTrades.length ? (
                    openTrades.map(({ trade }) => (
                      <tr
  key={trade.id}
  className={
    selectedTrade?.id === trade.id
      ? 'paper-trade-row-selected'
      : ''
  }
  onClick={() => setSelectedTradeId(trade.id)}
>
                        <td>
                          <strong>{trade.symbol}</strong>
                        </td>

                        <td>
                          <span className="paper-side-badge">
                            LONG
                          </span>
                        </td>

                        <td>
                          {formatMoney(
                            trade.theoreticalEntryPrice,
                          )}
                        </td>

                        <td>{formatMoney(trade.stopPrice)}</td>

                        <td>
                          {trade.trailingStopActive
                            ? 'Trailing active'
                            : 'Initial stop'}
                        </td>

                        <td>{trade.signalScore ?? '—'}</td>

                        <td>{trade.setupType ?? '—'}</td>

                        <td>
                          <span className="paper-open-badge">
                            Open
                          </span>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td
                        colSpan="8"
                        className="paper-empty-row"
                      >
                        No open paper positions right now.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="paper-trade-workspace">
  <div className="paper-trade-chart-card">
    <div className="paper-section-heading">
      <div>
        <p className="eyebrow">TRADE REVIEW</p>
        <h3>
          {selectedTrade
            ? `${selectedTrade.symbol} Trade Chart`
            : 'Trade Chart'}
        </h3>
      </div>

      {selectedTrade && (
        <span className="paper-selected-trade-status">
          {selectedTrade.status === 'open'
            ? 'OPEN'
            : 'CLOSED'}
        </span>
      )}
    </div>

    <PaperTradeChart trade={selectedTrade} />
  </div>

  <aside className="paper-trade-details-card">
    <div className="paper-section-heading">
      <div>
        <p className="eyebrow">POSITION DATA</p>
        <h3>Trade Details</h3>
      </div>
    </div>

    {selectedTrade ? (
      <div className="paper-trade-details">
        <div>
          <span>Symbol</span>
          <strong>{selectedTrade.symbol}</strong>
        </div>

        <div>
  <span>Status</span>
  <strong>
    {selectedTrade.status === 'open'
      ? 'Open'
      : `Closed${
          selectedRow?.exitReason
            ? ` · ${
                selectedRow.exitReason === 'Expired'
                  ? 'Time Limit'
                  : selectedRow.exitReason === 'Stop'
                    ? selectedTrade.trailingStopActive
                      ? 'Trailing Stop'
                      : 'Initial Stop'
                    : selectedRow.exitReason
              }`
            : ''
        }`}
  </strong>
</div>

        <div>
          <span>Setup</span>
          <strong>
            {selectedTrade.setupType ?? '—'}
          </strong>
        </div>

        <div>
          <span>Score</span>
          <strong>
            {selectedTrade.signalScore ?? '—'}
          </strong>
        </div>

        <div>
          <span>Entry</span>
          <strong>
            {formatMoney(
              selectedTrade.theoreticalEntryPrice,
            )}
          </strong>
        </div>

        <div>
          <span>Initial Stop</span>
          <strong>
            {formatMoney(selectedTrade.stopPrice)}
          </strong>
        </div>

        <div>
          <span>Target</span>
          <strong>
            {formatMoney(
              selectedTrade.targetPrice ??
                selectedTrade.profitTarget,
            )}
          </strong>
        </div>

        <div>
          <span>Protection</span>
          <strong>
            {selectedTrade.trailingStopActive
              ? 'Trailing active'
              : 'Initial stop'}
          </strong>
        </div>

        <div>
          <span>Entry Time</span>
          <strong>
            {selectedRow?.entryTime ?? '—'}
          </strong>
        </div>

<div>
  <span>Exit Time</span>
  <strong>
    {selectedRow?.exitTime ?? '—'}
  </strong>
</div>

        <div>
          <span>R Result</span>
          <strong>
            {selectedTrade.rMultiple == null
              ? '—'
              : formatR(selectedTrade.rMultiple)}
          </strong>
        </div>

       <div className="paper-trade-detail-wide">
  <span>Hypothetical P&amp;L</span>
  <strong>
    {selectedTrade.pnl == null
      ? '—'
      : formatMoney(selectedTrade.pnl)}
  </strong>
</div>
      </div>
    ) : (
      <p className="paper-empty-copy">
        No paper trade is available to review.
      </p>
    )}
  </aside>
</section>
          <details className="paper-operations-details">
            <summary>Observer &amp; journal details</summary>

            <PaperObserverStatus operational={operational} />

            <div className="paper-operations-copy">
              <p>
                Paper journal source:{' '}
                {snapshot.storage === 'POSTGRES OBSERVER STATE'
                  ? 'the independent observer’s PostgreSQL state'
                  : 'the local JSON development fallback'}
                .
              </p>

              <p>{snapshot.limitation}</p>

              <p>
                This dashboard reads persisted paper results. It
                does not create trades or place real orders.
              </p>
            </div>
          </details>

          <div className="paper-lower-grid">
            <section className="paper-section">
              <div className="paper-section-heading">
                <div>
                  <p className="eyebrow">TRADE JOURNAL</p>
                  <h3>Recent Closed Trades</h3>
                </div>

                <button
                  className="paper-link-button"
                  onClick={() =>
                    setShowAllTrades((value) => !value)
                  }
                >
                  {showAllTrades
                    ? 'Show Recent'
                    : 'View All Trades'}
                </button>
              </div>

              <div className="paper-table-wrap">
                <table className="paper-table paper-recent-table">
                  <thead>
                    <tr>
                      <th>Symbol</th>
                      <th>Entry</th>
                      <th>Exit</th>
                      <th>Setup</th>
                      <th>R</th>
                      <th>P&amp;L</th>
                    </tr>
                  </thead>

                  <tbody>
                    {(showAllTrades
                      ? closedTrades
                      : recentClosedTrades
                    ).length ? (
                      (showAllTrades
                        ? closedTrades
                        : recentClosedTrades
                      ).map(
                        ({
                          trade,
                          entryTime,
                          exitLabel,
                          exitReason,
                        }) => (
                          <tr
  key={trade.id}
  className={
    selectedTrade?.id === trade.id
      ? 'paper-trade-row-selected'
      : ''
  }
  onClick={() => setSelectedTradeId(trade.id)}
>
                            <td>
                              <strong>{trade.symbol}</strong>
                            </td>

                            <td>{entryTime}</td>

                            <td>
                              {exitLabel}
                              {exitReason
                                ? ` · ${exitReason}`
                                : ''}
                            </td>

                            <td>{trade.setupType ?? '—'}</td>

                            <td>
                              {trade.rMultiple == null
                                ? '—'
                                : formatR(trade.rMultiple)}
                            </td>

                            <td>
                              {trade.pnl == null
                                ? '—'
                                : formatMoney(trade.pnl)}
                            </td>
                          </tr>
                        ),
                      )
                    ) : (
                      <tr>
                        <td
                          colSpan="6"
                          className="paper-empty-row"
                        >
                          No closed paper trades yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

   <section className="paper-section paper-performance-card">
  <div className="paper-section-heading">
    <div>
      <p className="eyebrow">PAPER EQUITY</p>
      <h3>Account Performance</h3>
    </div>

    <div className="paper-performance-summary">
      <div>
        <span>Return</span>
        <strong>{formatPercent(totalReturn)}</strong>
      </div>

      <div>
        <span>Current</span>
        <strong>{formatMoney(currentEquity)}</strong>
      </div>

      <div>
        <span>Peak</span>
        <strong>{formatMoney(peakEquity)}</strong>
      </div>

      <div>
        <span>Max Drawdown</span>
        <strong>-{formatMoney(maxDrawdown)}</strong>
      </div>
    </div>
  </div>

  <PaperEquityChart
    points={equitySeries}
    startingEquity={startingEquity}
  />
</section>
</div>
 </>
      )}
    </section>
  )
}