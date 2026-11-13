import React from 'react'

const h = React.createElement

const strategyLabels = {
  'setup-scan-baseline': 'SetupScan baseline',
  'trend-momentum-v1': 'Trend / momentum',
}

function number(value) {
  if (value === Infinity) return '∞'
  if (!Number.isFinite(value)) return 'Unavailable'
  return Number.isInteger(value) ? String(value) : value.toFixed(3)
}

const metrics = [
  ['tradeCount', 'Trades', number],
  ['winRate', 'Win rate', value => Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : 'Unavailable'],
  ['averageR', 'Average R', number],
  ['expectancy', 'Expectancy R', number],
  ['totalR', 'Total R', number],
  ['profitFactor', 'Profit factor', number],
  ['maximumDrawdown', 'Maximum drawdown R', number],
  ['ambiguousTradeCount', 'Ambiguous trades', number],
]

export function StrategyComparisonResult({ record, dataset }) {
  const entries = Object.entries(record.metrics ?? {})
  const symbols = record.input?.symbols ?? []
  const coverage = dataset?.effectiveMetadata?.symbols ?? {}

  return h('section', {
    className: 'research-detail-section saved-strategy-comparison',
    'aria-label': 'Saved Strategy Comparison results',
  },
    h('h3', null, 'Strategy Comparison results'),
    h('p', { className: 'workbench-muted' },
      `Saved experiment status ${record.status ?? 'Unavailable'} · Methodology ${record.methodologyVersion ?? 'Unavailable'}`),
    entries.length > 1
      ? h('p', { className: 'workbench-muted saved-strategy-comparison-scroll-hint' }, 'Scroll sideways to view all strategies.')
      : null,
    entries.length
      ? h('div', {
        className: 'saved-strategy-comparison-table',
        role: 'region',
        'aria-label': 'Saved strategy metrics',
        tabIndex: 0,
      }, h('table', null,
        h('caption', null, 'Persisted strategy metrics'),
        h('thead', null, h('tr', null,
          h('th', { scope: 'col' }, 'Metric'),
          entries.map(([key, values]) => h('th', { key, scope: 'col' },
            h('span', null, key.includes('::') ? key.slice(0, key.lastIndexOf('::')) : symbols.join(', ')),
            h('strong', null, strategyLabels[values.strategyId] ?? values.strategyId ?? key),
          )),
        )),
        h('tbody', null, metrics.map(([key, label, format]) => h('tr', { key },
          h('th', { scope: 'row' }, label),
          entries.map(([entryKey, values]) => h('td', { key: entryKey }, format(values[key]))),
        ))),
      ))
      : h('p', { className: 'workbench-muted' }, 'Strategy metrics are unavailable in this saved record.'),
    h('p', { className: 'workbench-muted' }, 'R expresses returns in units of initial planned risk. The strategies use different entry rules and sample memberships.'),
    record.costModel?.status === 'not-modeled'
      ? h('p', { className: 'workbench-muted' }, 'Transaction costs were not modeled.')
      : null,
    !record.outOfSample
      ? h('p', { className: 'workbench-muted' }, 'Separate in-sample and out-of-sample metrics are unavailable in this saved result.')
      : null,
    ...symbols.filter(symbol => Number.isInteger(coverage[symbol]?.calculationCandleCount)).map(symbol =>
      h('p', { key: symbol, className: 'workbench-muted' },
        `${symbol} · ${number(coverage[symbol].requestedCandleCount)} research-window candles · ${coverage[symbol].calculationCandleCount} calculation candles including pre-roll`)),
    dataset?.datasetId ? h('p', { className: 'saved-strategy-comparison-dataset' },
      h('strong', null, 'Dataset '), h('code', null, dataset.datasetId)) : null,
    h('p', { className: 'workbench-muted' }, 'Historical sample results do not establish future profitability.'),
  )
}
