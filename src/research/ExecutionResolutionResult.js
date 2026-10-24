import React from 'react'
const h = React.createElement
const format = (v, suffix = '') => v == null || Number.isNaN(v) ? '—' : v === Infinity ? '∞' : `${Number(v).toFixed(2)}${suffix}`
const label = (method) => method === 'hourly' ? '1Hour baseline' : '5Min execution'
const counts = (values) => Object.entries(values ?? {}).map(([key, value]) => `${key}: ${value}`).join('; ') || 'None recorded'
function table(caption, headers, rows) {
  return h('div', { className: 'robustness-table-wrap' }, h('table', { className: 'robustness-table' },
    h('caption', null, caption), h('thead', null, h('tr', null, headers.map((title) => h('th', { key: title, scope: 'col' }, title)))),
    h('tbody', null, rows.map((row, i) => h('tr', { key: i }, row.map((v, j) => h(j ? 'td' : 'th', { key: j, ...(j ? {} : { scope: 'row' }) }, v)))))))
}

// One small normalized-only view, shared by the current Workbench result and saved detail.
export function ExecutionResolutionResult({ record }) {
  const details = record?.parameters?.executionResolution
  const rows = details?.rows ?? []
  if (!rows.length) return h('p', null, 'Execution comparison unavailable: complete 1Hour and 5Min inputs are required for every selected symbol. No performance is inferred.')
  const name = (row) => `${row.symbol} / ${row.period.label}`
  return h('details', { className: 'robustness-section', open: true },
    h('summary', null, 'Does five-minute execution change the same hourly candidate outcomes?'),
    h('p', null, `Methodology: ${record.methodologyVersion}. Frozen candidate: ${details.options.candidateId}. Research-eligible 75+ includes Potential and Qualified Setups; it is not a probability of winning. Causal context reference: ${details.regimeSourceSymbol ?? 'unavailable'}.`),
    h('p', null, 'Read paired counts first. Both columns use the same resolved hourly decisions. A lower five-minute entry price is favorable for these long positions. Changed outcome means a different R result, not necessarily a different win/loss label. Zero is measured; — is unavailable.'),
    h('p', null, 'R is result divided by initial risk. Expectancy is average R; profit factor is total gains divided by losses. Drawdown is the largest peak-to-trough decline in sequential R, not an account loss. Under 30 paired observations is insufficient, 30–99 exploratory, and 100+ stronger descriptive evidence—not statistical significance.'),
    h('p', null, `Decision data identity: ${details.inputIdentity?.hourlyDatasetId ?? 'not recorded'}. Execution data identity: ${details.inputIdentity?.fiveMinuteDatasetId ?? 'not recorded'}. Requested ${details.options.requestedStart ?? 'available history'} through ${details.options.requestedEnd ?? 'unavailable'}. Named windows do not guarantee complete coverage.`),
    ...(details.limitations ?? []).map((text, i) => h('p', { key: i, className: 'workbench-muted' }, text)),
    table('Supplied input checks; these are candle counts, not trade exclusions', ['Symbol', 'Hourly invalid / duplicates', 'Hourly alignment removed', '5Min invalid / duplicates', '5Min accepted', '5Min wrong identity or after cutoff'], (details.symbols ?? []).map((s) => [s,
      `${details.coverage?.hourly?.[s]?.rejectedCandleCount ?? '—'} / ${details.coverage?.hourly?.[s]?.duplicateCandleCount ?? '—'}`, details.coverage?.alignmentDroppedCounts?.[s] ?? '—',
      `${details.coverage?.fiveMinute?.[s]?.rejectedCandleCount ?? '—'} / ${details.coverage?.fiveMinute?.[s]?.duplicateCandleCount ?? '—'}`, details.coverage?.fiveMinute?.[s]?.acceptedCount ?? '—', details.coverage?.fiveMinute?.[s]?.timeframeSymbolOrCutoffExcluded ?? '—'])),
    table('Paired population and exclusions', ['Symbol / period', 'Common signals', 'Paired resolved', 'Excluded', 'Evidence', 'Hourly exclusions', '5Min exclusions', 'Decision sessions', 'Delayed 5Min entries'], rows.map((r) => [name(r), r.accounting.commonSignalCount, r.resolvedCount, r.accounting.excludedCount, r.evidenceStrength,
      counts(r.accounting.exclusionsByMethod.hourly), counts(r.accounting.exclusionsByMethod.fiveMinute), counts(r.sessions), r.delayedFiveMinuteEntries])),
    table('Entry timing and prices on the paired sample', ['Symbol / period / method', 'Average delay minutes', 'Median delay minutes', 'Average entry $', 'Average elapsed holding minutes'], rows.flatMap((r) => Object.entries(r.methods).map(([m, value]) => [
      `${name(r)} / ${label(m)}`, format(value.averageEntryDelayMinutes), format(value.medianEntryDelayMinutes), format(value.averageEntryPrice), format(value.averageHoldingMinutes)]))),
    table('Five-minute minus hourly entry and outcome differences', ['Symbol / period', 'Entry difference $', 'Favorable / unfavorable / equal entries', 'Improved / worsened R', 'Changed R %'], rows.map((r) => [name(r), format(r.differences.averageEntryPriceDifference),
      `${r.differences.favorableEntryCount} / ${r.differences.unfavorableEntryCount} / ${r.differences.equalEntryCount}`, `${r.differences.improvedRCount} / ${r.differences.worsenedRCount}`, format(r.differences.changedOutcomePercent, '%')])),
    table('Eastern date clustering and entry sessions', ['Symbol / period', 'Decision days', 'Average trades / active day', 'Maximum / day', 'Trades on multi-signal days %', 'Hourly entry sessions', '5Min entry sessions'], rows.map((r) => [name(r), r.uniqueEasternDecisionDays,
      format(r.clustering?.averageTradesPerActiveDay), r.clustering?.maximumTradesPerDay ?? '—', format(r.clustering?.multiSignalDayTradePercent, '%'), counts(r.entrySessions?.hourly), counts(r.entrySessions?.fiveMinute)])),
    h('details', null, h('summary', null, 'Performance and paired differences at all four modeled costs'),
      table('Performance — costs are fixed R deductions, not actual executable fills', ['Symbol / period / method', 'Cost R', 'Resolved', 'Win %', 'Expectancy R', 'Total R', 'Profit factor', 'Drawdown R', 'Ambiguous count / %', 'Exit reasons'], rows.flatMap((r) => Object.entries(r.methods).flatMap(([m, value]) => value.costTiers.map((tier) => [
        `${name(r)} / ${label(m)}`, format(tier.costR), r.resolvedCount, format(tier.metrics ? 100 * tier.metrics.winRate : null), format(tier.metrics?.averageR), format(tier.metrics?.totalR), format(tier.metrics?.profitFactor), format(tier.metrics?.maximumDrawdown),
        `${tier.metrics?.ambiguousTradeCount ?? '—'} / ${format(tier.metrics?.ambiguousTradeRate == null ? null : tier.metrics.ambiguousTradeRate * 100, '%')}`, counts(value.exitReasonCounts)])))),
      table('Paired differences — 5Min minus 1Hour', ['Symbol / period', 'Cost R', 'Expectancy difference R', 'Total difference R', 'Win-rate difference percentage points'], rows.flatMap((r) => r.differences.costTiers.map((tier) => [name(r), format(tier.costR), format(tier.expectancy), format(tier.totalR), format(tier.winRate == null ? null : tier.winRate * 100)])))),
    h('details', null, h('summary', null, 'Shared Eastern decision-day removal checks'),
      table('Same removed dates for both execution methods; ranking uses hourly before-cost R', ['Symbol / period / check', 'Removed dates', 'Remaining days', 'Paired trades', 'Evidence', 'Cost R', 'Hourly expectancy R', '5Min expectancy R', 'Difference R'], rows.flatMap((r) => r.concentration.flatMap((check) => check.summary.differences.costTiers.map((tier, i) => [
        `${name(r)} / ${check.key}`, check.removedDays.join(', ') || 'None', check.remainingDays, check.summary.resolvedCount, check.summary.evidenceStrength, format(tier.costR), format(check.summary.methods.hourly.costTiers[i].metrics?.averageR), format(check.summary.methods.fiveMinute.costTiers[i].metrics?.averageR), format(tier.expectancy)]))))),
  )
}
