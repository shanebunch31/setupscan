import fs from 'node:fs'
import path from 'node:path'

const mainPath = path.resolve('src/main.jsx')
const stylesPath = path.resolve('src/styles.css')

function replaceOnce(source, before, after, label, alreadyMarker = null) {
  if (alreadyMarker && source.includes(alreadyMarker)) return source

  const first = source.indexOf(before)
  if (first === -1) {
    throw new Error(`Could not find expected code for: ${label}`)
  }

  if (source.indexOf(before, first + before.length) !== -1) {
    throw new Error(`Found expected code more than once for: ${label}`)
  }

  return source.slice(0, first) + after + source.slice(first + before.length)
}

let main = fs.readFileSync(mainPath, 'utf8')
let styles = fs.readFileSync(stylesPath, 'utf8')

main = replaceOnce(
  main,
  `function TrendBadge({ trend }) {\n  const bullish = trend === 'Bullish'\n  return (\n    <span className={\`trend-badge \${bullish ? 'is-bullish' : 'is-bearish'}\`}>\n      {bullish ? <TrendingUp size={14} /> : <TrendingDown size={14} />}\n      {trend}\n    </span>\n  )\n}\n`,
  `function TrendBadge({ trend }) {\n  const bullish = trend === 'Bullish'\n  return (\n    <span className={\`trend-badge \${bullish ? 'is-bullish' : 'is-bearish'}\`}>\n      {bullish ? <TrendingUp size={14} /> : <TrendingDown size={14} />}\n      {trend}\n    </span>\n  )\n}\n\nconst SCANNER_REASON_SHORT_LABELS = {\n  'Price vs VWAP': 'VWAP',\n  'EMA alignment': 'EMA',\n  'RSI momentum': 'RSI',\n  'Relative volume': 'RVOL',\n  'Breakout / reclaim': 'Breakout',\n  'Trend confirmation': 'Trend',\n}\n\nfunction scannerConfirmationSummary(item) {\n  const passed = (item?.reasons ?? [])\n    .filter((reason) => reason.points > 0)\n    .map((reason) => SCANNER_REASON_SHORT_LABELS[reason.label] ?? reason.label)\n\n  if (!passed.length) return 'No checks currently contributing'\n\n  const visible = passed.slice(0, 4)\n  const extra = passed.length - visible.length\n\n  return visible.join(' · ') + (extra > 0 ? ' · +' + extra : '')\n}\n`,
  'compact scanner confirmation helper',
  'function scannerConfirmationSummary(item)',
)

main = replaceOnce(
  main,
  `  const averageScore = results.length\n    ? Math.round(results.reduce((total, item) => total + item.score, 0) / results.length)\n    : null`,
  `  const topSetupScore = results.length\n    ? Math.max(...results.map((item) => item.score))\n    : null`,
  'top setup score calculation',
  'const topSetupScore = results.length',
)

main = replaceOnce(
  main,
  `  const selectScannerSymbol = (symbol) => {\n  setSelectedSymbol(symbol)\n\n  setExpandedSymbol((current) =>\n    current === symbol ? null : symbol\n  )\n}`,
  `  const selectScannerSymbol = (symbol) => {\n    setSelectedSymbol(symbol)\n  }`,
  'scanner row selection behavior',
  `const selectScannerSymbol = (symbol) => {\n    setSelectedSymbol(symbol)\n  }`,
)

main = replaceOnce(
  main,
  `<span>Rule conditions met; not a profitability finding</span>`,
  `<span>All required scanner checks</span>`,
  'qualified setup caption',
  '<span>All required scanner checks</span>',
)

main = replaceOnce(
  main,
  `<span>Strong scores awaiting confirmation</span>`,
  `<span>Strong score; confirmation still missing</span>`,
  'potential setup caption',
  '<span>Strong score; confirmation still missing</span>',
)

main = replaceOnce(
  main,
  `      <div className="summary-label">\n        Average Setup Score\n      </div>\n\n      <strong>{averageScore ?? '—'}</strong>\n\n      <span>Average across evaluated symbols</span>`,
  `      <div className="summary-label">\n        Top Setup Score\n      </div>\n\n      <strong>{topSetupScore ?? '—'}</strong>\n\n      <span>Highest current rule score</span>`,
  'top setup score card',
  'Highest current rule score',
)

