import React from 'react'

const h = React.createElement
const rowLabel = (row) => `${row.period.label}${row.bucket ? ` / ${row.bucket}` : ''}${row.session ? ` / ${row.session === 'regular' ? 'Regular session' : row.session === 'outside' ? 'Outside regular session' : 'Unavailable session'}` : ''}`
const format = (value, suffix = '') => value == null ? '—' : value === Infinity ? '∞' : `${Number(value).toFixed(2)}${suffix}`
function table(caption, headers, rows) {
  return h('div', { className: 'robustness-table-wrap' }, h('table', { className: 'robustness-table' },
    h('caption', null, caption),
    h('thead', null, h('tr', null, headers.map((title) => h('th', { key: title, scope: 'col' }, title)))),
    h('tbody', null, rows.map((values, index) => h('tr', { key: index }, values.map((value, column) => h(column ? 'td' : 'th', { key: column, ...(column ? {} : { scope: 'row' }) }, value))))),
  ))
}

// Reads normalized fields, so the same view works after native payloads are omitted on save.
export function CandidateRobustnessResult({ record }) {
  const details = record?.parameters?.candidateRobustness
  if (!details) return null
  const rows = Object.values(record.metrics ?? {}).map((value) => value.robustness).filter(Boolean)
  if (!rows.length) return h('p', null, 'Candidate resilience study unavailable: complete hourly inputs for every requested symbol are required. No performance is inferred.')
  return h('details', { className: 'robustness-section' },
    h('summary', null, 'Trend Up + Medium Volatility — focused historical evidence'),
    h('p', null, `One frozen candidate: research-eligible 75+ includes Potential and Qualified Setups. Every requested symbol is evaluated separately. Causal context reference: ${details.regimeSourceSymbol ?? 'not recorded in this saved version'}. The existing helper selects SPY when supplied, otherwise the alphabetically first supplied symbol. Changing the supplied universe can change the backdrop and shared timestamps; compare runs with that limitation. No rule is optimized or promoted.`),
    h('p', null, `Methodology: ${record.methodologyVersion}. Requested coverage: ${details.options?.requestedStart ?? 'not specified'} through ${details.options?.requestedEnd ?? 'unavailable'}. Shared supplied candles: ${details.coverage?.actualDateRange?.start ?? 'unavailable'} through ${details.coverage?.actualDateRange?.end ?? 'unavailable'}. Named periods do not guarantee complete history.`),
    h('p', null, 'Year consistency means repetition across calendar years. Years use UTC decision dates. Time of day uses completed decision timestamps in Eastern Time, never exit times. Development is 2022–2024; recent is 2025–2026 YTD. Repeated exploration means these periods are not untouched evidence. Recent differences do not prove a permanent market change.'),
    h('p', null, 'Matched + nonmatching + unavailable = baseline candidates. Unavailable is not false. Resolved + outcome-excluded = baseline; exclusions overlap context categories. Yearly outcomes must finish within their year and cutoff; inherited Joined Context exclusions remain. Year totals may differ from major-period totals because their boundaries differ.'),
    h('p', null, 'Under 30 resolved observations is insufficient evidence; 30–99 is exploratory; 100+ is stronger descriptive evidence, not statistical significance. Small comparison groups cannot establish improvement. — means unavailable, not zero performance.'),
    h('p', null, 'R measures results relative to initial risk; expectancy is average R per resolved trade. Profit factor (PF) is gains divided by losses; ∞ means gains with no observed losses. Total R and maximum drawdown are sequential trade summaries, not account equity. Overlapping positions and capital limits are not modeled here.'),
    h('p', null, `Input coverage: ${details.coverage?.sourceRecordCount ?? 'unavailable'} Joined Context records; ${details.coverage?.acceptedPopulationCount ?? 'unavailable'} within membership/cutoff; ${details.coverage?.outsidePeriodCount ?? 'unavailable'} outside study periods. Input rejections and alignment removals are data checks, not trade exclusions.`),
    h('p', null, `Records with unavailable decision timestamps: ${details.coverage?.unavailableDecisionTimestampCount ?? 'not recorded'}. They cannot be assigned to a period/session and are excluded, never classified as regular. Session labels use the existing Eastern clock buckets, not a holiday/early-close calendar. Options-session execution constraints are a separate research question.`),
    table('Input checks by symbol', ['Symbol', 'Invalid bars rejected', 'Alignment removed', 'Bars after cutoff'], [...new Set(rows.map((row) => row.symbol))].sort().map((symbol) => [symbol,
      details.coverage?.dataQuality?.[symbol]?.rejectedCandleCount ?? '—', details.coverage?.alignmentDroppedCounts?.[symbol] ?? '—', details.coverage?.completionExcludedCounts?.[symbol] ?? '—'])),
    ...(details.conclusions ?? []).map((conclusion) => {
      const own = rows.filter((row) => row.symbol === conclusion.symbol)
      return h('section', { key: conclusion.symbol },
        h('h3', null, `${conclusion.symbol} (${conclusion.role}) — ${conclusion.status}`),
        h('p', null, conclusion.message),
        h('p', null, `Highest-total-R year at the highest modeled cost: ${conclusion.highestTotalRYear ?? 'unavailable'}; share of positive net yearly R: ${format(conclusion.highestYearShareOfNetR, '%')}. Years with at least 30 resolved: ${conclusion.yearsWithAtLeast30Resolved}/5. These describe concentration, not a test of significance.`),
        ...conclusion.bucketConcentration.map((item) => h('p', { key: item.period }, `${item.period}: highest-total-R decision bucket ${item.highestTotalRBucket ?? 'unavailable'}; share of positive net R ${format(item.shareOfNetR, '%')}. Shares can exceed 100% when other groups lose R; unavailable when total R is nonpositive.`)),
        table('Population and outcome accounting', ['Period / decision bucket', 'Baseline', 'Matched', 'Nonmatching', 'Unavailable', 'Resolved baseline', 'Excluded baseline', 'Resolved matched', 'Excluded matched', 'Matched / comparison evidence', 'Accounting'], own.map((row) => [
          rowLabel(row), row.baseline.candidateCount, row.matched.candidateCount, row.comparison.candidateCount, row.unavailable.candidateCount,
          row.baseline.resolvedCount, row.baseline.outcomeExcludedCount, row.matched.resolvedCount, row.matched.outcomeExcludedCount,
          `${row.matched.evidenceStrength} / ${row.comparisonEvidence}`, row.accounting.reconciliationStatus,
        ])),
        h('details', null, h('summary', null, 'Performance at every existing modeled cost tier'),
          h('p', null, 'Cost sensitivity means how results change with modeled execution friction. Each tier subtracts its R cost once per trade; these are assumptions, not historical bid/ask or executable fills. First nonpositive tier is observed among fixed tiers, not interpolated.'),
          table('Year, major-period and time-bucket performance', ['Period / bucket', 'Cost R', 'Resolved', 'Win %', 'Average R', 'PF', 'Total R', 'Max drawdown R', 'Nonmatching average R', 'Positive expectancy?', 'First nonpositive cost R'], own.flatMap((row) => row.matched.costTiers.map((tier, index) => [
            rowLabel(row), format(tier.costR), row.matched.resolvedCount,
            format(tier.metrics ? tier.metrics.winRate * 100 : null), format(tier.metrics?.averageR), format(tier.metrics?.profitFactor), format(tier.metrics?.totalR), format(tier.metrics?.maximumDrawdown), format(row.comparison.costTiers[index].metrics?.averageR),
            tier.positiveExpectancy == null ? '—' : tier.positiveExpectancy ? 'Yes' : 'No', format(row.matched.firstNonPositiveCostR),
          ]))),
        ),
        table('Recent minus development average R (descriptive)', ['Cost R', 'Difference R', 'Comparison evidence'], conclusion.developmentVsRecent.map((tier) => [format(tier.costR), format(tier.differenceAverageR), conclusion.evidenceStrength])),
        ...(conclusion.checks ?? []).map((check) => h('p', { key: check.period }, `${check.period}: ${check.evidenceStrength}; costs ${check.costResult}; ${format(check.multiSignalDayTradePercent, '%')} of trades on multi-signal days. `,
          check.sensitivity.map((s) => `${s.key}: ${s.resolvedCount} trades / ${s.remainingDays} days, highest-cost average ${format(s.highestCostAverageR)}R (${s.evidenceStrength}). `).join(''),
          check.sessions.map((s) => `${s.session}: ${s.resolvedCount} resolved, highest-cost average ${format(s.highestCostAverageR)}R (${s.evidenceStrength}). `).join(''),
          'These checks inform continued review; a positive average alone cannot establish shadow-testing suitability.')),
        table('Eastern decision-day results before costs', ['Period', 'Active days', 'Mean day R', 'Median day R', 'Positive days %', 'Negative days %', 'Total day R', 'Largest positive day R', 'Most negative day R'], own.filter((row) => row.dayLevel).map((row) => {
          const d = row.dayLevel
          return [row.period.label, d.activeDays, format(d.averageDayR), format(d.medianDayR), format(d.positiveDayPercent), format(d.negativeDayPercent), format(d.totalR), format(d.maximumPositiveDayR), format(d.maximumNegativeDayR)]
        })),
        h('details', null, h('summary', null, 'Day-removal sensitivity checks'),
          h('p', null, 'Rank days once by before-cost total R; break ties by date. Remove all trades from the selected days. Top and bottom sets overlap safely: each day is removed once. Fewer than five days means remove all available days. This is a sensitivity check, not a trading filter. Day results are not independent observations.'),
          table('Fixed day-removal checks at every existing cost tier', ['Period / check', 'Removed days', 'Remaining trades', 'Remaining days', 'Cost R', 'Average R', 'PF', 'Total R', 'Win %', 'Positive?', 'Evidence'], own.flatMap((row) => (row.daySensitivity ?? []).flatMap((check) => check.summary.costTiers.map((tier) => [
            `${row.period.label} / ${check.label}`, check.removedDays.length, check.summary.resolvedCount, check.remainingDays, format(tier.costR), format(tier.metrics?.averageR), format(tier.metrics?.profitFactor), format(tier.metrics?.totalR), format(tier.metrics ? 100 * tier.metrics.winRate : null), tier.positiveExpectancy == null ? '—' : tier.positiveExpectancy ? 'Yes' : 'No', check.summary.evidenceStrength,
          ])))),
        ),
        h('p', null, 'Trade clustering means many signals came from the same days rather than separate opportunities. Counts below use resolved matched trades and Eastern decision dates; R is before costs. Top/bottom groups contain up to five days, can overlap, and use net total R as denominator only when positive. The bottom percentage is the net loss of the bottom group; its signed R is also shown. Correlated trades can weaken confidence even with a large trade count.'),
        table('Resolved-trade day concentration', ['Period', 'Matched candidates', 'Resolved trades', 'Active days', 'Trades / day', 'Max / day', 'Trades on multi-signal days %', 'Top days used', 'Top days R', 'Top % net R', 'Bottom days used', 'Bottom days R', 'Bottom loss % net R'], own.filter((row) => row.clustering).map((row) => {
          const c = row.clustering
          return [row.period.label, c.matchedCandidateCount, c.resolvedMatchedTrades, c.uniqueSignalDays, format(c.averageTradesPerActiveDay), c.maximumTradesPerDay ?? '—', format(c.multiSignalDayTradePercent), c.topFiveDayCount, format(c.topFiveTotalR), format(c.topFivePercentOfNetR), c.bottomFiveDayCount, format(c.bottomFiveTotalR), format(c.bottomFiveLossPercentOfNetR)]
        })),
      )
    }),
    h('p', null, 'Historical associations do not establish future profitability. This study cannot automatically certify that the candidate survives every check or is suitable for shadow forward testing. Review coverage, small samples, matched-versus-nonmatching evidence, year/time concentration, clustering and costs before that separate decision. No scanner or Paper Trader rule changes result from this report.'),
  )
}
