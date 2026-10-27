import React from 'react'
const h = React.createElement
const value = n => n === Infinity ? '\u221e' : Number.isFinite(n) ? Number.isInteger(n) ? String(n) : n.toFixed(3) : '\u2014'
const pct = n => Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : '\u2014'
function table(caption, headings, rows) {
  return h('div', { className: 'paper-table-wrap', key: caption }, h('table', { className: 'workbench-table' },
    h('caption', null, caption), h('thead', null, h('tr', null, headings.map(label => h('th', { key: label, scope: 'col' }, label)))),
    h('tbody', null, rows.map((cells, i) => h('tr', { key: i }, cells.map((cell, j) => h('td', { key: j }, cell)))))))
}
export function ScannerAblationResult({ record }) {
  const report = record?.parameters?.scannerAblation
  if (!report) return h('p', null, 'Scanner ablation detail is unavailable in this saved record.')
  const rows = Object.values(record.metrics ?? {}).map(m => m.ablation).filter(Boolean)
  const ema = report.overlap?.allEvaluated?.find(p => p.left === 'ema' && p.right === 'trend')
  return h('section', { className: 'workbench-section', 'aria-label': 'Scanner Component Ablation results' },
    h('h3', null, 'Scanner Component Ablation'),
    h('p', null, 'Ablation = temporarily remove one ingredient to see how much it really contributes.'),
    h('p', null, report.reason ?? `Question: do the scanner ingredients add different information? ${value(report.evaluatedCount)} evaluated observations; ${value(report.baselineEligibleCount)} normal research-eligible 75+ observations. Qualified count always refers to the unchanged production definition.`),
    ema ? h('p', null, `EMA/Trend overlap: both true ${ema.bothTrue}; EMA only ${ema.leftOnly}; Trend only ${ema.rightOnly}; neither ${ema.neither}; unavailable ${ema.unavailable}. Trend given EMA: ${pct(ema.rightGivenLeft)}. Phi correlation: ${value(ema.phi)}. ${ema.leftOnly + ema.rightOnly === 0 && ema.availableCount > 0 ? 'They are identical on these available observations. This shows duplicated conditions, not a calibrated probability or proof of overstated profitability.' : 'Check disagreements and missing evidence before interpreting dependence.'}`) : null,
    h('p', null, 'Expectancy is average R per resolved outcome; 1R is the initial planned risk. Difference R compares a retained subset with the full baseline, not an independent test. A higher expectancy after removal can reflect sample selection. No result here establishes which ingredient has independent predictive value.'),
    ...[...new Set(rows.map(r => r.group))].map(group => {
      const subset = rows.filter(r => r.group === group)
      return h('details', { key: group, open: group === 'full' }, h('summary', null, subset[0].label),
        table('Fixed 75-point floor; no score rescaling. Missing performance is \u2014, not zero.', ['Variant', 'Evaluated', 'Eligible', 'Qualified', 'Resolved', 'Excluded', 'Expectancy R', 'Difference R', 'Retained', 'Evidence'], subset.map(r => [r.variantLabel, r.evaluatedCount, r.eligibleCount, r.qualifiedCount, r.resolvedCount, r.outcomeExcludedCount, value(r.metrics?.expectancy), value(r.differenceR), pct(r.retainedShare), r.evidenceStrength])),
        ...subset.map(r => h('details', { key: r.key }, h('summary', null, `${r.variantLabel}: outcomes, exclusions and concentration`),
          r.maximumScore < 75 ? h('p', null, `Maximum score is ${r.maximumScore}; this variant cannot reach 75. Empty membership is a threshold consequence, not measured zero performance.`) : null,
          h('p', null, `Unavailable-input observations: ${r.unavailableInputCount}. Outcome accounting: ${r.reconciliationStatus}. Removed: ${r.removed.eligibleCount}, resolved: ${r.removed.resolvedCount}, expectancy: ${value(r.removed.metrics?.expectancy)}R. Retained-versus-removed evidence: ${r.comparisonEvidence}. Under 30 is insufficient; 30\u201399 is a small exploratory sample; 100+ remains descriptive.`),
          table('Resolved outcome statistics; before execution costs', ['Win rate', 'Average winner R', 'Average loser R', 'Profit factor', 'Maximum drawdown R', 'Ambiguous trades', 'Ambiguous share'], [[pct(r.metrics?.winRate), value(r.metrics?.averageWinner), value(r.metrics?.averageLoser), value(r.metrics?.profitFactor), value(r.metrics?.maximumDrawdown), value(r.metrics?.ambiguousTradeCount), pct(r.metrics?.ambiguousTradeRate)]]),
          table('Outcome exclusions', ['Reason', 'Count'], Object.entries(r.exclusions)),
          ...['symbolConcentration', 'regimeConcentration'].map(field => table(field === 'symbolConcentration' ? 'Symbol concentration' : 'Causal regime concentration', ['Group', 'Eligible', 'Resolved', 'Resolved share'], Object.entries(r[field]).map(([key, c]) => [key, c.count, c.resolvedCount, pct(c.resolvedShare)]))),
        )))
    }),
    h('details', null, h('summary', null, 'Condition availability and pairwise overlap'),
      table('All evaluated observations; RSI/RVOL main flags mean full credit', ['Condition', 'Present', 'Absent', 'Unavailable'], (report.components ?? []).map(c => [c.key, c.present, c.absent, c.unavailable])),
      ...Object.entries(report.overlap ?? {}).map(([population, pairs]) => table(population === 'allEvaluated' ? 'All evaluated observations' : 'Normal research-eligible 75+ only (selection-conditioned)', ['Pair', 'Both', 'Left only', 'Right only', 'Neither', 'Unavailable', 'Right given left', 'Left given right', 'Phi'], pairs.map(p => [`${p.left} / ${p.right}`, p.bothTrue, p.leftOnly, p.rightOnly, p.neither, p.unavailable, pct(p.rightGivenLeft), pct(p.leftGivenRight), value(p.phi)]))),
      table('Input coverage before alignment', ['Symbol', 'Rejected', 'Duplicates', 'Outside completion cutoff', 'Alignment dropped'], (report.symbols ?? []).map(s => [s, value(report.dataQuality?.[s]?.rejectedCandleCount), value(report.dataQuality?.[s]?.duplicateCandleCount), value(report.completionExcludedCounts?.[s]), value(report.alignmentDroppedCounts?.[s])]))),
    h('details', null, h('summary', null, 'Methodology, alternatives and limitations'), h('ul', null, (report.limitations ?? []).map(text => h('li', { key: text }, text)))),
  )
}
