import React from 'react'
import { DiscoveryMetricLabel } from './discoveryEducation.js'
import { DISCOVERY_MIN_EXPLORATORY } from '../research/interpretation.js'

const h = React.createElement
const count = value => Number.isInteger(value) && value >= 0 ? value : null
const finite = value => Number.isFinite(value) ? value : null
const allowedStatuses = new Set(['mixed', 'same-direction', 'incomplete', 'insufficient-evidence'])

export function directionalEvidence(value) {
  return !Number.isFinite(value) ? 'unavailable' : value > 0 ? 'positive' : value < 0 ? 'negative' : 'zero'
}

export function formatEvidenceR(value) {
  return Number.isFinite(value) ? `${value > 0 ? '+' : ''}${value.toFixed(2)}R` : '—'
}

/** Copy existing native metrics; do not reconstruct them from aggregate results. */
export function discoveryEvidenceModel(sourceRows, interpretation) {
  const source = Array.isArray(sourceRows) ? sourceRows : []
  const labelsValid = source.every(row => typeof row?.label === 'string' && row.label.trim()) &&
    new Set(source.map(row => row.label)).size === source.length
  const points = Array.isArray(interpretation?.observations) ? interpretation.observations : []
  // Use the already-completed provenance check, and require that the visible
  // native rows are the same population as that interpretation. Unknown stays unknown.
  const comparable = labelsValid && allowedStatuses.has(interpretation?.status) && points.length === source.length &&
    source.every(row => points.some(point => point.label === row.label && point.resolvedCount === count(row.occurrenceCount) &&
      (point.resolvedCount === 0 || point.expectancy === finite(row.averageR))))
  const rows = labelsValid ? source.map(row => {
    const occurrenceCount = count(row.occurrenceCount)
    const populated = comparable && occurrenceCount > 0
    return {
      key: row.label, label: row.label, occurrenceCount,
      winRate: populated && finite(row.winRate) !== null && row.winRate >= 0 && row.winRate <= 1 ? row.winRate : null,
      profitFactor: populated && (row.profitFactor === Infinity || finite(row.profitFactor) !== null && row.profitFactor >= 0) ? row.profitFactor : null,
      averageR: populated ? finite(row.averageR) : null,
      totalR: populated ? finite(row.totalR) : null,
      maximumDrawdown: populated && finite(row.maximumDrawdown) !== null && row.maximumDrawdown >= 0 ? row.maximumDrawdown : null,
    }
  }) : []
  return {
    rows, comparable,
    status: comparable ? interpretation.status : 'unavailable',
    parentResolvedCount: count(interpretation?.parentResolvedCount),
    observations: rows.map(row => ({ label: row.label, series: [{ label: 'Average R', value: row.averageR, tradeCount: row.occurrenceCount }] })),
  }
}

/** Stable label selection survives reordering; missing selections use the first real row. */
export function discoveryEvidenceSelection(rows, selectedKey) {
  const found = rows.findIndex(row => row.key === selectedKey)
  const index = found < 0 ? 0 : found
  return { index, key: rows[index]?.key ?? null, row: rows[index] ?? null }
}

export function discoveryEvidenceKeyAt(rows, index) {
  return Number.isInteger(index) && index >= 0 && index < rows.length ? rows[index].key : null
}

