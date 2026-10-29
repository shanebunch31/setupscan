import fs from 'node:fs'
import path from 'node:path'

const mainPath = path.resolve('src/main.jsx')
const morningBriefPath = path.resolve('src/home/MorningBrief.jsx')

function replaceOnce(source, before, after, label, alreadyMarker = null) {
  if (alreadyMarker && source.includes(alreadyMarker)) {
    return source
  }

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
let morningBrief = fs.readFileSync(morningBriefPath, 'utf8')

main = replaceOnce(
  main,
  "import { MorningBrief } from './home/MorningBrief.jsx'",
  "import { MorningBrief } from './home/MorningBrief.jsx'\nimport { SetupHelpDrawer } from './help/SetupHelpDrawer.jsx'",
  'SetupHelpDrawer import',
  "import { SetupHelpDrawer } from './help/SetupHelpDrawer.jsx'",
)

main = replaceOnce(
  main,
  "\nfunction CandlestickChart({ candles = [], range = '5D' }) {",
  "\nfunction createSelectedChartRange(now = new Date()) {\n  const end = new Date(now)\n  const start = new Date(end)\n\n  start.setUTCDate(start.getUTCDate() - 30)\n\n  return {\n    start: start.toISOString(),\n    end: end.toISOString(),\n  }\n}\n\nfunction CandlestickChart({ candles = [], range = '5D' }) {",
  'selected chart range helper',
  'function createSelectedChartRange(now = new Date())',
)

main = replaceOnce(
  main,
  "  onSelectSymbol,\n}) {",
  "  onSelectSymbol,\n  onOpenHelp,\n}) {",
  'AppSidebar help callback prop',
  '  onOpenHelp,\n}) {',
)

main = replaceOnce(
  main,
  `      <div className="sidebar-help">\n        <CircleHelp size={19} />\n\n        <div>\n          <strong>Need help?</strong>\n          <p>\n            SetupScan explains unfamiliar trading and research terms in\n            plain English.\n          </p>\n        </div>\n      </div>`,
  `      <button\n        type="button"\n        className="sidebar-help"\n        onClick={onOpenHelp}\n        aria-label="Open SetupScan help"\n      >\n        <CircleHelp size={19} />\n\n        <div>\n          <strong>Need help?</strong>\n          <p>\n            SetupScan explains unfamiliar trading and research terms in\n            plain English.\n          </p>\n        </div>\n      </button>`,
  'sidebar help button',
  'aria-label="Open SetupScan help"',
)

main = replaceOnce(
  main,
  "const [navOpen, setNavOpen] = useState(false)\nconst [watchlist, setWatchlist] = useState([])",
  "const [navOpen, setNavOpen] = useState(false)\nconst [helpOpen, setHelpOpen] = useState(false)\nconst [watchlist, setWatchlist] = useState([])",
  'help drawer state',
  'const [helpOpen, setHelpOpen] = useState(false)',
)

main = replaceOnce(
  main,
  `  fetchHistoricalMarketData(\n    selectedSymbol,\n    '1Hour',\n    createScannerRange(),\n  )`,
  `  fetchHistoricalMarketData(\n    selectedSymbol,\n    '1Hour',\n    createSelectedChartRange(),\n  )`,
  'selected chart historical range',
  '    createSelectedChartRange(),',
)

main = replaceOnce(
  main,
  `        })\n        .slice(-40)\n\n      setSelectedChartCandles(completedCandles)`,
  `        })\n\n      setSelectedChartCandles(completedCandles)`,
  'remove 40-candle chart cap',
  'createSelectedChartRange(),\n  )\n    .then((data) => {',
)

main = replaceOnce(
  main,
  `    <span>\n      Completed 1-hour candles · {selectedChartRange}\n    </span>`,
  `    <span>\n      Range: {selectedChartRange} · Interval: 1H\n    </span>`,
  'chart range subtitle',
  'Range: {selectedChartRange} · Interval: 1H',
)

main = replaceOnce(
  main,
  `  <div className="chart-range-controls">\n    {['1D', '3D', '5D', 'ALL'].map((range) => (\n      <button\n        key={range}\n        type="button"\n        className={\n          selectedChartRange === range\n            ? 'chart-range-button active'\n            : 'chart-range-button'\n        }\n        onClick={(event) => {\n          event.stopPropagation()\n          setSelectedChartRange(range)\n        }}\n      >\n        {range}\n      </button>\n    ))}\n\n    <span className="chart-timeframe-pill">\n      1H\n    </span>\n  </div>`,
  `  <div className="chart-controls">\n    <div className="chart-control-group" aria-label="Chart range">\n      <span className="chart-control-label">Range</span>\n\n      <div className="chart-range-controls">\n        {['1D', '3D', '5D', 'ALL'].map((range) => (\n          <button\n            key={range}\n            type="button"\n            className={\n              selectedChartRange === range\n                ? 'chart-range-button active'\n                : 'chart-range-button'\n            }\n            onClick={(event) => {\n              event.stopPropagation()\n              setSelectedChartRange(range)\n            }}\n          >\n            {range}\n          </button>\n        ))}\n      </div>\n    </div>\n\n    <div\n      className="chart-control-group chart-interval-control"\n      aria-label="Chart interval"\n    >\n      <span className="chart-control-label">Interval</span>\n      <span className="chart-timeframe-pill">1H</span>\n    </div>\n  </div>`,
  'separate chart range and interval controls',
  'className="chart-control-group chart-interval-control"',
)

main = replaceOnce(
  main,
  `        selectedSymbol={selectedSymbol}\n        onSelectSymbol={setSelectedSymbol}\n      />`,
  `        selectedSymbol={selectedSymbol}\n        onSelectSymbol={setSelectedSymbol}\n        onOpenHelp={() => setHelpOpen(true)}\n      />`,
  'wire sidebar help callback',
  'onOpenHelp={() => setHelpOpen(true)}',
)

main = replaceOnce(
  main,
  `      </main>\n      {watchlistOpen && (`,
  `      </main>\n\n      <SetupHelpDrawer\n        open={helpOpen}\n        view={view}\n        onClose={() => setHelpOpen(false)}\n      />\n\n      {watchlistOpen && (`,
  'render SetupHelpDrawer',
  '<SetupHelpDrawer\n        open={helpOpen}',
)

morningBrief = replaceOnce(
  morningBrief,
  `            <h2>Needs Attention</h2>\n          </div>\n\n          <AlertTriangle size={18} />`,
  `            <h2>\n              {attentionItems.length\n                ? 'Needs Attention'\n                : 'All Systems Normal'}\n            </h2>\n          </div>\n\n          {attentionItems.length ? (\n            <AlertTriangle size={18} />\n          ) : (\n            <ShieldCheck size={18} />\n          )}`,
  'Home operational status heading',
  "? 'Needs Attention'\n                : 'All Systems Normal'",
)

fs.writeFileSync(mainPath, main)
fs.writeFileSync(morningBriefPath, morningBrief)

console.log('Applied Home + Scan UI polish successfully.')
console.log('Changed:')
console.log('  - src/main.jsx')
console.log('  - src/home/MorningBrief.jsx')
console.log('Added files should already be present from the branch pull:')
console.log('  - src/help/SetupHelpDrawer.jsx')
console.log('  - src/help/setupHelp.css')
console.log('')
console.log('Next run:')
console.log('  npm.cmd test')
console.log('  npm.cmd run build')
