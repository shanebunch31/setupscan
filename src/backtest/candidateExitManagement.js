// Historical paired exit study only; no network, storage, scanner or trading changes.
import { buildJoinedContextStudyInput, contextPeriod, contextEvidenceStrength } from './joinedContextStudy.js'
import { candidateDefinition, candidateRobustnessMethodology, candidatePeriods, candidateDaySensitivity, summarizeCandidateClustering } from './candidateContextRobustness.js'
import { buildTradeFromIndex, signalQualityDefaults, computeMetrics, costTierDefinitions } from './signalQualityBacktest.js'
import { trailingStopBacktestDefaults } from './strategy.js'
import { createTrailingStopTrade } from './candidateTrailingStopTrade.js'
import { synchronizeCandleSeries } from './relativeValue.js'
import { validateAndOrderHistoricalCandles } from '../data/marketData.js'
import { candleCompletesBy, historicalCandleEndTime } from '../data/historicalDataContract.js'

export const candidateExitMethodology = 'candidate-exit-management-1'
export const candidateExitConfiguration = Object.freeze({
  candidateId: 'trend-up-medium-volatility-v1', candidateMethodology: candidateRobustnessMethodology,
  membershipRule: 'research-eligible-75-plus', timeframe: '1Hour',
  stopDistancePercent: signalQualityDefaults.stopDistancePercent,
  targetR: signalQualityDefaults.targetR, maxHoldingBars: signalQualityDefaults.maxHoldingBars,
  activationR: trailingStopBacktestDefaults.activationR,
  trailDistancePercent: trailingStopBacktestDefaults.trailDistancePercent,
  samplePolicy: 'Paired resolved outcomes: both exits must resolve inside the summary period and original Joined Context decision period.',
  concentrationPolicy: 'Eastern decision dates, ranked separately per exit method by before-cost total R; ties by date; same removals at all costs. Different methods may remove different days.',
  drawdownPolicy: 'Sequential R in signal order, not account equity; overlapping positions and capital limits are not modeled.',
})
const methods = ['fixed', 'trailing']
const within = (timestamp, period) => Number.isFinite(Date.parse(timestamp)) && Date.parse(timestamp) >= Date.parse(period.start) && Date.parse(timestamp) <= Date.parse(period.end)
const counts = (values) => values.reduce((result, key) => { result[key] = (result[key] ?? 0) + 1; return result }, {})

// Both builders receive the same selected occurrence and exact next observed candle.
export function buildCandidateExitPair(record, candles, index) {
  if (index < 0 || candles[index]?.timestamp !== record.timestamp) throw new Error('Candidate signal is absent from aligned candles')
  const fixed = buildTradeFromIndex(candles, index, candidateExitConfiguration, { symbol: record.symbol })
  const trailing = fixed ? createTrailingStopTrade({ ...record, timeframe: '1Hour' }, candles[index + 1], candles, index, candidateExitConfiguration) : null
  const entryTimestamp = fixed ? candles[index + 1].timestamp : null
  if (fixed && (fixed.entryPrice !== trailing.entryPrice || fixed.stopPrice !== trailing.initialStopPrice || fixed.targetPrice !== trailing.targetPrice)) throw new Error('Exit comparison entry/risk parity failed')
  return {
    id: record.id, symbol: record.symbol, timestamp: record.timestamp, decisionTimestamp: record.decisionTimestamp,
    score: record.score, membershipRule: record.membershipRule,
    entryTimestamp, entryPrice: fixed?.entryPrice ?? null,
    exits: Object.fromEntries(methods.map((method) => {
      const trade = method === 'fixed' ? fixed : trailing
      const outcomeTimestamp = trade ? new Date(historicalCandleEndTime(candles[index + trade.holdingBars].timestamp, '1Hour')).toISOString() : null
      // Preserve the existing candidate's original outcome boundaries for BOTH methods.
      const exclusionReason = !contextPeriod(record.decisionTimestamp) ? 'outside-study-period'
        : !trade ? 'no-entry-or-invalid-risk'
          : trade.exitReason === 'Expired' && trade.holdingBars < candidateExitConfiguration.maxHoldingBars ? 'incomplete-holding-window'
            : contextPeriod(outcomeTimestamp)?.key !== contextPeriod(record.decisionTimestamp)?.key ? 'outcome-crosses-period' : null
      return [method, { trade: trade ? { ...trade, entryTimestamp } : null, outcomeTimestamp, exclusionReason }]
    })),
  }
}

function exclusion(pair, method, period) {
  const exit = pair.exits[method]
  return exit.exclusionReason ?? (!exit.trade || !Number.isFinite(exit.trade.rMultiple) ? 'unresolved-outcome'
    : !within(exit.outcomeTimestamp, period) ? 'outcome-crosses-summary-boundary' : null)
}
function summary(records) {
  const trades = records.map((record) => record.trade)
  const costTiers = costTierDefinitions.map(([label, costR]) => ({ label, costR, metrics: trades.length ? computeMetrics(trades, costR) : null }))
  return {
    resolvedCount: trades.length, evidenceStrength: contextEvidenceStrength(trades.length),
    metrics: costTiers[0].metrics, costTiers,
    averageHoldingBars: trades.length ? trades.reduce((n, t) => n + t.holdingBars, 0) / trades.length : null,
    exitReasonCounts: counts(trades.map((trade) => trade.exitReason)),
  }
}

