import assert from 'node:assert/strict'
import fs from 'node:fs'
import { test } from 'node:test'

const source = fs.readFileSync(new URL('./PaperTradingPanel.jsx', import.meta.url), 'utf8')

test('Paper safety, headline metrics, symbol activity, and trade journal remain outside the More metrics disclosure', () => {
  assert.match(source, /LIVE PAPER MODE — NO REAL ORDERS/)
  assert.match(source, /automated Paper Observer runs separately/)
  assert.match(source, /its records are separate and are not shown here/)
  assert.match(source, /local-file fallback may be shared only when both processes use the same data file/)
  assert.match(source, /first adjacent completed OHLC bar whose interval ends after the signal is detected/)
  assert.match(source, /not the exact first post-signal quote or a guaranteed fill/)
  assert.match(source, /paper-ohlc-gap-aware-v1 records used the following bar's open/)
  assert.match(source, /Legacy \/ unknown/)
  const metrics = source.indexOf('<PaperMetrics metrics={snapshot.metrics} />')
  const symbols = source.indexOf('paper-symbol-grid')
  const journal = source.indexOf('paper-table-wrap')
  assert.ok(metrics >= 0 && symbols > metrics && journal > symbols)
  assert.match(source, /<PaperTradeRow/)
})
