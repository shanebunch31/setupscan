// A predeclared descriptive study; never used by scanner or paper entry decisions.
import { scanSetups, isResearchEligibleSignal } from '../logic/scanner.js'
import { validateAndOrderHistoricalCandles } from '../data/marketData.js'
import { candleCompletesBy, historicalCandleEndTime } from '../data/historicalDataContract.js'
import { buildAlignedSeries, buildTradeFromIndex, computeMetrics, componentDefinitions, costTierDefinitions, signalQualityDefaults } from './signalQualityBacktest.js'
import { computeCausalRegimeSeries, causalRegimeDefaults } from './causalRegimeBacktest.js'
import { ablationComponents, conditionOverlap } from './scannerComponentAblation.js'
import { candidatePeriods, candidateDaySensitivity, summarizeCandidateClustering } from './candidateContextRobustness.js'

export const scoreStabilityMethodology = 'scanner-score-redundancy-stability-1'
export const scoreStabilityVariants = Object.freeze([
  { id: 'baseline', label: 'A. Current score', maximumScore: 100 },
  { id: 'keep-ema', label: 'B. Keep EMA / remove Trend', maximumScore: 85 },
  { id: 'keep-trend', label: 'C. Keep Trend / remove EMA', maximumScore: 80 },
  { id: 'combined-20', label: 'D. Shared trend family 20', maximumScore: 85 },
  { id: 'combined-15', label: 'E. Shared trend family 15', maximumScore: 80 },
].map(Object.freeze))
export const scoreStabilityModes = Object.freeze(scoreStabilityVariants.flatMap(v =>
  (v.id === 'baseline' ? ['fixed-75'] : ['fixed-75', 'mechanical-75-percent']).map(mode => Object.freeze({
    ...v, mode, key: `${v.id}::${mode}`, threshold: mode === 'fixed-75' ? 75 : Math.ceil(v.maximumScore * .75),
  }))))
