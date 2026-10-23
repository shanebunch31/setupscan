// Frozen descriptive study. All membership, causal context and fills come from Joined Context.
import { buildJoinedContextStudyInput, contextStudyGroups, contextEvidenceStrength } from './joinedContextStudy.js'
import { computeMetrics, costTierDefinitions } from './signalQualityBacktest.js'
import { classifyTimeOfDay } from './strategyDiscovery/breakoutContextResearch.js'

export const candidateRobustnessMethodology = 'candidate-context-robustness-2'
export const candidateDefinition = contextStudyGroups.find((group) => group.key === 'trend-up+medium-volatility')
// Representative instants select the existing classifier's fixed partitions, not new boundaries.
export const candidateTimeBuckets = ['14:30', '16:00', '19:00', '21:00']
  .map((time) => classifyTimeOfDay(`2024-01-02T${time}:00Z`))
const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
})
function signalDay(timestamp) {
  const parts = Object.fromEntries(dayFormatter.formatToParts(new Date(timestamp)).map((part) => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}
const sum = (values) => values.reduce((total, value) => total + value, 0)
const validTime = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value))
export const candidateSession = (timestamp) => !validTime(timestamp) ? 'unavailable' : classifyTimeOfDay(timestamp) === candidateTimeBuckets[3] ? 'outside' : 'regular'
const inPeriod = (timestamp, period) => validTime(timestamp) && Date.parse(timestamp) >= Date.parse(period.start) && Date.parse(timestamp) <= Date.parse(period.end)

export function candidatePeriods(requestedEnd) {
  const bounded = (key, label, start, end, type) => ({
    key, label, start, end: new Date(Math.min(Date.parse(end), Date.parse(requestedEnd))).toISOString(), type,
  })
  return [
    ...[2022, 2023, 2024, 2025, 2026].map((year) => bounded(`year-${year}`, year === 2026 ? '2026 YTD' : String(year), `${year}-01-01T00:00:00Z`, `${year}-12-31T23:59:59.999Z`, 'year')),
    bounded('development', 'Development 2022–2024', '2022-01-01T00:00:00Z', '2024-12-31T23:59:59.999Z', 'development'),
    bounded('recent', 'Recent 2025–2026 YTD', '2025-01-01T00:00:00Z', '2026-12-31T23:59:59.999Z', 'recent'),
  ]
}

function outcomeExclusion(record, period) {
  if (record.exclusionReason) return record.exclusionReason
  if (!record.trade || !Number.isFinite(record.trade.rMultiple)) return 'unresolved-outcome'
  if (!validTime(record.outcomeTimestamp)) return 'unavailable-outcome-time'
  if (Date.parse(record.outcomeTimestamp) < Date.parse(record.decisionTimestamp)) return 'invalid-outcome-time'
  if (!inPeriod(record.outcomeTimestamp, period)) return 'outcome-crosses-summary-boundary'
  return null
}

function summarize(records, period) {
  const resolved = records.filter((record) => !outcomeExclusion(record, period))
  const trades = resolved.map((record) => record.trade)
  const exclusionCounts = {}
  for (const record of records) {
    const reason = outcomeExclusion(record, period)
    if (reason) exclusionCounts[reason] = (exclusionCounts[reason] ?? 0) + 1
  }
  const costTiers = costTierDefinitions.map(([label, costR]) => {
    const metrics = trades.length ? computeMetrics(trades, costR) : null
    return { label, costR, metrics, positiveExpectancy: metrics ? metrics.averageR > 0 : null }
  })
  return {
    candidateCount: records.length, resolvedCount: resolved.length,
    outcomeExcludedCount: records.length - resolved.length, exclusionCounts,
    evidenceStrength: contextEvidenceStrength(resolved.length), metrics: costTiers[0].metrics, costTiers,
    // A discrete-tier observation, not an interpolated break-even cost.
    firstNonPositiveCostR: costTiers.find((tier) => tier.positiveExpectancy === false)?.costR ?? null,
    costResult: !trades.length ? 'unavailable' : costTiers.every((tier) => tier.positiveExpectancy) ? 'positive-at-all-modeled-tiers' : 'nonpositive-at-a-modeled-tier',
  }
}

