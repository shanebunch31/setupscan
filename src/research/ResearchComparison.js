import React, { useState } from 'react'
import { LoaderCircle, Scale } from 'lucide-react'
import { createResearchComparisonActions } from './researchComparisonModel.js'
import { compareResearchRuns } from './researchRunHistory.js'

const h = React.createElement

function runOptionLabel(run) {
  return [
    run.runId,
    run.requestedAt,
    run.status,
    (run.symbols ?? []).join(', '),
    run.timeframe,
    run.datasetId ? `Dataset ${run.datasetId}` : null,
  ].filter(Boolean).join(' · ')
}

function runDetail(run) {
  if (!run) return h('p', { className: 'research-comparison-muted' }, 'Select a run.')
  return h('dl', { className: 'research-comparison-run-meta' },
    ...[
      ['Run ID', run.runId], ['Requested at', run.requestedAt], ['Status', run.status],
      ['Symbols', (run.symbols ?? []).join(', ')], ['Timeframe', run.timeframe], ['Dataset ID', run.datasetId ?? 'Unavailable'],
    ].map(([label, value]) => h('div', { key: label }, h('dt', null, label), h('dd', null, value ?? '—'))),
  )
}

function displayValue(value) {
  if (Array.isArray(value)) {
    return value.filter((item) => ['string', 'number', 'boolean'].includes(typeof item)).slice(0, 8).map(String).join(', ')
  }
  if (['string', 'number', 'boolean'].includes(typeof value)) return String(value)
  return null
}

function EvidenceSummary({ reference, side }) {
  const evidence = reference?.evidence ?? {}
  const metadata = [
    ['Strategy', evidence.strategyId], ['Experiment', evidence.experimentId], ['Metrics key', evidence.metricsKey],
    ['Variant', evidence.ruleSetVariant], ['Partition', evidence.partition?.label ?? evidence.partition?.type],
    ['Out-of-sample role', evidence.outOfSampleRole], ['Symbols', evidence.symbols], ['Timeframe', evidence.timeframe],
    ['Provider', evidence.provider], ['Cost model', evidence.costModelStatus],
  ].filter(([, value]) => value !== null && value !== undefined && value !== '')
  const metrics = Object.entries(evidence.metrics ?? {})
    .filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value))
    .slice(0, 8)
  return h('section', { className: 'research-comparison-evidence-side' },
    h('h5', null, `Run ${side}`),
    reference?.evidenceId ? h('p', { className: 'research-comparison-evidence-id' }, reference.evidenceId) : null,
    h('dl', { className: 'research-comparison-evidence-meta' }, metadata.map(([label, value]) => h('div', { key: label }, h('dt', null, label), h('dd', null, displayValue(value))))),
    metrics.length ? h('ul', { className: 'research-comparison-metrics' }, metrics.map(([key, value]) => h('li', { key }, `${key}: ${String(value)}`))) : null,
  )
}

function CompatibilityItems({ title, items }) {
  return h('section', { className: 'research-comparison-compatibility-group' },
    h('h5', null, title),
    items.length
      ? h('ul', null, items.map((item, index) => {
        const valueA = displayValue(item.valueA)
        const valueB = displayValue(item.valueB)
        return h('li', { key: `${item.field ?? title}-${index}` },
          h('strong', null, item.field ?? title),
          item.reason ? h('span', null, item.reason) : null,
          valueA !== null ? h('span', null, `Run A: ${valueA}`) : null,
          valueB !== null ? h('span', null, `Run B: ${valueB}`) : null,
        )
      }))
      : h('p', { className: 'research-comparison-muted' }, `No ${title.toLowerCase()} reported.`),
  )
}

function MatchedEvidence({ comparison }) {
  const compatibility = comparison.compatibility ?? {}
  const familyAnnotations = comparison.sharedEvidenceFamilies ?? []
  return h('li', { className: 'research-comparison-pair' },
    h('div', { className: 'research-comparison-pair-heading' },
      h('strong', null, `${comparison.evidenceA?.evidence?.strategyId ?? 'Unknown strategy'} · ${comparison.evidenceA?.evidence?.metricsKey ?? 'Evidence'}`),
      h('span', null, `Compatibility: ${compatibility.compatible === true ? 'compatible' : compatibility.compatible === false ? 'hard conflict reported' : 'unknown'}`),
    ),
    h('div', { className: 'research-comparison-evidence-grid' },
      h(EvidenceSummary, { reference: comparison.evidenceA, side: 'A' }),
      h(EvidenceSummary, { reference: comparison.evidenceB, side: 'B' }),
    ),
    h('div', { className: 'research-comparison-compatibility' },
      h(CompatibilityItems, { title: 'Hard conflicts', items: compatibility.hardConflicts ?? [] }),
      h(CompatibilityItems, { title: 'Soft mismatches', items: compatibility.softMismatches ?? [] }),
      h(CompatibilityItems, { title: 'Unknown metadata', items: compatibility.unknowns ?? [] }),
    ),
    familyAnnotations.length ? h('div', { className: 'research-comparison-family-note' },
      familyAnnotations.map((family) => h('p', { key: family.id }, h('strong', null, `Shared evidence family: ${family.id}`), family.note ? ` · ${family.note}` : null)),
      comparison.nonIndependentEvidence ? h('p', null, 'Non-independence annotation: these evidence entries share a family.') : null,
    ) : null,
  )
}

