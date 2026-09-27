import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { test } from 'node:test'
import { projectPaperTrade } from './paperTradingModel.js'
import { PaperTradeRow } from './PaperTradeRow.js'

function markup(trade) {
  return renderToStaticMarkup(React.createElement(PaperTradeRow, { row: projectPaperTrade(trade) }))
}

function baseTrade() {
  return {
    symbol: 'SPY', status: 'closed', signalTimestamp: '2026-09-26T14:00:00.000Z',
    entryTimestamp: '2026-09-26T14:15:00.000Z', exitTimestamp: '2026-09-26T15:42:00.000Z',
    signalScore: 90, setupType: 'Breakout', theoreticalEntryPrice: 100, observedMarketPrice: 100,
    rMultiple: 1, pnl: 100,
  }
}

test('paper row visibly shows entry and normal close time in ET', () => {
  const html = markup({ ...baseTrade(), exitReason: 'Target' })
  assert.match(html, /Sep 26, 2026 · 10:15 AM ET/)
  assert.match(html, /Closed · Target/)
  assert.match(html, /Sep 26, 2026 · 11:42 AM ET/)
  assert.match(html, /ET/)
})

test('paper row identifies expiration and displays its existing exit timestamp', () => {
  const html = markup({ ...baseTrade(), exitReason: 'Expired', exitTimestamp: '2026-09-26T18:00:00.000Z' })
  assert.match(html, /Expired/)
  assert.match(html, /The simulated holding limit was reached/)
  assert.match(html, /Sep 26, 2026 · 2:00 PM ET/)
})

test('paper row displays unavailable for missing entry or closed event timestamps', () => {
  const html = markup({ ...baseTrade(), entryTimestamp: null, exitTimestamp: null, exitReason: 'Expired' })
  assert.match(html, /Unavailable/)
})