main = replaceOnce(
  main,
  `                <div className="table-wrap">\n                  <table>\n                    <thead>\n                      <tr>\n                        <th>Symbol</th>\n                        <th>Price</th>\n                        <th>Trend <TermHelp term="Trend" explanation={SCANNER_TERM_EXPLANATIONS.trend} /></th>\n                        <th>VWAP <TermHelp term="VWAP" explanation={SCANNER_TERM_EXPLANATIONS.vwap} /></th>\n                        <th>EMA 9 / 21 <TermHelp term="EMA 9 / 21" explanation={SCANNER_TERM_EXPLANATIONS.ema} /></th>\n                        <th>RSI <TermHelp term="RSI" explanation={SCANNER_TERM_EXPLANATIONS.rsi} /></th>\n                        <th>Rel. volume <TermHelp term="Relative volume" explanation={SCANNER_TERM_EXPLANATIONS.relativeVolume} /></th>\n                        <th>Setup score <TermHelp term="Setup score" explanation={SCANNER_TERM_EXPLANATIONS.score} /></th>\n                        <th>Signal status <TermHelp term="Signal status" explanation={\`${SCANNER_TERM_EXPLANATIONS.signal} ${SCANNER_TERM_EXPLANATIONS.status}\`} /></th>\n                      </tr>\n                    </thead>\n                    <tbody>`,
  `                <div className="table-wrap">\n                  <table className="scan-compact-table">\n                    <thead>\n                      <tr>\n                        <th>Symbol</th>\n                        <th>Price / Change</th>\n                        <th>Trend <TermHelp term="Trend" explanation={SCANNER_TERM_EXPLANATIONS.trend} /></th>\n                        <th>Key Confirmations</th>\n                        <th>Score <TermHelp term="Setup score" explanation={SCANNER_TERM_EXPLANATIONS.score} /></th>\n                        <th>Status <TermHelp term="Signal status" explanation={SCANNER_TERM_EXPLANATIONS.signal + ' ' + SCANNER_TERM_EXPLANATIONS.status} /></th>\n                      </tr>\n                    </thead>\n                    <tbody>`,
  'compact scanner table header',
  'className="scan-compact-table"',
)

const mapStartMarker = `                {visibleResults.map((item) => (`
const emptyRowMarker = `                      {!visibleResults.length ? <tr><td colSpan="9">`
const mapStart = main.indexOf(mapStartMarker)
const emptyRowStart = main.indexOf(emptyRowMarker, mapStart)

