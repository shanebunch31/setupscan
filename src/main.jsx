import React, { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  Activity,
  ChevronRight,
  ArrowUpRight,
  BarChart3,
  Bell,
  CircleHelp,
  House,
  LineChart,
  Menu,
  RefreshCw,
  Search,
  Settings2,
  Target,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  X,
} from 'lucide-react'
import {
  enrichHistoricalCandles,
  fetchHistoricalMarketData,
  getHistoricalMarketData,
} from './data/marketData.js'
import { createScannerRange, fetchScannerSnapshot, isSuccessfulScannerRefresh, scannerDataQualityNotices } from './data/scannerSnapshot.js'
import { scanSetups } from './logic/scanner.js'
import { runSetupScanBacktest } from './backtest/strategy.js'
import { getBacktestBreakdown } from './backtest/breakdown.js'
import { StrategyRobustnessLab } from './backtest/RobustnessLab.jsx'
import { RelativeValueResearchLab } from './backtest/RelativeValueResearchLab.jsx'
import { SignalQualityResearchLab } from './backtest/SignalQualityResearchLab.jsx'
import { FrozenScoreHoldoutLab } from './backtest/FrozenScoreHoldoutLab.jsx'
import { YearlyRegimeLab } from './backtest/YearlyRegimeLab.jsx'
import { CausalRegimeLab } from './backtest/CausalRegimeLab.jsx'
import { WalkForwardRegimeLab } from './backtest/WalkForwardRegimeLab.jsx'
import { VolatilityAwareVariantsLab } from './backtest/VolatilityAwareVariantsLab.jsx'
import { StrategyDiscoveryLab } from './backtest/StrategyDiscoveryLab.jsx'
import { PaperTradingPanel } from './paper/PaperTradingPanel.jsx'
import { MarketStatus } from './MarketStatus.js'
import { MarketSnapshotStrip } from './MarketSnapshotStrip.jsx'
import { MorningBrief } from './home/MorningBrief.jsx'
import { createRefreshTimestamp, formatLastRefresh, formatMarketTime } from './marketTime.js'
import { filterScannerResults, ScannerFiltersButton, ScannerThresholdFilter, SCANNER_TERM_EXPLANATIONS } from './scannerFilters.js'
import { METRIC_DEFINITIONS, MetricsGlossary, TermHelp } from './backtest/MetricsGlossary.jsx'
import { BACKTEST_EXTRA_DEFINITIONS, BACKTEST_LEARNING_INTRO } from './backtest/backtestLearning.js'
import {
  listResearchRuns,
} from './research/researchRunHistory.js'
import { projectResearchComparisonRuns, ResearchWorkspace } from './research/ResearchWorkspace.js'
import './styles.css'

const DEFAULT_WATCHLIST = ['SPY', 'QQQ', 'IWM', 'NVDA', 'TSLA', 'AAPL', 'AMD', 'META', 'AMZN']
const robustnessSymbols = ['SPY', 'QQQ', 'IWM']
const navItems = [
  { id: 'home', label: 'Home' },
  { id: 'scan', label: 'Scan' },
  { id: 'paper', label: 'Paper Trading' },
  { id: 'backtest', label: 'Backtest' },
  { id: 'research', label: 'Research' },
  { id: 'settings', label: 'Settings' },
]
const researchTabs = [
  { id: 'robustness', label: 'Strategy Resilience' },
  { id: 'relative-value', label: 'Relative Value' },
  { id: 'signal-quality', label: 'Signal Quality / Expected Value' },
  { id: 'frozen-score-holdout', label: 'Frozen Score Holdout' },
  { id: 'yearly-regime', label: 'Yearly / Regime Stability' },
  { id: 'causal-regime', label: 'Causal Market-Regime Analysis' },
  { id: 'walk-forward-regime', label: 'Walk-Forward Regime Validation' },
  { id: 'volatility-aware-variants', label: 'Volatility-Aware Variants' },
  { id: 'strategy-discovery', label: 'Strategy Discovery Lab' },
]
const formatPrice = (value) => Number.isFinite(value) ? `$${value.toFixed(2)}` : '—'
const formatPercent = (value) => `${(value * 100).toFixed(1)}%`
const formatR = (value) => `${value === Infinity ? '∞' : value.toFixed(2)}R`
function scannerEmptyMessage(isLoading, evaluatedCount, unavailableCount, threshold) {
  if (isLoading) return 'Loading scanner results…'
  if (evaluatedCount === 0) {
    return `No symbols were successfully evaluated; ${unavailableCount} unavailable.`
  }
  if (unavailableCount > 0) {
    return `No evaluated symbols meet this minimum score; ${unavailableCount} unavailable.`
  }
  return `No scanner results meet this minimum score of ${threshold}.`
}
const APP_ROUTES = {
  home: '/home',
  scan: '/scan',
  paper: '/paper',
  backtest: '/backtest',
  research: '/research/workbench',
  settings: '/settings',
}

const RESEARCH_ROUTES = {
  workbench: '/research/workbench',
  history: '/research/history',
  shadow: '/research/shadow',
  comparison: '/research/comparison',
  labs: '/research/labs',
}


function readAppRoute() {
  if (typeof window === 'undefined') {
    return {
      view: 'home',
      researchWorkspaceView: 'workbench',
    }
  }

  const path = window.location.pathname.replace(/\/+$/, '') || '/'

  if (path === '/research' || path === '/research/workbench') {
    return {
      view: 'research',
      researchWorkspaceView: 'workbench',
    }
  }

  for (const [workspace, route] of Object.entries(RESEARCH_ROUTES)) {
    if (path === route) {
      return {
        view: 'research',
        researchWorkspaceView: workspace,
      }
    }
  }

  for (const [view, route] of Object.entries(APP_ROUTES)) {
    if (path === route) {
      return {
        view,
        researchWorkspaceView: 'workbench',
      }
    }
  }

  return {
    view: 'scan',
    researchWorkspaceView: 'workbench',
  }
}

function navigateAppRoute(view, researchWorkspaceView = 'workbench') {
  if (typeof window === 'undefined') return

  const route =
    view === 'research'
      ? RESEARCH_ROUTES[researchWorkspaceView] ?? RESEARCH_ROUTES.workbench
      : APP_ROUTES[view] ?? APP_ROUTES.home

  window.history.pushState({}, '', route)
}
const formatDate = (value) =>
  value ? new Date(value).toLocaleDateString('en-US', { timeZone: 'UTC' }) : '—'
const getDemoHistoricalData = () => {
  const candles = getHistoricalMarketData('SPY')
  return {
    provider: 'DEMO',
    symbol: 'SPY',
    timeframe: '1h',
    start: candles[0].timestamp,
    end: candles[candles.length - 1].timestamp,
    candleCount: candles.length,
    complete: true,
    candles,
  }
}

