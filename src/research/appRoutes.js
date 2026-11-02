export const QUICK_BACKTEST_ROUTE = '/research/labs/quick-backtest'

const APP_ROUTES = {
  home: '/home',
  scan: '/scan',
  paper: '/paper',
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

const labTabs = new Set([
  'overview',
  'quick-backtest',
  'robustness',
  'relative-value',
  'signal-quality',
  'frozen-score-holdout',
  'yearly-regime',
  'causal-regime',
  'walk-forward-regime',
  'volatility-aware-variants',
  'strategy-discovery',
])

export function readAppRoute(browser = globalThis.window) {
  if (!browser) {
    return {
      view: 'home',
      researchWorkspaceView: 'workbench',
      researchTab: 'overview',
    }
  }

  const path =
    browser.location.pathname.replace(/\/+$/, '') || '/'

  if (path === '/backtest') {
    browser.history.replaceState(
      {},
      '',
      QUICK_BACKTEST_ROUTE +
        (browser.location.search ?? '') +
        (browser.location.hash ?? ''),
    )
  }

  if (path === '/backtest' || path === QUICK_BACKTEST_ROUTE) {
    return {
      view: 'research',
      researchWorkspaceView: 'labs',
      researchTab: 'quick-backtest',
    }
  }

  const storedTab = browser.history.state?.researchTab

  if (path === RESEARCH_ROUTES.labs) {
    return {
      view: 'research',
      researchWorkspaceView: 'labs',
      researchTab: labTabs.has(storedTab)
        ? storedTab
        : 'overview',
    }
  }

  const researchTab = labTabs.has(storedTab)
    ? storedTab
    : 'overview'

  if (path === '/research') {
    return {
      view: 'research',
      researchWorkspaceView: 'workbench',
      researchTab,
    }
  }

  for (const [researchWorkspaceView, route] of Object.entries(
    RESEARCH_ROUTES,
  )) {
    if (path === route) {
      return {
        view: 'research',
        researchWorkspaceView,
        researchTab,
      }
    }
  }

  for (const [view, route] of Object.entries(APP_ROUTES)) {
    if (path === route) {
      return {
        view,
        researchWorkspaceView: 'workbench',
        researchTab,
      }
    }
  }

  return {
    view: 'scan',
    researchWorkspaceView: 'workbench',
    researchTab,
  }
}

export function navigateAppRoute(
  view,
  researchWorkspaceView = 'workbench',
  researchTab = 'overview',
  browser = globalThis.window,
) {
  if (!browser) return

  const route =
    view === 'research'
      ? researchWorkspaceView === 'labs' &&
        researchTab === 'quick-backtest'
        ? QUICK_BACKTEST_ROUTE
        : RESEARCH_ROUTES[researchWorkspaceView] ??
          RESEARCH_ROUTES.workbench
      : APP_ROUTES[view] ?? APP_ROUTES.home

  browser.history.pushState({ researchTab }, '', route)
}

export function subscribeAppRoute(
  onRoute,
  browser = globalThis.window,
) {
  const onPopState = () => onRoute(readAppRoute(browser))

  browser.addEventListener('popstate', onPopState)

  return () =>
    browser.removeEventListener('popstate', onPopState)
}

// The Overview does not need historical experiment datasets.
// Quick Backtest loads its own lightweight historical data.
// Advanced Labs use the shared research loader.
export function researchLoadingMode(view, workspace, tab) {
  if (view !== 'research' || workspace !== 'labs') return null

  if (tab === 'overview') return null
  if (tab === 'quick-backtest') return 'quick-backtest'

  return 'advanced-labs'
}