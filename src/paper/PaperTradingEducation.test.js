import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { test } from 'node:test'
import { PaperMetricLabel, PaperMetrics, PaperTradingEducation } from './PaperTradingEducation.js'

function findElement(element, predicate) {
  if (!React.isValidElement(element)) return null
  if (predicate(element)) return element
  for (const child of React.Children.toArray(element.props.children)) {
    const found = findElement(child, predicate)
    if (found) return found
  }
  return null
}

test('paper education explains simulated journal, fixed R amount, equity assumption, and hypothetical P&L', () => {
  const html = renderToStaticMarkup(React.createElement(PaperTradingEducation, {
    account: { riskPerTrade: 100, startingEquity: 10000 },
  }))
  assert.match(html, /Real market bars, simulated trades, no orders or real money/)
  assert.match(html, /1R = \$100 planned risk/)
  assert.match(html, /starting paper equity = \$10,000/)
  assert.match(html, /Hypothetical P&amp;L is not actual money/)
})

test('paper metric labels expose concise accessible help without changing values', () => {
  const html = renderToStaticMarkup(React.createElement(PaperMetricLabel, {
    label: 'R',
    explanation: 'One unit of planned risk.',
  }))
  assert.match(html, /aria-label="R: One unit of planned risk\."/)
  assert.match(html, />R</)
})

test('Paper Trading keeps headline activity and P&L visible and places secondary metrics behind More metrics', () => {
  const tree = PaperMetrics({
    metrics: {
      totalTrades: 8, wins: 4, losses: 3, winRate: 0.5, cumulativePnl: 100,
      profitFactor: 1.4, expectancy: 0.2, averageR: 0.2, maximumDrawdown: 50,
      currentEquity: 10100, cumulativeR: 1,
    },
  })
  const html = renderToStaticMarkup(tree)
  for (const label of ['Total trades', 'Wins / losses', 'Win rate', 'Hypothetical P&amp;L', 'More metrics', 'Profit factor', 'Expectancy', 'Max drawdown']) {
    assert.ok(html.includes(label), `expected Paper metrics to include ${label}`)
  }
  const details = findElement(tree, (element) => element.type === 'details')
  assert.ok(details)
  assert.equal(details.props.open, undefined)
})