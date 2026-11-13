import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { test } from 'node:test'
import { StrategyComparisonResult } from './StrategyComparisonResult.js'
import { ResearchRunDetail } from './ResearchRunDetail.js'
import { ResearchHistoryTable } from './ResearchHistory.js'

function savedRecord() {
  return {
    id: 'strategy-comparison', status: 'completed', methodologyVersion: 'strategy-comparison-1',
    input: { symbols: ['MSFT'] }, costModel: { status: 'not-modeled' }, outOfSample: null,
    metrics: {
      'MSFT::control': { strategyId: 'setup-scan-baseline', tradeCount: 5, winRate: 0.4, averageR: 0.2, expectancy: 0.2, totalR: 1, profitFactor: 1.333, maximumDrawdown: 2, ambiguousTradeCount: 0 },
      'MSFT::trendMomentum': { strategyId: 'trend-momentum-v1', tradeCount: 108, winRate: 4 / 9, averageR: -0.077, expectancy: -0.077, profitFactor: 0.851, maximumDrawdown: 31.999, ambiguousTradeCount: 0 },
    },
  }
}

const dataset = {
  datasetId: 'saved-dataset',
  effectiveMetadata: { symbols: { MSFT: { requestedCandleCount: 508, calculationCandleCount: 693 } } },
}

test('saved strategy comparison displays persisted metrics, membership and cost limitations', () => {
  const record = savedRecord()
  const before = structuredClone(record)
  const html = renderToStaticMarkup(React.createElement(StrategyComparisonResult, { record, dataset }))
  for (const value of ['MSFT', 'SetupScan baseline', 'Trend / momentum', '40.0%', '44.4%', '-0.077', '0.851', '31.999', '508 research-window candles', '693 calculation candles', 'saved-dataset', 'Transaction costs were not modeled', 'Separate in-sample and out-of-sample metrics are unavailable']) assert.ok(html.includes(value), value)
  assert.deepEqual(record, before)
  assert.match(html, /role="region" aria-label="Saved strategy metrics" tabindex="0"/)
  assert.match(html, /scope="row">Trades/)
})

test('missing saved total R stays unavailable instead of being calculated from trade count', () => {
  const html = renderToStaticMarkup(React.createElement(StrategyComparisonResult, { record: savedRecord() }))
  assert.match(html, /Total R<\/th><td>1<\/td><td>Unavailable<\/td>/)
})

test('zero values, infinite profit factor and unavailable metrics remain distinct', () => {
  const record = savedRecord()
  record.metrics = { control: { tradeCount: 0, winRate: 0, profitFactor: Infinity, averageR: null } }
  const html = renderToStaticMarkup(React.createElement(StrategyComparisonResult, { record }))
  assert.match(html, /Trades<\/th><td>0<\/td>/)
  assert.match(html, /Win rate<\/th><td>0.0%<\/td>/)
  assert.match(html, /Profit factor<\/th><td>∞<\/td>/)
  assert.match(html, /Average R<\/th><td>Unavailable<\/td>/)
})

test('legacy metric keys and missing metrics remain readable without invented findings', () => {
  const record = savedRecord()
  record.metrics = { control: { strategyId: 'archived-strategy', tradeCount: 7 } }
  const html = renderToStaticMarkup(React.createElement(StrategyComparisonResult, { record }))
  assert.match(html, /MSFT/)
  assert.match(html, /archived-strategy/)
  record.metrics = {}
  assert.match(renderToStaticMarkup(React.createElement(StrategyComparisonResult, { record })), /Strategy metrics are unavailable/)
})

test('persisted Run Detail includes strategy results directly after the run summary', () => {
  const run = {
    runContext: { runId: 'saved-run', symbols: ['MSFT'], timeframe: '1Hour', requestedExperiments: ['strategy-comparison'] },
    status: 'completed', dataset, records: [savedRecord()],
    experimentResults: [{ experimentId: 'strategy-comparison', status: 'succeeded' }],
  }
  const html = renderToStaticMarkup(React.createElement(ResearchRunDetail, { run }))
  assert.ok(html.indexOf('Strategy Comparison results') < html.indexOf('Experiment execution'))
  for (const text of ['completed', 'MSFT', '1Hour', 'saved-dataset', 'Strategy Comparison results']) assert.ok(html.includes(text))
})

test('history provides an explicit View Results action for the exact saved run', () => {
  const selected = []
  const tree = ResearchHistoryTable({ runs: [{ runId: 'saved-run', symbols: ['MSFT'] }], onSelectRun: id => selected.push(id) })
  function button(element) {
    if (!React.isValidElement(element)) return null
    if (element.type === 'button') return element
    return React.Children.toArray(element.props.children).map(button).find(Boolean)
  }
  const action = button(tree)
  assert.equal(action.props.children, 'View Results')
  assert.equal(action.props['aria-label'], 'View Results for saved-run')
  action.props.onClick()
  assert.deepEqual(selected, ['saved-run'])
})
