import React, { useEffect, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { getResearchRun } from './researchRunHistory.js'
import { loadResearchRunDetail } from './researchHistoryModel.js'

const h = React.createElement

function DetailSection({ title, children }) {
  return h('section', { className: 'research-detail-section' }, h('h3', null, title), children)
}

function ValueList({ label, values }) {
  return h('p', { className: 'research-detail-value' },
    h('strong', null, `${label}: `),
    Array.isArray(values) && values.length ? values.join(', ') : 'None',
  )
}

function PersistedRunSummary({ run }) {
  const context = run.runContext ?? {}
  const dataset = run.dataset ?? {}
  const synthesis = run.synthesis ?? {}
  const coverage = synthesis.coverage ?? {}
  const experimentResults = run.experimentResults ?? []
  const fetchIssues = run.fetchIssues ?? []
  const strategyGroups = synthesis.strategyGroups ?? []
  const conflicts = synthesis.conflicts ?? []
  const unresolvedQuestions = synthesis.unresolvedQuestions ?? []
  const compatibilityNotes = synthesis.compatibilityNotes ?? []
  const provenance = synthesis.provenance ?? {}

  return h(React.Fragment, null,
    h('dl', { className: 'research-detail-metadata' },
      ...[
        ['Run ID', context.runId], ['Requested at', context.requestedAt], ['Status', run.status], ['Fetch status', run.fetchStatus],
        ['Symbols', (context.symbols ?? []).join(', ')], ['Timeframe', context.timeframe],
        ['Requested dates', [context.requestedStart, context.requestedEnd].filter(Boolean).join(' – ') || 'Unbounded'],
        ['Dataset ID', dataset.datasetId ?? 'Unavailable'],
      ].map(([label, value]) => h('div', { key: label }, h('dt', null, label), h('dd', null, value ?? '—'))),
    ),
    h(DetailSection, { title: 'Fetch issues' }, fetchIssues.length
      ? h('ul', { className: 'workbench-issue-list' }, fetchIssues.map((issue, index) => h('li', { key: `${issue.symbol ?? 'run'}-${issue.type ?? 'issue'}-${index}` },
        h('strong', null, [issue.symbol, issue.type].filter(Boolean).join(' · ') || 'Run issue'),
        issue.error?.message ? h('span', null, issue.error.message) : null,
        issue.message ? h('span', null, issue.message) : null,
      )))
      : h('p', { className: 'workbench-muted' }, 'No fetch issues.')),
    h(DetailSection, { title: 'Experiment execution' }, experimentResults.length
      ? h('ul', { className: 'workbench-experiment-list' }, experimentResults.map((result) => h('li', { key: result.experimentId },
        h('span', { className: 'workbench-experiment-name' }, result.experimentId),
        h('span', { className: `workbench-status-label workbench-status-${result.status}` }, result.status),
        result.error?.message ? h('span', { className: 'workbench-error-detail' }, result.error.message) : null,
      )))
      : h('p', { className: 'workbench-muted' }, 'No experiment execution records.')),
    h(DetailSection, { title: 'Synthesis coverage' }, h(React.Fragment, null,
      h(ValueList, { label: 'Requested', values: coverage.requested }),
      h(ValueList, { label: 'Evaluated', values: coverage.evaluated }),
      h(ValueList, { label: 'Unavailable', values: coverage.unavailable }),
      h(ValueList, { label: 'Incomplete', values: coverage.incomplete }),
    )),
    h(DetailSection, { title: 'Strategy groups and evidence' }, strategyGroups.length
      ? h('ul', { className: 'research-detail-groups' }, strategyGroups.map((group) => h('li', { key: String(group.strategyId) },
        h('h4', null, group.strategyId ?? 'Unknown strategy'),
        (group.evidence ?? []).length
          ? h('ul', { className: 'research-detail-evidence' }, group.evidence.map((evidence) => h('li', { key: evidence.id ?? `${evidence.sourceRecordId}-${evidence.metricsKey}` },
            h('strong', null, evidence.sourceRecordId ?? evidence.experimentId ?? 'Evidence'),
            h('span', null, evidence.metricsKey ?? 'Metrics'),
            evidence.partition ? h('span', null, evidence.partition) : null,
            evidence.metrics ? h('p', null, Object.entries(evidence.metrics)
              .filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value))
              .slice(0, 8)
              .map(([key, value]) => `${key}: ${value}`)
              .join(' · ')) : null,
          )))
          : h('p', { className: 'workbench-muted' }, 'No evidence entries.'),
        (group.evidenceFamilies ?? []).length ? h('p', { className: 'workbench-muted' }, `${group.evidenceFamilies.length} shared evidence families`) : null,
      )))
      : h('p', { className: 'workbench-muted' }, 'No normalized evidence groups.')),
    h(DetailSection, { title: 'Conflicts' }, conflicts.length
      ? h('ul', { className: 'workbench-issue-list' }, conflicts.map((conflict, index) => h('li', { key: conflict.id ?? index }, conflict.observation ?? conflict.dimension ?? conflict.message ?? 'Conflict recorded')))
      : h('p', { className: 'workbench-muted' }, 'No conflicts reported.')),
    h(DetailSection, { title: 'Unresolved questions' }, unresolvedQuestions.length
      ? h('ul', { className: 'workbench-plain-list' }, unresolvedQuestions.map((question, index) => h('li', { key: `${index}-${question}` }, question)))
      : h('p', { className: 'workbench-muted' }, 'None reported.')),
    h(DetailSection, { title: 'Compatibility notes' }, compatibilityNotes.length
      ? h('ul', { className: 'workbench-plain-list' }, compatibilityNotes.map((note, index) => h('li', { key: `${note.type ?? 'note'}-${index}` }, note.note ?? note.message ?? note.type ?? 'Compatibility note')))
      : h('p', { className: 'workbench-muted' }, 'None reported.')),
    h(DetailSection, { title: 'Provenance' }, Object.keys(provenance).length
      ? h('dl', { className: 'research-detail-provenance' }, Object.entries(provenance).map(([key, value]) => h('div', { key }, h('dt', null, key), h('dd', null, typeof value === 'string' || typeof value === 'number' ? String(value) : 'Recorded'))))
      : h('p', { className: 'workbench-muted' }, 'No synthesis provenance recorded.')),
  )
}

