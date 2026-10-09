import assert from 'node:assert/strict'
import fs from 'node:fs'
import { test } from 'node:test'

const mainSource = fs.readFileSync(new URL('../main.jsx', import.meta.url), 'utf8')
const backtestStart = mainSource.indexOf("{view === 'backtest' && (")
const researchStart = mainSource.indexOf("{view === 'research' && (", backtestStart)
const backtestBranch = mainSource.slice(backtestStart, researchStart)

test('Backtest answer precedes calculation checks and preserves critical visible context', () => {
  const answerIndex = backtestBranch.indexOf('<h2>Historical backtest</h2>')
  const dataContextIndex = backtestBranch.indexOf('<BacktestDataSummary')
  const metricsIndex = backtestBranch.indexOf('className="backtest-stats"')
  const sampleIndex = backtestBranch.indexOf('className="sample-grid"')
  const diagnosticsIndex = backtestBranch.indexOf('<BacktestDiagnostics')

  assert.match(
    mainSource,
    /data\?\.complete === false[\s\S]*Historical data is incomplete; interpret these results with caution/
  )
  assert.ok(dataContextIndex < metricsIndex)
  assert.ok(metricsIndex < sampleIndex)
  assert.ok(sampleIndex < diagnosticsIndex)
  assert.match(backtestBranch, /Historical results describe this sample; they do not predict future performance/)
  assert.match(
  mainSource,
  /data\?\.complete === false[\s\S]*Historical data is incomplete; interpret these results with caution/
)
})

test('Backtest detailed results, recent signals, calculation checks, and glossary remain reachable', () => {
  assert.match(backtestBranch, /<summary>Performance breakdown<\/summary>/)
  assert.match(
  backtestBranch,
  /<BacktestBreakdown\s+backtest=\{backtest\}\s+symbol=\{historicalData\?\.symbol \?\? selectedSymbol\}\s*\/>/
)
  assert.match(
  backtestBranch,
  /<ThresholdComparison\s+candles=\{backtest\.candles\}\s+symbol=\{historicalData\?\.symbol \?\? selectedSymbol\}\s*\/>/
)
  assert.match(backtestBranch, /<summary>Recent trades &amp; signals<\/summary>/)
  assert.match(mainSource, /<summary>How the results are calculated<\/summary>/)
  assert.match(backtestBranch, /<summary>Explain the metrics<\/summary>/)
})