// Research-only execution comparison. The hourly candidate and baseline builder are unchanged.
import { buildJoinedContextStudyInput, contextPeriod, contextEvidenceStrength } from './joinedContextStudy.js'
import { candidateDefinition, candidatePeriods, candidateSession } from './candidateContextRobustness.js'
import { buildTradeFromIndex, computeMetrics, costTierDefinitions, signalQualityDefaults } from './signalQualityBacktest.js'
import { synchronizeCandleSeries } from './relativeValue.js'
import { validateAndOrderHistoricalCandles } from '../data/marketData.js'
import { candleCompletesBy, historicalCandleEndTime } from '../data/historicalDataContract.js'
import { isRegularSession } from '../../server/marketSession.js'

export const executionResolutionId = 'candidate-execution-resolution'
export const executionResolutionConfiguration = Object.freeze({
  candidateId: 'trend-up-medium-volatility-v1', candidateMethodology: 'candidate-context-robustness-2',
  membershipRule: 'research-eligible-75-plus', decisionTimeframe: '1Hour', executionTimeframe: '5Min',
  stopDistancePercent: signalQualityDefaults.stopDistancePercent, targetR: signalQualityDefaults.targetR,
  maxHoldingBars: signalQualityDefaults.maxHoldingBars,
  entryRule: 'First supplied 5Min bar opening at or after the completed hourly decision; no use of its high/low/close to select entry.',
  horizonRule: 'Shared absolute deadline: end of the 12th observed aligned hourly bar after the signal. This can span overnight/weekend gaps; it is not necessarily 12 elapsed clock hours.',
  coverageRule: 'Require the shared hourly deadline. From entry through exit, require every 5Min interval during weekday 09:30–16:00 Eastern. Allow gaps outside the regular session; never synthesize prices. Holidays and early closes are not calendar-verified.',
  concentrationRule: 'Rank Eastern decision dates by paired hourly baseline before-cost total R, ties by date; remove the same top 5 or union of top/bottom 5 dates from both methods at every cost.',
})
const minute = 60000
const within = (timestamp, period) => Date.parse(timestamp) >= Date.parse(period.start) && Date.parse(timestamp) <= Date.parse(period.end)
const mean = (values) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted.length ? (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2 : null
}
const count = (values) => values.reduce((out, key) => { out[key] = (out[key] ?? 0) + 1; return out }, {})
const dayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' })
const day = (timestamp) => dayFormatter.format(new Date(timestamp))

function firstAtOrAfter(bars, time) {
  let lo = 0, hi = bars.length
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2)
    if (Date.parse(bars[mid].timestamp) < time) lo = mid + 1
    else hi = mid
  }
  return lo
}

// Reuse the existing DST-aware weekday regular-session convention.
// Missing regular-session 5Min intervals are treated as incomplete coverage.
// Gaps outside regular hours are allowed; no prices are synthesized.
// No holiday or early-close exchange calendar is assumed.
function missingExpectedCoverage(from, to) {
  for (let time = from; time < to; time += 5 * minute) {
    if (isRegularSession(new Date(time))) return true
  }
  return false
}

