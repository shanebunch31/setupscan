function metricObservation(label, metrics) {
  const tradeCount = Number.isFinite(metrics?.tradeCount) ? metrics.tradeCount : null
  const expectancy = tradeCount > 0 && Number.isFinite(metrics?.expectancy) ? metrics.expectancy : null
  return { label, value: expectancy, tradeCount }
}

function windowDetails(window) {
  return window.testRealizedStart && window.testRealizedEnd
    ? `${window.testRealizedStart} through ${window.testRealizedEnd} UTC`
    : 'Test-period dates unavailable'
}

/** Existing Experiment #7 variant expectancy summaries, in their returned test-window order. */
export function buildVolatilityAwareExpectancyObservations(windows = []) {
  return windows.map((window) => ({
    label: `${window.label} · ${window.testYear}`,
    detail: windowDetails(window),
    series: (window.variants ?? []).map((variant) => metricObservation(variant.label, variant.summary?.overall)),
  }))
}

/** Existing per-window expectancy differences, shown only when both samples have trades. */
export function buildVolatilityAwareControlDifferenceObservations(windows = []) {
  return windows.map((window) => ({
    label: `${window.label} · ${window.testYear}`,
    detail: windowDetails(window),
    series: (window.diffsVsControl ?? []).map((entry) => {
      const variantTradeCount = window.variants?.find((variant) => variant.key === entry.key)?.summary?.overall?.tradeCount
      const controlTradeCount = window.variants?.find((variant) => variant.key === 'control')?.summary?.overall?.tradeCount
      const hasComparableSamples = variantTradeCount > 0 && controlTradeCount > 0
      return {
        label: entry.label,
        value: hasComparableSamples && Number.isFinite(entry.diff?.expectancyChange) ? entry.diff.expectancyChange : null,
        tradeCount: Number.isFinite(variantTradeCount) ? variantTradeCount : null,
        comparisonTradeCount: Number.isFinite(controlTradeCount) ? controlTradeCount : null,
      }
    }),
  }))
}

/** Presentation rows from the already-calculated, signal-year summaries. */
export function buildYearlyExpectancyObservations(years = []) {
  return years.map((year) => ({
    label: String(year.year),
    detail: year.start && year.end ? `${year.start} through ${year.end} UTC` : 'Date range unavailable',
    series: [
      metricObservation('Baseline', year.baseline?.overall),
      metricObservation('RV-confirmed', year.rvConfirmed?.overall),
    ],
  }))
}

/** Presentation rows from Walk-Forward's existing per-test-year evidence table. */
export function buildWalkForwardRegimeExpectancyObservations(evidenceTable = []) {
  return evidenceTable.map((year) => ({
    label: String(year.testYear),
    series: [
      metricObservation('Low volatility', year.low),
      metricObservation('Medium volatility', year.medium),
      metricObservation('High volatility', year.high),
    ],
  }))
}

/** Uses only realized data bounds returned by the walk-forward calculation. */
export function buildWalkForwardTimelineRows(windows = []) {
  return windows.map((window) => ({
    label: `${window.label} · ${window.testYear}`,
    testYear: String(window.testYear),
    training: {
      start: window.trainRealizedStart ?? null,
      end: window.trainRealizedEnd ?? null,
      candleCount: Number.isFinite(window.trainCandleCount) ? window.trainCandleCount : null,
    },
    test: {
      start: window.testRealizedStart ?? null,
      end: window.testRealizedEnd ?? null,
      candleCount: Number.isFinite(window.testCandleCount) ? window.testCandleCount : null,
    },
  }))
}
