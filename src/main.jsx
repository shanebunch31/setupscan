import React, { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  Activity,
  ArrowUpRight,
  BarChart3,
  Bell,
  ChevronDown,
  CircleHelp,
  LineChart,
  Menu,
  RefreshCw,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  TrendingDown,
  TrendingUp,
  X,
} from 'lucide-react'
import {
  enrichHistoricalCandles,
  fetchHistoricalMarketData,
  getHistoricalMarketData,
  getWatchlistSnapshot,
} from './data/marketData.js'
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
import './styles.css'

const watchlist = ['SPY', 'QQQ', 'IWM', 'NVDA', 'TSLA', 'AAPL', 'AMD', 'META', 'AMZN']
const robustnessSymbols = ['SPY', 'QQQ', 'IWM']
const navItems = [
  { id: 'scan', label: 'Scan' },
  { id: 'paper', label: 'Paper Trading' },
  { id: 'backtest', label: 'Backtest' },
  { id: 'research', label: 'Research' },
  { id: 'settings', label: 'Settings' },
]
const researchTabs = [
  { id: 'robustness', label: 'Strategy Robustness' },
  { id: 'relative-value', label: 'Relative Value' },
  { id: 'signal-quality', label: 'Signal Quality / Expected Value' },
  { id: 'frozen-score-holdout', label: 'Frozen Score Holdout' },
  { id: 'yearly-regime', label: 'Yearly / Regime Stability' },
  { id: 'causal-regime', label: 'Causal Market-Regime Analysis' },
  { id: 'walk-forward-regime', label: 'Walk-Forward Regime Validation' },
  { id: 'volatility-aware-variants', label: 'Volatility-Aware Variants' },
  { id: 'strategy-discovery', label: 'Strategy Discovery Lab' },
]
const formatPrice = (value) => `$${value.toFixed(2)}`
const formatPercent = (value) => `${(value * 100).toFixed(1)}%`
const formatR = (value) => `${value === Infinity ? '∞' : value.toFixed(2)}R`
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
              <th>Max DD</th>
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

