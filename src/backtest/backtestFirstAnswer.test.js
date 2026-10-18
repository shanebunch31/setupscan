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
  assert.match(backtestBranch, /<summary>\{historicalData\?\.provider === 'DEMO' \? 'Performance breakdown — demo sample' : 'Performance breakdown'\}<\/summary>/)
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

test('demo backtest metrics are visibly separated and labeled illustrative while preserving the fetch error', () => {
  assert.match(mainSource, /setHistoricalError\(error\.message\)[\s\S]*setHistoricalStatus\('DEMO'\)[\s\S]*setHistoricalData\(getDemoHistoricalData\(\)\)/)
  assert.match(backtestBranch, /historicalData\?\.provider === 'DEMO'[\s\S]*backtest-demo-results/)
  assert.match(backtestBranch, /Illustrative demo metrics — not historical research/)
  assert.match(backtestBranch, /not evidence of strategy performance/)
  assert.match(backtestBranch, /The original data-fetch error is shown above/)
  assert.match(backtestBranch, /aria-label=\{historicalData\?\.provider === 'DEMO' \? 'Illustrative demo metrics' : 'Historical backtest results'\}/)
  assert.match(backtestBranch, /Performance breakdown — demo sample/)
  assert.match(mainSource, /data\?\.provider === 'DEMO' \? 'Demo calculation data' : 'Historical research data'/)
})

test('scanner empty states distinguish loading, unavailable, partial, and successful empty results', () => {
  assert.match(mainSource, /function scannerEmptyMessage\(isLoading, evaluatedCount, unavailableCount, threshold\)/)
  assert.match(mainSource, /if \(isLoading\) return 'Loading scanner results…'/)
  assert.match(mainSource, /No symbols were successfully evaluated; \$\{unavailableCount\} unavailable/)
  assert.match(mainSource, /No evaluated symbols meet this minimum score; \$\{unavailableCount\} unavailable/)
  assert.match(mainSource, /No scanner results meet this minimum score of \$\{threshold\}/)
  assert.match(mainSource, /const averageScore = results\.length[\s\S]*: null/)
  assert.match(mainSource, /\{averageScore \?\? '—'\}/)
  assert.match(mainSource, /\{results\.length\} evaluated · \{scanUnavailable\.length\} unavailable/)
  assert.equal((mainSource.match(/scannerEmptyMessage\(scanLoading, results\.length, scanUnavailable\.length, threshold\)/g) ?? []).length, 2)
})

test('scanner qualification copy describes rule conditions without implying profitability or live authorization', () => {
  assert.match(mainSource, /Meets the scanner's rule-based conditions\. This does not establish profitability or authorize live trading/)
  assert.match(mainSource, /Rule conditions met; not a profitability finding/)
  assert.doesNotMatch(mainSource, /eligible to trigger a paper trade or live trade/i)
})

test('desktop scanner selection has a native keyboard-operable button and visible focus style', () => {
  assert.match(mainSource, /type="button"[\s\S]*className="scanner-row-select"[\s\S]*aria-label=\{`Select \$\{item\.symbol\} scanner details`\}[\s\S]*aria-pressed=\{selectedSymbol === item\.symbol\}/)
  assert.match(mainSource, /event\.stopPropagation\(\)[\s\S]*setSelectedSymbol\(item\.symbol\)/)
  const styles = fs.readFileSync(new URL('../styles.css', import.meta.url), 'utf8')
  assert.match(styles, /\.scanner-row-select:focus-visible\s*\{[^}]*outline: 2px solid var\(--green\)/)
})

test('Backtest Diagnostics contains one summary and intro with valid paragraph and section nesting', () => {
  const diagnosticsStart = mainSource.indexOf('function BacktestDiagnostics')
  const diagnosticsEnd = mainSource.indexOf('function BacktestDataSummary', diagnosticsStart)
  const diagnostics = mainSource.slice(diagnosticsStart, diagnosticsEnd)
  assert.equal((diagnostics.match(/<summary>/g) ?? []).length, 1)
  assert.equal((diagnostics.match(/className="backtest-detail-intro"/g) ?? []).length, 1)
  assert.match(diagnostics, /<p className="backtest-detail-intro">[\s\S]*?<\/p>\s*<section className="calculation-checks panel">/)
  assert.doesNotMatch(diagnostics, /<section className="calculation-checks panel"><\/section><\/p>/)
})

test('primary, mobile, and Labs navigation expose the currently selected destination', () => {
  assert.equal((mainSource.match(/aria-current=\{view === item\.id \? 'page' : undefined\}/g) ?? []).length, 2)
  assert.match(mainSource, /aria-current=\{researchTab === tab\.id \? 'page' : undefined\}/)
  assert.match(mainSource, /<nav className="research-subnav" aria-label="Research labs">/)
})

test('shared design tokens keep the light palette, readable type, and focus states consistent', () => {
  const styles = fs.readFileSync(new URL('../styles.css', import.meta.url), 'utf8')
  const researchStyles = fs.readFileSync(new URL('./robustness.css', import.meta.url), 'utf8')
  const html = fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8')

  assert.match(styles, /--color-canvas:\s*#F3F5F1/i)
  assert.match(styles, /--color-surface:\s*#FFFFFF/i)
  assert.match(styles, /--color-brand:\s*#123B32/i)
  assert.match(styles, /--color-text:\s*#17251F/i)
  assert.match(styles, /--color-gold:\s*#D5A63C/i)
  assert.match(styles, /--color-caution:\s*#785514/i)
  assert.match(styles, /--font-size-body:\s*0\.875rem/)
  assert.match(styles, /--space-4:\s*16px/)
  assert.match(styles, /--radius-card:\s*8px/)
  assert.match(styles, /:where\(button, a, input, select, textarea, \[tabindex\]\):focus-visible\s*\{[^}]*outline: 3px solid var\(--focus-ring\)/)
  assert.match(styles, /td\s*\{[^}]*font-size: var\(--font-size-sm\)[^}]*\}/)
  assert.match(styles, /font-variant-numeric: tabular-nums lining-nums/)
  assert.match(styles, /family=DM\+Mono[^']*family=Manrope/)
  assert.match(researchStyles, /\.robustness-table td\s*\{[^}]*font-size: var\(--font-size-xs\)[^}]*font-variant-numeric: tabular-nums lining-nums/)
  assert.match(html, /<meta name="theme-color" content="#F3F5F1"\s*\/>/)
})
