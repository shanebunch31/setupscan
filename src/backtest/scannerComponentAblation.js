// Research-only score subtraction. Production scoring and outcome helpers are read, never changed.
import { scanSetups, isResearchEligibleSignal } from '../logic/scanner.js'
import { validateAndOrderHistoricalCandles } from '../data/marketData.js'
import { candleCompletesBy, historicalCandleEndTime } from '../data/historicalDataContract.js'
import { buildAlignedSeries, buildTradeFromIndex, computeMetrics, componentDefinitions, signalQualityDefaults } from './signalQualityBacktest.js'
import { computeCausalRegimeSeries, causalRegimeDefaults } from './causalRegimeBacktest.js'

export const ablationMethodology = 'scanner-component-ablation-1'
export const ablationComponents = Object.freeze([
  ['vwap', 'Price vs VWAP'], ['ema', 'EMA alignment'], ['rsi', 'RSI momentum'],
  ['rvol', 'Relative volume'], ['breakout', 'Breakout / reclaim'], ['trend', 'Trend confirmation'],
].map(([key, label]) => Object.freeze({ key, label })))
export const ablationVariants = Object.freeze([
  { id: 'baseline', label: 'Normal research-eligible 75+', remove: [], maximumScore: 100 },
  ...ablationComponents.map(({ key, label }, i) => ({ id: `without-${key}`, label: `Remove ${label}`, remove: [key], maximumScore: 100 - [20, 20, 15, 15, 15, 15][i] })),
  { id: 'without-ema-trend', label: 'Remove both EMA and Trend', remove: ['ema', 'trend'], maximumScore: 65 },
  { id: 'ema-trend-max', label: 'Count EMA/Trend once (larger contribution)', remove: [], maximumScore: 85 },
].map(v => Object.freeze({ ...v, remove: Object.freeze(v.remove) })))
export const ablationConfiguration = Object.freeze({
  methodologyVersion: ablationMethodology, timeframe: '1Hour', minimumScore: 75,
  variants: ablationVariants, outcome: { stopDistancePercent: 0.005, targetR: 2, maxHoldingBars: 12 },
  regime: causalRegimeDefaults, periods: 'UTC decision years; outcomes contained within each displayed period',
  neutralization: 'max(existing EMA points, existing Trend points); fixed 75 threshold; no rescaling',
})

export function ablationScore(signal, variantId) {
  const variant = ablationVariants.find(v => v.id === variantId)
  if (!variant) throw new Error('Unknown ablation variant')
  const points = Object.fromEntries(ablationComponents.map(({ key, label }) => {
    const reason = signal.reasons?.find(r => r.label === label)
    if (!Number.isFinite(reason?.points)) throw new Error(`Missing scanner contribution: ${label}`)
    return [key, reason.points]
  }))
  const removed = variantId === 'ema-trend-max' ? Math.min(points.ema, points.trend)
    : variant.remove.reduce((sum, key) => sum + points[key], 0)
  return { score: signal.score - removed, removedPoints: removed,
    eligible: isResearchEligibleSignal(signal) && signal.score - removed >= 75 }
}

export function conditionOverlap(records, left, right) {
  const counts = { bothTrue: 0, leftOnly: 0, rightOnly: 0, neither: 0, unavailable: 0 }
  for (const row of records) {
    const a = row.conditions[left], b = row.conditions[right]
    if (a == null || b == null) counts.unavailable++
    else counts[a && b ? 'bothTrue' : a ? 'leftOnly' : b ? 'rightOnly' : 'neither']++
  }
  const { bothTrue: a, leftOnly: b, rightOnly: c, neither: d } = counts
  const denominator = Math.sqrt((a + b) * (c + d) * (a + c) * (b + d))
  return { left, right, ...counts, evaluatedCount: records.length, availableCount: a + b + c + d,
    rightGivenLeft: a + b ? a / (a + b) : null, leftGivenRight: a + c ? a / (a + c) : null,
    phi: denominator ? (a * d - b * c) / denominator : null }
}
const evidence = n => n < 30 ? 'insufficient' : n < 100 ? 'exploratory-small-sample' : 'descriptive-only'
function metricsFor(trades) {
  if (!trades.length) return null
  const wins = trades.filter(t => t.rMultiple > 0), losses = trades.filter(t => t.rMultiple < 0)
  return { ...computeMetrics(trades),
    averageWinner: wins.length ? wins.reduce((s, t) => s + t.rMultiple, 0) / wins.length : null,
    averageLoser: losses.length ? losses.reduce((s, t) => s + t.rMultiple, 0) / losses.length : null,
    profitFactor: losses.length ? computeMetrics(trades).profitFactor : wins.length ? Infinity : null }
}
function summarize(rows, end) {
  const resolved = rows.filter(r => r.trade && r.outcomeTime < end)
  const excluded = {}
  for (const r of rows) {
    const reason = r.exclusion ?? (r.outcomeTime >= end ? 'outcome-crosses-period' : null)
    if (reason) excluded[reason] = (excluded[reason] ?? 0) + 1
  }
  const concentration = field => Object.fromEntries([...new Set(rows.map(r => r[field]))].sort().map(key => {
    const count = rows.filter(r => r[field] === key).length, resolvedCount = resolved.filter(r => r[field] === key).length
    return [key, { count, resolvedCount, resolvedShare: resolved.length ? resolvedCount / resolved.length : null }]
  }))
  return { eligibleCount: rows.length, qualifiedCount: rows.filter(r => r.signal.qualifiedSetup).length,
    resolvedCount: resolved.length, outcomeExcludedCount: rows.length - resolved.length, exclusions: excluded,
    evidenceStrength: evidence(resolved.length), metrics: metricsFor(resolved.map(r => r.trade)),
    symbolConcentration: concentration('symbol'), regimeConcentration: concentration('regime'),
    reconciliationStatus: resolved.length + Object.values(excluded).reduce((s, n) => s + n, 0) === rows.length ? 'reconciled' : 'mismatch' }
}