function BacktestBreakdown({ backtest }) {
  const breakdown = useMemo(() => getBacktestBreakdown(backtest), [backtest])
  const overall = [{ label: 'Overall', metrics: breakdown.overall }]
  return (
    <section className="backtest-breakdown panel">
      <div className="panel-heading compact">
        <div>
          <p className="eyebrow">BACKTEST LAB · SPY · 1H</p>
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

function ThresholdComparison({ candles }) {
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
          <p className="eyebrow">EXPLORATORY RESEARCH · SPY · 1H</p>
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
              <th>Max DD</th>
              <th>Avg hold</th>
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
    <section className="calculation-checks panel">
      <div className="panel-heading compact">
        <div>
          <p className="eyebrow">BACKTEST LAB · CALCULATION CHECKS</p>
          <h2>Historical research data</h2>
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
  )
  return (
    <>
      <section className="calculation-checks panel">
        <div className="panel-heading compact">
          <div>
            <p className="eyebrow">BACKTEST LAB · CALCULATION CHECKS</p>
            <h2>Historical research data</h2>
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
      <BacktestBreakdown backtest={backtest} />
      <ThresholdComparison candles={backtest.candles} />
    </>
  )
}

function NavBar({ view, onNavigate, navOpen, onToggleNav }) {
  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark">
          <Activity size={19} />
        </div>
        <div>
          <strong>SetupScan</strong>
          <span>MARKET RESEARCH CONSOLE</span>
        </div>
      </div>
      <nav className="primary-nav">
        {navItems.map((item) => (
          <button
            key={item.id}
            className={`nav-link ${view === item.id ? 'active' : ''}`}
            onClick={() => onNavigate(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <div className="market-status">
        <span className="status-dot" /> Market open <span className="market-time">09:41 ET</span>
      </div>
      <button className="icon-button" aria-label="Notifications">
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


function App() {
  const [view, setView] = useState('scan')
  const [navOpen, setNavOpen] = useState(false)
  const [researchTab, setResearchTab] = useState('robustness')
  const [threshold, setThreshold] = useState(65)
  const [selectedSymbol, setSelectedSymbol] = useState('SPY')
  const [watchlistOpen, setWatchlistOpen] = useState(false)
  const [lastUpdated, setLastUpdated] = useState('09:41:12 ET')
  const [historicalData, setHistoricalData] = useState(null)
  const [historicalStatus, setHistoricalStatus] = useState('LOADING HISTORICAL')
  const [historicalError, setHistoricalError] = useState(null)
  const [robustnessData, setRobustnessData] = useState(
    robustnessSymbols.map((symbol) => ({ symbol, status: 'LOADING' })),
  )
  const historicalRange = useMemo(() => {
    const end = new Date()
    const start = new Date(end)
    start.setUTCFullYear(start.getUTCFullYear() - 2)
    return { start: start.toISOString(), end: end.toISOString() }
  }, [])
  const snapshot = useMemo(() => getWatchlistSnapshot(watchlist), [])
  const results = useMemo(() => scanSetups(snapshot), [snapshot])
  const selected = results.find((item) => item.symbol === selectedSymbol) ?? results[0]
  const qualified = results.filter((item) => item.score >= threshold)
  useEffect(() => {
    let active = true
    fetchHistoricalMarketData('SPY', '1Hour', historicalRange)
      .then((data) => {
        if (!active) return
        if (!data.complete) {
          const expectedCandleMessage = data.minimumExpectedCandles
            ? `expected at least ${data.minimumExpectedCandles}`
            : 'the response did not include an expected minimum candle count'
          setHistoricalError(
            `Historical dataset incomplete: received ${data.candleCount} candles; ${expectedCandleMessage}.`,
          )
          setHistoricalStatus('DATA ERROR')
          setHistoricalData({ ...data, candles: [] })
          return
        }
        setHistoricalData(data)
        setHistoricalStatus('ALPACA HISTORICAL')
      })
      .catch((error) => {
        if (!active) return
        setHistoricalError(error.message)
        setHistoricalStatus('DEMO')
        setHistoricalData(getDemoHistoricalData())
      })
    return () => {
      active = false
    }
  }, [historicalRange])
  useEffect(() => {
    let active = true
    Promise.all(
      robustnessSymbols.map(async (symbol) => {
        try {
          const data = await fetchHistoricalMarketData(symbol, '1Hour', historicalRange)
          const minimumExpectedCandles = data.minimumExpectedCandles ?? 1000
          if (
            data.provider !== 'ALPACA HISTORICAL' ||
            data.complete === false ||
            !data.candles?.length ||
            data.candleCount < minimumExpectedCandles
          )
            return {
              symbol,
              status: 'UNAVAILABLE',
              error: 'Real Alpaca dataset unavailable or incomplete.',
            }
          return { symbol, status: 'AVAILABLE', data }
        } catch (error) {
          return { symbol, status: 'UNAVAILABLE', error: error.message }
        }
      }),
    ).then((datasets) => {
      if (active) setRobustnessData(datasets)
    })
    return () => {
      active = false
    }
  }, [historicalRange])
  const backtestCandles = useMemo(
    () => enrichHistoricalCandles(historicalData?.candles ?? []),
    [historicalData],
  )
  const backtest = useMemo(() => runSetupScanBacktest(backtestCandles), [backtestCandles])
  const bullishCount = results.filter((item) => item.status === 'Bullish').length
  const averageScore = Math.round(
    results.reduce((total, item) => total + item.score, 0) / results.length,
  )
  const refreshData = () =>
    setLastUpdated(
      `${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })} ET`,
    )
  const handleNavigate = (id) => {
    setView(id)
    setNavOpen(false)
  }

  return (
    <div className="app-shell">
      <NavBar
        view={view}
        onNavigate={handleNavigate}
        navOpen={navOpen}
        onToggleNav={() => setNavOpen(!navOpen)}
      />
      <main className="dashboard">
        {view === 'scan' && (
          <>
            <section className="hero-row">
              <div>
                <p className="eyebrow">RULE-BASED SETUP SCANNER</p>
                <h1>
                  Find the signal
                  <br />
                  <em>before the noise.</em>
                </h1>
                <p className="hero-copy">
                  A disciplined read on trend, momentum, and participation across your core
                  watchlist.
                </p>
              </div>
              <div className="hero-meta">
                <div className="data-freshness">
                  <span className="status-dot" />{' '}
                  {historicalStatus === 'ALPACA HISTORICAL'
                    ? 'ALPACA HISTORICAL · SPY · 1H'
                    : `${historicalStatus} data · delayed snapshot`}
                </div>
                <button className="refresh-button" onClick={refreshData}>
                  <RefreshCw size={15} /> Refresh <span>{lastUpdated}</span>
                </button>
              </div>
            </section>
            <section className="summary-grid">
              <div className="summary-card">
                <div className="summary-label">
                  Scanned today <BarChart3 size={16} />
                </div>
                <strong>{results.length}</strong>
                <span>symbols monitored</span>
              </div>
              <div className="summary-card highlight">
                <div className="summary-label">
                  Qualified setups <ArrowUpRight size={16} />
                </div>
                <strong>{qualified.length.toString().padStart(2, '0')}</strong>
                <span>above {threshold} score threshold</span>
              </div>
              <div className="summary-card">
                <div className="summary-label">
                  Market posture <Activity size={16} />
                </div>
                <strong>{bullishCount > 4 ? 'Constructive' : 'Mixed'}</strong>
                <span>{bullishCount} bullish signals active</span>
              </div>
              <div className="summary-card">
                <div className="summary-label">
                  Average score <LineChart size={16} />
                </div>
                <strong>{averageScore}</strong>
                <span>across watchlist</span>
              </div>
            </section>
            <div className="content-grid">
              <section className="scanner-panel panel">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">LIVE SCAN</p>
                    <h2>Setup scanner</h2>
                  </div>
                  <button className="filter-button">
                    <SlidersHorizontal size={15} /> Filters <ChevronDown size={14} />
                  </button>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Symbol</th>
                        <th>Price</th>
                        <th>Trend</th>
                        <th>VWAP</th>
                        <th>EMA 9 / 21</th>
                        <th>RSI</th>
                        <th>Rel. vol.</th>
                        <th>Score</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {results.map((item) => (
                        <tr
                          key={item.symbol}
                          className={selectedSymbol === item.symbol ? 'selected-row' : ''}
                          onClick={() => setSelectedSymbol(item.symbol)}
                        >
                          <td>
                            <div className="symbol-cell">
                              <span className="ticker-dot">{item.symbol.slice(0, 1)}</span>
                              <strong>{item.symbol}</strong>
                            </div>
                          </td>
                          <td className="price-cell">
                            {formatPrice(item.price)}
                            <small className={item.change >= 0 ? 'positive' : 'negative'}>
                              {item.change >= 0 ? '+' : ''}
                              {item.change.toFixed(2)}%
                            </small>
                          </td>
                          <td>
                            <TrendBadge trend={item.trend} />
                          </td>
                          <td>{formatPrice(item.vwap)}</td>
                          <td>
                            <span className={item.ema9 > item.ema21 ? 'positive' : 'negative'}>
                              {formatPrice(item.ema9)}
                            </span>
                            <small> / {formatPrice(item.ema21)}</small>
                          </td>
                          <td>
                            <span className={item.rsi > 50 ? 'positive' : 'negative'}>
                              {item.rsi}
                            </span>
                          </td>
                          <td>{item.relativeVolume.toFixed(2)}x</td>
                          <td>
                            <ScoreRing score={item.score} />
                          </td>
                          <td>
                            <span
                              className={`status-pill ${item.status.toLowerCase().replace(' ', '-')}`}
                            >
                              {item.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mobile-list">
                  {results.map((item) => (
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
                </div>
              </section>
              <aside className="side-column">
                <section className="qualified-panel panel">
                  <div className="panel-heading compact">
                    <div>
                      <p className="eyebrow">THRESHOLD ≥ {threshold}</p>
                      <h2>Qualified setups</h2>
                    </div>
                    <span className="count-badge">{qualified.length}</span>
                  </div>
                  {qualified.length ? (
                    qualified.map((item) => (
                      <button
                        className="qualified-row"
                        key={item.symbol}
                        onClick={() => setSelectedSymbol(item.symbol)}
                      >
                        <div>
                          <strong>{item.symbol}</strong>
                          <span>{item.setupType}</span>
                        </div>
                        <div className="qualified-score">
                          {item.score}
                          <small>/100</small>
                          <ArrowUpRight size={14} />
                        </div>
                      </button>
                    ))
                  ) : (
                    <div className="empty-state">No setups meet this threshold yet.</div>
                  )}
                  <div className="threshold-control">
                    <div>
                      <span>Minimum score</span>
                      <strong>{threshold}</strong>
                    </div>
                    <input
                      type="range"
                      min="40"
                      max="90"
                      value={threshold}
                      onChange={(event) => setThreshold(Number(event.target.value))}
                    />
                  </div>
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
                        onClick={() => setSelectedSymbol(symbol)}
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
            <section className="detail-grid single-column">
              <section className="detail-panel panel">
                <div className="detail-header">
                  <div>
                    <p className="eyebrow">SETUP BREAKDOWN</p>
                    <h2>
                      Why {selected.symbol} scored {selected.score}
                    </h2>
                  </div>
                  <TrendBadge trend={selected.trend} />
                </div>
                <div className="detail-metrics">
                  <div>
                    <span>Last price</span>
                    <strong>{formatPrice(selected.price)}</strong>
                    <small className={selected.change >= 0 ? 'positive' : 'negative'}>
                      {selected.change >= 0 ? '+' : ''}
                      {selected.change.toFixed(2)}% today
                    </small>
                  </div>
                  <div>
                    <span>Setup type</span>
                    <strong>{selected.setupType}</strong>
                    <small>
                      {selected.status === 'No Setup'
                        ? 'Waiting for confirmation'
                        : 'Conditions aligned'}
                    </small>
                  </div>
                </div>
                <div className="reason-list">
                  {selected.reasons.map((reason) => (
                    <div className="reason-item" key={reason.label}>
                      <span className={reason.points > 0 ? 'reason-positive' : 'reason-neutral'}>
                        {reason.points > 0 ? '+' : ''}
                        {reason.points}
                      </span>
                      <div>
                        <strong>{reason.label}</strong>
                        <p>{reason.detail}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </section>
          </>
        )}
        {view === 'paper' && <PaperTradingPanel />}
        {view === 'backtest' && (
          <>
            <BacktestDiagnostics
              backtest={backtest}
              data={historicalData}
              error={historicalError}
            />
            <section className="detail-grid single-column">
              <section className="backtest-panel panel">
                <div className="panel-heading compact">
                  <div>
                    <p className="eyebrow">BACKTEST LAB · SPY · 1H</p>
                    <h2>Historical backtest</h2>
                  </div>
                  <span className="coming-soon">{backtest.trades.length} TRADES</span>
                </div>
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
                <div className="trade-ledger">
                  <div className="ledger-heading">
                    <span>Recent signals</span>
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
              </section>
            </section>
          </>
        )}
        {view === 'research' && (
          <>
            <nav className="research-subnav">
              {researchTabs.map((tab) => (
                <button
                  key={tab.id}
                  className={`research-tab ${researchTab === tab.id ? 'active' : ''} ${tab.placeholder ? 'is-placeholder' : ''}`}
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
              <FrozenScoreHoldoutLab datasets={robustnessData} />
            )}
            {researchTab === 'yearly-regime' && (
              <YearlyRegimeLab datasets={robustnessData} />
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
            {researchTab === 'strategy-discovery' && <StrategyDiscoveryLab />}
          </>
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
        <div className="toast">
          <span>Watchlist is ready for provider settings.</span>
          <button onClick={() => setWatchlistOpen(false)} aria-label="Close">
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  )
}

createRoot(document.getElementById('root')).render(<App />)