if (mapStart === -1 || emptyRowStart === -1) {
  if (!main.includes('scan-key-confirmations')) {
    throw new Error('Could not locate the scanner row map for compact-table conversion.')
  }
} else {
  const oldMap = main.slice(mapStart, emptyRowStart)
  const sectionStart = oldMap.indexOf(`<section className="selected-setup-panel scanner-inline-detail">`)
  const sectionEndMarker = `      </section>`
  const sectionEnd = oldMap.indexOf(sectionEndMarker, sectionStart)

  if (sectionStart === -1 || sectionEnd === -1) {
    throw new Error('Could not extract the existing selected setup detail section.')
  }

  const selectedSection = oldMap
    .slice(sectionStart, sectionEnd + sectionEndMarker.length)
    .replace('scanner-inline-detail', 'scanner-below-table-detail')

  const compactRows = `                {visibleResults.map((item) => (\n                  <tr\n                    key={item.symbol}\n                    className={selectedSymbol === item.symbol ? 'selected-row' : ''}\n                    onClick={() => selectScannerSymbol(item.symbol)}\n                  >\n                    <td>\n                      <div className="symbol-cell">\n                        <span className="ticker-dot">\n                          {item.symbol.slice(0, 1)}\n                        </span>\n\n                        <button\n                          type="button"\n                          className="scanner-row-select"\n                          aria-label={'Select ' + item.symbol + ' scanner details'}\n                          aria-pressed={selectedSymbol === item.symbol}\n                          onClick={(event) => {\n                            event.stopPropagation()\n                            selectScannerSymbol(item.symbol)\n                          }}\n                        >\n                          {item.symbol}\n                        </button>\n                      </div>\n                    </td>\n\n                    <td className="price-cell">\n                      {formatPrice(item.price)}\n\n                      <small className={item.change >= 0 ? 'positive' : 'negative'}>\n                        {item.change >= 0 ? '+' : ''}\n                        {item.change.toFixed(2)}%\n                      </small>\n                    </td>\n\n                    <td>\n                      <TrendBadge trend={item.trend} />\n                    </td>\n\n                    <td>\n                      <span className="scan-key-confirmations">\n                        {scannerConfirmationSummary(item)}\n                      </span>\n                    </td>\n\n                    <td>\n                      <ScoreRing score={item.score} />\n                    </td>\n\n                    <td>\n                      <span\n                        className={'status-pill ' + item.status.toLowerCase().replace(' ', '-')}\n                      >\n                        {item.status}\n                      </span>\n                    </td>\n                  </tr>\n                ))}\n`

  main = main.slice(0, mapStart) + compactRows + main.slice(emptyRowStart)
  main = main.replace(
    `{!visibleResults.length ? <tr><td colSpan="9">`,
    `{!visibleResults.length ? <tr><td colSpan="6">`,
  )

  const mobileMarker = `                <div className="mobile-list">`
  const mobileIndex = main.indexOf(mobileMarker, mapStart)

  if (mobileIndex === -1) {
    throw new Error('Could not locate mobile scanner list insertion point.')
  }

  const selectedBelowTable = `                {selected ? (\n${selectedSection}\n                ) : null}\n\n`
  main = main.slice(0, mobileIndex) + selectedBelowTable + main.slice(mobileIndex)
}

if (!main.includes('selected-confirmation-card')) {
  const contextStartMarker = `          <article>\n            <h3>Scanner Context</h3>`
  const contextStart = main.indexOf(contextStartMarker)

  if (contextStart === -1) {
    throw new Error('Could not find Scanner Context card.')
  }

  const contextEndMarker = `          </article>`
  const contextEnd = main.indexOf(contextEndMarker, contextStart)

  if (contextEnd === -1) {
    throw new Error('Could not find the end of Scanner Context card.')
  }

  const replacement = `          <article className="selected-confirmation-card">\n            <h3>\n              {selected.status === 'Qualified Setup'\n                ? 'Confirmation Status'\n                : selected.status === 'No Setup'\n                  ? 'Why No Setup?'\n                  : 'Missing Confirmation'}\n            </h3>\n\n            {selected.reasons?.some((reason) => reason.points <= 0) ? (\n              <div className="selected-missing-list">\n                {selected.reasons\n                  .filter((reason) => reason.points <= 0)\n                  .map((reason) => (\n                    <div key={reason.label}>\n                      <strong>{reason.label}</strong>\n                      <span>{reason.detail}</span>\n                    </div>\n                  ))}\n              </div>\n            ) : (\n              <p className="selected-confirmation-clear">\n                All required scanner checks are currently contributing.\n              </p>\n            )}\n          </article>`

  main =
    main.slice(0, contextStart) +
    replacement +
    main.slice(contextEnd + contextEndMarker.length)
}