function UnmatchedEvidence({ entry }) {
  const side = entry.side === 'B' ? 'B' : 'A'
  const title = entry.reason === 'missing' ? `Evidence present only in Run ${side}` : `Unmatched evidence from Run ${side}`
  return h('li', { className: 'research-comparison-unmatched-item' },
    h('h5', null, title),
    h(EvidenceSummary, { reference: entry.evidence, side }),
    h('p', { className: 'research-comparison-muted' }, `Matching status: ${entry.counterpartStatus ?? 'unknown'} · ${entry.reason ?? 'reason unknown'}`),
    h(CompatibilityItems, { title: 'Unknown metadata', items: entry.compatibility?.unknowns ?? [] }),
  )
}

export function ResearchComparisonResult({ result }) {
  const comparisons = result.comparisons ?? []
  const unmatched = result.unmatched ?? []
  const notes = result.compatibilityNotes ?? []
  const provenance = result.provenance ?? {}
  return h('section', { className: 'research-comparison-result', 'aria-label': 'Comparison result' },
    h('header', { className: 'research-comparison-result-heading' },
      h('h3', null, 'Comparison evidence'),
      h('p', null, `${result.runA?.runId ?? 'Unknown run'} ↔ ${result.runB?.runId ?? 'Unknown run'}`),
    ),
    h('section', { className: 'research-comparison-provenance' },
      h('h4', null, 'Dataset and provenance'),
      h('p', null, `Run A dataset: ${provenance.datasetIdA ?? result.runA?.datasetId ?? 'Unknown'}`),
      h('p', null, `Run B dataset: ${provenance.datasetIdB ?? result.runB?.datasetId ?? 'Unknown'}`),
      provenance.datasetIdsEqual === false ? h('p', null, 'Dataset differs between the selected runs.') : null,
      provenance.datasetIdsEqual === null ? h('p', null, 'Dataset identity is unknown for at least one run.') : null,
      ...[['Run A', result.runA], ['Run B', result.runB]].map(([label, run]) => h('p', { key: label }, `${label} requested at: ${run?.requestedAt ?? 'Unknown'}`)),
      ...[['Run A', result.runA?.codeRevision], ['Run B', result.runB?.codeRevision]].map(([label, revision]) => revision ? h('p', { key: `${label}-revision` }, `${label} code revision: ${revision.status ?? 'unknown'}${revision.reason ? ` · ${revision.reason}` : ''}`) : null),
    ),
    h('section', { className: 'research-comparison-matched' },
      h('h4', null, 'Matched evidence'),
      comparisons.length
        ? h('ul', null, comparisons.map((comparison) => h(MatchedEvidence, { key: comparison.id, comparison })))
        : h('p', { className: 'research-comparison-muted' }, 'No comparable evidence found.'),
    ),
    h('section', { className: 'research-comparison-unmatched' },
      h('h4', null, 'Unmatched evidence'),
      unmatched.length
        ? h('ul', null, unmatched.map((entry, index) => h(UnmatchedEvidence, { key: entry.evidence?.id ?? `${entry.side}-${index}`, entry })))
        : h('p', { className: 'research-comparison-muted' }, 'No unmatched evidence reported.'),
    ),
    h('section', { className: 'research-comparison-notes' },
      h('h4', null, 'Compatibility information'),
      notes.length
        ? h('ul', null, notes.map((note, index) => h('li', { key: `${note.type ?? 'note'}-${index}` },
          h('strong', null, note.type === 'dataset-identity-differs' ? 'Dataset differs' : note.type === 'shared-evidence-families' ? 'Shared evidence family' : note.type === 'run-code-revision-unknown' || note.type === 'requested-at-unknown' ? 'Reproducibility limitation' : note.type ?? 'Compatibility note'),
          note.note ? h('span', null, note.note) : null,
          Array.isArray(note.familyIds) && note.familyIds.length ? h('span', null, `Families: ${note.familyIds.join(', ')}`) : null,
        )))
        : h('p', { className: 'research-comparison-muted' }, 'No compatibility notes reported.'),
    ),
  )
}

