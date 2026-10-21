// Research only: contexts are attached before outcomes, never selected from outcome summaries.
import { buildAlignedSeries, buildCatalogueBySymbol, buildTradeFromIndex, computeMetrics, costTierDefinitions, signalQualityDefaults } from './signalQualityBacktest.js'
import { computeCausalRegimeSeries, causalRegimeDefaults } from './causalRegimeBacktest.js'
import { computeFirstObservedDailyRangeLabels } from './strategyDiscovery/breakoutContextResearch.js'
import { computeSessionVwapSeries, strategyDiscoveryResearchWindows } from './strategyDiscovery/discoveryMetrics.js'
import { historicalCandleEndTime, candleCompletesBy } from '../data/historicalDataContract.js'
import { validateAndOrderHistoricalCandles } from '../data/marketData.js'

export const joinedContextMethodology = 'joined-context-1'
export const joinedContextPeriods = [
  { ...strategyDiscoveryResearchWindows.development, key: 'development', label: 'Development 2022–2024' },
  { ...strategyDiscoveryResearchWindows.outOfSample, key: 'holdout', label: 'Holdout 2025' },
  { ...strategyDiscoveryResearchWindows.holdout, key: 'followup', label: 'Observational follow-up 2026 YTD', end: '2026-12-31T23:59:59Z' },
]
const singles = [
  ['trend-up', 'Trend Up', 'trend', 'Uptrend'],
  ['medium-volatility', 'Medium Volatility', 'volatility', 'Medium'],
  ['favorable-vwap', 'Favorable Discovery VWAP', 'vwap', 'favorable'],
  ['above-first-range', 'Above first-observed daily range', 'firstRange', 'above'],
  ['rv-confirmed', 'Relative Value confirmed', 'relativeValue', 'confirmed'],
]
const combinations = [[0, 1], [0, 2], [0, 4], [2, 4], [3, 0]]
export const contextStudyGroups = [
  ...singles.map(([key, label, field, value]) => ({ key, label, conditions: [[field, value]] })),
  ...combinations.map((indices) => ({ key: indices.map((i) => singles[i][0]).join('+'), label: indices.map((i) => singles[i][1]).join(' + '), conditions: indices.map((i) => singles[i].slice(2)) })),
]
export function contextEvidenceStrength(count) {
  return count < 30 ? 'insufficient-evidence' : count < 100 ? 'exploratory' : 'stronger-descriptive-evidence'
}
export function contextPeriod(timestamp) {
  const time = Date.parse(timestamp)
  return joinedContextPeriods.find((period) => time >= Date.parse(period.start) && time <= Date.parse(period.end)) ?? null
}
const context = (value, reason = 'Insufficient causal history') => ({ value: value ?? null, available: value !== null && value !== undefined, reason: value == null ? reason : null })

export function buildJoinedContextRecords(aligned, catalogue, regimes, options = signalQualityDefaults, sourceBySymbol = aligned.raw) {
  return Object.keys(aligned.raw).flatMap((symbol) => {
    const candles = aligned.raw[symbol]
    const source = sourceBySymbol[symbol]
    const vwaps = computeSessionVwapSeries(source)
    const ranges = computeFirstObservedDailyRangeLabels(source)
    const contextIndices = new Map(source.map((bar, index) => [bar.timestamp, index]))
    return catalogue[symbol].filter((entry) => entry.researchEligible && entry.score >= 75).map((entry) => {
      const i = entry.index
      const candle = candles[i]
      const contextIndex = contextIndices.get(candle.timestamp)
      const decisionMs = historicalCandleEndTime(candle.timestamp, '1Hour')
      const decisionTimestamp = new Date(decisionMs).toISOString()
      const period = contextPeriod(decisionTimestamp)
      const regime = regimes[i]
      const contexts = {
        trend: context(['Uptrend', 'Downtrend', 'Mixed'].includes(regime?.trend.classification) ? regime.trend.classification : null),
        volatility: context(['Low', 'Medium', 'High'].includes(regime?.volatility.classification) ? regime.volatility.classification : null),
        vwap: context(Number.isFinite(vwaps[contextIndex]) ? (candle.close > vwaps[contextIndex] ? 'favorable' : 'unfavorable') : null, 'No accumulated session volume'),
        firstRange: context(ranges[contextIndex] === 'Insufficient History' || ranges[contextIndex] == null ? null : ranges[contextIndex] === 'Breakout Above First-Observed Daily Range' ? 'above' : 'not-above', 'First observed candle establishes the reference'),
        relativeValue: context(entry.componentAvailability.rvConfirmation ? (entry.components.rvConfirmation ? 'confirmed' : 'not-confirmed') : null, 'Insufficient aligned peer history'),
      }
      // Preserve the native fill builder. Exclude incomplete/cross-period outcomes rather than
      // truncating the holding period or allowing later periods to supply performance evidence.
      const trade = buildTradeFromIndex(candles, i, options, { symbol })
      const exitCandle = trade ? candles[i + trade.holdingBars] : null
      const outcomeTimestamp = exitCandle ? new Date(historicalCandleEndTime(exitCandle.timestamp, '1Hour')).toISOString() : null
      const exclusionReason = !period ? 'outside-study-period' : !trade ? 'no-entry-or-invalid-risk'
        : trade.exitReason === 'Expired' && trade.holdingBars < options.maxHoldingBars ? 'incomplete-holding-window'
          : contextPeriod(outcomeTimestamp)?.key !== period.key ? 'outcome-crosses-period' : null
      return {
        id: `${symbol}:${entry.timestamp}`, symbol, timestamp: entry.timestamp, decisionTimestamp,
        score: entry.score, membershipRule: 'research-eligible-75-plus', strategyId: 'setup-scan-baseline',
        methodologyVersion: joinedContextMethodology, periodRole: period?.key ?? null, contexts,
        outcomeTimestamp, exclusionReason, trade: exclusionReason ? null : trade,
      }
    })
  }).sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.symbol.localeCompare(b.symbol))
}