const styleMarker = '/* Scan mockup density + typography pass */'
if (!styles.includes(styleMarker)) {
  styles += `\n\n${styleMarker}\n\n.scan-page-heading h1 {\n  font-family: var(--sans);\n  font-size: 28px;\n  font-weight: 800;\n  letter-spacing: -0.035em;\n}\n\n.scan-page-subtitle,\n.scanner-panel .qualified-explanation,\n.summary-card-copy > span,\n.selected-info-grid p,\n.selected-check small {\n  font-family: var(--sans);\n}\n\n.summary-card {\n  min-height: 84px;\n  padding: 11px 13px;\n  gap: 11px;\n}\n\n.summary-icon {\n  width: 40px;\n  height: 40px;\n  border-radius: 9px;\n}\n\n.summary-label {\n  font-family: var(--sans);\n  font-size: 9px;\n  font-weight: 700;\n  letter-spacing: 0.035em;\n}\n\n.summary-card-copy strong {\n  margin-top: 4px;\n  font-family: var(--sans);\n  font-size: 23px;\n  font-weight: 800;\n  letter-spacing: -0.035em;\n}\n\n.summary-card-copy > span {\n  margin-top: 4px;\n  font-size: 9px;\n  line-height: 1.3;\n}\n\n.scanner-panel .panel-heading {\n  padding-top: 16px;\n  padding-bottom: 14px;\n}\n\n.scanner-panel .panel-heading h2 {\n  font-family: var(--sans);\n  font-size: 16px;\n  font-weight: 700;\n  letter-spacing: -0.025em;\n}\n\n.scan-compact-table {\n  min-width: 760px;\n}\n\n.scan-compact-table th {\n  padding: 9px 12px;\n  font-family: var(--sans);\n  font-size: 9px;\n  font-weight: 600;\n  letter-spacing: 0.015em;\n  text-transform: none;\n}\n\n.scan-compact-table td {\n  padding: 10px 12px;\n  font-family: var(--sans);\n  font-size: 11px;\n  vertical-align: middle;\n}\n\n.scan-compact-table .price-cell,\n.scan-compact-table .score-ring,\n.scan-compact-table .price-cell small {\n  font-family: var(--mono);\n}\n\n.scan-compact-table .scanner-row-select {\n  font-family: var(--sans);\n  font-size: 12px;\n  font-weight: 700;\n}\n\n.scan-key-confirmations {\n  display: block;\n  max-width: 330px;\n  color: #b5c3d1;\n  font-family: var(--sans);\n  font-size: 10px;\n  line-height: 1.35;\n  white-space: normal;\n}\n\n.scan-compact-table tbody tr.selected-row {\n  background: linear-gradient(90deg, #10395e 0%, #0b2945 62%, #0a2239 100%) !important;\n  box-shadow: inset 3px 0 0 var(--terminal-blue);\n}\n\n.scanner-below-table-detail {\n  margin: 10px 0 0;\n  border: 1px solid var(--terminal-border);\n  border-radius: 6px;\n  background: linear-gradient(180deg, #091c2d, #071625);\n}\n\n.scanner-below-table-detail .selected-setup-header h2 {\n  font-family: var(--sans);\n  font-size: 19px;\n  font-weight: 800;\n  letter-spacing: -0.03em;\n}\n\n.selected-check strong,\n.selected-info-grid h3,\n.selected-score-label {\n  font-family: var(--sans);\n}\n\n.selected-check strong {\n  font-size: 10px;\n}\n\n.selected-info-grid h3 {\n  font-size: 11px;\n  font-weight: 700;\n}\n\n.selected-missing-list {\n  display: grid;\n  gap: 8px;\n}\n\n.selected-missing-list > div {\n  padding: 8px 9px;\n  background: #0a1d2e;\n  border: 1px solid #15324a;\n  border-left: 3px solid #f0aa3c;\n  border-radius: 4px;\n}\n\n.selected-missing-list strong,\n.selected-missing-list span {\n  display: block;\n  font-family: var(--sans);\n}\n\n.selected-missing-list strong {\n  color: #f0c477;\n  font-size: 9px;\n}\n\n.selected-missing-list span {\n  margin-top: 3px;\n  color: var(--terminal-muted);\n  font-size: 9px;\n  line-height: 1.4;\n}\n\n.selected-confirmation-clear {\n  padding: 9px 10px;\n  color: var(--terminal-green) !important;\n  background: rgba(22, 221, 176, 0.06);\n  border: 1px solid rgba(22, 221, 176, 0.16);\n  border-radius: 4px;\n}\n\n@media (max-width: 760px) {\n  .scanner-below-table-detail {\n    margin-top: 8px;\n  }\n}\n`
}

fs.writeFileSync(mainPath, main)
fs.writeFileSync(stylesPath, styles)

console.log('Applied Scan mockup density + typography pass successfully.')
console.log('Changed:')
console.log('  - src/main.jsx')
console.log('  - src/styles.css')
console.log('')
console.log('Next run:')
console.log('  npm.cmd test')
console.log('  npm.cmd run build')