export function discoveryEvidenceNote(model, selectedKey, dimension, options = {}) {
  const { row } = discoveryEvidenceSelection(model.rows, selectedKey)

  const noun =
    options.noun ??
    (dimension === 'year'
      ? 'years'
      : dimension === 'symbol'
        ? 'symbols'
        : 'context buckets')
  if (!row || !model.comparable) return {
    title: 'Deeper evidence is unavailable',
    text: 'This breakdown or its required provenance is missing or inconsistent. No comparison can be inferred; the overall historical result remains separate.',
  }
  if (model.status === 'insufficient-evidence') return {
    title: `${row.label}: insufficient parent evidence`,
    text: `The parent sample has ${model.parentResolvedCount ?? 'an unknown number of'} resolved observations. The existing Discovery guideline is ${DISCOVERY_MIN_EXPLORATORY} for exploratory evidence, not validation. Splitting this sample into ${noun} does not strengthen it. Collect more observations before interpreting differences.`,
  }
  if (directionalEvidence(row.averageR) === 'unavailable') return {
    title: `${row.label}: result unavailable`,
    text: `${row.occurrenceCount ?? 'Unknown'} resolved observations are recorded. An unavailable result is not zero; inspect data coverage and exclusions before comparing this bucket.`,
  }
  if (row.occurrenceCount < DISCOVERY_MIN_EXPLORATORY) return {
    title: `${row.label}: small historical sample`,
    text: `Only ${row.occurrenceCount} resolved observations are available, below the existing ${DISCOVERY_MIN_EXPLORATORY}-observation guideline. The displayed values describe this sample, but collect more evidence before interpreting differences across ${noun}.`,
  }
  const eligiblePeers = model.rows.filter(peer => peer.key !== row.key && peer.occurrenceCount >= DISCOVERY_MIN_EXPLORATORY && Number.isFinite(peer.averageR))
  const sign = directionalEvidence(row.averageR)
  const opposite = eligiblePeers.filter(peer => (sign === 'positive' && peer.averageR < 0) || (sign === 'negative' && peer.averageR > 0))
  if (opposite.length) return {
    title: `${row.label} differs from ${new Intl.ListFormat('en').format(opposite.map(peer => peer.label))} in this sample`,
    text: `The average result has the opposite sign in these historical ${noun}. Investigate whether market context, volatility, or other conditions help explain the difference before changing strategy rules or treating one bucket as preferable. This does not establish a cause.`,
  }
  if (sign === 'zero') return {
    title: `${row.label}: a measured average of zero`,
    text: 'The recorded average is exactly zero, not missing. Examine the range of outcomes and sample size; an average alone cannot explain the underlying pattern.',
  }
  const agrees = eligiblePeers.some(peer => directionalEvidence(peer.averageR) === sign)
  return {
    title: `${row.label}: ${agrees ? 'shares a historical direction' : 'limited peer comparison'}`,
    text: agrees
      ? `Its average result has the same sign as some other ${noun}. Compare the surrounding conditions without treating these overlapping historical views as independent confirmation or a prediction.`
      : `There are no other sufficiently populated ${noun} with the same or opposite sign to support this comparison. Examine missing data, small samples, and any zero results before drawing conclusions.`,
  }
}

export function DiscoveryEvidenceTable({
  id,
  dimension,
  labelOverride,
  model,
  selectedKey,
  onSelect,
  rowRefs,
}) {
  const selected = discoveryEvidenceSelection(model.rows, selectedKey)

  const label =
    labelOverride ??
    (dimension === 'year'
      ? 'Year'
      : dimension === 'symbol'
        ? 'Symbol'
        : 'Bucket')
  return h('div', { className: 'discovery-evidence-table-wrap', tabIndex: 0, role: 'region', 'aria-label': `${label} evidence table; scroll horizontally if needed` },
    h('table', { className: 'robustness-table discovery-detail-evidence-table' },
      h('caption', null, `${label} evidence. Select a row to inspect the matching chart observation. Teal means selected, not good. A dash means unavailable.`),
      h('thead', null, h('tr', null,
        h('th', { scope: 'col' }, label),
        ...['Occurrences', 'Win rate', 'Profit factor', 'Average R', 'Total R', 'Max DD'].map(metric => h('th', { scope: 'col', key: metric }, h(DiscoveryMetricLabel, { label: metric }))))),
      h('tbody', null, ...model.rows.map(row => h('tr', {
        key: row.key, 'data-selected': row.key === selected.key ? 'true' : undefined,
        ref: element => { if (rowRefs) { if (element) rowRefs.current.set(row.key, element); else rowRefs.current.delete(row.key) } },
      },
      h('th', { scope: 'row' }, h('button', { type: 'button', 'aria-pressed': row.key === selected.key,
        'aria-label': `Inspect ${label.toLowerCase()} ${row.label}`, 'aria-controls': `${id}-chart`, onClick: () => onSelect(row.key),
      }, row.label, row.key === selected.key ? h('span', { className: 'discovery-selected-marker', 'aria-hidden': true }, ' · Selected') : null)),
      h('td', null, row.occurrenceCount ?? '—'),
      h('td', null, row.winRate === null ? '—' : `${(row.winRate * 100).toFixed(1)}%`),
      h('td', null, row.profitFactor === null ? '—' : row.profitFactor === Infinity ? '∞' : row.profitFactor.toFixed(2)),
      h('td', { 'data-direction': directionalEvidence(row.averageR) }, formatEvidenceR(row.averageR)),
      h('td', { 'data-direction': directionalEvidence(row.totalR) }, formatEvidenceR(row.totalR)),
      h('td', null, row.maximumDrawdown === null ? '—' : `${row.maximumDrawdown.toFixed(2)}R`))))))
}

export function DiscoveryEvidenceNote({ note }) {
  return h('aside', { className: 'discovery-evidence-research-note', 'aria-live': 'polite' },
    h('p', { className: 'eyebrow' }, 'RESEARCH NOTE'), h('h5', null, note.title), h('p', null, note.text))
}
