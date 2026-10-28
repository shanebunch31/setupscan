import React, { useState } from 'react'
const h = React.createElement
const value = n => n === Infinity ? '\u221e' : Number.isFinite(n) ? Number.isInteger(n) ? String(n) : n.toFixed(3) : '\u2014'
const pct = n => Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : '\u2014'
function table(caption, headings, rows) {
  return h('div', { className: 'table-scroll' }, h('table', null,
    h('caption', null, caption), h('thead', null, h('tr', null, headings.map(label => h('th', { key: label, scope: 'col' }, label)))),
    h('tbody', null, rows.map((cells, i) => h('tr', { key: i }, cells.map((cell, j) => h('td', { key: j }, cell)))))))
}

export function QualificationStackResult({ record }) {
  const [selected, setSelected] = useState('full::pooled')
  const report = record?.parameters?.qualificationStack
  if (!report) return h('p', { className: 'muted' }, 'Qualification stack detail is unavailable in this record.')
  const rows = [...Object.values(record.metrics ?? {}).map(m => m.qualificationStack).filter(Boolean), ...(report.subgroups ?? [])]
  const groups = [...new Map(rows.map(r => [r.group, r.label])).entries()]
  const group = groups.some(([key]) => key === selected) ? selected : groups[0]?.[0]
  const selectedRows = rows.filter(r => r.group === group)
  return h('section', { className: 'workbench-section', 'aria-label': 'Qualification Stack / Condition Count results' },
    h('h3', null, 'Qualification Stack / Condition Count'),
    h('p', null, 'Question: do more full confirmations correspond to better historical outcomes, and which missing conditions change the comparison? Partial RSI/RVOL points do not count as full passes. Condition count is not a win probability.'),
    h('p', null, 'Six-of-six is the current Qualified population. The five-family view requires EMA AND Trend for one shared confirmation; it does not establish statistical independence. Unavailable inputs are excluded from exact-count classification, never treated as failed conditions.'),
    h('p', null, 'Expectancy is average R per resolved outcome; 1R is the initial planned risk. Profit factor compares positive and negative R. Drawdown is the largest sequential-R decline, not account equity. Missing results are \u2014, not zero performance. Under 30 resolved on either side is insufficient; 30\u201399 is exploratory; 100+ is descriptive only.'),
    ...(report.conclusions ?? []).map(c => h('details', { key: c.view },
      h('summary', null, `${c.view === 'six' ? 'Six-condition' : 'Five-family'} findings: ${c.status}`),
      ...Object.entries(c.summary).map(([key, text]) => h('p', { key }, h('strong', null, `${key.replace(/([a-z])([A-Z])/g, '$1 $2').toUpperCase()}: `), text)),
      h('p', null, `Older improvement does not persist: ${c.olderImprovementNotPersistent.map(p => `${p.higher}/${p.lower}: ${p.result === null ? 'insufficient evidence' : p.result ? 'yes' : 'no'}`).join('; ')}.`),
      h('p', null, `Largest observed absolute single-missing differences (not recommendations): ${c.largestObservedMissingDifferences.map(m => `${m.missing}: ${value(m.differenceR)}R, n=${m.resolvedCount}, ${m.evidence}`).join('; ') || 'insufficient evidence'}.`),
      h('p', null, `Cost-sensitive populations: ${c.costDependence.length}; day-stress-sensitive populations: ${c.dayDependence.length}; contrasts below 100 on either side: ${c.underpowered.length}.`))),
    report.redundancy ? h('p', null, `EMA/Trend: ${report.redundancy.agreementCount} agree; ${report.redundancy.disagreementCount} disagree; ${report.redundancy.unavailableCount} unavailable. Single-missing EMA/Trend counts: ${report.redundancy.emaMissingCount}/${report.redundancy.trendMissingCount}. ${report.redundancy.interpretation}`) : null,
    h('label', null, 'Inspect a period, symbol or causal regime ', h('select', { value: group, onChange: e => setSelected(e.target.value) },
      groups.map(([key, label]) => h('option', { key, value: key }, label)))),
    selectedRows.length ? h('p', null, `UTC decision/outcome bounds: ${selectedRows[0].period.start} to ${selectedRows[0].period.end}. Outcomes crossing the period are excluded. Changing this view does not change research membership.`) : null,
    ...['six', 'five'].map(view => {
      const own = selectedRows.filter(r => r.view === view)
      const accounting = report.accounting?.find(a => a.group === group && a.view === view)
      const comparison = report.comparisons?.find(c => c.group === group && c.view === view)
      return h('section', { key: view }, h('h4', null, view === 'six' ? 'Current six-condition stack' : 'Five-family stack'),
        accounting ? h('p', null, `Examined: ${accounting.examinedCount}; condition-evaluable: ${accounting.conditionEvaluableCount}; unavailable: ${accounting.unavailableCount}; exact-count total: ${accounting.exactCountTotal}. Single-missing total: ${accounting.singleMissingTotal}; pair-missing total: ${accounting.pairMissingTotal}; accounting: ${accounting.reconciliationStatus}. Subgroups partition their parent count and must not be added to it.`) : null,
        comparison ? table(`Adjacent count comparisons: ${comparison.monotonicity}. Positive means the higher-count population has higher expectancy.`, ['Higher / lower', 'Resolved samples', 'Evidence', '0R difference', '0.02R difference', '0.05R difference', '0.10R difference'],
          comparison.pairs.map(p => [`${p.higher} / ${p.lower}`, `${p.higherN}/${p.lowerN}`, p.evidence, ...p.costTiers.map(t => `${value(t.differenceR)} (${t.direction})`)])) : null,
        ...['count', 'single', 'pair'].map(kind => h('details', { key: kind, open: kind === 'count' }, h('summary', null, kind === 'count' ? 'Exact-count populations' : kind === 'single' ? 'Every single missing condition/family' : 'Every missing pair (exploratory subgroups)'),
          table('Before-cost results; percentage is of condition-evaluable observations. Difference compares this population with current Qualified 6-of-6.',
            ['Population','Eligible','Resolved','Excluded','Population %','Win rate','Expectancy R','Total R','Profit factor','Drawdown R','Difference R','Evidence'],
            own.filter(r => r.kind === kind).map(r => [r.bucketLabel, r.eligibleCount, r.resolvedCount, r.outcomeExcludedCount, pct(r.populationShare), pct(r.metrics?.winRate), value(r.metrics?.expectancy), value(r.metrics?.totalR), value(r.metrics?.profitFactor), value(r.metrics?.maximumDrawdown), value(r.costTiers[0].differenceFromQualifiedR), r.evidenceStrength])),
          ...own.filter(r => r.kind === kind).map(r => h('details', { key: r.key }, h('summary', null, `${r.bucketLabel}: costs, exclusions and concentration`),
            h('p', null, `Wins/losses/breakeven: ${r.wins}/${r.losses}/${r.breakeven}; expired resolved outcomes: ${r.expiredCount} (subset). Qualified comparison n=${r.qualifiedResolvedCount}; ${r.comparisonEvidence}; accounting ${r.reconciliationStatus}.`),
            table('Identical resolved occurrences at each cost tier', ['Cost R','Sample','Expectancy R','Total R','Profit factor','Drawdown R','Difference R','Ambiguous trades'], r.costTiers.map(t => [value(t.costR),value(t.metrics?.tradeCount),value(t.metrics?.expectancy),value(t.metrics?.totalR),value(t.metrics?.profitFactor),value(t.metrics?.maximumDrawdown),value(t.differenceFromQualifiedR),value(t.metrics?.ambiguousTradeCount)])),
            table('Outcome exclusions', ['Reason','Count'], Object.entries(r.exclusions)),
            r.concentration ? h('p', null, `Eastern active days: ${r.concentration.uniqueSignalDays}; highest five days ${value(r.concentration.topFiveTotalR)}R; lowest five ${value(r.concentration.bottomFiveTotalR)}R. Day shares of positive net R can exceed 100%.`) : null,
            ...r.daySensitivity.map(stress => h('details', { key: stress.key }, h('summary', null, stress.key),
              h('p', null, `Qualified-baseline ranked dates removed: ${stress.removedDays.join(', ') || 'none'}. Same dates across all populations/costs. Remaining samples: ${stress.resolvedCount} / Qualified ${stress.qualifiedResolvedCount}.`),
              table('Day-removal stress; no optimized deletions', ['Cost R','Expectancy R','Difference R'], stress.costTiers.map(t => [value(t.costR),value(t.metrics?.expectancy),value(t.differenceFromQualifiedR)]))))))),
        ),
        accounting ? table('Unavailable inputs; counts can overlap within an observation', ['Condition/family','Unavailable'], Object.entries(accounting.unavailableByCondition)) : null,
      )
    }),
    h('details', null, h('summary', null, 'Source coverage and methodology'),
      h('p', null, `Actual decision range: ${report.coverage?.actualDecisionStart ?? 'unavailable'} to ${report.coverage?.actualDecisionEnd ?? 'unavailable'}. Causal regime reference: ${report.regimeSourceSymbol ?? 'unavailable'}.`),
      table('Source quality', ['Symbol','Rejected','Duplicates','After cutoff','Alignment dropped'], (report.symbols ?? []).map(s => [s,value(report.coverage?.dataQuality?.[s]?.rejectedCandleCount),value(report.coverage?.dataQuality?.[s]?.duplicateCandleCount),value(report.coverage?.completionExcludedCounts?.[s]),value(report.coverage?.alignmentDroppedCounts?.[s])])),
      h('ul', null, (report.limitations ?? []).map(text => h('li', { key: text }, text)))),
  )
}