function ScoreRing({ score }) {
  return (
    <div className={`score-ring score-${score >= 75 ? 'high' : score >= 60 ? 'medium' : 'low'}`}>
      <strong>{score}</strong>
      <span>/100</span>
    </div>
  )
}
function TrendBadge({ trend }) {
  const bullish = trend === 'Bullish'
  return (
    <span className={`trend-badge ${bullish ? 'is-bullish' : 'is-bearish'}`}>
      {bullish ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
      {trend}
    </span>
  )
}

function CandlestickChart({ candles = [], range = '5D' }) {
  const [hoveredCandle, setHoveredCandle] = useState(null)

  const easternDateFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })

  const getSessionKey = (timestamp) => {
    const parts = easternDateFormatter.formatToParts(
      new Date(timestamp),
    )

    const year = parts.find((part) => part.type === 'year')?.value
    const month = parts.find((part) => part.type === 'month')?.value
    const day = parts.find((part) => part.type === 'day')?.value

    return `${year}-${month}-${day}`
  }

  const allValidCandles = candles
    .filter(
      (candle) =>
        Number.isFinite(candle.open) &&
        Number.isFinite(candle.high) &&
        Number.isFinite(candle.low) &&
        Number.isFinite(candle.close) &&
        Number.isFinite(new Date(candle.timestamp).getTime()),
    )
    .sort(
      (a, b) =>
        new Date(a.timestamp).getTime() -
        new Date(b.timestamp).getTime(),
    )

  const availableSessions = [
    ...new Set(
      allValidCandles.map((candle) =>
        getSessionKey(candle.timestamp),
      ),
    ),
  ]

  const sessionCount =
    range === '1D'
      ? 1
      : range === '3D'
        ? 3
        : range === '5D'
          ? 5
          : null

  const allowedSessions =
    sessionCount === null
      ? null
      : new Set(availableSessions.slice(-sessionCount))

  const validCandles =
    allowedSessions === null
      ? allValidCandles
      : allValidCandles.filter((candle) =>
          allowedSessions.has(
            getSessionKey(candle.timestamp),
          ),
        )

  useEffect(() => {
    setHoveredCandle(null)
  }, [range, candles])

  if (validCandles.length < 2) {
    return (
      <div className="selected-chart-empty">
        Not enough completed candle data to draw this chart.
      </div>
    )
  }

  const width = 900
  const height = 270

  const left = 10
  const right = 58
  const priceTop = 12
  const priceBottom = 202
  const volumeTop = 214
  const volumeBottom = 248

  const lows = validCandles.map((candle) => candle.low)
  const highs = validCandles.map((candle) => candle.high)

  const rawLow = Math.min(...lows)
  const rawHigh = Math.max(...highs)

  const rawRange = rawHigh - rawLow
  const pricePadding = rawRange > 0 ? rawRange * 0.06 : 1

  const minPrice = rawLow - pricePadding
  const maxPrice = rawHigh + pricePadding
  const priceRange = maxPrice - minPrice

  const plotWidth = width - left - right
  const priceHeight = priceBottom - priceTop
  const volumeHeight = volumeBottom - volumeTop

  const step = plotWidth / validCandles.length
  const bodyWidth = Math.max(
    3,
    Math.min(12, step * 0.58),
  )

  const maxVolume = Math.max(
    1,
    ...validCandles.map((candle) =>
      Number.isFinite(candle.volume)
        ? candle.volume
        : 0,
    ),
  )

  const xFor = (index) =>
    left + index * step + step / 2

  const yFor = (price) =>
    priceTop +
    ((maxPrice - price) / priceRange) * priceHeight

  const priceTicks = [0, 0.25, 0.5, 0.75, 1]

  const labelIndexes = [
    0,
    Math.floor((validCandles.length - 1) / 2),
    validCandles.length - 1,
  ]

  const formatChartDate = (timestamp) =>
    new Date(timestamp).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      timeZone: 'America/New_York',
    })

  const formatCandleTime = (timestamp) =>
    new Date(timestamp).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'America/New_York',
      timeZoneName: 'short',
    })

  const formatVolume = (volume) =>
    Number.isFinite(volume)
      ? new Intl.NumberFormat('en-US', {
          notation: 'compact',
          maximumFractionDigits: 1,
        }).format(volume)
      : 'Unavailable'

  return (
    <div className="candlestick-chart-shell">
      <div className="candlestick-hover-readout">
        {hoveredCandle ? (
          <>
            <span className="hover-candle-time">
              {formatCandleTime(hoveredCandle.timestamp)}
            </span>

            <span>
              O <strong>{formatPrice(hoveredCandle.open)}</strong>
            </span>

            <span>
              H <strong>{formatPrice(hoveredCandle.high)}</strong>
            </span>

            <span>
              L <strong>{formatPrice(hoveredCandle.low)}</strong>
            </span>

            <span>
              C <strong>{formatPrice(hoveredCandle.close)}</strong>
            </span>

            <span>
              Vol <strong>{formatVolume(hoveredCandle.volume)}</strong>
            </span>
          </>
        ) : (
          <span className="hover-chart-help">
            Hover over a candle to see open, high, low, close and volume.
          </span>
        )}
      </div>

      <div className="candlestick-chart">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`Completed one-hour candlestick chart — ${range}`}
          onMouseLeave={() => setHoveredCandle(null)}
        >
          {priceTicks.map((ratio) => {
            const y =
              priceTop +
              ratio * priceHeight

            const value =
              maxPrice -
              ratio * priceRange

            return (
              <g key={ratio}>
                <line
                  className="candlestick-grid-line"
                  x1={left}
                  x2={width - right}
                  y1={y}
                  y2={y}
                />

                <text
                  className="candlestick-price-label"
                  x={width - right + 8}
                  y={y + 3}
                >
                  {value.toFixed(2)}
                </text>
              </g>
            )
          })}

          {validCandles.map((candle, index) => {
            const x = xFor(index)

            const openY = yFor(candle.open)
            const closeY = yFor(candle.close)
            const highY = yFor(candle.high)
            const lowY = yFor(candle.low)

            const isUp = candle.close >= candle.open
            const isHovered =
              hoveredCandle?.timestamp === candle.timestamp

            const bodyY = Math.min(openY, closeY)

            const bodyHeight = Math.max(
              2,
              Math.abs(closeY - openY),
            )

            const volume =
              Number.isFinite(candle.volume)
                ? candle.volume
                : 0

            const volumeBarHeight =
              (volume / maxVolume) * volumeHeight

            return (
              <g
                key={`${candle.timestamp}-${index}`}
                className={`${
                  isUp
                    ? 'chart-candle-up'
                    : 'chart-candle-down'
                } ${isHovered ? 'is-hovered' : ''}`}
                onMouseEnter={() =>
                  setHoveredCandle(candle)
                }
              >
                <rect
                  className="candlestick-hover-target"
                  x={x - step / 2}
                  y={priceTop}
                  width={step}
                  height={volumeBottom - priceTop}
                  fill="transparent"
                />

                <line
                  x1={x}
                  x2={x}
                  y1={highY}
                  y2={lowY}
                  stroke="currentColor"
                  strokeWidth={
                    isHovered ? '2' : '1.4'
                  }
                />

                <rect
                  x={x - bodyWidth / 2}
                  y={bodyY}
                  width={bodyWidth}
                  height={bodyHeight}
                  fill="currentColor"
                  rx="1"
                />

                <rect
                  className="candlestick-volume"
                  x={x - bodyWidth / 2}
                  y={
                    volumeBottom -
                    volumeBarHeight
                  }
                  width={bodyWidth}
                  height={volumeBarHeight}
                  fill="currentColor"
                />
              </g>
            )
          })}

          <line
            className="candlestick-volume-divider"
            x1={left}
            x2={width - right}
            y1={volumeTop - 5}
            y2={volumeTop - 5}
          />

          {labelIndexes.map((index) => (
            <text
              key={index}
              className="candlestick-date-label"
              x={xFor(index)}
              y={265}
              textAnchor={
                index === 0
                  ? 'start'
                  : index === validCandles.length - 1
                    ? 'end'
                    : 'middle'
              }
            >
              {formatChartDate(
                validCandles[index].timestamp,
              )}
            </text>
          ))}
        </svg>
      </div>
    </div>
  )
}
const formatBreakdownR = (value) => `${value === Infinity ? '∞' : value.toFixed(2)}R`

