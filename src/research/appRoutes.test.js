import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ResearchWorkspace } from './ResearchWorkspace.js'
import { readAppRoute, navigateAppRoute, subscribeAppRoute, researchLoadingMode, QUICK_BACKTEST_ROUTE } from './appRoutes.js'

function browserAt(path) {
  const entries = [{ url: new URL(path, 'https://setupscan.test'), state: null }]
  let index = 0
  const listeners = new Set(), calls = []
  const browser = {
    get location() { return entries[index].url },
    history: {
      get state() { return entries[index].state },
      get length() { return entries.length },
      pushState(state, _, path) { const url = new URL(path, browser.location); calls.push('push'); entries.splice(++index); entries.push({ url, state }) },
      replaceState(state, _, path) { calls.push('replace'); entries[index] = { url: new URL(path, browser.location), state } },
      back() { if (index > 0) { index--; for (const fn of listeners) fn() } },
      forward() { if (index < entries.length - 1) { index++; for (const fn of listeners) fn() } },
    },
    addEventListener(name, fn) { assert.equal(name, 'popstate'); listeners.add(fn) },
    removeEventListener(name, fn) { assert.equal(name, 'popstate'); listeners.delete(fn) },
  }
  return { browser, calls, listeners }
}
const quickRoute = { view: 'research', researchWorkspaceView: 'labs', researchTab: 'quick-backtest' }

test('legacy Backtest redirects by replacement, keeps query/hash and creates no Back loop', () => {
  const { browser, calls } = browserAt('/home')
  browser.history.pushState({}, '', '/backtest/?bookmark=yes#results')
  assert.deepEqual(readAppRoute(browser), quickRoute)
  assert.equal(browser.location.pathname, QUICK_BACKTEST_ROUTE)
  assert.equal(browser.location.search, '?bookmark=yes')
  assert.equal(browser.location.hash, '#results')
  assert.deepEqual(calls, ['push', 'replace'])
  assert.equal(browser.history.length, 2)
  browser.history.back()
  assert.equal(readAppRoute(browser).view, 'home')
  browser.history.forward()
  assert.deepEqual(readAppRoute(browser), quickRoute)
  assert.deepEqual(calls, ['push', 'replace'])
})

test('direct Quick Backtest refresh selects Research, Labs and the tool without a redirect', () => {
  const { browser, calls } = browserAt(QUICK_BACKTEST_ROUTE + '/')
  assert.deepEqual(readAppRoute(browser), quickRoute)
  assert.deepEqual(readAppRoute(browser), quickRoute)
  assert.deepEqual(calls, [])
  const html = renderToStaticMarkup(React.createElement(ResearchWorkspace, { activeView: readAppRoute(browser).researchWorkspaceView, existingLabs: 'Quick Backtest' }))
  assert.match(html, /aria-current="page">Labs<\/button>/)
  const main = readFileSync(new URL('../main.jsx', import.meta.url), 'utf8')
  assert.match(main, /aria-current=\{view === item\.id \? 'page' : undefined\}/)
  assert.match(main, /aria-current=\{\s*researchTab === tab\.id\s*\?\s*'page'\s*:\s*undefined\s*\}/)
  assert.doesNotMatch(main.slice(main.indexOf('const navItems'), main.indexOf('const researchTabs')), /Backtest/)
})

test('Back/Forward restores Quick Backtest and the selected advanced experiment through the app subscription', () => {
  const { browser, listeners } = browserAt('/scan')
  const visited = [], stop = subscribeAppRoute((route) => visited.push(route), browser)
  navigateAppRoute('research', 'labs', 'quick-backtest', browser)
  navigateAppRoute('research', 'labs', 'signal-quality', browser)
  navigateAppRoute('research', 'history', 'signal-quality', browser)
  browser.history.back()
  assert.equal(visited.at(-1).researchTab, 'signal-quality')
  assert.equal(visited.at(-1).researchWorkspaceView, 'labs')
  browser.history.back()
  assert.deepEqual(visited.at(-1), quickRoute)
  browser.history.back()
  assert.equal(visited.at(-1).view, 'scan')
  browser.history.forward()
  assert.deepEqual(visited.at(-1), quickRoute)
  stop()
  assert.equal(listeners.size, 0)
})

test('existing Research paths and plain Labs default retain their destinations', () => {
  for (const workspace of ['workbench', 'history', 'comparison', 'shadow', 'labs']) {
    const { browser } = browserAt(`/research/${workspace}`)
    assert.deepEqual(readAppRoute(browser), { view: 'research', researchWorkspaceView: workspace, researchTab: 'overview' })
  }
  assert.equal(readAppRoute(browserAt('/research').browser).researchWorkspaceView, 'workbench')
})

test('Quick Backtest cannot enter the advanced history loader; all existing experiment tabs still can', () => {
  assert.equal(researchLoadingMode('research', 'labs', 'quick-backtest'), 'quick-backtest')
  for (const tab of ['robustness', 'relative-value', 'signal-quality', 'frozen-score-holdout', 'yearly-regime', 'causal-regime', 'walk-forward-regime', 'volatility-aware-variants', 'strategy-discovery']) {
    assert.equal(researchLoadingMode('research', 'labs', tab), 'advanced-labs')
  }
  assert.equal(researchLoadingMode('research', 'workbench', 'quick-backtest'), null)
  assert.equal(researchLoadingMode('scan', 'labs', 'quick-backtest'), null)
  const main = readFileSync(new URL('../main.jsx', import.meta.url), 'utf8')
  assert.match(main, /if \(loadingMode !== 'quick-backtest'\) return undefined[\s\S]*?fetchHistoricalMarketData\(selectedSymbol, '1Hour', historicalRange\)/)
  const advanced = main.slice(main.indexOf("if (loadingMode !== 'advanced-labs')"), main.indexOf('}, [loadingMode, frozenScoreRange])'))
  assert.match(advanced, /^if \(loadingMode !== 'advanced-labs'\) \{\s*return undefined\s*\}/)
  assert.match(advanced, /for \(const symbol of robustnessSymbols\)/)
  assert.match(advanced, /fetchHistoricalMarketData\(\s*symbol,\s*'1Hour',\s*frozenScoreRange/)
  assert.match(main, /const robustnessSymbols = \['SPY', 'QQQ', 'IWM'\]/)
  assert.match(main, /setResearchTab\(nextRoute.researchTab\)/)
})