export function summarizeCandidateClustering(records, period) {
  const resolved = records.filter((record) => !outcomeExclusion(record, period))
  const days = new Map()
  for (const record of resolved) {
    const key = signalDay(record.decisionTimestamp)
    if (!days.has(key)) days.set(key, { date: key, count: 0, totalR: 0 })
    const day = days.get(key)
    day.count += 1
    day.totalR += record.trade.rMultiple
  }
  const daily = [...days.values()]
  const top = [...daily].sort((a, b) => b.totalR - a.totalR || a.date.localeCompare(b.date)).slice(0, 5)
  const bottom = [...daily].sort((a, b) => a.totalR - b.totalR || a.date.localeCompare(b.date)).slice(0, 5)
  const totalR = sum(daily.map((day) => day.totalR))
  const topFiveTotalR = sum(top.map((day) => day.totalR))
  const bottomFiveTotalR = sum(bottom.map((day) => day.totalR))
  return {
    matchedCandidateCount: records.length, resolvedMatchedTrades: resolved.length,
    uniqueSignalDays: days.size,
    averageTradesPerActiveDay: days.size ? resolved.length / days.size : null,
    maximumTradesPerDay: days.size ? Math.max(...daily.map((day) => day.count)) : null,
    multiSignalDayTradePercent: resolved.length ? 100 * sum(daily.filter((day) => day.count > 1).map((day) => day.count)) / resolved.length : null,
    totalR: resolved.length ? totalR : null,
    topFiveDayCount: top.length, bottomFiveDayCount: bottom.length,
    topFiveTotalR: resolved.length ? topFiveTotalR : null, bottomFiveTotalR: resolved.length ? bottomFiveTotalR : null,
    topFivePercentOfNetR: totalR > 0 ? 100 * topFiveTotalR / totalR : null,
    bottomFiveLossPercentOfNetR: totalR > 0 ? 100 * Math.max(0, -bottomFiveTotalR) / totalR : null,
    denominator: 'Resolved matched trades grouped by Eastern decision date; R before costs. Day contributions use positive net total R only, may exceed 100%, and overlap when fewer than 10 active days exist.',
  }
}

function summaryRow(records, symbol, period, bucket = null, session = null) {
  const baseline = records.filter((record) => record.symbol === symbol && inPeriod(record.decisionTimestamp, period) && (!bucket || classifyTimeOfDay(record.decisionTimestamp) === bucket) && (!session || candidateSession(record.decisionTimestamp) === session))
  const available = baseline.filter((record) => candidateDefinition.conditions.every(([field]) => record.contexts?.[field]?.available === true && record.contexts[field].value != null))
  const matched = available.filter((record) => candidateDefinition.conditions.every(([field, value]) => record.contexts[field].value === value))
  const matchedSet = new Set(matched)
  const availableSet = new Set(available)
  const comparison = available.filter((record) => !matchedSet.has(record))
  const unavailable = baseline.filter((record) => !availableSet.has(record))
  const b = summarize(baseline, period), m = summarize(matched, period), c = summarize(comparison, period), u = summarize(unavailable, period)
  return {
    key: `${period.key}::${symbol}${bucket ? `::${bucket}` : ''}${session ? `::session-${session}` : ''}`, symbol, period, bucket, session,
    role: 'requested symbol',
    baseline: b, matched: m, comparison: c, unavailable: u,
    accounting: {
      baselineCount: baseline.length, matchedCount: matched.length, comparisonCount: comparison.length,
      contextUnavailableCount: unavailable.length, resolvedCount: b.resolvedCount, outcomeExcludedCount: b.outcomeExcludedCount,
      matchedResolvedCount: m.resolvedCount, comparisonResolvedCount: c.resolvedCount, unavailableResolvedCount: u.resolvedCount,
      reconciliationStatus: matched.length + comparison.length + unavailable.length === baseline.length && m.resolvedCount + c.resolvedCount + u.resolvedCount + b.outcomeExcludedCount === baseline.length ? 'reconciled' : 'mismatch',
    },
    differenceR: m.metrics && c.metrics ? m.metrics.averageR - c.metrics.averageR : null,
    comparisonEvidence: contextEvidenceStrength(Math.min(m.resolvedCount, c.resolvedCount)),
    clustering: period.type !== 'year' && !bucket && !session ? summarizeCandidateClustering(matched, period) : null,
    dayLevel: !bucket && !session ? summarizeCandidateDays(matched, period) : null,
    daySensitivity: period.type !== 'year' && !bucket && !session ? candidateDaySensitivity(matched, period) : null,
  }
}