export const scoreStabilityConfiguration = Object.freeze({
  methodologyVersion: scoreStabilityMethodology, timeframe: '1Hour', variants: scoreStabilityModes,
  outcome: { stopDistancePercent: .005, targetR: 2, maxHoldingBars: 12 }, regime: causalRegimeDefaults,
  costTiers: costTierDefinitions.map(([, costR]) => costR),
  population: 'All scored completed hourly observations; baseline exactly researchEligible. Mechanical floors may admit observations below original 75.',
  missingInputs: 'Preserve scanner contribution values and disclose unavailable inputs separately. Missing reason points make the score unavailable. Combined families require available EMA and Trend; disagreement earns zero shared credit.',
  periods: 'UTC decision periods, resolved outcomes contained; pre-roll retained for calculation only; omitted end uses frozen run requestedAt.',
  concentration: 'Eastern decision dates. Rank baseline days once before costs; remove top five or top and bottom five using the same dates for all modes/costs in a group.',
})
export const scoreEvidence = n => n < 30 ? 'insufficient' : n < 100 ? 'small-exploratory-sample' : 'descriptive-only'
const symbols = ['SPY', 'QQQ', 'IWM']
const count = (rows, predicate) => rows.filter(predicate).length
const ratio = (n, d) => d ? n / d : null
const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' })
const day = timestamp => {
  const p = Object.fromEntries(dayFormat.formatToParts(new Date(timestamp)).map(x => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day}`
}

export function scoreRedundancyObservation(signal, conditions, mode) {
  const points = Object.fromEntries(ablationComponents.map(({ key, label }) => [key, signal.reasons?.find(r => r.label === label)?.points]))
  const pairState = conditions.ema == null || conditions.trend == null ? 'unavailable' : conditions.ema === conditions.trend ? 'agreement' : 'disagreement'
  let score = null
  if (Number.isFinite(signal.score) && Object.values(points).every(Number.isFinite)) {
    if (mode.id === 'baseline') score = signal.score
    else if (mode.id === 'keep-ema') score = signal.score - points.trend
    else if (mode.id === 'keep-trend') score = signal.score - points.ema
    else if (pairState !== 'unavailable') score = signal.score - points.ema - points.trend + (conditions.ema && conditions.trend ? (mode.id === 'combined-20' ? 20 : 15) : 0)
  }
  return { score, pairState, eligible: score !== null && score >= mode.threshold && (mode.id !== 'baseline' || isResearchEligibleSignal(signal)) }
}

function metrics(trades, costR) {
  if (!trades.length) return null
  const result = computeMetrics(trades, costR)
  return { ...result, profitFactor: trades.every(t => t.rMultiple === costR) ? null : result.profitFactor }
}

function summarizeOutcomes(records, period) {
  const exclusions = {}, resolved = []
  for (const r of records) {
    const reason = r.exclusionReason ?? (!r.trade ? 'unresolved-outcome' :
      Date.parse(r.outcomeTimestamp) > Date.parse(period.end) ? 'outcome-crosses-period' : null)
    if (reason) exclusions[reason] = (exclusions[reason] ?? 0) + 1
    else resolved.push(r)
  }
  const trades = resolved.map(r => r.trade)
  return {
    resolved, summary: {
      resolvedCount: resolved.length, outcomeExcludedCount: records.length - resolved.length, exclusions,
      wins: count(trades, t => t.rMultiple > 0), losses: count(trades, t => t.rMultiple < 0), breakeven: count(trades, t => t.rMultiple === 0),
      expiredCount: count(trades, t => t.exitReason === 'Expired'), evidenceStrength: scoreEvidence(resolved.length),
      costTiers: costTierDefinitions.map(([label, costR]) => ({ label, costR, metrics: metrics(trades, costR) })),
    },
  }
}

// Exported pure aggregation seam allows boundary/evidence tests without fabricated market paths.
export function summarizeScoreStability(records, { requestedStart, requestedEnd, coverage = {} }) {
  const full = { key: 'full', label: 'Full requested sample', start: requestedStart, end: requestedEnd, type: 'full' }
  const periods = [full, ...candidatePeriods(requestedEnd).map(p => ({ ...p, start: new Date(Math.max(Date.parse(p.start), Date.parse(requestedStart))).toISOString() }))]
  const inPeriod = (r, p) => Date.parse(r.decisionTimestamp) >= Date.parse(p.start) && Date.parse(r.decisionTimestamp) <= Date.parse(p.end)
  const groups = periods.flatMap(period => [null, ...symbols].map(symbol => ({
    key: `${period.key}::${symbol ?? 'pooled'}`, label: `${period.label} / ${symbol ?? 'Pooled SPY/QQQ/IWM'}`, period, symbol,
    records: records.filter(r => inPeriod(r, period) && (!symbol || r.symbol === symbol)),
  })))
  for (const field of ['trend', 'volatility', 'regime']) {
    for (const value of [...new Set(records.map(r => r[field]))].sort()) groups.push({
      key: `${field}::${value}`, label: `${field}: ${value}`, period: full, symbol: null,
      records: records.filter(r => r[field] === value),
    })
  }
  const rows = groups.flatMap(group => {
    const base = group.records.filter(r => r.scores[scoreStabilityModes[0].key].eligible)
    const baseline = summarizeOutcomes(base, group.period).summary
    const baseSet = new Set(base)
    const withDays = ['full', 'development', 'recent'].includes(group.period.key) && !/^(trend|volatility|regime)::/.test(group.key)
    const removals = withDays ? candidateDaySensitivity(base, group.period) : []
    return scoreStabilityModes.map(mode => {
      const selected = group.records.filter(r => r.scores[mode.key].eligible)
      const { resolved, summary } = summarizeOutcomes(selected, group.period)
      const scoreEvaluableCount = count(group.records, r => r.scores[mode.key].score !== null)
      const retainedCount = count(selected, r => baseSet.has(r))
      const costTiers = summary.costTiers.map((tier, i) => ({ ...tier,
        differenceR: tier.metrics && baseline.costTiers[i].metrics ? tier.metrics.expectancy - baseline.costTiers[i].metrics.expectancy : null,
      }))
      return {
        key: `${group.key}::${mode.key}`, group: group.key, label: group.label, period: group.period, symbol: group.symbol,
        variant: mode.id, variantLabel: mode.label, mode: mode.mode, threshold: mode.threshold, maximumScore: mode.maximumScore,
        evaluatedCount: group.records.length, scoreEvaluableCount, scoreUnavailableCount: group.records.length - scoreEvaluableCount,
        unavailableInputCount: count(group.records, r => Object.values(r.conditions).some(v => v == null)),
        emaTrendDisagreementCount: count(group.records, r => r.scores[mode.key].pairState === 'disagreement'),
        eligibleCount: selected.length, ineligibleCount: scoreEvaluableCount - selected.length,
        baselineEligibleCount: base.length, baselineResolvedCount: baseline.resolvedCount,
        retainedCount, addedCount: selected.length - retainedCount, removedCount: base.length - retainedCount,
        eligibilityRate: ratio(selected.length, group.records.length), retentionRate: ratio(retainedCount, base.length),
        eligibleRatioToBaseline: ratio(selected.length, base.length),
        ...summary, costTiers, metrics: costTiers[0].metrics,
        comparisonEvidence: scoreEvidence(Math.min(summary.resolvedCount, baseline.resolvedCount)),
        reconciliationStatus: scoreEvaluableCount + (group.records.length - scoreEvaluableCount) === group.records.length &&
          summary.resolvedCount + Object.values(summary.exclusions).reduce((s, n) => s + n, 0) === selected.length &&
          summary.wins + summary.losses + summary.breakeven === summary.resolvedCount ? 'reconciled' : 'mismatch',
        concentration: withDays ? {
          ...summarizeCandidateClustering(selected, group.period),
          highestFiveTradeCount: Math.min(5, resolved.length),
          highestFiveTradeTotalR: resolved.length ? [...resolved].sort((a, b) => b.trade.rMultiple - a.trade.rMultiple).slice(0, 5).reduce((s, r) => s + r.trade.rMultiple, 0) : null,
        } : null,
        daySensitivity: removals.map(removal => {
          const removed = new Set(removal.removedDays)
          const remaining = resolved.filter(r => !removed.has(day(r.decisionTimestamp)))
          const stress = summarizeOutcomes(remaining, group.period).summary
          return { key: removal.key, removedDays: removal.removedDays, ranking: 'baseline before-cost days; identical for every mode and cost',
            ...stress, costTiers: stress.costTiers.map((t, i) => ({ ...t,
              differenceR: t.metrics && removal.summary.costTiers[i].metrics ? t.metrics.expectancy - removal.summary.costTiers[i].metrics.expectancy : null,
            })) }
        }),
      }
    })
  })
  const equivalences = scoreStabilityModes.flatMap((a, i) => scoreStabilityModes.slice(i + 1).map(b => {
    const comparable = records.filter(r => r.scores[a.key].score !== null && r.scores[b.key].score !== null)
    const availabilityMatches = records.every(r => (r.scores[a.key].score === null) === (r.scores[b.key].score === null))
    const scoresMatch = comparable.every(r => r.scores[a.key].score === r.scores[b.key].score)
    const membershipMatches = records.every(r => r.scores[a.key].eligible === r.scores[b.key].eligible)
    return { left: a.key, right: b.key, comparableCount: comparable.length, availabilityMatches, scoresMatch, membershipMatches,
      equivalent: comparable.length > 0 && availabilityMatches && scoresMatch && membershipMatches }
  }))
  const conclusions = scoreStabilityModes.filter(m => m.id !== 'baseline').map(mode => scoreStabilityConclusion(rows.filter(r => r.variant === mode.id && r.mode === mode.mode)))
  return { available: true, methodologyVersion: scoreStabilityMethodology, options: scoreStabilityConfiguration,
    requestedStart, requestedEnd, symbols, regimeSourceSymbol: 'SPY', periods, coverage, rows, equivalences, conclusions,
    overlap: conditionOverlap(records, 'ema', 'trend'),
    limitations: [
      'Research only. Setup Score is not a win probability. No production score, qualification, Paper Trader or Shadow Forward changes.',
      'Mechanical thresholds can admit previously ineligible observations. Baseline and subtraction variants preserve actual scanner points, including zero credit for unavailable inputs; unavailable-input counts overlap membership counts and are not extra excluded observations. Combined families cannot be scored when EMA or Trend is unavailable; disagreement earns zero family credit.',
      'Shared Signal Quality model: next observed open, 0.5% risk, 2R target, 12 observed bars, adverse stop gaps, target-price gaps, stop-first ambiguity counted. Short expired outcomes and cross-period outcomes are excluded. Expired counts are a subset of resolved outcomes, not an extra exclusion.',
      'UTC decision periods use contained outcomes. Indicators retain available pre-roll. Aligned shared timestamps may omit bars; missing bars are not fabricated. Historical hourly VWAP follows Signal Quality and is not the live scanner five-minute VWAP input.',
      'Sequential R drawdown is not account equity. Overlapping occurrences, capital constraints, sizing, financing and actual execution are not modeled. Costs are fixed R deductions, not observed fills.',
      '2025–2026 is repeatedly explored historical follow-up, not an untouched holdout. Under 30 resolved is insufficient; 30–99 is exploratory; 100+ is descriptive only. Dependent variants are not independent confirmations.',
      'Day stress removes baseline-ranked Eastern dates once before costs, not an optimized deletion search. Top/bottom dates can overlap; deleting five days from a short sample can leave no evidence.',
    ] }
}

export function scoreStabilityConclusion(rows) {
  const find = period => rows.find(r => r.group === `${period}::pooled`)
  const full = find('full'), development = find('development'), recent = find('recent')
  const evidenceCount = r => Math.min(r?.resolvedCount ?? 0, r?.baselineResolvedCount ?? 0)
  const meaningful = rows.filter(r => evidenceCount(r) >= 30)
  const direction = r => Math.abs(r) <= signalQualityDefaults.negligibleThresholdR ? 'negligible' : r > 0 ? 'positive' : 'negative'
  const comparisons = meaningful.flatMap(r => r.costTiers.filter(t => t.differenceR !== null).map(t => ({ group: r.group, costR: t.costR, direction: direction(t.differenceR), differenceR: t.differenceR })))
  const directions = new Set(comparisons.map(c => c.direction))
  const signConflict = directions.has('positive') && directions.has('negative')
  const costDependence = meaningful.some(r => r.costTiers.some(t => t.metrics?.expectancy > 0) && r.costTiers.some(t => t.metrics && t.metrics.expectancy <= 0))
  const concentrationDependence = meaningful.some(r => r.daySensitivity.some(s => s.resolvedCount >= 30 && s.costTiers.some((t, i) => t.differenceR !== null && r.costTiers[i].differenceR !== null && direction(t.differenceR) !== direction(r.costTiers[i].differenceR))))
  const sparseBreakdowns = rows.filter(r => evidenceCount(r) < 100).map(r => r.group)
  const regimeUnavailable = rows.some(r => /Insufficient|unavailable/i.test(r.group) && r.eligibleCount > 0)
  const status = evidenceCount(recent) < 30 || evidenceCount(development) < 30 ? 'INSUFFICIENT' : signConflict ? 'MIXED / UNSTABLE' :
    costDependence || concentrationDependence || regimeUnavailable || sparseBreakdowns.length || directions.size !== 1 ? 'DIRECTIONALLY CONSISTENT BUT EXPLORATORY' : 'DESCRIPTIVELY STABLE'
  const delta = r => r?.costTiers[0].differenceR ?? null
  return { variant: full.variant, mode: full.mode, status, comparisons,
    flags: { signConflict, costDependence, concentrationDependence, sparseBreakdowns, regimeUnavailable,
      olderImprovementNotPersistent: delta(development) === null || delta(recent) === null ? null : direction(delta(development)) === 'positive' && direction(delta(recent)) !== 'positive' },
    summary: {
      result: `${full.variantLabel}, ${full.mode} (${full.threshold}/${full.maximumScore}): full-sample difference versus baseline ${delta(full) === null ? 'unavailable' : `${delta(full).toFixed(3)}R`}. No winner selected.`,
      evidence: `Resolved full/development/recent: ${full.resolvedCount}/${development.resolvedCount}/${recent.resolvedCount}; baseline ${full.baselineResolvedCount}/${development.baselineResolvedCount}/${recent.baselineResolvedCount}.`,
      stability: `${status}. Development/recent difference R: ${delta(development) ?? 'unavailable'} / ${delta(recent) ?? 'unavailable'}. Review symbol, year, causal regime, cost and day-stress contradictions together.`,
      limitation: 'Operational sample floors and symmetric 0.02R negligible band are descriptive safeguards, not statistical significance. Repeated historical exploration cannot establish future profitability.',
      nextQuestion: 'Review adequately populated recent and symbol-specific contradictions before considering a separately approved prospective candidate; do not change production scoring from this result.',
    } }
}

export function runScannerScoreStability(raw, { requestedStart = null, requestedEnd } = {}) {
  if (!Number.isFinite(Date.parse(requestedEnd)) || (requestedStart && !Number.isFinite(Date.parse(requestedStart)))) return { available: false, reason: 'A valid frozen cutoff and optional start are required.' }
  if (symbols.some(s => !raw[s]?.length)) return { available: false, reason: 'Complete SPY, QQQ and IWM hourly inputs are required.' }
  if (symbols.some(s => raw[s].some(c => !['1Hour', '1h'].includes(c.timeframe)))) return { available: false, reason: 'Explicit hourly candles are required.' }
  const validation = Object.fromEntries(symbols.map(s => [s, validateAndOrderHistoricalCandles(raw[s])]))
  const dataQuality = Object.fromEntries(symbols.map(s => [s, validation[s].dataQuality]))
  if (symbols.some(s => dataQuality[s].rejectedCandleCount)) return { incomplete: true, reason: 'Invalid source candles; no outcomes fabricated.', dataQuality }
  const source = Object.fromEntries(symbols.map(s => [s, validation[s].candles.filter(c => candleCompletesBy(c, '1Hour', requestedEnd))]))
  const aligned = buildAlignedSeries(source)
  if (!aligned.timestamps.length) return { available: false, reason: 'No shared completed hourly observations.', dataQuality }
  const regimes = computeCausalRegimeSeries(aligned.raw, causalRegimeDefaults)
  const records = symbols.flatMap(symbol => {
    const candles = aligned.raw[symbol], enriched = aligned.enriched[symbol]
    const signals = new Map(scanSetups(enriched).map(s => [s.timestamp, s]))
    return enriched.flatMap((c, i) => {
      if (requestedStart && Date.parse(c.timestamp) < Date.parse(requestedStart)) return []
      const signal = signals.get(c.timestamp)
      const conditions = Object.fromEntries(ablationComponents.map(({ key }, j) => [key, componentDefinitions[j].available(c, i) ? componentDefinitions[j].test(c) : null]))
      const scores = Object.fromEntries(scoreStabilityModes.map(m => [m.key, scoreRedundancyObservation(signal, conditions, m)]))
      const trade = Object.values(scores).some(s => s.eligible) ? buildTradeFromIndex(candles, i, signalQualityDefaults, { symbol }) : null
      const trend = regimes[i].trend.classification, volatility = regimes[i].volatility.classification
      return [{ symbol, conditions, scores, trend, volatility, regime: `${trend} / ${volatility}`,
        decisionTimestamp: new Date(historicalCandleEndTime(c.timestamp, '1Hour')).toISOString(),
        trade, outcomeTimestamp: trade ? new Date(historicalCandleEndTime(candles[i + trade.holdingBars].timestamp, '1Hour')).toISOString() : null,
        exclusionReason: !trade ? 'no-entry-or-invalid-risk' : trade.exitReason === 'Expired' && trade.holdingBars < 12 ? 'incomplete-holding-window' : null,
      }]
    })
  }).sort((a, b) => a.decisionTimestamp.localeCompare(b.decisionTimestamp) || a.symbol.localeCompare(b.symbol))
  if (!records.length) return { available: false, reason: 'No evaluated observations in range.', dataQuality }
  return summarizeScoreStability(records, { requestedStart: requestedStart ?? records[0].decisionTimestamp, requestedEnd,
    coverage: { dataQuality, alignmentDroppedCounts: aligned.droppedCounts,
      completionExcludedCounts: Object.fromEntries(symbols.map(s => [s, validation[s].candles.length - source[s].length])),
      actualDecisionStart: records[0].decisionTimestamp, actualDecisionEnd: records.at(-1).decisionTimestamp } })
}