export function ResearchComparisonView({
  runs = [], selectedRunIdA = '', selectedRunIdB = '', onSelectRunA = () => {}, onSelectRunB = () => {},
  onCompare = () => {}, loading = false, error = null, result = null,
}) {
  const canCompare = Boolean(selectedRunIdA && selectedRunIdB && selectedRunIdA !== selectedRunIdB)
  const displayState = error ? 'error' : loading ? 'loading' : result ? 'success' : 'idle'

  return h('section', { className: 'research-comparison', 'aria-labelledby': 'research-comparison-title' },
    h('header', { className: 'research-comparison-heading' },
      h('div', null, h('p', { className: 'workbench-eyebrow' }, 'PERSISTED EVIDENCE'), h('h2', { id: 'research-comparison-title' }, 'Compare research runs')),
      h('div', { className: `research-comparison-state research-comparison-state-${displayState}`, role: displayState === 'error' ? 'alert' : 'status' },
        loading && !error ? h(LoaderCircle, { size: 15, className: 'workbench-spinner', 'aria-hidden': true }) : null,
        error ? 'Error' : loading ? 'Comparing' : result ? 'Complete' : 'Ready',
      ),
    ),
    runs.length === 0 ? h('p', { className: 'research-comparison-empty' }, 'No historical runs are available.') : null,
    runs.length === 1 ? h('p', { className: 'research-comparison-empty' }, 'At least two historical runs are required.') : null,
    h('div', { className: 'research-comparison-selectors' },
      ...[['A', selectedRunIdA, onSelectRunA], ['B', selectedRunIdB, onSelectRunB]].map(([side, selectedId, onChange]) => h('section', { className: 'research-comparison-run-selector', key: side },
        h('label', { htmlFor: `research-comparison-run-${side.toLowerCase()}` }, `Run ${side}`),
        h('select', {
          id: `research-comparison-run-${side.toLowerCase()}`,
          value: selectedId,
          disabled: runs.length === 0,
          onChange: (event) => onChange(event.target.value),
          'aria-label': `Select Run ${side}`,
        },
        h('option', { value: '' }, `Select Run ${side}`),
        runs.map((run) => h('option', { key: run.runId, value: run.runId }, runOptionLabel(run))),
        ),
        runDetail(runs.find((run) => run.runId === selectedId)),
      )),
    ),
    runs.length > 1 && !canCompare && !error ? h('p', { className: 'research-comparison-muted' }, 'Select two distinct runs to compare.') : null,
    h('button', { type: 'button', className: 'research-comparison-button', disabled: !canCompare || loading, onClick: onCompare }, h(Scale, { size: 15, 'aria-hidden': true }), 'Compare'),
    error ? h('p', { className: 'research-comparison-error', role: 'alert' }, error) : null,
    loading && !error ? h('p', { className: 'research-comparison-muted', role: 'status' }, 'Comparing persisted evidence…') : null,
    !result && !error && !loading ? h('p', { className: 'research-comparison-muted' }, canCompare ? 'Comparison has not been run.' : 'Choose two runs to begin.') : null,
    result ? h(ResearchComparisonResult, { result }) : null,
  )
}

export function ResearchComparison({ runs = [], compareRuns = compareResearchRuns }) {
  const [selectedRunIdA, setSelectedRunIdA] = useState('')
  const [selectedRunIdB, setSelectedRunIdB] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)
  const actions = createResearchComparisonActions({ compareRuns })

  function changeSelection(side, runId) {
    if (side === 'A') setSelectedRunIdA(runId)
    else setSelectedRunIdB(runId)
    setResult(null)
    setError(null)
  }

  async function compareSelectedRuns() {
    if (!selectedRunIdA || !selectedRunIdB || selectedRunIdA === selectedRunIdB) return
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const comparison = await actions.compare(selectedRunIdA, selectedRunIdB)
      setResult(comparison)
    } catch (comparisonError) {
      setError(comparisonError.message)
    } finally {
      setLoading(false)
    }
  }

  return h(ResearchComparisonView, {
    runs, selectedRunIdA, selectedRunIdB,
    onSelectRunA: (runId) => changeSelection('A', runId),
    onSelectRunB: (runId) => changeSelection('B', runId),
    onCompare: compareSelectedRuns,
    loading, error, result,
  })
}