// Input bars have already been validated and capped at the completed-data cutoff.
export function buildExecutionResolutionPair(record, hourly, signalIndex, executionBars) {
  if (hourly[signalIndex]?.timestamp !== record.timestamp) throw new Error('Candidate signal is absent from aligned hourly data')
  const decision = Date.parse(record.decisionTimestamp)
  const endBar = hourly[signalIndex + executionResolutionConfiguration.maxHoldingBars]
  const deadline = endBar ? historicalCandleEndTime(endBar.timestamp, '1Hour') : null
  const fixed = buildTradeFromIndex(hourly, signalIndex, executionResolutionConfiguration, { symbol: record.symbol })
  const hourlyEntry = hourly[signalIndex + 1]?.timestamp ?? null
  const hourlyOutcome = fixed ? new Date(historicalCandleEndTime(hourly[signalIndex + fixed.holdingBars].timestamp, '1Hour')).toISOString() : null
  const baselineReason = !fixed ? 'no-hourly-entry' : !deadline ? 'incomplete-shared-horizon'
    : Date.parse(hourlyEntry) < decision ? 'hourly-entry-before-decision'
      : record.exclusionReason ?? null
  const baseline = { trade: fixed, entryTimestamp: hourlyEntry, outcomeTimestamp: hourlyOutcome, exclusionReason: baselineReason }
  let challenger = { trade: null, entryTimestamp: null, outcomeTimestamp: null, exclusionReason: 'missing-5min-entry' }
  const startIndex = firstAtOrAfter(executionBars, decision)
  const entryBar = executionBars[startIndex]
  if (!deadline) challenger.exclusionReason = 'incomplete-shared-horizon'
  else if (entryBar && Date.parse(entryBar.timestamp) < deadline) {
    const entryTime = Date.parse(entryBar.timestamp)
    // Never inspect future prices when choosing an entry. An absent boundary bar is ambiguous:
    // it may be a market closure or a provider omission, so delayed entries are disclosed.
    challenger.entryTimestamp = entryBar.timestamp
    let expected = entryTime
    const bars = []
    const hourlyIntervals = hourly.slice(signalIndex, signalIndex + executionResolutionConfiguration.maxHoldingBars + 1)
      .map((bar) => [Date.parse(bar.timestamp), historicalCandleEndTime(bar.timestamp, '1Hour')])
    for (let index = startIndex; index < executionBars.length; index += 1) {
      const bar = executionBars[index]
      const time = Date.parse(bar.timestamp)
      if (time + 5 * minute > deadline || time < expected || (time - expected) % (5 * minute) !== 0
        || missingExpectedCoverage(expected, time, hourlyIntervals)) break
      bars.push(bar)
      expected = time + 5 * minute
    }
    if (bars.length) {
      // Reuse the exact fixed-stop fill builder, adapting only its observed-bar horizon/units.
      const trade = buildTradeFromIndex([{ timestamp: record.timestamp }, ...bars], 0,
        { ...executionResolutionConfiguration, maxHoldingBars: bars.length }, { symbol: record.symbol })
      const outcome = Date.parse(bars[trade.holdingBars - 1].timestamp) + 5 * minute
      challenger = { entryTimestamp: entryBar.timestamp, outcomeTimestamp: new Date(outcome).toISOString(),
        trade: { ...trade, holdingTime: (outcome - entryTime) / minute },
        exclusionReason: trade.exitReason === 'Expired' && outcome !== deadline ? 'missing-5min-outcome-coverage'
          : contextPeriod(record.decisionTimestamp)?.key !== contextPeriod(new Date(outcome).toISOString())?.key ? 'outcome-crosses-period' : null }
    }
  }
  return { symbol: record.symbol, timestamp: record.timestamp, decisionTimestamp: record.decisionTimestamp,
    deadline: deadline ? new Date(deadline).toISOString() : null, session: candidateSession(record.decisionTimestamp),
    methods: { hourly: baseline, fiveMinute: challenger } }
}

function pairedSummary(pairs) {
  const methods = Object.fromEntries(['hourly', 'fiveMinute'].map((method) => {
    // Reporting uses the same bar-end elapsed-time convention for both resolutions.
    // The hourly trade object itself remains exactly as the native builder produced it.
    const trades = pairs.map((pair) => ({ ...pair.methods[method].trade,
      holdingTime: (Date.parse(pair.methods[method].outcomeTimestamp) - Date.parse(pair.methods[method].entryTimestamp)) / minute }))
    const delays = pairs.map((pair) => (Date.parse(pair.methods[method].entryTimestamp) - Date.parse(pair.decisionTimestamp)) / minute)
    return [method, { resolvedCount: pairs.length,
      averageEntryDelayMinutes: mean(delays), medianEntryDelayMinutes: median(delays),
      averageEntryPrice: mean(trades.map((t) => t.entryPrice)),
      averageHoldingMinutes: mean(pairs.map((p) => (Date.parse(p.methods[method].outcomeTimestamp) - Date.parse(p.methods[method].entryTimestamp)) / minute)),
      exitReasonCounts: count(trades.map((t) => t.exitReason)),
      costTiers: costTierDefinitions.map(([label, costR]) => ({ label, costR, metrics: trades.length ? computeMetrics(trades, costR) : null })),
    }]
  }))
  const deltas = pairs.map((p) => p.methods.fiveMinute.trade.rMultiple - p.methods.hourly.trade.rMultiple)
  const prices = pairs.map((p) => p.methods.fiveMinute.trade.entryPrice - p.methods.hourly.trade.entryPrice)
  return { resolvedCount: pairs.length, evidenceStrength: contextEvidenceStrength(pairs.length), methods,
    differences: {
      averageEntryPriceDifference: mean(prices), favorableEntryCount: prices.filter((p) => p < 0).length,
      unfavorableEntryCount: prices.filter((p) => p > 0).length, equalEntryCount: prices.filter((p) => p === 0).length,
      improvedRCount: deltas.filter((r) => r > 1e-10).length, worsenedRCount: deltas.filter((r) => r < -1e-10).length,
      changedOutcomePercent: pairs.length ? 100 * deltas.filter((r) => Math.abs(r) > 1e-10).length / pairs.length : null,
      costTiers: costTierDefinitions.map(([label, costR], i) => {
        const a = methods.hourly.costTiers[i].metrics, b = methods.fiveMinute.costTiers[i].metrics
        return { label, costR, expectancy: a && b ? b.averageR - a.averageR : null,
          totalR: a && b ? b.totalR - a.totalR : null, winRate: a && b ? b.winRate - a.winRate : null }
      }),
    } }
}

