import React, { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  Activity,
  ArrowUpRight,
  BarChart3,
  Bell,
  CircleHelp,
  LineChart,
  Menu,
  RefreshCw,
  Settings2,
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
import { fetchScannerSnapshot, isSuccessfulScannerRefresh } from './data/scannerSnapshot.js'
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
import { createRefreshTimestamp, formatLastRefresh, formatMarketTime } from './marketTime.js'
import { filterScannerResults, ScannerFiltersButton, ScannerThresholdFilter, SCANNER_TERM_EXPLANATIONS } from './scannerFilters.js'
import { METRIC_DEFINITIONS, MetricsGlossary, TermHelp } from './backtest/MetricsGlossary.jsx'
import { BACKTEST_EXTRA_DEFINITIONS, BACKTEST_LEARNING_INTRO } from './backtest/backtestLearning.js'
import { listResearchRuns } from './research/researchRunHistory.js'
import { projectResearchComparisonRuns, ResearchWorkspace } from './research/ResearchWorkspace.js'
import './styles.css'

const DEFAULT_WATCHLIST = ['SPY', 'QQQ', 'IWM', 'NVDA', 'TSLA', 'AAPL', 'AMD', 'META', 'AMZN']
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
const formatPrice = (value) => Number.isFinite(value) ? `$${value.toFixed(2)}` : '—'
const formatPercent = (value) => `${(value * 100).toFixed(1)}%`
const formatR = (value) => `${value === Infinity ? '∞' : value.toFixed(2)}R`
const APP_ROUTES = {
  scan: '/scan',
  paper: '/paper',
  backtest: '/backtest',
  research: '/research/workbench',
  settings: '/settings',
}

const RESEARCH_ROUTES = {
  workbench: '/research/workbench',
  history: '/research/history',
  comparison: '/research/comparison',
  labs: '/research/labs',
}

function readAppRoute() {
  if (typeof window === 'undefined') {
    return {
      view: 'scan',
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
      : APP_ROUTES[view] ?? APP_ROUTES.scan

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
      <summary>Show calculation details</summary>
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
    </details>
  )
}

function BacktestDataSummary({ data, error }) {
  const provider = data?.provider ?? 'Data loading'
     const status = data?.complete === false ? 'Incomplete' : data?.complete === true ? 'Complete' : error ? 'Unavailable' : 'Loading'
  return (
    <div className="backtest-data-context" aria-label="Historical data context">
      <p>{provider} · {data?.symbol ?? 'SPY'} · {data?.timeframe ?? '1Hour'} · {formatDate(data?.start)} – {formatDate(data?.end)} · {data?.candleCount ?? 0} candles · {status}</p>
      {error ? <p className="data-error" role="alert">{error}</p> : null}
      {data?.complete === false ? <p className="data-error" role="alert">Historical data is incomplete; interpret these results with caution.</p> : null}
    </div>
  )
}

function NavBar({ view, onNavigate, navOpen, onToggleNav, currentTime }) {
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
      <MarketStatus now={currentTime} />
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
  setWatchlist((current) => current.filter((item) => item !== symbol))
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
  const [watchlistOpen, setWatchlistOpen] = useState(false)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [currentTime, setCurrentTime] = useState(() => new Date())
  const [historicalData, setHistoricalData] = useState(null)
  const [historicalStatus, setHistoricalStatus] = useState('LOADING HISTORICAL')
  const [historicalError, setHistoricalError] = useState(null)
  const [robustnessData, setRobustnessData] = useState(
    robustnessSymbols.map((symbol) => ({ symbol, status: 'LOADING' })),
  )
  const [frozenScoreData, setFrozenScoreData] = useState(
    robustnessSymbols.map((symbol) => ({ symbol, status: 'LOADING' })),
  )
  const historicalRange = useMemo(() => {
    const end = new Date()
    const start = new Date(end)
    start.setUTCFullYear(start.getUTCFullYear() - 2)
    return { start: start.toISOString(), end: end.toISOString() }
  }, [])

  const frozenScoreRange = useMemo(() => {
    const end = new Date()
    return {
      start: '2022-01-01T00:00:00.000Z',
      end: end.toISOString(),
    }
  }, [])

  const scanRange = useMemo(() => {
    const end = new Date()
    const start = new Date(end)
    start.setUTCDate(start.getUTCDate() - 30)
    return { start: start.toISOString(), end: end.toISOString() }
  }, [])
  const [scanSnapshot, setScanSnapshot] = useState([])
  const [scanUnavailable, setScanUnavailable] = useState([])
  const [scanLoading, setScanLoading] = useState(true)
  useEffect(() => {
    const clock = setInterval(() => setCurrentTime(new Date()), 15000)
    return () => clearInterval(clock)
  }, [])

  useEffect(() => {
  if (view !== 'scan') {
    setScanLoading(false)
    return undefined
  }

  let active = true
  setScanLoading(true)

  fetchScannerSnapshot(watchlist, scanRange)
    .then((entries) => {
      if (!active) return

      setScanSnapshot(
        entries
          .filter((entry) => entry.available)
          .map((entry) => entry.snapshot),
      )

      setScanUnavailable(
        entries
          .filter((entry) => !entry.available)
          .map((entry) => entry.symbol),
      )

      setScanLoading(false)
    })
    .catch(() => {
      if (!active) return
      setScanLoading(false)
    })

  return () => {
    active = false
  }
}, [view, scanRange, watchlist])
  const results = useMemo(() => scanSetups(scanSnapshot), [scanSnapshot])
  useEffect(() => {
  if (view !== 'backtest') return undefined

  let active = true

  setHistoricalStatus('LOADING HISTORICAL')
  setHistoricalError(null)

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
}, [view, selectedSymbol, historicalRange]) 


  useEffect(() => {
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

        // Space the requests so one rate-limit response does not cascade.
        await new Promise((resolve) =>
          setTimeout(resolve, 1500),
        )
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
  }, [frozenScoreRange])

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
  const bullishCount = results.filter((item) => item.status === 'Bullish').length
  const averageScore = results.length
    ? Math.round(results.reduce((total, item) => total + item.score, 0) / results.length)
    : 0
  const qualified = filterScannerResults(results, threshold)
  const visibleResults = qualified
  const selected = visibleResults.find((item) => item.symbol === selectedSymbol) ?? visibleResults[0]
  const refreshData = async () => {
    setScanLoading(true)
    try {
      const entries = await fetchScannerSnapshot(watchlist, scanRange)
      setScanSnapshot(entries.filter((entry) => entry.available).map((entry) => entry.snapshot))
      setScanUnavailable(entries.filter((entry) => !entry.available).map((entry) => entry.symbol))
      if (isSuccessfulScannerRefresh(entries)) setLastUpdated(createRefreshTimestamp())
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
  setResearchWorkspaceView(nextView)
  navigateAppRoute('research', nextView)
}
  const existingResearchLabs = (
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
      <NavBar
        view={view}
        onNavigate={handleNavigate}
        navOpen={navOpen}
        onToggleNav={() => setNavOpen(!navOpen)}
        currentTime={currentTime}
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
                {scanLoading ? (
                  <p className="hero-copy">Loading real Alpaca historical data…</p>
                ) : scanUnavailable.length ? (
                  <p className="hero-copy">
                    Unavailable (no real Alpaca data): {scanUnavailable.join(', ')}
                  </p>
                ) : null}
              </div>
              <div className="hero-meta">
                <div className="data-freshness">
                  <span className="status-dot" />{' '}
                  {historicalStatus === 'ALPACA HISTORICAL'
                    ? 'ALPACA HISTORICAL · SPY · 1H'
                    : `${historicalStatus} data · delayed snapshot`}
                </div>
                <button className="refresh-button" onClick={refreshData} disabled={scanLoading}>
                  <RefreshCw size={15} /> Refresh <span>{formatLastRefresh(lastUpdated)}</span>
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
                  Qualified setups <TermHelp term="Qualified setups" explanation={SCANNER_TERM_EXPLANATIONS.qualified} /> <ArrowUpRight size={16} />
                </div>
                <strong>{qualified.length.toString().padStart(2, '0')}</strong>
                  <span>Meets minimum setup score {threshold}</span>
              </div>
              <div className="summary-card">
                <div className="summary-label">
                  Scanner signal mix <TermHelp term="Signal status" explanation="Score-based setup categories. Bearish does not mean SetupScan recommends a short." /> <Activity size={16} />
                </div>
                <strong>{bullishCount} / {results.length}</strong>
                <span>Bullish statuses among available symbols</span>
              </div>
              <div className="summary-card">
                <div className="summary-label">
                  Average setup score <TermHelp term="Average setup score" explanation="The mean score across available symbols in this scan." /> <LineChart size={16} />
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
                      {!visibleResults.length ? <tr><td colSpan="9">No scanner results meet this minimum score.</td></tr> : null}
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
                  {!visibleResults.length ? <p className="empty-state">No scanner results meet this minimum score.</p> : null}
                </div>
              </section>
              <aside className="side-column">
                <section className="qualified-panel panel">
                  <div className="panel-heading compact">
                    <div>
                      <p className="eyebrow">MINIMUM SETUP SCORE ≥ {threshold}</p>
                      <h2>Qualified setups</h2>
                      <p className="qualified-explanation">Meets the selected score cutoff; not a recommendation.</p>
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
                          <span>{item.setupType} <TermHelp term="Setup type" explanation={SCANNER_TERM_EXPLANATIONS.setupType} /></span>
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
            <section className="detail-grid single-column">
              {selected ? (
                <section className="detail-panel panel">
                  <div className="detail-header">
                    <div>
                      <p className="eyebrow">SETUP BREAKDOWN</p>
                      <h2>
                        Why {selected.symbol} received setup score {selected.score} <TermHelp term="Signal" explanation={SCANNER_TERM_EXPLANATIONS.signal} />
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
              ) : (
                <section className="detail-panel panel">
                  <div className="empty-state">
                    {scanLoading
                      ? 'Loading real Alpaca historical data…'
                      : 'No real Alpaca data available for this watchlist right now.'}
                  </div>
                </section>
              )}
            </section>
          </>
        )}
        {view === 'paper' && <PaperTradingPanel />}
        {view === 'backtest' && (
          <>
            <section className="detail-grid single-column">
              <section className="backtest-panel panel">
                <div className="panel-heading compact">
                  <div>
                    <p className="eyebrow">BACKTEST LAB · SPY · 1H</p>
                    <h2>Historical backtest</h2>
                  </div>
                  <span className="coming-soon">{backtest.trades.length} TRADES</span>
                </div>
                <BacktestDataSummary data={historicalData} error={historicalError} />
                <p className="backtest-learning-intro">Historical results describe this sample; they do not predict future performance.</p>
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
                  <summary>Recent signals</summary>
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
            <details className="backtest-more-details">
              <summary>More details</summary>
              <BacktestBreakdown backtest={backtest} />
              <ThresholdComparison candles={backtest.candles} />
            </details>
            <BacktestDiagnostics backtest={backtest} data={historicalData} error={historicalError} />
            <details className="backtest-terms-disclosure">
              <summary>What do these terms mean?</summary>
              <MetricsGlossary title="Backtest terms" intro="Short explanations for the metrics used on this page." definitions={BACKTEST_GLOSSARY_DEFINITIONS} />
            </details>
          </>
        )}
        {view === 'research' && (
          <ResearchWorkspace
            activeView={researchWorkspaceView}
            onNavigate={handleResearchWorkspaceNavigate}
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