export function summarizeCandidateExitPairs(pairs, symbols, periods) {
  return periods.flatMap((period) => symbols.flatMap((symbol) => {
    const candidates = pairs.filter((pair) => pair.symbol === symbol && within(pair.decisionTimestamp, period))
    const paired = candidates.filter((pair) => methods.every((method) => !exclusion(pair, method, period)))
    const exclusionsByMethod = Object.fromEntries(methods.map((method) => [method, counts(candidates.map((pair) => exclusion(pair, method, period)).filter(Boolean))]))
    return methods.map((method) => {
      const records = paired.map((pair) => ({ ...pair, ...pair.exits[method] }))
      const resolvedSummary = summary(records)
      return {
        key: `${period.key}::${symbol}::${method}`, symbol, period, exitMethod: method,
        ...resolvedSummary,
        accounting: {
          candidateCount: candidates.length, pairedResolvedCount: paired.length,
          pairedExcludedCount: candidates.length - paired.length, exclusionsByMethod,
          individuallyResolvedCount: candidates.filter((pair) => !exclusion(pair, method, period)).length,
          reconciliationStatus: 'reconciled',
        },
        clustering: summarizeCandidateClustering(records, period),
        concentration: [
          { key: 'baseline', removedDays: [], remainingDays: summarizeCandidateClustering(records, period).uniqueSignalDays, summary: resolvedSummary },
          ...candidateDaySensitivity(records, period),
        ],
      }
    })
  }))
}

export function runCandidateExitManagement(rawSeriesBySymbol, options = {}) {
  const joined = buildJoinedContextStudyInput(rawSeriesBySymbol, options)
  if (!joined.available) return joined
  // Reuse precisely the validated, completed, shared series used by Joined Context;
  // never rescan signals or use the broader raw sequence for one exit only.
  const source = Object.fromEntries(joined.symbols.map((symbol) => [symbol,
    validateAndOrderHistoricalCandles(rawSeriesBySymbol[symbol]).candles.filter((bar) => candleCompletesBy(bar, '1Hour', joined.options.requestedEnd)),
  ]))
  const { series } = synchronizeCandleSeries(source)
  const indices = Object.fromEntries(joined.symbols.map((symbol) => [symbol, new Map(series[symbol].map((bar, index) => [bar.timestamp, index]))]))
  const selected = joined.records.filter((record) => record.membershipRule === 'research-eligible-75-plus' && record.score >= 75 &&
    candidateDefinition.conditions.every(([field, value]) => record.contexts[field]?.available === true && record.contexts[field].value === value))
  const pairs = selected.map((record) => buildCandidateExitPair(record, series[record.symbol], indices[record.symbol].get(record.timestamp)))
  const periods = [
    { key: 'full', label: 'Full observed period', type: 'full', start: joined.options.requestedStart ?? joined.actualDateRange.start, end: joined.options.requestedEnd },
    ...candidatePeriods(joined.options.requestedEnd),
  ]
  return {
    available: true, methodologyVersion: candidateExitMethodology, membershipRule: 'research-eligible-75-plus',
    candidate: { ...candidateDefinition, id: candidateExitConfiguration.candidateId, methodologyVersion: candidateRobustnessMethodology },
    options: { ...candidateExitConfiguration, requestedStart: joined.options.requestedStart, requestedEnd: joined.options.requestedEnd },
    symbols: joined.symbols, regimeSourceSymbol: joined.regimeSourceSymbol, periods,
    costTiers: costTierDefinitions.map(([label, costR]) => ({ label, costR })),
    rows: summarizeCandidateExitPairs(pairs, joined.symbols, periods), pairs,
    coverage: { actualDateRange: joined.actualDateRange, dataQuality: joined.dataQuality,
      alignmentDroppedCounts: joined.alignmentDroppedCounts, completionExcludedCounts: joined.completionExcludedCounts,
      researchEligibleCount: joined.records.length, candidateCount: pairs.length },
    limitations: [
      'Historical repeated exploration, not untouched validation or evidence of future profitability. No exit method is automatically selected.',
      'Under 30 resolved: insufficient; 30–99: exploratory; 100+: stronger descriptive evidence, not statistical significance.',
      'Both exits share the paired resolved sample; a result available for only one exit is excluded from both and counted separately.',
      candidateExitConfiguration.samplePolicy, candidateExitConfiguration.concentrationPolicy, candidateExitConfiguration.drawdownPolicy,
      'Costs subtract fixed R per trade, not actual bid/ask or executable fills. Holding bars are observed aligned hourly bars, not elapsed wall-clock hours.',
      'Stop-first when the open is between barriers; adverse stop gaps fill at the open, target gaps at the target. A raised trailing stop applies only to later candles.',
    ],
  }
}
