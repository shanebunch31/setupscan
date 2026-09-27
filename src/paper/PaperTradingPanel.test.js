import assert from 'node:assert/strict'
import fs from 'node:fs'
import { test } from 'node:test'

const source = fs.readFileSync(new URL('./PaperTradingPanel.jsx', import.meta.url), 'utf8')

test('Paper safety, headline metrics, symbol activity, and trade journal remain outside the More metrics disclosure', () => {
  assert.match(source, /LIVE PAPER MODE — NO REAL ORDERS/)
  const metrics = source.indexOf('<PaperMetrics metrics={snapshot.metrics} />')
  const symbols = source.indexOf('paper-symbol-grid')
  const journal = source.indexOf('paper-table-wrap')
  assert.ok(metrics >= 0 && symbols > metrics && journal > symbols)
  assert.match(source, /<PaperTradeRow/)
})