import React from 'react'
const h = React.createElement
const value = n => n === Infinity ? '\u221e' : Number.isFinite(n) ? Number.isInteger(n) ? String(n) : n.toFixed(3) : '\u2014'
const pct = n => Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : '\u2014'
function table(caption, headings, rows) {
  return h('div', { className: 'table-scroll' }, h('table', null,
    h('caption', null, caption),
    h('thead', null, h('tr', null, headings.map(label => h('th', { key: label, scope: 'col' }, label)))),
    h('tbody', null, rows.map((cells, i) => h('tr', { key: i }, cells.map((cell, j) => h('td', { key: j }, cell)))))))
}

export function ScannerScoreStabilityResult({ record }) {
  const report = record?.parameters?.scoreStability
  if (!report) return h('p', { className: 'muted' }, 'Score stability detail is unavailable in this record.')
  const rows = Object.values(record.metrics ?? {}).map(m => m.scoreStability).filter(Boolean)
  return h('section', { className: 'workbench-section', 'aria-label': 'Scanner Score Redundancy / Stability results' },
    h('h3', null, 'Scanner Score Redundancy / Stability'),
    h('p', null, 'Question: does removing duplicated EMA/Trend credit remain consistent across periods, symbols, causal regimes and costs? Fixed 75 and mechanical 64/60 floors answer different questions; neither is optimized.'),
    h('p', null, 'Expectancy is average R per resolved outcome; 1R is the initial planned risk. Profit factor compares positive with negative R. Drawdown is the largest fall in sequential cumulative R, not account equity. Missing metrics are \u2014, not measured zero performance.'),
    h('p', null, `Evaluation range: ${report.requestedStart ?? 'unavailable'} to ${report.requestedEnd ?? 'unavailable'}. Regimes use ${report.regimeSourceSymbol ?? 'unavailable'}. Under 30 resolved is insufficient; 30\u201399 exploratory; 100+ descriptive only.`),
    ...(report.conclusions ?? []).map(c => h('details', { key: `${c.variant}::${c.mode}` },
      h('summary', null, `${c.variant} / ${c.mode}: ${c.status}`),
      ...Object.entries(c.summary).map(([label, text]) => h('p', { key: label }, h('strong', null, `${label.toUpperCase()}: `), text)),
      h('p', null, `Older improvement not persistent: ${c.flags.olderImprovementNotPersistent == null ? 'unavailable' : c.flags.olderImprovementNotPersistent ? 'yes' : 'no'}. Direction conflict: ${c.flags.signConflict ? 'yes' : 'no'}; cost dependence: ${c.flags.costDependence ? 'yes' : 'no'}; day-stress dependence: ${c.flags.concentrationDependence ? 'yes' : 'no'}.`))),
    ...[...new Set(rows.map(r => r.group))].map(group => {
      const subset = rows.filter(r => r.group === group)
      return h('details', { key: group, open: group === 'full::pooled' }, h('summary', null, subset[0].label),
        h('p', null, `Decision and outcome bounds: ${subset[0].period.start} to ${subset[0].period.end}. Outcomes crossing this period are excluded.`),
        table('Before-cost results; retention means baseline observations retained, not total eligibility relative to baseline.',
          ['Variant / floor', 'Evaluated', 'Score available', 'Eligible', 'Resolved', 'Excluded', 'Expectancy R', 'Difference R', 'Retained', 'Added', 'Evidence'],
          subset.map(r => [`${r.variantLabel} / ${r.mode} ${r.threshold}/${r.maximumScore}`, r.evaluatedCount, r.scoreEvaluableCount, r.eligibleCount, r.resolvedCount, r.outcomeExcludedCount, value(r.metrics?.expectancy), value(r.costTiers[0].differenceR), pct(r.retentionRate), r.addedCount, r.comparisonEvidence])),
        ...subset.map(r => h('details', { key: r.key }, h('summary', null, `${r.variantLabel} / ${r.mode}: accounting, costs and concentration`),
          h('p', null, `Score unavailable: ${r.scoreUnavailableCount}; evaluable but ineligible: ${r.ineligibleCount}; any unavailable input (overlaps membership): ${r.unavailableInputCount}; EMA/Trend disagreement: ${r.emaTrendDisagreementCount}. Accounting: ${r.reconciliationStatus}.`),
          h('p', null, `Wins/losses/breakeven before costs: ${r.wins}/${r.losses}/${r.breakeven}. Expired resolved outcomes: ${r.expiredCount} (subset). Baseline eligible/resolved: ${r.baselineEligibleCount}/${r.baselineResolvedCount}; retained/added/removed: ${r.retainedCount}/${r.addedCount}/${r.removedCount}.`),
          table('Same resolved occurrences at every fixed cost tier', ['Cost R','Trades','Win rate','Expectancy R','Total R','Profit factor','Drawdown R','Difference R','Ambiguous trades'],
            r.costTiers.map(t => [value(t.costR),value(t.metrics?.tradeCount),pct(t.metrics?.winRate),value(t.metrics?.expectancy),value(t.metrics?.totalR),value(t.metrics?.profitFactor),value(t.metrics?.maximumDrawdown),value(t.differenceR),value(t.metrics?.ambiguousTradeCount)])),
          table('Excluded outcomes', ['Reason','Count'], Object.entries(r.exclusions)),
          r.concentration ? h('p', null, `Eastern active days: ${r.concentration.uniqueSignalDays}; highest five days total R: ${value(r.concentration.topFiveTotalR)}; lowest five: ${value(r.concentration.bottomFiveTotalR)}; highest ${r.concentration.highestFiveTradeCount} trades total R: ${value(r.concentration.highestFiveTradeTotalR)}. Day shares of positive net R can exceed 100%.`) : null,
          ...r.daySensitivity.map(s => h('details', { key: s.key }, h('summary', null, s.key),
            h('p', null, `Removed baseline-ranked dates: ${s.removedDays.join(', ') || 'none'}. Remaining resolved: ${s.resolvedCount}; ${s.evidenceStrength}.`),
            table('Identical removed dates at every cost tier and variant', ['Cost R','Expectancy R','Difference R','Total R'], s.costTiers.map(t => [value(t.costR),value(t.metrics?.expectancy),value(t.differenceR),value(t.metrics?.totalR)])))),
        )))
    }),
    h('details', null, h('summary', null, 'Equivalence and source coverage'),
      table('Equivalence requires identical scores, membership and availability; equivalent variants are not independent confirmations.', ['Left','Right','Comparable','Scores match','Membership matches','Availability matches','Equivalent'],
        (report.equivalences ?? []).map(e => [e.left,e.right,e.comparableCount,...[e.scoresMatch,e.membershipMatches,e.availabilityMatches,e.equivalent].map(v => v ? 'yes' : 'no')])),
      table('Input coverage', ['Symbol','Rejected','Duplicates','After cutoff','Alignment dropped'], (report.symbols ?? []).map(s => [s,value(report.coverage?.dataQuality?.[s]?.rejectedCandleCount),value(report.coverage?.dataQuality?.[s]?.duplicateCandleCount),value(report.coverage?.completionExcludedCounts?.[s]),value(report.coverage?.alignmentDroppedCounts?.[s])]))),
    h('details', null, h('summary', null, 'Methodology and limitations'), h('ul', null, (report.limitations ?? []).map(text => h('li', { key: text }, text)))),
  )
}
