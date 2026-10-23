// Research only: no paper engine, brokerage, storage or network dependency.
import { buildAlignedSeries, buildCatalogueBySymbol, buildTradeFromIndex, computeMetrics, signalQualityDefaults, costTierDefinitions } from '../backtest/signalQualityBacktest.js'
import { computeCausalRegimeSeries, causalRegimeDefaults, causalRegimeReferenceSymbol } from '../backtest/causalRegimeBacktest.js'
import { candidateDefinition, candidateRobustnessMethodology } from '../backtest/candidateContextRobustness.js'
import { historicalCandleEndTime } from '../data/historicalDataContract.js'

export const shadowCandidate = Object.freeze({
  id: 'trend-up-medium-volatility-v1', version: 1, name: 'Trend Up + Medium Volatility v1',
  methodologyVersion: candidateRobustnessMethodology, forwardVersion: 'shadow-forward-1',
  timeframe: '1Hour', membershipRule: 'research-eligible-75-plus', symbolAgnostic: true,
  contextVersion: 'causal-expanding-context-1', tradeVersion: 'signal-quality-next-open-stop-first-1',
  conditions: Object.freeze(candidateDefinition.conditions.map((pair) => Object.freeze([...pair]))),
  costTiers: Object.freeze(costTierDefinitions.map(([label, costR]) => Object.freeze({ label, costR }))),
  stopDistancePercent: signalQualityDefaults.stopDistancePercent, targetR: signalQualityDefaults.targetR,
  maxHoldingBars: signalQualityDefaults.maxHoldingBars,
})
export const shadowOptions = Object.freeze({ ...signalQualityDefaults })
export const shadowFreshnessMs = 5 * 60_000
const end = (bar) => historicalCandleEndTime(bar.timestamp, '1Hour')
export const easternDecisionDay = (timestamp) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(timestamp))
export function shadowOccurrenceId(trackingId, symbol, timestamp) {
  return [trackingId, shadowCandidate.id, symbol, '1Hour', timestamp].map(encodeURIComponent).join(':')
}
export function evaluateShadowDecision(raw, tracking, observedAt) {
  const aligned = buildAlignedSeries(Object.fromEntries(Object.keys(raw).sort().map((s) => [s, raw[s]])))
  const index = aligned.timestamps.length - 1
  if (index < 0) return { aligned, occurrences: [], latest: null }
  const latest = aligned.timestamps[index]
  const decisionTimestamp = new Date(end({ timestamp: latest })).toISOString()
  const decisionMs = Date.parse(decisionTimestamp), now = Date.parse(observedAt)
  if (decisionMs < Date.parse(tracking.startedAt) || decisionMs > now || now - decisionMs > shadowFreshnessMs) return { aligned, occurrences: [], latest }
  const catalogue = buildCatalogueBySymbol(aligned, shadowOptions)
  const regime = computeCausalRegimeSeries(aligned.raw, causalRegimeDefaults)[index]
  const contexts = { trend: regime.trend.classification, volatility: regime.volatility.classification }
  const occurrences = Object.keys(aligned.raw).sort().flatMap((symbol) => {
    const signal = catalogue[symbol][index]
    if (!signal.researchEligible || signal.score < 75 || !shadowCandidate.conditions.every(([key, value]) => contexts[key] === value)) return []
    return [{ id: shadowOccurrenceId(tracking.id, symbol, decisionTimestamp), trackingId: tracking.id,
      candidateId: shadowCandidate.id, candidateVersion: shadowCandidate.version, symbol, timeframe: '1Hour',
      signalTimestamp: latest, decisionTimestamp, decisionDay: easternDecisionDay(decisionTimestamp), createdAt: observedAt,
      qualification: { score: signal.score, classification: signal.status, researchEligible: signal.researchEligible, ...contexts },
      provenance: { methodologyVersion: shadowCandidate.methodologyVersion, contextVersion: shadowCandidate.contextVersion,
        tradeVersion: shadowCandidate.tradeVersion, sourceFingerprint: tracking.sourceFingerprint,
        provider: tracking.provider, adjustmentMode: tracking.adjustmentMode, historyStart: tracking.historyStart,
        regimeSourceSymbol: causalRegimeReferenceSymbol(aligned.raw), universe: [...tracking.symbols] },
      theoretical: null, state: 'pending', outcome: null }]
  })
  return { aligned, occurrences, latest }
}
export function resolveShadowOccurrence(occurrence, alignedRaw, observedAt) {
  if (occurrence.state !== 'pending') return occurrence
  const candles = alignedRaw[occurrence.symbol] ?? []
  const index = candles.findIndex((bar) => bar.timestamp === occurrence.signalTimestamp)
  if (index < 0 || !candles[index + 1]) return occurrence
  const trade = buildTradeFromIndex(candles, index, shadowOptions, { symbol: occurrence.symbol })
  if (!trade || !Number.isFinite(trade.rMultiple)) return { ...occurrence, state: 'excluded', outcome: { reason: 'invalid-theoretical-risk', recordedAt: observedAt } }
  const theoretical = { side: 'long', entryTimestamp: candles[index + 1].timestamp, entryPrice: trade.entryPrice,
    stopPrice: trade.stopPrice, targetPrice: trade.targetPrice, riskUnit: trade.entryPrice * shadowOptions.stopDistancePercent }
  if (occurrence.theoretical && Object.entries(theoretical).some(([key, value]) => occurrence.theoretical[key] !== value)) throw new Error('Frozen theoretical entry changed')
  if (trade.exitReason === 'Expired' && trade.holdingBars < shadowOptions.maxHoldingBars) return { ...occurrence, theoretical }
  return { ...occurrence, theoretical, state: 'resolved', outcome: {
    timestamp: new Date(end(candles[index + trade.holdingBars])).toISOString(), recordedAt: observedAt,
    reason: trade.exitReason, rawR: trade.rMultiple, ambiguousCandle: trade.ambiguousCandle,
    holdingBars: trade.holdingBars, exitPrice: trade.exitPrice,
    costTiers: shadowCandidate.costTiers.map(({ costR }) => ({ costR, r: computeMetrics([trade], costR).averageR })),
  } }
}
export function shadowMilestone(count) {
  return count < 30 ? 'Early / insufficient forward evidence' : count < 50 ? 'Early review only' : count < 100 ? 'Meaningful forward sample for review' : 'Stronger descriptive forward evidence'
}
export function summarizeShadow(tracking, occurrences) {
  return tracking.symbols.map((symbol) => {
    const rows = occurrences.filter((r) => r.symbol === symbol).sort((a, b) => a.decisionTimestamp.localeCompare(b.decisionTimestamp))
    const resolved = rows.filter((r) => r.state === 'resolved')
    const trades = resolved.map((r) => ({ rMultiple: r.outcome.rawR, ambiguousCandle: r.outcome.ambiguousCandle, holdingTime: r.outcome.holdingBars * 60 }))
    const days = new Map()
    for (const r of resolved) days.set(r.decisionDay, (days.get(r.decisionDay) ?? 0) + r.outcome.rawR)
    const activeDays = new Set(rows.map((r) => r.decisionDay)).size
    return { symbol, total: rows.length, resolved: resolved.length, pending: rows.filter((r) => r.state === 'pending').length,
      excluded: rows.filter((r) => r.state === 'excluded').length, unavailable: rows.filter((r) => r.state === 'unavailable').length,
      activeDays, occurrencesPerDay: activeDays ? rows.length / activeDays : null,
      positiveDays: [...days.values()].filter((v) => v > 0).length, negativeDays: [...days.values()].filter((v) => v < 0).length,
      costTiers: shadowCandidate.costTiers.map(({ label, costR }) => ({ label, costR, metrics: trades.length ? computeMetrics(trades, costR) : null })),
      milestone: shadowMilestone(resolved.length), nextMilestone: [30, 50, 100].find((n) => n > resolved.length) ?? null,
      firstObservation: rows[0]?.decisionTimestamp ?? null, latestObservation: rows.at(-1)?.decisionTimestamp ?? null }
  })
}