export function summarizeExecutionResolution(pairs, symbols, periods) {
  return periods.flatMap((period) => symbols.map((symbol) => {
    const candidates = pairs.filter((p) => p.symbol === symbol && within(p.decisionTimestamp, period))
    const reason = (p, method) => p.methods[method].exclusionReason ?? (!within(p.methods[method].outcomeTimestamp, period) ? 'outcome-crosses-summary-boundary' : null)
    const paired = candidates.filter((p) => !reason(p, 'hourly') && !reason(p, 'fiveMinute'))
    const days = new Map()
    const dayCounts = count(paired.map((p) => day(p.decisionTimestamp)))
    paired.forEach((p) => { const key = day(p.decisionTimestamp); days.set(key, (days.get(key) ?? 0) + p.methods.hourly.trade.rMultiple) })
    const ranked = [...days].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    const top = ranked.slice(0, 5).map(([key]) => key)
    const bottom = [...days].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([key]) => key)
    return { key: `${period.key}::${symbol}`, symbol, period, ...pairedSummary(paired),
      accounting: { commonSignalCount: candidates.length, pairedCount: paired.length, excludedCount: candidates.length - paired.length,
        exclusionsByMethod: Object.fromEntries(['hourly', 'fiveMinute'].map((m) => [m, count(candidates.map((p) => reason(p, m)).filter(Boolean))])),
        reconciliationStatus: 'reconciled' },
      sessions: count(paired.map((p) => p.session)), delayedFiveMinuteEntries: paired.filter((p) => Date.parse(p.methods.fiveMinute.entryTimestamp) > Date.parse(p.decisionTimestamp)).length,
      entrySessions: Object.fromEntries(['hourly', 'fiveMinute'].map((m) => [m, count(paired.map((p) => candidateSession(p.methods[m].entryTimestamp)))])),
      uniqueEasternDecisionDays: days.size,
      clustering: { averageTradesPerActiveDay: days.size ? paired.length / days.size : null,
        maximumTradesPerDay: days.size ? Math.max(...Object.values(dayCounts)) : null,
        multiSignalDayTradePercent: paired.length ? 100 * Object.values(dayCounts).filter((n) => n > 1).reduce((a, b) => a + b, 0) / paired.length : null },
      concentration: [{ key: 'remove-top-5-days', removedDays: top }, { key: 'remove-top-and-bottom-5-days', removedDays: [...new Set([...top, ...bottom])].sort() }]
        .map((check) => { const remaining = paired.filter((p) => !check.removedDays.includes(day(p.decisionTimestamp))); return { ...check,
          remainingDays: new Set(remaining.map((p) => day(p.decisionTimestamp))).size, summary: pairedSummary(remaining) } }),
    }
  }))
}

