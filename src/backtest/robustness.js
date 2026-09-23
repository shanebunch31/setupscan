import { runSetupScanBacktest } from './strategy.js'

export const robustnessThresholds = [75, 80, 85, 90, 95]

export function runThresholdResearch(candles) {
  return robustnessThresholds.map((minimumScore) => {
    const result = runSetupScanBacktest(candles, { minimumScore })
    return { minimumScore, ...result }
  })
}

export function runMarketConditionResearch(candles, periodCount = 4, minimumScore = 75) {
  const periods = []
  const periodSize = Math.ceil(candles.length / periodCount)
  for (let index = 0; index < periodCount; index += 1) {
    const periodCandles = candles.slice(index * periodSize, (index + 1) * periodSize)
    if (!periodCandles.length) continue
    const result = runSetupScanBacktest(periodCandles, { minimumScore })
    periods.push({ label: `Period ${index + 1}`, start: periodCandles[0].timestamp, end: periodCandles[periodCandles.length - 1].timestamp, candleCount: periodCandles.length, ...result })
  }
  return periods
}

export function getRobustnessWarnings(thresholdResults) {
  return thresholdResults.flatMap((result) => {
    const warnings = []
    const { minimumScore, metrics, inSampleMetrics, outOfSampleMetrics } = result
    if (metrics.totalTrades < 100) warnings.push(`${minimumScore}+ has a small sample (${metrics.totalTrades} trades).`)
    if (metrics.totalTrades && metrics.totalTrades < 100 && Math.abs(metrics.totalPositiveR) > Math.abs(metrics.totalNegativeR) * 2) warnings.push(`${minimumScore}+ depends heavily on a small number of trades.`)
    if (Math.abs(inSampleMetrics.expectancy - outOfSampleMetrics.expectancy) >= 0.15) warnings.push(`${minimumScore}+ differs substantially between in-sample and out-of-sample expectancy.`)
    if (Math.abs(metrics.expectancy) > 0 && metrics.maximumDrawdown > Math.abs(metrics.expectancy) * 100) warnings.push(`${minimumScore}+ has large drawdown relative to expectancy.`)
    return warnings
  })
}