export function runScannerComponentAblation(raw, { requestedStart = null, requestedEnd } = {}) {
  const symbols = ['SPY', 'QQQ', 'IWM']
  if (!Number.isFinite(Date.parse(requestedEnd)) || (requestedStart && !Number.isFinite(Date.parse(requestedStart)))) return { available: false, reason: 'Valid requested date bounds are required.' }
  if (symbols.some(s => !raw[s]?.length)) return { available: false, reason: 'Complete SPY, QQQ and IWM hourly inputs are required.' }
  if (symbols.some(s => raw[s].some(c => !['1Hour', '1h'].includes(c.timeframe)))) return { available: false, reason: 'Only explicitly identified hourly candles are supported.' }
  const validation = Object.fromEntries(symbols.map(s => [s, validateAndOrderHistoricalCandles(raw[s])]))
  const dataQuality = Object.fromEntries(symbols.map(s => [s, validation[s].dataQuality]))
  if (symbols.some(s => dataQuality[s].rejectedCandleCount)) return { incomplete: true, reason: 'Invalid source candles prevent a reliable comparison; no outcomes fabricated.', dataQuality }
  const source = Object.fromEntries(symbols.map(s => [s, validation[s].candles.filter(c => candleCompletesBy(c, '1Hour', requestedEnd))]))
  const completionExcludedCounts = Object.fromEntries(symbols.map(s => [s, validation[s].candles.length - source[s].length]))
  const aligned = buildAlignedSeries(source)
  if (!aligned.timestamps.length) return { available: false, reason: 'No shared completed observations.', dataQuality }
  const regimes = computeCausalRegimeSeries(aligned.raw, causalRegimeDefaults)
  const records = symbols.flatMap(symbol => {
    const candles = aligned.raw[symbol], enriched = aligned.enriched[symbol]
    const scores = new Map(scanSetups(enriched).map(s => [s.timestamp, s]))
    return enriched.flatMap((c, i) => {
      if (requestedStart && Date.parse(c.timestamp) < Date.parse(requestedStart)) return []
      const signal = scores.get(c.timestamp)
      const availability = Object.fromEntries(ablationComponents.map(({ key }, j) => [key, componentDefinitions[j].available(c, i)]))
      const points = Object.fromEntries(ablationComponents.map(({ key, label }) => [key, signal.reasons.find(r => r.label === label).points]))
      const conditions = Object.fromEntries(ablationComponents.map(({ key }, j) => [key, availability[key] ? points[key] === [20, 20, 15, 15, 15, 15][j] : null]))
      conditions.rsiPartial = availability.rsi ? points.rsi === 8 : null
      conditions.rvolPartial = availability.rvol ? points.rvol === 8 : null
      const decisionTime = historicalCandleEndTime(c.timestamp, '1Hour')
      const trade = isResearchEligibleSignal(signal) ? buildTradeFromIndex(candles, i, signalQualityDefaults, { symbol }) : null
      const outcomeTime = trade ? historicalCandleEndTime(candles[i + trade.holdingBars].timestamp, '1Hour') : null
      const exclusion = !trade ? 'no-entry-or-invalid-risk' : trade.exitReason === 'Expired' && trade.holdingBars < 12 ? 'incomplete-holding-window' : null
      const trend = regimes[i].trend.classification, volatility = regimes[i].volatility.classification
      return [{ symbol, signal, availability, conditions, decisionTime, outcomeTime, exclusion,
        trade: exclusion ? null : trade, year: new Date(decisionTime).getUTCFullYear(), trend, volatility, regime: `${trend} / ${volatility}` }]
    })
  }).sort((a, b) => a.decisionTime - b.decisionTime || a.symbol.localeCompare(b.symbol))
  if (!records.length) return { available: false, reason: 'No evaluated observations inside the requested range.', dataQuality, completionExcludedCounts }
  const baseline = records.filter(r => isResearchEligibleSignal(r.signal))
  const featureNames = [...ablationComponents.map(c => c.key), 'rsiPartial', 'rvolPartial']
  const overlap = population => featureNames.flatMap((a, i) => featureNames.slice(i + 1).map(b => conditionOverlap(population, a, b)))
  const fullEnd = Date.parse(requestedEnd) + 1
  const groups = [{ key: 'full', label: 'Full observed range', rows: records, end: fullEnd },
    ...symbols.map(symbol => ({ key: `symbol-${symbol}`, label: symbol, symbol, rows: records.filter(r => r.symbol === symbol), end: fullEnd })),
    ...[...new Set(records.map(r => r.year))].sort().map(year => ({ key: `year-${year}`, label: `${year} (UTC decision year)`, rows: records.filter(r => r.year === year), end: Math.min(fullEnd, Date.UTC(year + 1, 0, 1)) })),
    ...['trend', 'volatility'].flatMap(field => [...new Set(records.map(r => r[field]))].sort().map(value => ({ key: `${field}-${value}`, label: `${field}: ${value}`, rows: records.filter(r => r[field] === value), end: fullEnd }))),
  ]
  const rows = groups.flatMap(group => {
    const base = group.rows.filter(r => isResearchEligibleSignal(r.signal)), baseSummary = summarize(base, group.end)
    return ablationVariants.map(variant => {
      const selected = base.filter(r => ablationScore(r.signal, variant.id).eligible)
      const removed = base.filter(r => !ablationScore(r.signal, variant.id).eligible)
      const summary = summarize(selected, group.end), removedSummary = summarize(removed, group.end)
      return { key: `${group.key}::${variant.id}`, group: group.key, label: group.label, symbol: group.symbol ?? null,
        variant: variant.id, variantLabel: variant.label, maximumScore: variant.maximumScore,
        evaluatedCount: group.rows.length, baselineEligibleCount: base.length,
        unavailableInputCount: group.rows.filter(r => Object.values(r.availability).some(v => !v)).length,
        ...summary, removed: removedSummary,
        differenceR: summary.metrics && baseSummary.metrics ? summary.metrics.expectancy - baseSummary.metrics.expectancy : null,
        retainedShare: base.length ? selected.length / base.length : null,
        comparisonEvidence: evidence(Math.min(summary.resolvedCount, removedSummary.resolvedCount)),
      }
    })
  })
  return { available: true, methodologyVersion: ablationMethodology, options: ablationConfiguration,
    symbols, regimeSourceSymbol: 'SPY', requestedStart, requestedEnd, dataQuality, completionExcludedCounts,
    alignmentDroppedCounts: aligned.droppedCounts, evaluatedCount: records.length, baselineEligibleCount: baseline.length,
    components: featureNames.map(key => ({ key, present: records.filter(r => r.conditions[key] === true).length,
      absent: records.filter(r => r.conditions[key] === false).length, unavailable: records.filter(r => r.conditions[key] == null).length })),
    overlap: { allEvaluated: overlap(records), researchEligible: overlap(baseline) }, rows,
    limitations: [
      'Exploratory repeated historical comparisons, not independent confirmation or evidence of future profitability. Setup Score is not a win probability.',
      'Subtraction at a fixed 75 floor selects a subset, not a causal estimate of independent predictive value. Compare retained and removed samples; no automatic winner or significance claim.',
      'EMA/Trend max uses existing points only. Alternatives are dropping either component or rescaling to 100; rescaling changes the selection threshold and is not tested here.',
      'Both removed has a maximum score of 65 and cannot pass 75. On normally enriched inputs the max challenger matches removal of Trend; those are not independent confirmations.',
      'Fixed Signal Quality fills: next observed open, 0.5% stop, 2R target, 12 observed bars, adverse stop gaps, target-price gaps, stop-first intrabar ambiguity counted. No trailing stop or execution costs.',
      'Short expired outcomes and outcomes crossing the displayed UTC year are excluded in this versioned study. Full-range and yearly results therefore need not sum.',
      'Aligned completed hourly observations retain pre-roll for indicators. Missing intervals are not reconstructed; 12 observed bars are not necessarily 12 contiguous hours. Drawdown is sequential R in decision-time/symbol order, not account equity; overlapping positions and capital are not modeled.',
      'Causal regimes use SPY with expanding history through the decision candle. Insufficient-History is a separate group. Under 30 resolved is insufficient; 30\u201399 is a small exploratory sample; 100+ remains descriptive only.',
    ] }
}