export function runCandidateExecutionResolution(hourlyBySymbol, executionBySymbol, options = {}) {
  const joined = buildJoinedContextStudyInput(hourlyBySymbol, options)
  if (!joined.available) return joined
  const source = Object.fromEntries(joined.symbols.map((symbol) => [symbol,
    validateAndOrderHistoricalCandles(hourlyBySymbol[symbol]).candles.filter((b) => candleCompletesBy(b, '1Hour', joined.options.requestedEnd))]))
  const { series } = synchronizeCandleSeries(source)
  const quality = {}
  const five = Object.fromEntries(joined.symbols.map((symbol) => {
    const supplied = executionBySymbol?.[symbol] ?? []
    const validated = validateAndOrderHistoricalCandles(supplied)
    const candles = validated.candles.filter((bar) => bar.timeframe === '5Min' && bar.symbol === symbol && candleCompletesBy(bar, '5Min', joined.options.requestedEnd))
    quality[symbol] = { ...validated.dataQuality, acceptedCount: candles.length, timeframeSymbolOrCutoffExcluded: validated.candles.length - candles.length }
    return [symbol, candles]
  }))
  const indices = Object.fromEntries(joined.symbols.map((symbol) => [symbol, new Map(series[symbol].map((bar, i) => [bar.timestamp, i]))]))
  const selected = joined.records.filter((r) => r.membershipRule === 'research-eligible-75-plus' && r.score >= 75 && candidateDefinition.conditions.every(([field, value]) => r.contexts[field]?.available && r.contexts[field].value === value))
  const pairs = selected.map((r) => buildExecutionResolutionPair(r, series[r.symbol], indices[r.symbol].get(r.timestamp), five[r.symbol]))
  const periods = [{ key: 'full', label: 'Full observed period', type: 'full', start: joined.options.requestedStart ?? joined.actualDateRange.start, end: joined.options.requestedEnd }, ...candidatePeriods(joined.options.requestedEnd)]
  return { available: true, methodologyVersion: 'candidate-execution-resolution-3', membershipRule: 'research-eligible-75-plus',
    options: { ...executionResolutionConfiguration, requestedStart: joined.options.requestedStart, requestedEnd: joined.options.requestedEnd },
    symbols: joined.symbols, regimeSourceSymbol: joined.regimeSourceSymbol, periods, pairs,
    rows: summarizeExecutionResolution(pairs, joined.symbols, periods),
    coverage: { hourly: joined.dataQuality, fiveMinute: quality, candidateCount: selected.length, alignmentDroppedCounts: joined.alignmentDroppedCounts,
      actualDateRange: joined.actualDateRange, completionExcludedCounts: joined.completionExcludedCounts },
    limitations: [executionResolutionConfiguration.entryRule, executionResolutionConfiguration.horizonRule, executionResolutionConfiguration.coverageRule, executionResolutionConfiguration.concentrationRule,
      'Entry at the selected open is a historical fill assumption with zero modeled decision latency. Completion is required at the dataset cutoff, not before buying at that open.',
      'First supplied is not guaranteed first market opportunity: delayed entry counts are reported. Coverage requires weekday Eastern regular-session 5Min intervals, not an exchange calendar. Gaps outside regular hours are allowed and no prices are synthesized. Holidays and early closes may still be conservatively excluded.',
      'Both methods must resolve within the original candidate period and displayed period. Missing twelve-bar deadline excludes even early exits. End-of-range outcomes are excluded; data beyond the requested cutoff is never used.',
      'Changing execution resolution changes both entry and barrier visibility, not entry timing alone. Hourly and five-minute bars may differ; no assumed intrabar path or price improvement at targets.',
      'On aligned hourly data, both methods can enter at exactly the same timestamp. Five-minute resolution does not automatically provide an earlier entry.',
      'Costs subtract fixed R per trade, not bid/ask or executable fills. Sequential R drawdown is not account equity; capital limits and overlapping positions are not modeled.',
      'Elapsed holding times use exit-bar completion as the timestamp convention for both resolutions; exact intrabar exit times are unknown.',
      'Under 30 paired trades: insufficient; 30–99: exploratory; 100+: stronger descriptive evidence, not significance. Repeated retrospective exploration, not untouched validation or future profitability. No automatic winner or promotion.',
      'Canonical candles for both timeframes are saved once. Existing single-timeframe offline replay is explicitly blocked for this experiment.',
    ] }
}
