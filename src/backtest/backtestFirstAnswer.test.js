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

  assert.ok(answerIndex >= 0 && answerIndex < dataContextIndex)
  assert.ok(dataContextIndex < metricsIndex)
  assert.ok(metricsIndex < sampleIndex)
  assert.ok(sampleIndex < diagnosticsIndex)
  assert.match(backtestBranch, /Historical results describe this sample; they do not predict future performance/)
  assert.match(mainSource, /data\?\.complete === false \? <p className="data-error" role="alert">Historical data is incomplete/)
})

test('Backtest detailed results, recent signals, calculation checks, and glossary remain reachable', () => {
  assert.match(backtestBranch, /<summary>More details<\/summary>/)
  assert.match(backtestBranch, /<BacktestBreakdown backtest=\{backtest\} \/>/)
  assert.match(backtestBranch, /<ThresholdComparison candles=\{backtest\.candles\} \/>/)
  assert.match(backtestBranch, /<summary>Recent signals<\/summary>/)
  assert.match(mainSource, /<summary>Show calculation details<\/summary>/)
  assert.match(backtestBranch, /<summary>What do these terms mean\?<\/summary>/)
})