function BreakdownTable({ title, groups }) {
  return (
    <div className="breakdown-section">
      <h3>{title}</h3>
      <div className="breakdown-table-wrap">
        <table className="breakdown-table">
          <thead>
            <tr>
              <th>Group</th>
              <th>Trades</th>
              <th>Win rate</th>
              <th>Profit factor</th>
              <th>Expectancy</th>
              <th>Average R</th>
              <th>Max drawdown</th>
            </tr>
          </thead>
          <tbody>
            {groups.map(({ label, metrics }) => (
              <tr key={label}>
                <td>{label}</td>
                <td>{metrics.tradeCount}</td>
                <td>{formatPercent(metrics.winRate)}</td>
                <td>{metrics.profitFactor === Infinity ? '∞' : metrics.profitFactor.toFixed(2)}</td>
                <td>{formatBreakdownR(metrics.expectancy)}</td>
                <td>{formatBreakdownR(metrics.averageR)}</td>
                <td>{formatBreakdownR(metrics.maximumDrawdown)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function BacktestBreakdown({ backtest, symbol }) {
  const breakdown = useMemo(() => getBacktestBreakdown(backtest), [backtest])
  const overall = [{ label: 'Overall', metrics: breakdown.overall }]
  return (
    <section className="backtest-breakdown panel">
      <div className="panel-heading compact">
        <div>
        <p className="eyebrow">BACKTEST LAB · {symbol} · 1H</p>
          <h2>Backtest breakdown</h2>
        </div>
        <span className="coming-soon">RESEARCH ONLY</span>
      </div>
      <div className="breakdown-overall">
        <strong>Overall results</strong>
        <span>
          {breakdown.overall.tradeCount} trades · {formatPercent(breakdown.overall.winRate)} win
          rate · {formatBreakdownR(breakdown.overall.averageR)} average R
        </span>
      </div>
      <p className="backtest-learning-intro">{BACKTEST_LEARNING_INTRO}</p>
      <BreakdownTable title="Overall comparison" groups={overall} />
      <BreakdownTable title="Setup score" groups={breakdown.scoreBuckets} />
      <BreakdownTable title="Setup type" groups={breakdown.setupTypes} />
      <BreakdownTable
        title="Direction · current strategy is long-only"
        groups={breakdown.directions}
      />
      <BreakdownTable title="Sample partition" groups={breakdown.partitions} />
      <p className="research-note">
        Descriptive historical analysis of existing trades. Subgroups are not claims of a validated
        edge.
      </p>
    </section>
  )
}

const comparisonThresholds = [75, 80, 85, 90, 95]
const BACKTEST_GLOSSARY_DEFINITIONS = [...METRIC_DEFINITIONS, ...BACKTEST_EXTRA_DEFINITIONS]

function ThresholdComparison({ candles, symbol }) {
  const comparisons = useMemo(
    () =>
      comparisonThresholds.map((minimumScore) => {
        const result = runSetupScanBacktest(candles, { minimumScore })
        return {
          minimumScore,
          metrics: result.metrics,
          inSampleMetrics: result.inSampleMetrics,
          outOfSampleMetrics: result.outOfSampleMetrics,
        }
      }),
    [candles],
  )
  return (
    <section className="threshold-comparison panel">
      <div className="panel-heading compact">
        <div>
          <p className="eyebrow">EXPLORATORY RESEARCH · {symbol} · 1H</p>
          <h2>Threshold comparison</h2>
        </div>
        <span className="coming-soon">NO WINNER SELECTED</span>
      </div>
      <p className="comparison-note">
        The same strategy rules and chronological split are evaluated at each minimum score
        threshold. This table is descriptive research, not optimization or validation.
      </p>
      <div className="breakdown-table-wrap">
        <table className="breakdown-table threshold-table">
          <thead>
            <tr>
              <th>Threshold</th>
              <th>Trades</th>
              <th>Win rate</th>
              <th>Profit factor</th>
              <th>Expectancy</th>
              <th>Average R</th>
              <th>Max drawdown</th>
              <th>Average hold (minutes)</th>
              <th>In-sample</th>
              <th>Out-of-sample</th>
            </tr>
          </thead>
          <tbody>
            {comparisons.map(({ minimumScore, metrics, inSampleMetrics, outOfSampleMetrics }) => (
              <tr key={minimumScore}>
                <td>{minimumScore}+</td>
                <td>{metrics.totalTrades}</td>
                <td>{formatPercent(metrics.winRate)}</td>
                <td>{metrics.profitFactor === Infinity ? '∞' : metrics.profitFactor.toFixed(2)}</td>
                <td>{formatBreakdownR(metrics.expectancy)}</td>
                <td>{formatBreakdownR(metrics.averageR)}</td>
                <td>{formatBreakdownR(metrics.maximumDrawdown)}</td>
                <td>{metrics.averageHoldingTime.toFixed(0)}m</td>
                <td>
                  {inSampleMetrics.totalTrades} · {formatPercent(inSampleMetrics.winRate)}
                </td>
                <td>
                  {outOfSampleMetrics.totalTrades} · {formatPercent(outOfSampleMetrics.winRate)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function BacktestDiagnostics({ backtest, data, error }) {
  const { metrics } = backtest
  const checks = [
    ['Provider', data?.provider ?? 'LOADING'],
    ['Symbol', data?.symbol ?? 'SPY'],
    ['Timeframe', data?.timeframe ?? '1Hour'],
    ['Start date', formatDate(data?.start)],
    ['End date', formatDate(data?.end)],
    ['Candle count', data?.candleCount ?? 0],
    ['Data status', data?.complete === false ? 'INCOMPLETE' : (data?.provider ?? 'LOADING')],
    ['Winning trades', metrics.winningTrades],
    ['Losing trades', metrics.losingTrades],
    ['Expired trades', metrics.expiredTrades],
    ['Total positive R', formatR(metrics.totalPositiveR)],
    ['Total negative R', formatR(metrics.totalNegativeR)],
    ['Calculated profit factor', formatR(metrics.calculatedProfitFactor)],
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
          <h2>{data?.provider === 'DEMO' ? 'Demo calculation data' : 'Historical research data'}</h2>
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
        <strong>{provider}</strong>
        <span>
          {formatDate(data?.start)} – {formatDate(data?.end)}
          {' · '}
          {(data?.candleCount ?? 0).toLocaleString()} candles
          {' · '}
          {status}
        </span>
      </p>
      {error ? <p className="data-error" role="alert">{error}</p> : null}
      {data?.complete === false ? (
        <p className="data-error" role="alert">
          Historical data is incomplete; interpret these results with caution.
        </p>
      ) : null}
    </div>
  )
}

function TopBar({
  view,
  onNavigate,
  navOpen,
  onToggleNav,
  currentTime,
  watchlistSymbol,
  onWatchlistSymbolChange,
  onAddSymbol,
  onSelectSymbol,
}) {
  const submitSymbol = (event) => {
    event.preventDefault()

    const symbol = watchlistSymbol.trim().toUpperCase()

    if (!symbol) return

    onAddSymbol(symbol)
    onSelectSymbol(symbol)
    onWatchlistSymbolChange('')
    onNavigate('scan')
  }

  return (
    <header className="topbar">
      <form
        className="topbar-symbol-search"
        onSubmit={submitSymbol}
      >
        <Search size={16} />

        <input
          value={watchlistSymbol}
          onChange={(event) =>
            onWatchlistSymbolChange(event.target.value.toUpperCase())
          }
          placeholder="Search symbol to add to watchlist and scanner..."
          aria-label="Add symbol to watchlist and scanner"
        />

        <button type="submit">
          Add
        </button>
      </form>
      <MarketSnapshotStrip />

      <MarketStatus now={currentTime} />

      <button
        className="icon-button"
        aria-label="Notifications"
      >
        <Bell size={18} />
      </button>

      <button
        className="icon-button nav-toggle"
        aria-label="Toggle navigation"
        onClick={onToggleNav}
      >
        {navOpen ? <X size={18} /> : <Menu size={18} />}
      </button>

      {navOpen && (
        <nav className="mobile-nav">
          {navItems.map((item) => (
            <button
              key={item.id}
              className={`nav-link ${view === item.id ? 'active' : ''}`}
              aria-current={view === item.id ? 'page' : undefined}
              onClick={() => onNavigate(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      )}
    </header>
  )
}

function AppSidebar({
  view,
  onNavigate,
  researchWorkspaceView,
  onResearchNavigate,
  watchlist,
  selectedSymbol,
  onSelectSymbol,
}) {
  const icons = {
    home: House,
    scan: Activity,
    paper: LineChart,
    backtest: BarChart3,
    research: CircleHelp,
    settings: Settings2,
  }

  const researchLinks = [
    ['labs', 'Research Labs'],
    ['workbench', 'Research Workbench'],
    ['history', 'History'],
    ['comparison', 'Comparison'],
    ['shadow', 'Shadow Forward'],
  ]

  return (
    <aside className="app-sidebar">
      <div className="sidebar-brand">
  <div className="sidebar-brand-title">
    <div className="brand-mark">
      <BarChart3 size={19} />
    </div>

    <strong>SetupScan</strong>
  </div>

  <p className="sidebar-motto">
    <span>Find the signal</span>
    <br />
    <em>before the noise.</em>
  </p>
</div>
      <nav className="sidebar-main-nav" aria-label="Main navigation">
        {navItems.map((item) => {
          const Icon = icons[item.id] ?? Activity

          return (
           <button
            key={item.id}
            type="button"
            className={`sidebar-nav-button ${
            view === item.id ? 'active' : ''
     }`}
            aria-current={view === item.id ? 'page' : undefined}
            onClick={() => onNavigate(item.id)}
       >
              <Icon size={17} />
              <span>{item.label}</span>
            </button>
          )
        })}
      </nav>

      {view === 'research' ? (
        <section className="sidebar-section">
          <span className="sidebar-section-label">RESEARCH</span>

          <div className="sidebar-subnav">
            {researchLinks.map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={
                  researchWorkspaceView === id ? 'active' : ''
                }
                aria-current={
  researchWorkspaceView === id
    ? 'page'
    : undefined
}
                onClick={() => onResearchNavigate(id)}
              >
                {label}
              </button>
            ))}
          </div>
        </section>
      ) : (
        <section className="sidebar-section">
          <span className="sidebar-section-label">WATCHLIST</span>

          <div className="sidebar-watchlist">
            {watchlist.slice(0, 7).map((symbol) => (
              <button
                key={symbol}
                type="button"
                className={selectedSymbol === symbol ? 'active' : ''}
                onClick={() => onSelectSymbol(symbol)}
              >
                <span>{symbol}</span>

                {selectedSymbol === symbol && (
                  <small>Selected</small>
                )}
              </button>
            ))}
          </div>
        </section>
      )}

      <div className="sidebar-help">
        <CircleHelp size={19} />

        <div>
          <strong>Need help?</strong>
          <p>
            SetupScan explains unfamiliar trading and research terms in
            plain English.
          </p>
        </div>
      </div>
    </aside>
  )
}

function App() {
  const initialRoute = readAppRoute()
const [view, setView] = useState(initialRoute.view)
const [navOpen, setNavOpen] = useState(false)
const [watchlist, setWatchlist] = useState(DEFAULT_WATCHLIST)
const [watchlistSymbol, setWatchlistSymbol] = useState('')
const addToWatchlist = (symbol) => {
  const normalized = symbol.trim().toUpperCase()

  if (!normalized || watchlist.includes(normalized)) return

  setWatchlist((current) => [...current, normalized])
}

const removeFromWatchlist = (symbol) => {
  setWatchlist((current) => {
    const next = current.filter((item) => item !== symbol)

    if (selectedSymbol === symbol && next.length > 0) {
      setSelectedSymbol(next[0])
    }

    return next
  })
}
const [researchTab, setResearchTab] = useState('robustness')
const [researchWorkspaceView, setResearchWorkspaceView] = useState(
  initialRoute.researchWorkspaceView,
)
  const [selectedResearchRunId, setSelectedResearchRunId] = useState(null)
  const [comparisonRuns, setComparisonRuns] = useState([])
  const [comparisonRunsLoading, setComparisonRunsLoading] = useState(false)
  const [comparisonRunsError, setComparisonRunsError] = useState(null)
  const [threshold, setThreshold] = useState(65)
  const [scannerFiltersOpen, setScannerFiltersOpen] = useState(false)
  const [selectedSymbol, setSelectedSymbol] = useState('SPY')
  const [expandedSymbol, setExpandedSymbol] = useState(null)
  const [backtestRangeYears, setBacktestRangeYears] = useState(2)
  const [watchlistOpen, setWatchlistOpen] = useState(false)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [currentTime, setCurrentTime] = useState(() => new Date())
  const [historicalData, setHistoricalData] = useState(null)
  const [historicalStatus, setHistoricalStatus] = useState('LOADING HISTORICAL')
  const [historicalError, setHistoricalError] = useState(null)
  const [backtestLoading, setBacktestLoading] = useState(false)
  const [robustnessData, setRobustnessData] = useState(
    robustnessSymbols.map((symbol) => ({ symbol, status: 'LOADING' })),
  )
  const [frozenScoreData, setFrozenScoreData] = useState(
    robustnessSymbols.map((symbol) => ({ symbol, status: 'LOADING' })),
  )
 const historicalRange = useMemo(() => {
  const end = new Date()
  const start = new Date(end)
  start.setUTCFullYear(start.getUTCFullYear() - backtestRangeYears)
  return { start: start.toISOString(), end: end.toISOString() }
}, [backtestRangeYears])

  const frozenScoreRange = useMemo(() => {
    const end = new Date()
    return {
      start: '2022-01-01T00:00:00.000Z',
      end: end.toISOString(),
    }
  }, [])

  const scanRange = useMemo(() => createScannerRange(), [])
  const [scanSnapshot, setScanSnapshot] = useState([])
  const [scanUnavailable, setScanUnavailable] = useState([])
  const [scanDataQuality, setScanDataQuality] = useState([])
  const [scanLoading, setScanLoading] = useState(true)
  const [selectedChartCandles, setSelectedChartCandles] = useState([])
  const [selectedChartLoading, setSelectedChartLoading] = useState(false)
  const [selectedChartError, setSelectedChartError] = useState(null)
  const [selectedChartRange, setSelectedChartRange] = useState('5D')
  useEffect(() => {
    const clock = setInterval(() => setCurrentTime(new Date()), 15000)
    return () => clearInterval(clock)
  }, [])

  useEffect(() => {
  if (view !== 'scan' && view !== 'home') {
    setScanLoading(false)
    return undefined
  }

  let active = true
  setScanLoading(true)

  fetchScannerSnapshot(watchlist, scanRange)
    .then((entries) => {
      if (!active) return

      const availableEntries = entries.filter(
        (entry) => entry.available,
      )

      setScanSnapshot(
        availableEntries.map(
          (entry) => entry.snapshot,
        ),
      )

      setScanUnavailable(
        watchlist.filter((symbol) => !availableEntries.some((entry) => entry.symbol === symbol)),
      )
      setScanDataQuality(scannerDataQualityNotices(entries))

      if (availableEntries.length > 0) {
        setHistoricalStatus('ALPACA HISTORICAL')
        setHistoricalError(null)
      } else {
        setHistoricalStatus('DATA ERROR')
        setHistoricalError(
          'No Alpaca historical data was available for the scanner.',
        )
      }

      setScanLoading(false)
    })
    .catch((error) => {
      if (!active) return

      setHistoricalStatus('DATA ERROR')
      setHistoricalError(error.message)
      setScanSnapshot([])
      setScanUnavailable(watchlist)
      setScanDataQuality([])
      setScanLoading(false)
    })

  return () => {
    active = false
  }
}, [view, scanRange, watchlist])

useEffect(() => {
  if (view !== 'scan' || !selectedSymbol) {
    return undefined
  }

  let active = true

  setSelectedChartLoading(true)
  setSelectedChartError(null)

  fetchHistoricalMarketData(
    selectedSymbol,
    '1Hour',
    createScannerRange(),
  )
    .then((data) => {
      if (!active) return

      const nowMs = Date.now()

      const completedCandles = (data?.candles ?? [])
        .filter((candle) => {
          const candleStart =
            new Date(candle.timestamp).getTime()

          return (
            Number.isFinite(candleStart) &&
            candleStart + 60 * 60 * 1000 <= nowMs
          )
        })
        .slice(-40)

      setSelectedChartCandles(completedCandles)

      if (!completedCandles.length) {
        setSelectedChartError(
          'No completed 1-hour candles are available for this symbol.',
        )
      }

      setSelectedChartLoading(false)
    })
    .catch(() => {
      if (!active) return

      setSelectedChartCandles([])
      setSelectedChartError(
        'Price chart data is currently unavailable.',
      )
      setSelectedChartLoading(false)
    })

  return () => {
    active = false
  }
}, [view, selectedSymbol, lastUpdated])

const results = useMemo(
  () => scanSetups(scanSnapshot),
  [scanSnapshot],)
  useEffect(() => {
  if (view !== 'backtest') return undefined

  let active = true

  setHistoricalStatus('LOADING HISTORICAL')
  setHistoricalError(null)
  setBacktestLoading(true)

  fetchHistoricalMarketData(selectedSymbol, '1Hour', historicalRange)
    .then((data) => {
      if (!active) return

      if (!data.complete) {
        const expectedCandleMessage = data.minimumExpectedCandles
          ? `expected at least ${data.minimumExpectedCandles}`
          : 'the response did not include an expected minimum candle count'

        setHistoricalError(
          `Historical dataset incomplete: received ${data.candleCount} candles; ${expectedCandleMessage}.`,
        )
        setHistoricalData({ ...data, candles: [] })
        setBacktestLoading(false)
        return
      }

      setHistoricalData(data)
      setHistoricalStatus('ALPACA HISTORICAL')
      setBacktestLoading(false)
    })

    .catch((error) => {
      if (!active) return

      setHistoricalError(error.message)
      setHistoricalStatus('DEMO')
      setHistoricalData(getDemoHistoricalData())
      setBacktestLoading(false)
    })

  return () => {
    active = false
  }
}, [view, selectedSymbol, historicalRange]) 


  useEffect(() => {
  if (view !== 'research' || researchWorkspaceView !== 'labs') {
    return undefined
  }

  let active = true

  async function loadRobustnessData() {
    const datasets = []

    for (const symbol of robustnessSymbols) {
      if (!active) break

      try {
        const data = await fetchHistoricalMarketData(
          symbol,
          '1Hour',
          frozenScoreRange,
        )

        const minimumExpectedCandles =
          data.minimumExpectedCandles ?? 1000

        console.log('ROBUSTNESS DATA CHECK', {
          symbol,
          provider: data.provider,
          candleCount: data.candleCount,
          candleArrayLength:
            data.candles?.length ?? 0,
          minimumExpectedCandles,
          complete: data.complete,
        })

        if (
          data.provider !== 'ALPACA HISTORICAL' ||
          data.complete === false ||
          !data.candles?.length ||
          data.candleCount < minimumExpectedCandles
        ) {
          datasets.push({
            symbol,
            status: 'UNAVAILABLE',
            error:
              'Real Alpaca dataset unavailable or incomplete.',
          })
        } else {
          datasets.push({
            symbol,
            status: 'AVAILABLE',
            data,
          })
        }
      } catch (error) {
        datasets.push({
          symbol,
          status: 'UNAVAILABLE',
          error: error.message,
        })
      }
    }

    if (active) {
      setFrozenScoreData(datasets)
      setRobustnessData(datasets)
    }
  }

  loadRobustnessData()

  return () => {
    active = false
  }
}, [view, researchWorkspaceView, frozenScoreRange])

  useEffect(() => {
    if (view !== 'research' || researchWorkspaceView !== 'comparison') return undefined
    let active = true
    setComparisonRunsLoading(true)
    setComparisonRunsError(null)
    listResearchRuns({ limit: 100, offset: 0 })
      .then((response) => {
        if (active) setComparisonRuns(projectResearchComparisonRuns(response?.runs))
      })
      .catch((error) => {
        if (active) setComparisonRunsError(error.message)
      })
      .finally(() => {
        if (active) setComparisonRunsLoading(false)
      })
    return () => { active = false }
  }, [view, researchWorkspaceView])



  const backtestCandles = useMemo(
    () => enrichHistoricalCandles(historicalData?.candles ?? []),
    [historicalData],
  )
  const backtest = useMemo(() => runSetupScanBacktest(backtestCandles), [backtestCandles])
  const averageScore = results.length
    ? Math.round(results.reduce((total, item) => total + item.score, 0) / results.length)
    : null
  const scoreQualified = filterScannerResults(results, threshold)
const qualifiedSetups = results.filter((item) => item.qualifiedSetup === true)
const potentialSetups = results.filter(
  (item) => item.potentialSetup === true && item.qualifiedSetup !== true
)
const visibleResults = scoreQualified
  const selected = visibleResults.find((item) => item.symbol === selectedSymbol) ?? visibleResults[0]

  const selectedChecksPassed =
  selected?.reasons?.filter((reason) => reason.points > 0).length ?? 0

  const selectScannerSymbol = (symbol) => {
  setSelectedSymbol(symbol)

  setExpandedSymbol((current) =>
    current === symbol ? null : symbol
  )
}

  const refreshData = async () => {
    setScanLoading(true)
    try {
      const entries = await fetchScannerSnapshot(watchlist, createScannerRange())
      setScanSnapshot(entries.filter((entry) => entry.available).map((entry) => entry.snapshot))
      const availableSymbols = new Set(entries.filter((entry) => entry.available).map((entry) => entry.symbol))
      setScanUnavailable(watchlist.filter((symbol) => !availableSymbols.has(symbol)))
      setScanDataQuality(scannerDataQualityNotices(entries))
      if (isSuccessfulScannerRefresh(entries)) {
        setHistoricalStatus('ALPACA HISTORICAL')
        setHistoricalError(null)
        setLastUpdated(createRefreshTimestamp())
      } else {
        setHistoricalStatus('DATA ERROR')
        setHistoricalError('No Alpaca historical data was available for the scanner.')
      }
    } finally {
      setScanLoading(false)
    }
  }
  useEffect(() => {
  const handlePopState = () => {
    const nextRoute = readAppRoute()

    setView(nextRoute.view)
    setResearchWorkspaceView(nextRoute.researchWorkspaceView)
    setNavOpen(false)
  }

  window.addEventListener('popstate', handlePopState)

  return () => {
    window.removeEventListener('popstate', handlePopState)
  }
}, [])

const handleNavigate = (id) => {
  setView(id)
  setNavOpen(false)

  if (id === 'research') {
    setResearchWorkspaceView('workbench')
    navigateAppRoute('research', 'workbench')
    return
  }

  navigateAppRoute(id)
}

const handleResearchWorkspaceNavigate = (nextView) => {
  setView('research')
  setResearchWorkspaceView(nextView)
  setNavOpen(false)
  navigateAppRoute('research', nextView)
}

  const existingResearchLabs = (
    <>
      <nav className="research-subnav" aria-label="Research labs">
        {researchTabs.map((tab) => (
          <button
            key={tab.id}
            className={`research-tab ${researchTab === tab.id ? 'active' : ''} ${tab.placeholder ? 'is-placeholder' : ''}`}
            aria-current={researchTab === tab.id ? 'page' : undefined}
            onClick={() => setResearchTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>
      {researchTab === 'robustness' && <StrategyRobustnessLab datasets={robustnessData} />}
      {researchTab === 'relative-value' && (
        <RelativeValueResearchLab datasets={robustnessData} />
      )}
      {researchTab === 'signal-quality' && (
        <SignalQualityResearchLab datasets={robustnessData} />
      )}
      {researchTab === 'frozen-score-holdout' && (
        <FrozenScoreHoldoutLab datasets={frozenScoreData} />
      )}
      {researchTab === 'yearly-regime' && (
        <YearlyRegimeLab datasets={frozenScoreData} />
      )}
      {researchTab === 'causal-regime' && (
        <CausalRegimeLab datasets={robustnessData} />
      )}
      {researchTab === 'walk-forward-regime' && (
        <WalkForwardRegimeLab datasets={robustnessData} />
      )}
      {researchTab === 'volatility-aware-variants' && (
        <VolatilityAwareVariantsLab datasets={robustnessData} />
      )}
      {researchTab === 'strategy-discovery' && <StrategyDiscoveryLab datasets={robustnessData} />}
    </>
  )

  return (
    <div className="app-shell">
      <TopBar
  view={view}
  onNavigate={handleNavigate}
  navOpen={navOpen}
  onToggleNav={() => setNavOpen(!navOpen)}
  currentTime={currentTime}
  watchlistSymbol={watchlistSymbol}
  onWatchlistSymbolChange={setWatchlistSymbol}
  onAddSymbol={addToWatchlist}
  onSelectSymbol={setSelectedSymbol}
/>

      <AppSidebar
        view={view}
        onNavigate={handleNavigate}
        researchWorkspaceView={researchWorkspaceView}
        onResearchNavigate={handleResearchWorkspaceNavigate}
        watchlist={watchlist}
        selectedSymbol={selectedSymbol}
        onSelectSymbol={setSelectedSymbol}
      />

      <main className="dashboard">
        {view === 'home' && (
  <MorningBrief
    currentTime={currentTime}
    results={results}
    scanLoading={scanLoading}
    scanUnavailable={scanUnavailable}
    scanDataQuality={scanDataQuality}
    onOpenSetup={(symbol) => {
      setSelectedSymbol(symbol)
      setExpandedSymbol(symbol)
      handleNavigate('scan')
    }}
    onOpenPaper={() =>
      handleNavigate('paper')
    }
    onOpenResearch={() =>
      handleResearchWorkspaceNavigate(
        'history',
      )
    }
  />
)}
        {view === 'scan' && (
          <>
<section className="scan-page-heading">
  <div className="scan-heading-copy">
    <h1>Today&apos;s Top Setups</h1>

    <p className="scan-page-subtitle">
      Rule-based setups ranked using SetupScan&apos;s current scanner criteria.
    </p>

    {scanLoading ? (
      <p className="scan-data-message">
        Loading real Alpaca historical data…
      </p>
    ) : scanUnavailable.length ? (
      <p className="scan-data-message">
        Unavailable or incomplete historical data:{' '}
        {scanUnavailable.join(', ')}
      </p>
    ) : null}

    {scanDataQuality.length ? (
      <p className="scan-data-message" role="status">
        Historical data checks: {scanDataQuality.join(' ')}
      </p>
    ) : null}
  </div>

  <div className="scan-heading-actions">
    <div className="data-freshness">
      <span className="status-dot" />

      <span>
        {historicalStatus === 'ALPACA HISTORICAL'
          ? `MARKET DATA · ${historicalData?.symbol ?? selectedSymbol} · 1H`
          : `${historicalStatus} · delayed snapshot`}
      </span>
    </div>

    <button
      className="refresh-button"
      onClick={refreshData}
      disabled={scanLoading}
    >
      <RefreshCw size={15} />
      Refresh
      <span>{formatLastRefresh(lastUpdated)}</span>
    </button>
  </div>
</section>

<section className="summary-grid">
  <div className="summary-card">
    <div className="summary-icon">
      <Target size={22} />
    </div>

    <div className="summary-card-copy">
      <div className="summary-label">
        Qualified Setups
      </div>

      <strong>
        {qualifiedSetups.length.toString().padStart(2, '0')}
      </strong>

      <span>Rule conditions met; not a profitability finding</span>
    </div>
  </div>

  <div className="summary-card">
    <div className="summary-icon">
      <BarChart3 size={20} />
    </div>

    <div className="summary-card-copy">
      <div className="summary-label">
        Scanned Today
      </div>

      <strong>{results.length}</strong>

      <span>
        {results.length} evaluated · {scanUnavailable.length} unavailable
      </span>
    </div>
  </div>

  <div className="summary-card">
    <div className="summary-icon">
      <Activity size={20} />
    </div>

    <div className="summary-card-copy">
      <div className="summary-label">
        Potential Setups
      </div>

      <strong>
        {potentialSetups.length.toString().padStart(2, '0')}
      </strong>

      <span>Strong scores awaiting confirmation</span>
    </div>
  </div>

  <div className="summary-card">
    <div className="summary-icon">
      <LineChart size={20} />
    </div>

    <div className="summary-card-copy">
      <div className="summary-label">
        Average Setup Score
      </div>

      <strong>{averageScore ?? '—'}</strong>

      <span>Average across evaluated symbols</span>
    </div>
  </div>
</section>

            <div className="content-grid">
              <section className="scanner-panel panel">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">LIVE SCAN</p>
                    <h2>Today&apos;s Scan</h2>
                    <p className="qualified-explanation">
                      Showing {scoreQualified.length} of {results.length} evaluated symbols at score threshold {threshold}; {scanUnavailable.length} unavailable.
                    </p>
                  </div>
                  <ScannerFiltersButton open={scannerFiltersOpen} onToggle={() => setScannerFiltersOpen((open) => !open)} />
                </div>
                <ScannerThresholdFilter open={scannerFiltersOpen} threshold={threshold} onChange={setThreshold} />
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Symbol</th>
                        <th>Price</th>
                        <th>Trend <TermHelp term="Trend" explanation={SCANNER_TERM_EXPLANATIONS.trend} /></th>
                        <th>VWAP <TermHelp term="VWAP" explanation={SCANNER_TERM_EXPLANATIONS.vwap} /></th>
                        <th>EMA 9 / 21 <TermHelp term="EMA 9 / 21" explanation={SCANNER_TERM_EXPLANATIONS.ema} /></th>
                        <th>RSI <TermHelp term="RSI" explanation={SCANNER_TERM_EXPLANATIONS.rsi} /></th>
                        <th>Rel. volume <TermHelp term="Relative volume" explanation={SCANNER_TERM_EXPLANATIONS.relativeVolume} /></th>
                        <th>Setup score <TermHelp term="Setup score" explanation={SCANNER_TERM_EXPLANATIONS.score} /></th>
                        <th>Signal status <TermHelp term="Signal status" explanation={`${SCANNER_TERM_EXPLANATIONS.signal} ${SCANNER_TERM_EXPLANATIONS.status}`} /></th>
                      </tr>
                    </thead>
                    <tbody>

                {visibleResults.map((item) => (
  <React.Fragment key={item.symbol}>
    <tr
      className={
        selectedSymbol === item.symbol
          ? 'selected-row'
          : ''
      }
      onClick={() => selectScannerSymbol(item.symbol)}
    >
      <td>
        <div className="symbol-cell">
          <span className="ticker-dot">
            {item.symbol.slice(0, 1)}
          </span>

          <button
            type="button"
            className="scanner-row-select"
            aria-label={`Select ${item.symbol} scanner details`}
            aria-pressed={selectedSymbol === item.symbol}
            onClick={(event) => {
              event.stopPropagation()
              selectScannerSymbol(item.symbol)
            }}
          >
            {item.symbol}
          </button>
        </div>
      </td>

      <td className="price-cell">
        {formatPrice(item.price)}

        <small
          className={
            item.change >= 0
              ? 'positive'
              : 'negative'
          }
        >
          {item.change >= 0 ? '+' : ''}
          {item.change.toFixed(2)}%
        </small>
      </td>

      <td>
        <TrendBadge trend={item.trend} />
      </td>

      <td>
        {formatPrice(item.vwap)}
      </td>

      <td>
        <span
          className={
            item.ema9 > item.ema21
              ? 'positive'
              : 'negative'
          }
        >
          {formatPrice(item.ema9)}
        </span>

        <small>
          {' / '}
          {formatPrice(item.ema21)}
        </small>
      </td>

      <td>
        <span
          className={
            item.rsi > 50
              ? 'positive'
              : 'negative'
          }
        >
          {item.rsi}
        </span>
      </td>

      <td>
        {Number.isFinite(item.relativeVolume)
          ? `${item.relativeVolume.toFixed(2)}x`
          : '—'}
      </td>

      <td>
        <ScoreRing score={item.score} />
      </td>

      <td>
        <span
          className={`status-pill ${item.status
            .toLowerCase()
            .replace(' ', '-')}`}
        >
          {item.status}
        </span>
      </td>
    </tr>
    {expandedSymbol === item.symbol &&
selected?.symbol === item.symbol ? (
  <tr className="scanner-expanded-row">
    <td colSpan="9">
      <section className="selected-setup-panel scanner-inline-detail">
        <div className="selected-setup-header">
          <div>
            <p className="eyebrow">
              SELECTED SYMBOL
            </p>

            <h2>
              {selected.symbol} — {selected.status}
            </h2>

            <p>
              {selectedChecksPassed} of 6 scanner checks passed
            </p>
          </div>

          <TrendBadge trend={selected.trend} />
        </div>

        <div className="selected-setup-layout">
          <aside className="selected-score-column">
            <div
              className="selected-score-ring"
              style={{
                '--score-progress': `${Math.max(
                  0,
                  Math.min(100, selected.score),
               ) * 3.6}deg`,
             }}
           >
  <div className="selected-score-ring-inner">
    <strong>{selected.score}</strong>
    <span>/100</span>
  </div>
</div>

            <span className="selected-score-label">
              Setup Score
            </span>

            <div className="selected-price">
              <strong>
                {formatPrice(selected.price)}
              </strong>

              <span
                className={
                  selected.change >= 0
                    ? 'positive'
                    : 'negative'
                }
              >
                {selected.change >= 0 ? '+' : ''}
                {selected.change.toFixed(2)}%
              </span>
            </div>

            <div className="selected-check-list">
              {selected.reasons.map((reason) => (
                <div
                  className="selected-check"
                  key={reason.label}
                >
                  <span
                    className={
                      reason.points > 0
                        ? 'check-pass'
                        : 'check-missing'
                    }
                  >
                    {reason.points > 0 ? '✓' : '—'}
                  </span>

                  <div>
                    <strong>{reason.label}</strong>
                    <small>{reason.detail}</small>
                  </div>
                </div>
              ))}
            </div>
          </aside>

          <div className="selected-chart-column">
           <div className="selected-chart-toolbar">
  <div>
    <strong>Price Action</strong>

    <span>
      Completed 1-hour candles · {selectedChartRange}
    </span>
  </div>

  <div className="chart-range-controls">
    {['1D', '3D', '5D', 'ALL'].map((range) => (
      <button
        key={range}
        type="button"
        className={
          selectedChartRange === range
            ? 'chart-range-button active'
            : 'chart-range-button'
        }
        onClick={(event) => {
          event.stopPropagation()
          setSelectedChartRange(range)
        }}
      >
        {range}
      </button>
    ))}

    <span className="chart-timeframe-pill">
      1H
    </span>
  </div>
</div>

            {selectedChartLoading ? (
              <div className="selected-chart-state">
                Loading {selected.symbol} price data…
              </div>
            ) : selectedChartError ? (
              <div className="selected-chart-state">
                {selectedChartError}
              </div>
            ) : (
              <CandlestickChart
              candles={selectedChartCandles}
              range={selectedChartRange}
         />
            )}
          </div>
        </div>

        <div className="selected-info-grid">
          <article>
            <h3>Why This Setup?</h3>

            <p>
              {selected.status === 'Qualified Setup'
  ? `Meets the scanner's rule-based conditions. This does not establish profitability or authorize live trading.`
                : selected.status === 'Potential Setup'
                  ? `${selectedChecksPassed} of 6 scanner checks are currently contributing. ${selected.symbol} has a strong setup score, but one or more required confirmations are still missing.`
                  : `${selectedChecksPassed} of 6 scanner checks are currently contributing. SetupScan is not labeling ${selected.symbol} as a qualifying setup right now.`}
            </p>
          </article>

          <article>
            <h3>Current Reference Levels</h3>

            <dl>
              <div>
                <dt>Last Price</dt>
                <dd>{formatPrice(selected.price)}</dd>
              </div>

              <div>
                <dt>VWAP</dt>
                <dd>{formatPrice(selected.vwap)}</dd>
              </div>

              <div>
                <dt>EMA 9</dt>
                <dd>{formatPrice(selected.ema9)}</dd>
              </div>

              <div>
                <dt>EMA 21</dt>
                <dd>{formatPrice(selected.ema21)}</dd>
              </div>
            </dl>
          </article>

          <article>
            <h3>Scanner Context</h3>

            <dl>
              <div>
                <dt>Status</dt>
                <dd>{selected.status}</dd>
              </div>

              <div>
                <dt>Checks Passed</dt>
                <dd>{selectedChecksPassed} / 6</dd>
              </div>

              <div>
                <dt>Relative Volume</dt>
                <dd>
                  {Number.isFinite(selected.relativeVolume)
                    ? `${selected.relativeVolume.toFixed(2)}x`
                    : 'Unavailable'}
                </dd>
              </div>

              <div>
                <dt>Trend</dt>
                <dd>{selected.trend}</dd>
              </div>
            </dl>

            <p className="selected-context-note">
              These are current scanner measurements,
              not historical performance statistics.
            </p>
          </article>
        </div>
      </section>
    </td>
  </tr>
) : null}
  </React.Fragment>
))}
                      {!visibleResults.length ? <tr><td colSpan="9">{scannerEmptyMessage(scanLoading, results.length, scanUnavailable.length, threshold)}</td></tr> : null}
                    </tbody>
                  </table>
                </div>
                <div className="mobile-list">
                  {visibleResults.map((item) => (
                    <button
                      className={`mobile-row ${selectedSymbol === item.symbol ? 'selected-row' : ''}`}
                      key={item.symbol}
                      onClick={() => setSelectedSymbol(item.symbol)}
                    >
                      <div className="symbol-cell">
                        <span className="ticker-dot">{item.symbol.slice(0, 1)}</span>
                        <strong>{item.symbol}</strong>
                        <TrendBadge trend={item.trend} />
                      </div>
                      <div className="mobile-score">
                        <ScoreRing score={item.score} />
                        <span
                          className={`status-pill ${item.status.toLowerCase().replace(' ', '-')}`}
                        >
                          {item.status}
                        </span>
                      </div>
                    </button>
                  ))}
                  {!visibleResults.length ? <p className="empty-state">{scannerEmptyMessage(scanLoading, results.length, scanUnavailable.length, threshold)}</p> : null}
                </div>
              </section>
              <aside className="side-column">
                <section className="qualified-panel panel">
                  <div className="panel-heading compact">
                    <div>
                      <p className="eyebrow">SCORE THRESHOLD ≥ {threshold}</p>
                    <h2>Score-matched setups</h2>
                      <p className="qualified-explanation">
                        Meets the selected score threshold; does not mean trade-ready.
                      </p>
                  </div>
                    <span className="count-badge">{scoreQualified.length}</span>
                </div>
                  {scoreQualified.length ?(
                    scoreQualified.map((item) => (
                      <button
                        className={`qualified-row ${item.qualifiedSetup ? 'qualified-match' : ''}`}
                        key={item.symbol}
                        onClick={() => setSelectedSymbol(item.symbol)}
                      >
                        <div>
                          <strong>{item.symbol}</strong>
                          <span>
                            {item.status === 'Potential Setup' ? 'Potential setup' : item.setupType}
                            {' '}
                            <TermHelp term="Setup type" explanation={SCANNER_TERM_EXPLANATIONS.setupType} />
                          </span>
                        </div>
                        <div className="qualified-score">
                          {item.score}
                          <small>/100</small>
                          <ChevronRight size={15} />
                        </div>
                      </button>
                    ))
                  ) : (
                    <div className="empty-state">No setups meet this threshold yet.</div>
                  )}
                </section>
                <section className="watchlist-panel panel">
                  <div className="panel-heading compact">
                    <div>
                      <p className="eyebrow">MARKETS</p>
                      <h2>Watchlist</h2>
                    </div>
                    <button
                      className="icon-button small"
                      onClick={() => setWatchlistOpen(!watchlistOpen)}
                      aria-label="Manage watchlist"
                    >
                      <Settings2 size={16} />
                    </button>
                  </div>
                  <div className="watchlist-chips">
                    {watchlist.map((symbol) => (
                      <button
                        className={selectedSymbol === symbol ? 'active' : ''}
                        key={symbol}
                        onClick={() => {
  setSelectedSymbol(symbol)
  setView('scan')
}}
                      >
                        {symbol}
                      </button>
                    ))}
                  </div>
                  <div className="secure-note">
                    <ShieldCheck size={15} />
                    <span>
                      Provider-ready architecture
                      <br />
                      <small>No API keys stored in the client</small>
                    </span>
                  </div>
                </section>
              </aside>
            </div>
          </>
        )}

        {view === 'paper' && <PaperTradingPanel />}
        {view === 'backtest' && (
          <>
            <section className="detail-grid single-column">
              <section className="backtest-panel panel">
                <div className="panel-heading compact">
                  <div>
                    <p className="eyebrow">BACKTEST LAB · {historicalData?.symbol ?? selectedSymbol} · 1H</p>
                    <h2>Historical backtest</h2>
                    <select
  className="backtest-symbol-select"
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
<select
  className="backtest-symbol-select"
  value={backtestRangeYears}
  onChange={(event) => setBacktestRangeYears(Number(event.target.value))}
  aria-label="Backtest range"
  disabled={backtestLoading}
>
  <option value={1}>1 year</option>
  <option value={2}>2 years</option>
  <option value={3}>3 years</option>
  <option value={5}>5 years</option>
</select>
                  </div>
                  <span className="coming-soon">
  {backtestLoading ? 'RUNNING BACKTEST' : `${backtest.trades.length} TRADES`}
</span>
                </div>
                {backtestLoading ? (
  <div className="backtest-loading" role="status" aria-live="polite">
    <span className="status-dot" />
    <div>
      <strong>Running backtest</strong>
      <small>
        Loading {backtestRangeYears} {backtestRangeYears === 1 ? 'year' : 'years'} of {selectedSymbol} historical data and recalculating results…
      </small>
    </div>
  </div>
) : null}
                <BacktestDataSummary data={historicalData} error={historicalError} />
                <section
                  className={`backtest-result-evidence ${historicalData?.provider === 'DEMO' ? 'backtest-demo-results' : ''}`}
                  aria-label={historicalData?.provider === 'DEMO' ? 'Illustrative demo metrics' : 'Historical backtest results'}
                >
                  {historicalData?.provider === 'DEMO' ? (
                    <div className="backtest-demo-notice" role="note">
                      <h3>Illustrative demo metrics — not historical research</h3>
                      <p>The historical-data request failed, so these figures use built-in example candles. They are illustrative only and are not evidence of strategy performance. The original data-fetch error is shown above.</p>
                    </div>
                  ) : null}
                <p className="backtest-learning-intro">
                  {historicalData?.provider === 'DEMO'
                    ? 'These example results do not predict or measure future performance.'
                    : 'Historical results describe this sample; they do not predict future performance.'}
                </p>
                <div className="backtest-stats">
                  <div>
                    <span>Win rate</span>
                    <strong>{formatPercent(backtest.metrics.winRate)}</strong>
                  </div>
                  <div>
                    <span>Average R</span>
                    <strong>{formatR(backtest.metrics.averageR)}</strong>
                  </div>
                  <div>
                    <span>Profit factor</span>
                    <strong>{formatR(backtest.metrics.profitFactor)}</strong>
                  </div>
                  <div>
                    <span>Max drawdown</span>
                    <strong>{formatR(backtest.metrics.maximumDrawdown)}</strong>
                  </div>
                  <div>
                    <span>Expectancy</span>
                    <strong>{formatR(backtest.metrics.expectancy)}</strong>
                  </div>
                  <div>
                    <span>Avg hold</span>
                    <strong>{backtest.metrics.averageHoldingTime.toFixed(0)}m</strong>
                  </div>
                </div>
                <div className="sample-grid">
                  <div>
                    <span>In-sample</span>
                    <strong>
                      {backtest.inSampleMetrics.numberOfTrades} trades ·{' '}
                      {formatR(backtest.inSampleMetrics.averageR)}
                    </strong>
                  </div>
                  <div>
                    <span>Out-of-sample</span>
                    <strong>
                      {backtest.outOfSampleMetrics.numberOfTrades} trades ·{' '}
                      {formatR(backtest.outOfSampleMetrics.averageR)}
                    </strong>
                  </div>
                </div>
                <details className="backtest-recent-details">
                  <summary>Recent trades &amp; signals</summary>
                  <p className="backtest-detail-intro">
                    See the latest trades generated by this backtest and how each one performed.
                  </p>
                  <div className="trade-ledger">
                  <div className="ledger-heading">
                    <span>Latest sample trades</span>
                    <span>Outcome / R</span>
                  </div>
                  {backtest.trades
                    .slice(-4)
                    .reverse()
                    .map((trade) => (
                      <div className="ledger-row" key={`${trade.timestamp}-${trade.symbol}`}>
                        <span>
                          <strong>{trade.symbol}</strong>
                          <small>
                            {trade.setupType} · {new Date(trade.timestamp).toLocaleDateString()}
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
            <details className="backtest-more-details">
             <summary>{historicalData?.provider === 'DEMO' ? 'Performance breakdown — demo sample' : 'Performance breakdown'}</summary>
             <p className="backtest-detail-intro">
               Compare results across score ranges, setup types, and sample groups.
            </p>
            <BacktestBreakdown
               backtest={backtest}
               symbol={historicalData?.symbol ?? selectedSymbol}
            />
              <ThresholdComparison
                candles={backtest.candles}
                symbol={historicalData?.symbol ?? selectedSymbol}
              />
            </details>
            <BacktestDiagnostics backtest={backtest} data={historicalData} error={historicalError} />
            <details className="backtest-terms-disclosure">
              <summary>Explain the metrics</summary>
              <MetricsGlossary title="Backtest terms" intro="Short explanations for the metrics used on this page." definitions={BACKTEST_GLOSSARY_DEFINITIONS} />
            </details>
          </>
        )}
        {view === 'research' && (
          <ResearchWorkspace
            activeView={researchWorkspaceView}
            onNavigate={handleResearchWorkspaceNavigate}
            MetricsGlossaryComponent={MetricsGlossary}
            existingLabs={existingResearchLabs}
            selectedRunId={selectedResearchRunId}
            onRunSelected={(runId) => setSelectedResearchRunId(runId)}
            runs={comparisonRuns}
            comparisonRunsLoading={comparisonRunsLoading}
            comparisonRunsError={comparisonRunsError}

          />
        )}
        {view === 'settings' && (
          <div className="settings-view">
            <section className="panel">
              <div className="panel-heading compact">
                <div>
                  <p className="eyebrow">SETTINGS</p>
                  <h2>App preferences</h2>
                </div>
                <span className="coming-soon">COMING SOON</span>
              </div>
              <p>
                Provider connections, notification preferences, and account settings will live here.
              </p>
            </section>
          </div>
        )}
        <footer>
          <span>
            <CircleHelp size={14} /> Scores are rule-based research signals, not probabilities or
            financial advice.
          </span>
          <span>Data provider: {historicalData?.provider ?? historicalStatus}</span>
        </footer>
      </main>
      {watchlistOpen && (
  <div className="watchlist-manager">
    <div>
      <strong>Manage watchlist</strong>
      <small>Add symbols to scan or remove symbols you no longer want to monitor.</small>
    </div>

    <div>
      <input
        value={watchlistSymbol}
        onChange={(event) => setWatchlistSymbol(event.target.value.toUpperCase())}
        placeholder="Enter symbol"
        aria-label="Add symbol to watchlist"
      />

      <button
        onClick={() => {
          addToWatchlist(watchlistSymbol)
          setWatchlistSymbol('')
        }}
      >
        Add
      </button>
    </div>

    <div>
      {watchlist.map((symbol) => (
        <button
          key={symbol}
          onClick={() => removeFromWatchlist(symbol)}
          aria-label={`Remove ${symbol} from watchlist`}
        >
          {symbol} ×
        </button>
      ))}
    </div>

    <button
      onClick={() => setWatchlistOpen(false)}
      aria-label="Close watchlist manager"
    >
      <X size={16} />
    </button>
  </div>
)}
</div>
) 
}

createRoot(document.getElementById('root')).render(<App />)
