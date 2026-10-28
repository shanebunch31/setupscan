// Research only: full-condition populations, never score thresholds or execution rules.
import { validateAndOrderHistoricalCandles } from '../data/marketData.js'
import { candleCompletesBy, historicalCandleEndTime } from '../data/historicalDataContract.js'
import { buildAlignedSeries, buildTradeFromIndex, componentDefinitions, computeMetrics, costTierDefinitions, signalQualityDefaults } from './signalQualityBacktest.js'
import { computeCausalRegimeSeries, causalRegimeDefaults } from './causalRegimeBacktest.js'
import { candidatePeriods, candidateDaySensitivity, summarizeCandidateClustering } from './candidateContextRobustness.js'
import { scoreEvidence } from './scannerScoreRedundancyStability.js'

export const qualificationStackMethodology = 'qualification-stack-condition-count-1'
export const stackConditions = Object.freeze([
  ['vwap', 'VWAP', 'aboveVwap'], ['ema', 'EMA', 'emaAligned'], ['rsi', 'RSI', 'rsiRange'],
  ['rvol', 'RVOL', 'relVolume'], ['breakout', 'Breakout/Reclaim', 'breakout'], ['trend', 'Trend', 'bullishTrend'],
].map(([key, label, source]) => Object.freeze({ key, label, source })))
export const stackViews = Object.freeze([
  { id: 'six', label: 'Current six-condition stack', keys: stackConditions.map(c => c.key) },
  { id: 'five', label: 'Five-family stack (EMA/Trend counted once)', keys: ['vwap', 'trendFamily', 'rsi', 'rvol', 'breakout'] },
].map(v => Object.freeze({ ...v, keys: Object.freeze(v.keys), maximum: v.keys.length })))
const labelFor = key => key === 'trendFamily' ? 'Trend confirmation family' : stackConditions.find(c => c.key === key).label
export const stackBuckets = Object.freeze(stackViews.flatMap(view => [
  ...Array.from({ length: view.maximum - 2 }, (_, i) => ({ id: `count-${view.maximum - i}`, kind: 'count', count: view.maximum - i, label: `Exactly ${view.maximum - i} of ${view.maximum}` })),
  { id: 'count-le2', kind: 'count', count: 2, label: `At most 2 of ${view.maximum}` },
  ...view.keys.map(key => ({ id: `missing-${key}`, kind: 'single', count: view.maximum - 1, missing: [key], label: `Missing ${labelFor(key)}` })),
  ...view.keys.flatMap((a, i) => view.keys.slice(i + 1).map(b => ({ id: `missing-${a}+${b}`, kind: 'pair', count: view.maximum - 2, missing: [a, b], label: `Missing ${labelFor(a)} + ${labelFor(b)}` }))),
].map(b => Object.freeze({ ...b, view: view.id, key: `${view.id}::${b.id}` }))))
export const qualificationStackConfiguration = Object.freeze({
  methodologyVersion: qualificationStackMethodology, timeframe: '1Hour', views: stackViews, buckets: stackBuckets,
  outcome: { stopDistancePercent: .005, targetR: 2, maxHoldingBars: 12 }, regime: causalRegimeDefaults,
  costTiers: costTierDefinitions.map(([, r]) => r),
  population: 'All completed aligned hourly decisions in the requested range, not restricted to score 75+. Full available conditions only; partial credit is not a pass. All conditions must be evaluable for exact-count classification.',
  trendFamily: 'EMA AND Trend; disagreement is recorded and family fails; either unavailable makes family unavailable. No statistical independence claim.',
  periods: 'UTC decision periods; outcomes must finish within each displayed period. Calculation pre-roll retained. Omitted end uses frozen run requestedAt.',
  concentration: 'Eastern decision dates; Qualified baseline ranks top five / top-and-bottom five days before costs, with the same removals across all populations and cost tiers.',
})
const symbols = ['SPY', 'QQQ', 'IWM']
const ratio = (n, d) => d ? n / d : null
const count = (rows, predicate) => rows.filter(predicate).length
const dayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' })
const dayOf = timestamp => {
  const p = Object.fromEntries(dayFormatter.formatToParts(new Date(timestamp)).map(x => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day}`
}

export function fullStackConditions(candle, index) {
  return Object.fromEntries(stackConditions.map(({ key, source }) => {
    const definition = componentDefinitions.find(d => d.key === source)
    const typed = key === 'trend' ? ['Bullish', 'Bearish', 'Neutral'].includes(candle.trend) : key !== 'breakout' || typeof candle.breakout === 'boolean'
    return [key, typed && definition.available(candle, index) ? definition.test(candle) : null]
  }))
}

export function classifyQualificationStack(input) {
  const conditions = Object.fromEntries(stackConditions.map(({ key }) => [key, typeof input[key] === 'boolean' ? input[key] : null]))
  const pairState = conditions.ema === null || conditions.trend === null ? 'unavailable' : conditions.ema === conditions.trend ? 'agreement' : 'disagreement'
  const families = { vwap: conditions.vwap, trendFamily: pairState === 'unavailable' ? null : conditions.ema && conditions.trend,
    rsi: conditions.rsi, rvol: conditions.rvol, breakout: conditions.breakout }
  const classify = values => {
    const unavailable = Object.keys(values).filter(k => values[k] === null)
    const missing = Object.keys(values).filter(k => values[k] === false)
    return { evaluable: !unavailable.length, passedCount: unavailable.length ? null : Object.values(values).filter(v => v === true).length, missing, unavailable }
  }
  return { conditions, families, pairState, six: classify(conditions), five: classify(families) }
}
export function belongsToStack(classification, bucket) {
  const state = classification[bucket.view]
  if (!state.evaluable) return false
  if (bucket.id === 'count-le2') return state.passedCount <= 2
  if (state.passedCount !== bucket.count) return false
  return bucket.kind === 'count' || bucket.missing.every(key => state.missing.includes(key))
}

function summarizeOutcomes(records, period) {
  const resolved = [], exclusions = {}
  for (const r of records) {
    const time = Date.parse(r.outcomeTimestamp)
    const reason = r.exclusionReason ?? (!r.trade || !Number.isFinite(r.trade.rMultiple) ? 'unresolved-outcome' :
      !Number.isFinite(time) ? 'unavailable-outcome-time' : time < Date.parse(r.decisionTimestamp) ? 'invalid-outcome-time' :
        time > Date.parse(period.end) ? 'outcome-crosses-period' : null)
    if (reason) exclusions[reason] = (exclusions[reason] ?? 0) + 1
    else resolved.push(r)
  }
  const trades = resolved.map(r => r.trade)
  const costTiers = costTierDefinitions.map(([label, costR]) => {
    const metrics = trades.length ? computeMetrics(trades, costR) : null
    if (metrics && trades.every(t => t.rMultiple === costR)) metrics.profitFactor = null
    return { label, costR, metrics }
  })
  return { resolved, summary: {
    resolvedCount: resolved.length, outcomeExcludedCount: records.length - resolved.length, exclusions,
    wins: count(trades, t => t.rMultiple > 0), losses: count(trades, t => t.rMultiple < 0), breakeven: count(trades, t => t.rMultiple === 0),
    expiredCount: count(trades, t => t.exitReason === 'Expired'), evidenceStrength: scoreEvidence(resolved.length), costTiers, metrics: costTiers[0].metrics,
  } }
}

// Public pure summary seam; records are internal transient observations, not saved raw payloads.
export function summarizeQualificationStack(records, { requestedStart, requestedEnd, coverage = {} }) {
  const ordered = [...records].sort((a, b) => a.decisionTimestamp.localeCompare(b.decisionTimestamp) || a.symbol.localeCompare(b.symbol))
  const full = { key: 'full', label: 'Full sample', start: requestedStart, end: requestedEnd, type: 'full' }
  const periods = [full, ...candidatePeriods(requestedEnd).map(p => ({ ...p, start: new Date(Math.max(Date.parse(p.start), Date.parse(requestedStart))).toISOString() }))]
  const groups = periods.flatMap(period => [null, ...symbols].map(symbol => ({
    key: `${period.key}::${symbol ?? 'pooled'}`, label: `${period.label} / ${symbol ?? 'Pooled SPY/QQQ/IWM'}`, period, symbol,
    records: ordered.filter(r => Date.parse(r.decisionTimestamp) >= Date.parse(period.start) && Date.parse(r.decisionTimestamp) <= Date.parse(period.end) && (!symbol || r.symbol === symbol)),
  })))
  for (const field of ['trend', 'volatility', 'regime']) for (const value of [...new Set(ordered.map(r => r[field]))].sort()) groups.push({
    key: `${field}::${value}`, label: `${field}: ${value}`, period: full, symbol: null, records: ordered.filter(r => r[field] === value),
  })
  const accounting = [], rows = []
  for (const group of groups) {
    const baselineRecords = group.records.filter(r => r.classification.six.passedCount === 6)
    const baseline = summarizeOutcomes(baselineRecords, group.period).summary
    const withDays = ['full', 'development', 'recent'].includes(group.period.key) && !/^(trend|volatility|regime)::/.test(group.key)
    const removals = withDays ? candidateDaySensitivity(baselineRecords, group.period) : []
    for (const view of stackViews) {
      const evaluable = group.records.filter(r => r.classification[view.id].evaluable)
      const viewRows = stackBuckets.filter(b => b.view === view.id).map(bucket => {
        const selected = evaluable.filter(r => belongsToStack(r.classification, bucket))
        const { resolved, summary } = summarizeOutcomes(selected, group.period)
        const costTiers = summary.costTiers.map((tier, i) => ({ ...tier, differenceFromQualifiedR: tier.metrics && baseline.costTiers[i].metrics ? tier.metrics.expectancy - baseline.costTiers[i].metrics.expectancy : null }))
        return {
          key: `${group.key}::${bucket.key}`, group: group.key, label: group.label, period: group.period, symbol: group.symbol,
          view: view.id, bucket: bucket.id, bucketLabel: bucket.label, kind: bucket.kind, fullPassCount: bucket.count, missing: bucket.missing ?? [],
          examinedCount: group.records.length, conditionEvaluableCount: evaluable.length, unavailableCount: group.records.length - evaluable.length,
          eligibleCount: selected.length, otherEvaluableCount: evaluable.length - selected.length,
          populationShare: ratio(selected.length, evaluable.length), examinedShare: ratio(selected.length, group.records.length),
          qualifiedEligibleCount: baselineRecords.length, qualifiedResolvedCount: baseline.resolvedCount,
          populationRatioToQualified: ratio(selected.length, baselineRecords.length),
          ...summary, costTiers, comparisonEvidence: scoreEvidence(Math.min(summary.resolvedCount, baseline.resolvedCount)),
          reconciliationStatus: summary.resolvedCount + Object.values(summary.exclusions).reduce((s, n) => s + n, 0) === selected.length && summary.wins + summary.losses + summary.breakeven === summary.resolvedCount ? 'reconciled' : 'mismatch',
          concentration: withDays ? summarizeCandidateClustering(selected, group.period) : null,
          daySensitivity: removals.map(removal => {
            const removed = new Set(removal.removedDays)
            const stress = summarizeOutcomes(resolved.filter(r => !removed.has(dayOf(r.decisionTimestamp))), group.period).summary
            return { key: removal.key, removedDays: removal.removedDays, qualifiedResolvedCount: removal.summary.resolvedCount, ...stress,
              costTiers: stress.costTiers.map((tier, i) => ({ ...tier, differenceFromQualifiedR: tier.metrics && removal.summary.costTiers[i].metrics ? tier.metrics.expectancy - removal.summary.costTiers[i].metrics.expectancy : null })) }
          }),
        }
      })
      const sum = kind => viewRows.filter(r => r.kind === kind).reduce((s, r) => s + r.eligibleCount, 0)
      const exact = n => viewRows.find(r => r.bucket === `count-${n}`).eligibleCount
      accounting.push({ group: group.key, view: view.id, examinedCount: group.records.length, conditionEvaluableCount: evaluable.length,
        unavailableCount: group.records.length - evaluable.length,
        unavailableByCondition: Object.fromEntries(view.keys.map(key => [key, count(group.records, r => r.classification[view.id].unavailable.includes(key))])),
        disagreementCount: count(group.records, r => r.classification.pairState === 'disagreement'),
        exactCountTotal: sum('count'), singleMissingTotal: sum('single'), pairMissingTotal: sum('pair'),
        reconciliationStatus: sum('count') === evaluable.length && sum('single') === exact(view.maximum - 1) && sum('pair') === exact(view.maximum - 2) ? 'reconciled' : 'mismatch' })
      rows.push(...viewRows)
    }
  }
  const comparisons = groups.flatMap(group => stackViews.map(view => compareStackCounts(rows.filter(r => r.group === group.key && r.view === view.id && r.kind === 'count'), view)))
  const missingComparisons = rows.filter(r => r.kind === 'single').map(r => ({
    group: r.group, view: r.view, missing: r.missing[0], eligibleCount: r.eligibleCount, resolvedCount: r.resolvedCount, qualifiedResolvedCount: r.qualifiedResolvedCount,
    evidence: r.comparisonEvidence, costTiers: r.costTiers.map(t => ({ costR: t.costR, differenceFromQualifiedR: t.differenceFromQualifiedR,
      direction: directional(t.differenceFromQualifiedR, Math.min(r.resolvedCount, r.qualifiedResolvedCount)) })),
  }))
  const ema = ordered.filter(r => belongsToStack(r.classification, stackBuckets.find(b => b.key === 'six::missing-ema')))
  const trend = ordered.filter(r => belongsToStack(r.classification, stackBuckets.find(b => b.key === 'six::missing-trend')))
  const emaSet = new Set(ema)
  const redundancy = {
    agreementCount: count(ordered, r => r.classification.pairState === 'agreement'), disagreementCount: count(ordered, r => r.classification.pairState === 'disagreement'),
    unavailableCount: count(ordered, r => r.classification.pairState === 'unavailable'), emaMissingCount: ema.length, trendMissingCount: trend.length,
    sameMembership: ema.length === trend.length && trend.every(r => emaSet.has(r)),
    interpretation: !ema.length && !trend.length ? 'Both single-missing buckets are empty; this is a structural consequence of redundancy, not two confirmations.' : 'Single-missing EMA and Trend are distinct disjoint condition patterns; matching aggregate metrics alone does not prove equivalence.',
  }
  return { available: true, methodologyVersion: qualificationStackMethodology, options: qualificationStackConfiguration,
    requestedStart, requestedEnd, symbols, regimeSourceSymbol: 'SPY', periods, coverage, rows, accounting, comparisons, missingComparisons, redundancy,
    conclusions: stackViews.map(v => stackConclusion(v, rows, comparisons, missingComparisons)),
    limitations: [
      'Research only. Condition count and Setup Score are not win probabilities. Production Qualified/Potential definitions, Paper Trader and Shadow Forward remain unchanged.',
      'All six required inputs must be evaluable before assigning an exact count. Unavailable is not fail. Partial RSI/RVOL score credit is not a full pass. Single/pair subgroups partition their parent count, not additional independent observations.',
      'The five-family view counts EMA AND Trend once; disagreement is a known non-pass and is disclosed. Removing duplicate credit does not establish statistical independence among remaining families.',
      'Shared Signal Quality outcomes: next observed open, 0.5% initial risk, 2R target, 12 observed bars; adverse stop gaps, target-price gaps, stop-first same-bar ambiguity counted. No trailing-stop model. Short expired outcomes and outcomes crossing the displayed UTC period are excluded. Resolved expired outcomes overlap wins/losses/breakeven.',
      'Available pre-roll seeds indicators before counting requested-range decisions. Shared-timestamp alignment can drop observations; missing bars are not fabricated. Historical hourly VWAP is not the live scanner separate five-minute VWAP input.',
      'R costs are fixed modeled deductions on identical occurrences. Sequential-R drawdown is not account equity; overlaps, capital and position sizing are not modeled.',
      '2025–2026 is repeatedly explored historical follow-up, not an untouched holdout. Many predeclared subgroups create multiple-comparison risk; no best pair, optimization, causal attribution, or promotion is authorized.',
      'Under 30 resolved on either comparison side is insufficient; 30–99 is exploratory; 100+ remains descriptive. The symmetric 0.02R negligible band is an operational convention, not statistical significance.',
      'Concentration uses Eastern decision dates. Day stress removes Qualified-baseline highest five or highest-and-lowest five before-cost dates identically across populations/costs; dates may overlap, and a short sample may leave no evidence.',
    ] }
}

function directional(difference, n) {
  return difference === null || n < 30 ? 'insufficient' : Math.abs(difference) <= signalQualityDefaults.negligibleThresholdR ? 'negligible' : difference > 0 ? 'positive' : 'negative'
}
export function compareStackCounts(rows, view) {
  const sorted = [...rows].sort((a, b) => a.fullPassCount - b.fullPassCount)
  const pairs = sorted.slice(1).map((higher, i) => {
    const lower = sorted[i], n = Math.min(higher.resolvedCount, lower.resolvedCount)
    return { lower: lower.bucket, higher: higher.bucket, lowerN: lower.resolvedCount, higherN: higher.resolvedCount, evidence: scoreEvidence(n),
      costTiers: higher.costTiers.map((tier, j) => {
        const differenceR = tier.metrics && lower.costTiers[j].metrics ? tier.metrics.expectancy - lower.costTiers[j].metrics.expectancy : null
        return { costR: tier.costR, differenceR, direction: directional(differenceR, n) }
      }) }
  })
  const directions = pairs.map(p => p.costTiers[0].direction)
  return { group: rows[0].group, view: view.id, pairs,
    monotonicity: directions.includes('insufficient') ? 'insufficient' : directions.includes('negative') ? 'not-monotonic' : directions.includes('positive') ? 'nondecreasing-within-negligible-band' : 'negligible-differences' }
}

function stackConclusion(view, rows, comparisons, missingComparisons) {
  const own = comparisons.filter(c => c.view === view.id)
  const pooled = period => own.find(c => c.group === `${period}::pooled`)
  const keyPairs = c => c.pairs.filter(p => p.lower !== 'count-le2')
  const d = pooled('development'), r = pooled('recent'), f = pooled('full')
  const sufficientlyCompared = keyPairs(d).every(p => p.lowerN >= 30 && p.higherN >= 30) && keyPairs(r).every(p => p.lowerN >= 30 && p.higherN >= 30)
  // Compare the SAME adjacent populations across groups; different contrasts are not sign reversals.
  const reversals = keyPairs(f).flatMap(pair => {
    const evidence = own.flatMap(c => c.pairs.filter(p => p.lower === pair.lower && p.higher === pair.higher && p.costTiers[0].direction !== 'insufficient').map(p => ({ group: c.group, direction: p.costTiers[0].direction })))
    return evidence.some(e => e.direction === 'positive') && evidence.some(e => e.direction === 'negative') ? [{ lower: pair.lower, higher: pair.higher, evidence }] : []
  })
  const ownRows = rows.filter(row => row.view === view.id && row.kind === 'count')
  const costDependence = ownRows.filter(row => row.resolvedCount >= 30 && row.costTiers.some(t => t.metrics.expectancy > 0) && row.costTiers.some(t => t.metrics.expectancy <= 0)).map(row => row.key)
  const dayDependence = ownRows.filter(row => row.comparisonEvidence !== 'insufficient' && row.daySensitivity.some(s => Math.min(s.resolvedCount, s.qualifiedResolvedCount) >= 30 && s.costTiers.some((t, i) =>
    t.differenceFromQualifiedR !== null && row.costTiers[i].differenceFromQualifiedR !== null && directional(t.differenceFromQualifiedR, 30) !== directional(row.costTiers[i].differenceFromQualifiedR, 30)))).map(row => row.key)
  const underpowered = own.flatMap(c => keyPairs(c).filter(p => p.lowerN < 100 || p.higherN < 100).map(p => `${c.group}::${p.lower}/${p.higher}`))
  const status = !sufficientlyCompared ? 'INSUFFICIENT' : reversals.length ? 'MIXED / UNSTABLE' : underpowered.length || costDependence.length || dayDependence.length ? 'DIRECTIONALLY CONSISTENT BUT EXPLORATORY' : 'DESCRIPTIVELY CONSISTENT'
  const missing = missingComparisons.filter(c => c.view === view.id && ['full::pooled', 'development::pooled', 'recent::pooled', 'full::SPY', 'full::QQQ', 'full::IWM'].includes(c.group))
  const consequential = missing.filter(c => c.group === 'full::pooled' && c.costTiers[0].direction !== 'insufficient')
  const largest = consequential.length ? Math.max(...consequential.map(c => Math.abs(c.costTiers[0].differenceFromQualifiedR))) : null
  return { view: view.id, status, reversals, costDependence, dayDependence, underpowered,
    development: d, recent: r, full: f,
    olderImprovementNotPersistent: keyPairs(d).map(p => ({ lower: p.lower, higher: p.higher, result:
      p.costTiers[0].direction === 'insufficient' || r.pairs.find(q => q.lower === p.lower).costTiers[0].direction === 'insufficient' ? null :
        p.costTiers[0].direction === 'positive' && r.pairs.find(q => q.lower === p.lower).costTiers[0].direction !== 'positive' })),
    missingConditionFindings: missing,
    largestObservedMissingDifferences: largest === null ? [] : consequential.filter(c => Math.abs(c.costTiers[0].differenceFromQualifiedR) === largest).map(c => ({ missing: c.missing, differenceR: c.costTiers[0].differenceFromQualifiedR, resolvedCount: c.resolvedCount, evidence: c.evidence })),
    summary: {
      result: `${view.label}: ${f.monotonicity} in the full sample. ${status}. No stack or missing pair is selected for production.`,
      evidence: keyPairs(f).map(p => `${p.higher} versus ${p.lower}: ${p.higherN}/${p.lowerN} resolved; difference ${p.costTiers[0].differenceR === null ? 'unavailable' : `${p.costTiers[0].differenceR.toFixed(3)}R`}; ${p.evidence}`).join('. '),
      independentConditionView: `Six/five-family full-sample ordering: ${comparisons.find(c => c.group === 'full::pooled' && c.view === 'six').monotonicity} / ${comparisons.find(c => c.group === 'full::pooled' && c.view === 'five').monotonicity}. Five families remove EMA/Trend double-counting; they are not proven independent.`,
      stability: `Development/recent ordering: ${d.monotonicity} / ${r.monotonicity}. ${reversals.length} adjacent-count contrasts reverse direction across adequately sampled groups. Inspect SPY, QQQ and IWM separately; pooled results can hide disagreement.`,
      missingConditionFindings: missing.filter(c => c.group === 'full::pooled').map(c => `Missing ${labelFor(c.missing)}: n=${c.resolvedCount}, difference from Qualified ${c.costTiers[0].differenceFromQualifiedR === null ? 'unavailable' : `${c.costTiers[0].differenceFromQualifiedR.toFixed(3)}R`}, ${c.evidence}`).join('. '),
      limitation: 'Many dependent, repeatedly explored subgroups; operational sample floors and negligible bands do not establish significance, causality or future profitability. Count comparisons exclude unavailable inputs.',
      nextQuestion: 'Inspect recent and symbol-specific contradictions before predeclaring a separate prospective test of one condition question. Do not tune conditions or promote the strongest historical pair.',
    } }
}

export function runQualificationStack(raw, { requestedStart = null, requestedEnd } = {}) {
  if (!Number.isFinite(Date.parse(requestedEnd)) || (requestedStart && !Number.isFinite(Date.parse(requestedStart)))) return { available: false, reason: 'A valid frozen cutoff and optional start are required.' }
  if (symbols.some(s => !raw[s]?.length)) return { available: false, reason: 'Complete SPY, QQQ and IWM hourly inputs are required.' }
  if (symbols.some(s => raw[s].some(c => !['1Hour', '1h'].includes(c.timeframe)))) return { available: false, reason: 'Explicit hourly candles are required.' }
  const validation = Object.fromEntries(symbols.map(s => [s, validateAndOrderHistoricalCandles(raw[s])]))
  const dataQuality = Object.fromEntries(symbols.map(s => [s, validation[s].dataQuality]))
  if (symbols.some(s => dataQuality[s].rejectedCandleCount)) return { incomplete: true, reason: 'Invalid source candles prevent a reliable comparison.', dataQuality }
  const source = Object.fromEntries(symbols.map(s => [s, validation[s].candles.filter(c => candleCompletesBy(c, '1Hour', requestedEnd))]))
  const aligned = buildAlignedSeries(source)
  if (!aligned.timestamps.length) return { available: false, reason: 'No shared completed hourly observations.', dataQuality }
  const regimes = computeCausalRegimeSeries(aligned.raw, causalRegimeDefaults)
  const records = symbols.flatMap(symbol => aligned.enriched[symbol].flatMap((candle, i) => {
    if (requestedStart && Date.parse(candle.timestamp) < Date.parse(requestedStart)) return []
    const classification = classifyQualificationStack(fullStackConditions(candle, i))
    const candles = aligned.raw[symbol]
    const trade = classification.six.evaluable ? buildTradeFromIndex(candles, i, signalQualityDefaults, { symbol }) : null
    const trend = regimes[i].trend.classification, volatility = regimes[i].volatility.classification
    return [{ symbol, classification, trend, volatility, regime: `${trend} / ${volatility}`,
      decisionTimestamp: new Date(historicalCandleEndTime(candle.timestamp, '1Hour')).toISOString(), trade,
      outcomeTimestamp: trade ? new Date(historicalCandleEndTime(candles[i + trade.holdingBars].timestamp, '1Hour')).toISOString() : null,
      exclusionReason: !trade ? 'no-entry-or-invalid-risk' : trade.exitReason === 'Expired' && trade.holdingBars < 12 ? 'incomplete-holding-window' : null,
    }]
  }))
  if (!records.length) return { available: false, reason: 'No evaluated observations in range.', dataQuality }
  const times = records.map(r => r.decisionTimestamp).sort()
  return summarizeQualificationStack(records, { requestedStart: requestedStart ?? times[0], requestedEnd,
    coverage: { dataQuality, alignmentDroppedCounts: aligned.droppedCounts,
      completionExcludedCounts: Object.fromEntries(symbols.map(s => [s, validation[s].candles.length - source[s].length])),
      actualDecisionStart: times[0], actualDecisionEnd: times.at(-1) } })
}
