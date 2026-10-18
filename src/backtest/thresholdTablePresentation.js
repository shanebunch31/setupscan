const formatPercent = (value) => `${(value * 100).toFixed(1)}%`
const formatR = (value) => `${value === Infinity ? '∞' : value.toFixed(2)}R`

export const thresholdTableHeadings = [
  'Threshold',
  'Total',
  'In-sample',
  'Out-of-sample',
  'Win rate',
  'Profit factor',
  'Expectancy',
  'Average R',
  'Max DD',
  'Avg hold',
  'Avg win',
  'Avg loss',
]

/** Keeps threshold-table values in the same order as the visible headings. */
export function buildThresholdTableCells(result) {
  const metrics = result.metrics
  const hasTrades = Number.isFinite(metrics.totalTrades) && metrics.totalTrades > 0
  return [
    `${result.minimumScore}+`,
    metrics.totalTrades,
    result.inSampleMetrics.totalTrades,
    result.outOfSampleMetrics.totalTrades,
    hasTrades ? formatPercent(metrics.winRate) : '—',
    hasTrades ? (metrics.profitFactor === Infinity ? '∞' : metrics.profitFactor.toFixed(2)) : '—',
    hasTrades ? formatR(metrics.expectancy) : '—',
    hasTrades ? formatR(metrics.averageR) : '—',
    hasTrades ? formatR(metrics.maximumDrawdown) : '—',
    hasTrades ? `${metrics.averageHoldingTime.toFixed(0)}m` : '—',
    hasTrades ? formatR(metrics.averageWinner) : '—',
    hasTrades ? formatR(metrics.averageLoser) : '—',
  ]
}