function summarize(records) {
  const trades = records.filter((record) => record.trade).map((record) => record.trade)
  return {
    candidateCount: records.length, resolvedCount: trades.length, outcomeExcludedCount: records.length - trades.length,
    evidenceStrength: contextEvidenceStrength(trades.length),
    metrics: trades.length ? computeMetrics(trades) : null,
    costTiers: costTierDefinitions.map(([label, costR]) => ({ label, costR, metrics: trades.length ? computeMetrics(trades, costR) : null })),
  }
}

export function summarizeContextStudy(records, symbols = ['SPY', 'QQQ', 'IWM']) {
  return joinedContextPeriods.flatMap((period) => ['pooled', ...symbols].flatMap((symbol) => {
    const baseline = records.filter((record) => record.periodRole === period.key && (symbol === 'pooled' || record.symbol === symbol))
    return contextStudyGroups.map((group) => {
      const available = baseline.filter((record) => group.conditions.every(([field]) => record.contexts[field].available))
      const matched = available.filter((record) => group.conditions.every(([field, value]) => record.contexts[field].value === value))
      const matchedIds = new Set(matched.map((record) => record.id))
      const comparison = available.filter((record) => !matchedIds.has(record.id))
      const baselineSummary = summarize(baseline)
      const matchedSummary = summarize(matched)
      const comparisonSummary = summarize(comparison)
      const unavailable = baseline.filter((record) => !group.conditions.every(([field]) => record.contexts[field].available))
      const unavailableSummary = summarize(unavailable)
      return {
        key: group.key, label: group.label, symbol, period, baseline: baselineSummary,
        matched: matchedSummary, comparison: comparisonSummary,
        accounting: {
          baselineCount: baseline.length, contextAvailableCount: available.length, contextUnavailableCount: unavailable.length,
          matchedCount: matched.length, comparisonCount: comparison.length,
          resolvedCount: baselineSummary.resolvedCount, outcomeExcludedCount: baselineSummary.outcomeExcludedCount,
          unavailableResolvedCount: unavailableSummary.resolvedCount,
          reconciliationStatus: available.length + unavailable.length === baseline.length &&
            matchedSummary.resolvedCount + comparisonSummary.resolvedCount + unavailableSummary.resolvedCount + baselineSummary.outcomeExcludedCount === baseline.length ? 'reconciled' : 'mismatch',
        },
        comparisonEvidence: contextEvidenceStrength(Math.min(matchedSummary.resolvedCount, comparisonSummary.resolvedCount)),
        differenceR: matchedSummary.metrics && comparisonSummary.metrics ? matchedSummary.metrics.averageR - comparisonSummary.metrics.averageR : null,
      }
    })
  }))
}

export function runJoinedContextStudy(rawSeriesBySymbol, { requestedEnd = new Date().toISOString(), requestedStart = null } = {}) {
  const required = ['SPY', 'QQQ', 'IWM']
  const missingSymbols = required.filter((symbol) => !rawSeriesBySymbol[symbol]?.length)
  if (missingSymbols.length) return { available: false, missingSymbols }
  if (required.some((symbol) => rawSeriesBySymbol[symbol].some((bar) => !['1Hour', '1h'].includes(bar.timeframe)))) {
    return { available: false, reason: 'Joined context study requires explicitly identified hourly candles.' }
  }
  const validated = Object.fromEntries(required.map((symbol) => [symbol, validateAndOrderHistoricalCandles(rawSeriesBySymbol[symbol])]))
  if (!Number.isFinite(Date.parse(requestedEnd))) return { available: false, reason: 'A valid completed-candle cutoff is required.' }
  const source = Object.fromEntries(required.map((symbol) => [symbol, validated[symbol].candles.filter((bar) => candleCompletesBy(bar, '1Hour', requestedEnd))]))
  const aligned = buildAlignedSeries(source)
  if (!aligned.timestamps.length) return { available: false, reason: 'No shared valid hourly observations.' }
  const options = { ...signalQualityDefaults, requestedEnd, requestedStart }
  const records = buildJoinedContextRecords(aligned, buildCatalogueBySymbol(aligned, options), computeCausalRegimeSeries(aligned.raw, causalRegimeDefaults), options, source)
    .filter((record) => !requestedStart || Date.parse(record.timestamp) >= Date.parse(requestedStart))
  return {
    available: true, methodologyVersion: joinedContextMethodology, membershipRule: 'research-eligible-75-plus', options,
    costTiers: costTierDefinitions.map(([label, costR]) => ({ label, costR })),
    records, rows: summarizeContextStudy(records, required), periods: joinedContextPeriods,
    alignmentDroppedCounts: aligned.droppedCounts, outsidePeriodCount: records.filter((record) => !record.periodRole).length,
    dataQuality: Object.fromEntries(required.map((symbol) => [symbol, validated[symbol].dataQuality])),
    actualDateRange: { start: aligned.timestamps[0] ?? null, end: aligned.timestamps.at(-1) ?? null },
    completionExcludedCounts: Object.fromEntries(required.map((symbol) => [symbol, validated[symbol].candles.length - source[symbol].length])),
  }
}