export function ResearchRunDetail({ runId, run = null, getRun = getResearchRun, loading: externalLoading = false, error: externalError = null }) {
  const [loadedRun, setLoadedRun] = useState(null)
  const [loading, setLoading] = useState(Boolean(runId && !run))
  const [error, setError] = useState(null)

  useEffect(() => {
    if (run) {
      setLoadedRun(null)
      setError(null)
      setLoading(false)
      return undefined
    }
    if (externalLoading || externalError || !runId) return undefined

    let active = true
    setLoadedRun(null)
    setError(null)
    setLoading(true)
    loadResearchRunDetail(runId, getRun)
      .then((result) => {
        if (active) setLoadedRun(result)
      })
      .catch((loadError) => {
        if (active) setError(loadError.message)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [runId, run, getRun, externalLoading, externalError])

  const displayRun = run ?? loadedRun
  const displayError = externalError ?? error
  return h('section', { className: 'research-run-detail', 'aria-labelledby': 'research-run-detail-title' },
    h('header', { className: 'research-run-detail-heading' },
      h('div', null, h('p', { className: 'workbench-eyebrow' }, 'PERSISTED RUN'), h('h2', { id: 'research-run-detail-title' }, 'Run detail')),
    ),
    displayError ? h('p', { className: 'research-detail-error', role: 'alert' }, displayError)
      : externalLoading || loading ? h('p', { className: 'workbench-muted', role: 'status' }, h(LoaderCircle, { size: 15, className: 'workbench-spinner', 'aria-hidden': true }), ' Loading run detail')
        : displayRun ? h(PersistedRunSummary, { run: displayRun })
          : h('p', { className: 'workbench-muted' }, runId ? 'Research run not found.' : 'Select a run to view its persisted detail.'),
  )
}