function symbolConclusion(symbol, rows, timeOfDay, sessions) {
  const own = rows.filter((row) => row.symbol === symbol)
  const development = own.find((row) => row.period.key === 'development')
  const recent = own.find((row) => row.period.key === 'recent')
  const years = own.filter((row) => row.period.type === 'year')
  const highestCost = (row) => row.matched.costTiers.at(-1).metrics
  const d = highestCost(development), r = highestCost(recent)
  const sample = Math.min(development.matched.resolvedCount, recent.matched.resolvedCount)
  const observedYears = years.filter((row) => highestCost(row))
  const positiveYears = observedYears.filter((row) => highestCost(row).averageR > 0)
  const largest = (entries) => [...entries].sort((a, b) => highestCost(b).totalR - highestCost(a).totalR || a.key.localeCompare(b.key))[0] ?? null
  const strongestYear = largest(observedYears)
  const yearTotal = sum(observedYears.map((row) => highestCost(row).totalR))
  const bucketConcentration = ['development', 'recent'].map((key) => {
    const entries = timeOfDay.filter((row) => row.symbol === symbol && row.period.key === key && highestCost(row))
    const top = largest(entries)
    const totalR = sum(entries.map((row) => highestCost(row).totalR))
    return { period: key, highestTotalRBucket: top?.bucket ?? null, shareOfNetR: totalR > 0 ? 100 * highestCost(top).totalR / totalR : null }
  })
  return {
    symbol, role: 'requested symbol',
    status: sample < 30 ? 'insufficient evidence' : 'continue historical validation',
    evidenceStrength: contextEvidenceStrength(sample),
    developmentVsRecent: development.matched.costTiers.map((tier, i) => ({
      costR: tier.costR,
      differenceAverageR: tier.metrics && recent.matched.costTiers[i].metrics ? recent.matched.costTiers[i].metrics.averageR - tier.metrics.averageR : null,
    })),
    positiveYearsAtHighestCost: positiveYears.length, observedYears: observedYears.length,
    yearsWithAtLeast30Resolved: years.filter((row) => row.matched.resolvedCount >= 30).length,
    highestTotalRYear: strongestYear?.period.label ?? null,
    highestYearShareOfNetR: yearTotal > 0 ? 100 * highestCost(strongestYear).totalR / yearTotal : null,
    bucketConcentration,
    checks: [development, recent].map((row) => ({
      period: row.period.key, evidenceStrength: row.matched.evidenceStrength,
      costResult: row.matched.costResult, multiSignalDayTradePercent: row.clustering.multiSignalDayTradePercent,
      sensitivity: row.daySensitivity.map((check) => ({ key: check.key, remainingDays: check.remainingDays, resolvedCount: check.summary.resolvedCount, evidenceStrength: check.summary.evidenceStrength, highestCostAverageR: check.summary.costTiers.at(-1).metrics?.averageR ?? null })),
      sessions: sessions.filter((s) => s.symbol === symbol && s.period.key === row.period.key).map((s) => ({ session: s.session, resolvedCount: s.matched.resolvedCount, evidenceStrength: s.matched.evidenceStrength, highestCostAverageR: s.matched.costTiers.at(-1).metrics?.averageR ?? null })),
    })),
    message: `${symbol}: ${positiveYears.length}/${observedYears.length} observed years have positive expectancy at the highest modeled cost. ` +
      (d && r ? `Recent minus development expectancy at that cost is ${(r.averageR - d.averageR).toFixed(3)}R. ${r.averageR > d.averageR ? 'Recent results are stronger; this does not establish consistency in development.' : 'Recent results are not stronger than development.'} ` : 'Development versus recent comparison is unavailable. ') +
      `Development/recent matched resolved counts: ${development.matched.resolvedCount}/${recent.matched.resolvedCount}. ` +
      `Positive at every modeled tier: development ${d ? development.matched.costResult === 'positive-at-all-modeled-tiers' ? 'yes' : 'no' : 'unavailable'}, recent ${r ? recent.matched.costResult === 'positive-at-all-modeled-tiers' ? 'yes' : 'no' : 'unavailable'}. ` +
      'Year, time-bucket and day concentration must be reviewed together; correlated trades are not independent evidence. Shadow forward suitability requires review, not automatic approval.',
  }
}

