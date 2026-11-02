import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'vite'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { enrichHistoricalCandles, getHistoricalMarketData } from '../data/marketData.js'
import { runSetupScanBacktest, setupScanBacktestDefaults } from '../backtest/strategy.js'
import { navigateAppRoute } from './appRoutes.js'

// Compile the real JSX without writing build artifacts or starting an app/server.
const require = createRequire(import.meta.url)
const bundle = await build({
  configFile: false, logLevel: 'silent',
  build: { write: false, minify: false, lib: { entry: fileURLToPath(new URL('./QuickBacktest.jsx', import.meta.url)), formats: ['es'] },
    rolldownOptions: { external: ['react'], output: { paths: { react: pathToFileURL(require.resolve('react')).href } } },
  },
})
const moduleCode = (Array.isArray(bundle) ? bundle[0] : bundle).output.find((item) => item.type === 'chunk' && item.isEntry).code
const { QuickBacktest } = await import(`data:text/javascript;base64,${Buffer.from(moduleCode).toString('base64')}`)
const candles = getHistoricalMarketData('SPY', 338)
const backtest = runSetupScanBacktest(enrichHistoricalCandles(candles))
const data = { provider: 'ALPACA HISTORICAL', symbol: 'SPY', timeframe: '1Hour', start: candles[0].timestamp, end: candles.at(-1).timestamp, candles, candleCount: candles.length, complete: true }
const props = { watchlist: ['SPY', 'AAPL'], selectedSymbol: 'SPY', setSelectedSymbol() {}, backtestRangeYears: 2, setBacktestRangeYears() {}, backtestLoading: false, historicalData: data, historicalError: null, backtest, onOpenLab() {} }
const render = (overrides = {}) => renderToStaticMarkup(React.createElement(QuickBacktest, { ...props, ...overrides }))
function find(element, predicate) {
  if (!element || typeof element !== 'object') return null
  if (predicate(element)) return element
  for (const child of React.Children.toArray(element.props?.children)) { const match = find(child, predicate); if (match) return match }
  return null
}

test('Quick Backtest renders the existing metrics, context and collapsed details without advanced study tables', () => {
  const html = render()
  for (const text of ['Quick Backtest', 'Win Rate', 'Total Trades', 'Profit Factor', 'Max Drawdown', 'Expectancy', 'Avg Hold', 'In-sample', 'Out-of-sample', 'Recent Backtest Trades', 'How the results are calculated', 'ALPACA HISTORICAL', 'SPY', '1Hour', 'Complete', 'Historical results describe this sample']) assert.ok(html.includes(text), text)
  assert.doesNotMatch(html, /Threshold comparison|Performance breakdown|Overall comparison|Direction ·|threshold-table|breakdown-table|<details[^>]*\sopen/)
  assert.ok(html.indexOf('Historical data context') < html.indexOf('quick-backtest-summary-grid'))
  assert.ok(html.indexOf('quick-backtest-summary-grid') < html.indexOf('How the results are calculated'))
  const tree = QuickBacktest(props)
  const range = find(tree, (node) => node.props?.['aria-label'] === 'Backtest range')
  assert.deepEqual(React.Children.toArray(range.props.children).map((child) => child.props.value), [1, 2, 3, 5])
})

test('SPY demo fallback stays labeled SPY when AAPL is selected and preserves the original error', () => {
  const html = render({ selectedSymbol: 'AAPL', historicalData: { ...data, provider: 'DEMO' }, historicalError: 'Provider unavailable' })
  assert.match(html, /SPY demo data — illustrative only, not historical research/)
  assert.match(html, /QUICK BACKTEST · SPY · 1H · DEMO DATA/)
  assert.match(html, /SPY demo metrics/)
  assert.match(html, /built-in SPY example candles, regardless of the requested symbol/)
  assert.match(html, /Provider unavailable/)
  assert.doesNotMatch(html, /QUICK BACKTEST · AAPL|AAPL historical|AAPL demo/)
  assert.match(html, /value="AAPL" selected="">AAPL/)
})

test('incomplete datasets and loading retain explicit status and disabled controls', () => {
  const incomplete = render({ historicalData: { ...data, complete: false, candles: [] }, historicalError: 'Historical dataset incomplete' })
  assert.match(incomplete, /Historical dataset incomplete/)
  assert.match(incomplete, /Historical data is incomplete; interpret these results with caution/)
  assert.match(render({ backtestLoading: true }), /Running backtest/)
  const tree = QuickBacktest({ ...props, backtestLoading: true })
  assert.equal(find(tree, (node) => node.props?.['aria-label'] === 'Backtest symbol').props.disabled, true)
})

test('advanced navigation buttons open the existing Labs experiments', () => {
  const calls = []
  const browser = { history: { pushState: (state, _, route) => calls.push({ state, route }) } }
  const tree = QuickBacktest({ ...props, onOpenLab: (tab) => navigateAppRoute('research', 'labs', tab, browser) })
  for (const title of ['Strategy Resilience', 'Signal Quality / Expected Value']) {
    const button = find(tree, (node) => node.type === 'button' && find(node, child => child.type === 'span' && child.props.children === title))
    assert.ok(button)
    button.props.onClick()
  }
  assert.deepEqual(calls, [
    { state: { researchTab: 'robustness' }, route: '/research/labs' },
    { state: { researchTab: 'signal-quality' }, route: '/research/labs' },
  ])
})

test('presentation preserves identical engine outputs and uses the unchanged default pipeline', () => {
  const expected = structuredClone(backtest)
  const html = render()
  assert.deepEqual(backtest, expected)
  assert.deepEqual(runSetupScanBacktest(enrichHistoricalCandles(candles)), expected)
  assert.ok(html.includes(`${(expected.metrics.winRate * 100).toFixed(1)}%`))
  assert.ok(html.includes(`${expected.metrics.averageR.toFixed(2)}R`))
  assert.deepEqual(setupScanBacktestDefaults, { minimumScore: 65, stopDistance: null, targetDistance: null, stopDistancePercent: .005, targetR: 2, maxHoldingBars: 12, splitRatio: .7 })
  const main = readFileSync(new URL('../main.jsx', import.meta.url), 'utf8')
  assert.match(main, /fetchHistoricalMarketData\(selectedSymbol, '1Hour', historicalRange\)/)
  assert.match(main, /enrichHistoricalCandles\(historicalData\?\.candles \?\? \[\]\)/)
  assert.match(main, /runSetupScanBacktest\(backtestCandles\)/)
  assert.match(main, /\[loadingMode, selectedSymbol, historicalRange\]/)
  assert.match(main, /setHistoricalData\(\{ \.\.\.data, candles: \[\] \}\)/)
  assert.match(main, /setHistoricalData\(getDemoHistoricalData\(\)\)/)
})