export function summarizeCandidateRobustness(joined) {
  if (!joined?.available) return { available: false, reason: joined?.reason, missingSymbols: joined?.missingSymbols }
  const cutoff = joined.options?.requestedEnd
  if (!validTime(cutoff)) return { available: false, reason: 'A valid run cutoff is required.' }
  const population = joined.records.filter((record) => record.membershipRule === 'research-eligible-75-plus' && record.score >= 75 && validTime(record.decisionTimestamp) && Date.parse(record.decisionTimestamp) <= Date.parse(cutoff))
  const symbols = [...new Set(joined.symbols ?? joined.records.map((record) => record.symbol))].sort()
  const periods = candidatePeriods(cutoff)
  const rows = periods.flatMap((period) => symbols.map((symbol) => summaryRow(population, symbol, period)))
  const timeOfDay = periods.filter((period) => period.type !== 'year').flatMap((period) => symbols.flatMap((symbol) => candidateTimeBuckets.map((bucket) => summaryRow(population, symbol, period, bucket))))
  const sessions = periods.filter((period) => period.type !== 'year').flatMap((period) => symbols.flatMap((symbol) => ['regular', 'outside', 'unavailable'].map((session) => summaryRow(population, symbol, period, null, session))))
  return {
    available: true, methodologyVersion: candidateRobustnessMethodology, membershipRule: 'research-eligible-75-plus',
    candidate: candidateDefinition, symbols, regimeSourceSymbol: joined.regimeSourceSymbol ?? null, options: { requestedStart: joined.options.requestedStart, requestedEnd: cutoff },
    costTiers: costTierDefinitions.map(([label, costR]) => ({ label, costR })),
    periods, rows, timeOfDay, sessions, conclusions: symbols.map((symbol) => symbolConclusion(symbol, rows, timeOfDay, sessions)),
    coverage: {
      actualDateRange: joined.actualDateRange, alignmentDroppedCounts: joined.alignmentDroppedCounts,
      completionExcludedCounts: joined.completionExcludedCounts, dataQuality: joined.dataQuality,
      outsidePeriodCount: joined.outsidePeriodCount,
      sourceRecordCount: joined.records.length, acceptedPopulationCount: population.length,
      unavailableDecisionTimestampCount: joined.records.filter((record) => !validTime(record.decisionTimestamp)).length,
    },
  }
}

export function runCandidateContextRobustness(rawSeriesBySymbol, options) {
  return summarizeCandidateRobustness(buildJoinedContextStudyInput(rawSeriesBySymbol, options))
}

function resolvedDays(records, period) {
  const resolved = records.filter((record) => validTime(record.decisionTimestamp) && inPeriod(record.decisionTimestamp, period) && !outcomeExclusion(record, period))
  const days = new Map()
  for (const record of resolved) {
    const date = signalDay(record.decisionTimestamp)
    if (!days.has(date)) days.set(date, [])
    days.get(date).push(record)
  }
  return [...days].map(([date, observations]) => ({ date, observations, totalR: sum(observations.map((record) => record.trade.rMultiple)) })).sort((a, b) => a.date.localeCompare(b.date))
}

export function summarizeCandidateDays(records, period) {
  const days = resolvedDays(records, period)
  const values = days.map((day) => day.totalR).sort((a, b) => a - b)
  const n = values.length
  return {
    activeDays: n, resolvedCount: sum(days.map((day) => day.observations.length)),
    averageDayR: n ? sum(values) / n : null,
    medianDayR: n ? (values[Math.floor((n - 1) / 2)] + values[Math.floor(n / 2)]) / 2 : null,
    positiveDayPercent: n ? 100 * values.filter((r) => r > 0).length / n : null,
    negativeDayPercent: n ? 100 * values.filter((r) => r < 0).length / n : null,
    totalR: n ? sum(values) : null,
    maximumPositiveDayR: values.some((r) => r > 0) ? Math.max(...values.filter((r) => r > 0)) : null,
    maximumNegativeDayR: values.some((r) => r < 0) ? Math.min(...values.filter((r) => r < 0)) : null,
  }
}

export function candidateDaySensitivity(records, period) {
  const days = resolvedDays(records, period)
  // Rank once before costs; same removed days at every cost tier. Date breaks ties.
  const top = [...days].sort((a, b) => b.totalR - a.totalR || a.date.localeCompare(b.date)).slice(0, 5).map((day) => day.date)
  const bottom = [...days].sort((a, b) => a.totalR - b.totalR || a.date.localeCompare(b.date)).slice(0, 5).map((day) => day.date)
  return [
    ['remove-top-five', 'Performance after removing the five highest-R signal days', top],
    ['remove-top-bottom-five', 'Performance after removing the five highest- and five lowest-R signal days', [...new Set([...top, ...bottom])].sort()],
  ].map(([key, label, removedDays]) => {
    const removed = new Set(removedDays)
    const remaining = records.filter((record) => inPeriod(record.decisionTimestamp, period) && !outcomeExclusion(record, period) && !removed.has(signalDay(record.decisionTimestamp)))
    return { key, label, removedDays, remainingDays: days.filter((day) => !removed.has(day.date)).length, summary: summarize(remaining, period) }
  })
}
