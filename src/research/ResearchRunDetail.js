import React, { useEffect, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { getResearchDataset, getResearchRun } from './researchRunHistory.js'
import { beginResearchRunDatasetLoad, loadResearchRunDetail, researchRunDatasetId, selectedResearchRun } from './researchHistoryModel.js'
import { TermHelp } from '../TermHelp.js'

const h = React.createElement

function evidencePartitionLabel(partition) {
  if (typeof partition === 'string') return partition
  return partition?.label ?? partition?.type ?? null
}

function DetailSection({ title, help = null, children }) {
  return h('section', { className: 'research-detail-section' }, h('h3', null, title, help ? h(TermHelp, help) : null), children)
}

function ValueList({ label, values }) {
  return h('p', { className: 'research-detail-value' },
    h('strong', null, `${label}: `),
    Array.isArray(values) && values.length ? values.join(', ') : 'None',
  )
}

function completedExperimentCount(results) {
  return results.filter((result) => result.status === 'succeeded' || result.status === 'completed').length
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
  const requestedExperiments = coverage.requested?.length ? coverage.requested : context.requestedExperiments ?? []
  const evaluatedExperiments = coverage.evaluated ?? []
  const unavailableExperiments = coverage.unavailable ?? []
  const incompleteExperiments = coverage.incomplete ?? []
  const experimentCount = requestedExperiments.length || experimentResults.length
  const completedCount = completedExperimentCount(experimentResults)
  const evidenceCount = strategyGroups.reduce((total, group) => total + (group.evidence ?? []).length, 0)
  const symbols = (context.symbols ?? []).join(', ') || 'Unavailable'
  const requestedDates = [context.requestedStart, context.requestedEnd].filter(Boolean).join(' – ') || 'Unbounded'

  return h(React.Fragment, null,
    h('section', { className: 'research-detail-overview', 'aria-label': 'Research run summary' },
      h('div', { className: 'research-detail-overview-heading' },
        h('strong', null, 'Run status'),
        h('span', { className: `workbench-status-label workbench-status-${run.status}` }, run.status ?? 'Unknown'),
      ),
      h('p', { className: 'research-detail-completion-count' }, `${completedCount} of ${experimentCount} ${experimentCount === 1 ? 'experiment' : 'experiments'} completed`),
      h('dl', { className: 'research-detail-overview-grid' },
        ...[
          ['Symbols', symbols], ['Timeframe', context.timeframe ?? 'Unavailable'],
          ['Requested period', requestedDates], ['Historical dataset', dataset.datasetId ? 'Available' : 'Unavailable'],
          ['EMA contract', context.emaContractVersion ?? 'Legacy version unknown'],
          ['Evidence entries', String(evidenceCount)], ['Fetch issues', String(fetchIssues.length)],
        ].map(([label, value]) => h('div', { key: label }, h('dt', null, label), h('dd', null, value))),
      ),
      h('p', { className: 'research-detail-learning-note' }, 'Historical results describe past data and do not establish future performance.'),
    ),
    h(DetailSection, { title: 'Experiment execution' }, experimentResults.length
      ? h(React.Fragment, null,
        h('p', { className: 'workbench-muted' }, `${completedCount} of ${experimentCount} ${experimentCount === 1 ? 'experiment' : 'experiments'} completed.`),
        h('details', { className: 'research-run-disclosure' },
          h('summary', null, 'More details'),
          h('ul', { className: 'workbench-experiment-list' }, experimentResults.map((result, index) => h('li', { key: result.experimentId ?? index },
            h('span', { className: 'workbench-experiment-name' }, result.experimentId ?? 'Unknown experiment'),
            h('span', { className: `workbench-status-label workbench-status-${result.status}` }, result.status ?? 'Unknown'),
            result.error?.message ? h('span', { className: 'workbench-error-detail' }, result.error.message) : null,
          ))),
        ),
      )
      : h('p', { className: 'workbench-muted' }, 'No experiment execution records.')),
    h(DetailSection, { title: 'Synthesis coverage', help: { term: 'Synthesis', explanation: 'A structured summary of experiment results and remaining evidence gaps. It does not choose an answer.' } }, h(React.Fragment, null,
      h('p', { className: 'workbench-muted' }, `${requestedExperiments.length} requested · ${evaluatedExperiments.length} evaluated · ${unavailableExperiments.length} unavailable · ${incompleteExperiments.length} incomplete`),
      h('details', { className: 'research-run-disclosure' },
        h('summary', null, 'More details'),
        h(ValueList, { label: 'Requested experiment identifiers', values: requestedExperiments }),
        h(ValueList, { label: 'Evaluated experiment identifiers', values: evaluatedExperiments }),
        h(ValueList, { label: 'Unavailable experiment identifiers', values: unavailableExperiments }),
        h(ValueList, { label: 'Incomplete experiment identifiers', values: incompleteExperiments }),
      ),
    )),
    h(DetailSection, { title: 'Unresolved questions' }, unresolvedQuestions.length
      ? h('ul', { className: 'workbench-plain-list' }, unresolvedQuestions.map((question, index) => h('li', { key: `${index}-${question}` }, question)))
      : h('p', { className: 'workbench-muted' }, 'None reported.')),
    h(DetailSection, { title: 'Conflicts', help: { term: 'Conflicts', explanation: 'Some evidence produced different metric results under different research conditions. Conflicts are shown as recorded, without ranking or resolution.' } }, conflicts.length
      ? h(React.Fragment, null,
        h('p', { className: 'workbench-muted' }, 'Conflicts mean some evidence produced different metric results under different research conditions.'),
        h('details', { className: 'research-run-disclosure research-detail-conflicts' },
          h('summary', null, `View conflicts (${conflicts.length})`),
          h('ul', { className: 'workbench-issue-list' }, conflicts.map((conflict, index) => h('li', { className: 'research-detail-conflict-row', key: conflict.id ?? index },
            h('span', { className: 'research-detail-conflict-text' }, conflict.observation ?? conflict.dimension ?? conflict.message ?? 'Conflict recorded'),
          ))),
        ),
      )
      : h('p', { className: 'workbench-muted' }, 'No conflicts reported.')),
    h(DetailSection, { title: 'Strategy groups and evidence', help: { term: 'Evidence', explanation: 'A measured result from an experiment and sample. It is not a conclusion by itself.' } }, strategyGroups.length
      ? h(React.Fragment, null,
        h('p', { className: 'workbench-muted' }, `${strategyGroups.length} strategy groups · ${evidenceCount} evidence entries`),
        h('ul', { className: 'research-detail-groups' }, strategyGroups.map((group, groupIndex) => {
          const groupEvidence = group.evidence ?? []
          const families = group.evidenceFamilies ?? []
          return h('li', { key: String(group.strategyId ?? groupIndex) },
            h('details', { className: 'research-run-disclosure research-detail-group' },
              h('summary', null, h('strong', null, group.strategyId ?? 'Unknown strategy'), h('span', null, `${groupEvidence.length} evidence entries`)),
              groupEvidence.length
                ? h('ul', { className: 'research-detail-evidence' }, groupEvidence.map((evidence, evidenceIndex) => h('li', { key: evidence.id ?? `${evidence.sourceRecordId}-${evidence.metricsKey}-${evidenceIndex}` },
                  h('strong', null, evidence.sourceRecordId ?? evidence.experimentId ?? 'Evidence'),
                  h('span', null, evidence.metricsKey ?? 'Metrics'),
                  evidencePartitionLabel(evidence.partition) ? h('span', null, evidencePartitionLabel(evidence.partition)) : null,
                  evidence.metrics ? h('details', { className: 'research-detail-metric-details' },
                    h('summary', null, 'More metric details'),
                    h('p', null, Object.entries(evidence.metrics)
                      .filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value))
                      .slice(0, 8)
                      .map(([key, value]) => `${key}: ${value}`)
                      .join(' · ')),
                  ) : null,
                )))
                : h('p', { className: 'workbench-muted' }, 'No evidence entries.'),
            ),
            families.length ? h('p', { className: 'research-detail-family-note' }, `${families.length} shared evidence families. Related results may reuse data, trades, or test windows and are not independent confirmations.`, h(TermHelp, { term: 'Evidence family', explanation: 'Related results that may reuse data, trades, or test windows, so they are not completely independent confirmations.' })) : null,
          )
        })),
      )
      : h('p', { className: 'workbench-muted' }, 'No normalized evidence groups.')),
    h('details', { className: 'research-run-disclosure research-detail-technical' },
      h('summary', null, 'How was this tested? View technical details'),
      h('p', { className: 'research-detail-learning-note' }, 'Dataset: the historical market-data input used by this run. The canonical calculation series is summarized below.'),
      h('dl', { className: 'research-detail-metadata' },
        ...[
          ['Run ID', context.runId], ['Requested at', context.requestedAt], ['Fetch status', run.fetchStatus],
          ['Requested period', requestedDates], ['Dataset ID', dataset.datasetId ?? 'Unavailable'],
          ['Requested experiment identifiers', requestedExperiments.join(', ') || 'None'],
        ].map(([label, value]) => h('div', { key: label }, h('dt', null, label), h('dd', null, value ?? '—'))),
      ),
      h(DetailSection, { title: 'Fetch issues' }, fetchIssues.length
        ? h('ul', { className: 'workbench-issue-list' }, fetchIssues.map((issue, index) => h('li', { key: `${issue.symbol ?? 'run'}-${issue.type ?? 'issue'}-${index}` },
          h('strong', null, [issue.symbol, issue.type].filter(Boolean).join(' · ') || 'Run issue'),
          issue.error?.message ? h('span', null, issue.error.message) : null,
          issue.message ? h('span', null, issue.message) : null,
        )))
        : h('p', { className: 'workbench-muted' }, 'No fetch issues.')),
      h(DetailSection, { title: 'Compatibility notes', help: { term: 'Compatibility', explanation: 'Whether the available information allows two results to be compared directly.' } }, compatibilityNotes.length
        ? h('ul', { className: 'workbench-plain-list' }, compatibilityNotes.map((note, index) => h('li', { key: `${note.type ?? 'note'}-${index}` }, note.note ?? note.message ?? note.type ?? 'Compatibility note')))
        : h('p', { className: 'workbench-muted' }, 'None reported.')),
      h(DetailSection, { title: 'Provenance', help: { term: 'Provenance', explanation: 'Details showing where the run and its data came from.' } }, Object.keys(provenance).length
        ? h('details', { className: 'research-detail-provenance-details' },
          h('summary', null, 'More provenance details'),
          h('dl', { className: 'research-detail-provenance' }, Object.entries(provenance).map(([key, value]) => h('div', { key }, h('dt', null, key), h('dd', null, typeof value === 'string' || typeof value === 'number' ? String(value) : 'Recorded')))),
        )
        : h('p', { className: 'workbench-muted' }, 'No synthesis provenance recorded.')),
    ),
  )
}

export function ResearchRunDetail({ runId, run = null, getRun = getResearchRun, getDataset = getResearchDataset, loading: externalLoading = false, error: externalError = null }) {
  const [loadedRunState, setLoadedRunState] = useState({ runId: null, run: null })
  const [loading, setLoading] = useState(Boolean(runId && !run))
  const [error, setError] = useState(null)
  const [datasetState, setDatasetState] = useState({ datasetId: null, status: 'idle', dataset: null, error: null })

  useEffect(() => {
    if (run) {
      setLoadedRunState({ runId: null, run: null })
      setError(null)
      setLoading(false)
      return undefined
    }
    if (externalLoading || externalError || !runId) return undefined

    let active = true
    setError(null)
    setLoading(true)
    loadResearchRunDetail(runId, getRun)
      .then((result) => { if (active) setLoadedRunState({ runId, run: result }) })
      .catch((loadError) => {
        if (active) setError(loadError.message)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [runId, run, getRun, externalLoading, externalError])

  const displayRun = selectedResearchRun(runId, run, loadedRunState)
  const displayError = externalError ?? error
  const datasetId = researchRunDatasetId(displayRun)
  const detailLoading = externalLoading || loading || Boolean(runId && !run && loadedRunState.runId !== runId)

  useEffect(() => {
    return beginResearchRunDatasetLoad(displayRun, getDataset, setDatasetState)
  }, [displayRun, datasetId, getDataset])

  const currentDatasetState = datasetState.datasetId === datasetId
    ? datasetState
    : datasetId ? { status: 'loading', dataset: null, error: null } : { status: 'idle', dataset: null, error: null }

  return h('section', { className: 'research-run-detail', 'aria-labelledby': 'research-run-detail-title' },
    h('header', { className: 'research-run-detail-heading' },
      h('div', null, h('p', { className: 'workbench-eyebrow' }, 'PERSISTED RUN'), h('h2', { id: 'research-run-detail-title' }, 'Run detail')),
    ),
    displayError ? h('p', { className: 'research-detail-error', role: 'alert' }, displayError)
      : detailLoading ? h('p', { className: 'workbench-muted', role: 'status' }, h(LoaderCircle, { size: 15, className: 'workbench-spinner', 'aria-hidden': true }), ' Loading run detail')
        : displayRun ? h(React.Fragment, null,
          h(PersistedRunSummary, { run: displayRun }),
          h(CanonicalDatasetSection, { dataset: currentDatasetState.dataset, loading: currentDatasetState.status === 'loading', error: currentDatasetState.error, datasetId }),
          h(PersistedRunProvenance, { run: displayRun, context: displayRun.runContext ?? {}, dataset: displayRun.dataset ?? {} }),
        )
          : h('p', { className: 'workbench-muted' }, runId ? 'Research run not found.' : 'Select a run to view its persisted detail.'),
  )
}

function displayStoredValue(value) {
  if (value === null || value === undefined || value === '') return 'Unavailable'
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

export function CanonicalDatasetSection({ dataset, loading, error, datasetId }) {
  const series = Array.isArray(dataset?.calculationSeries) ? dataset.calculationSeries : []
  return h(DetailSection, { title: 'Canonical calculation dataset' },
    h('p', { className: 'workbench-muted' }, 'Canonical dataset contents retrieved from saved storage; this is separate from the run provenance recorded below.'),
    loading
      ? h('p', { className: 'workbench-muted', role: 'status' }, h(LoaderCircle, { size: 15, className: 'workbench-spinner', 'aria-hidden': true }), ' Loading canonical dataset')
      : error
        ? h('p', { className: 'research-detail-error', role: 'alert' }, `Canonical dataset could not be loaded: ${error}`)
        : dataset
          ? h(React.Fragment, null,
            h('dl', { className: 'research-detail-metadata' },
              ...[
                ['Dataset ID', dataset.datasetId ?? datasetId],
                ['Calculation series', String(series.length)],
              ].map(([label, value]) => h('div', { key: label }, h('dt', null, label), h('dd', null, value ?? 'Unavailable'))),
            ),
            series.length
              ? h('ul', { className: 'workbench-plain-list' }, series.map((item, index) => {
                const candles = Array.isArray(item?.candles) ? item.candles : []
                return h('li', { key: item?.symbol ?? index }, `${item?.symbol ?? 'Unknown symbol'} · ${candles.length} calculation candles${candles.length ? ` · ${candles[0].timestamp} to ${candles.at(-1).timestamp}` : ''}`)
              }))
              : h('p', { className: 'workbench-muted' }, 'No calculation series are stored for this dataset.'),
          )
          : h('p', { className: 'workbench-muted' }, datasetId
            ? 'Canonical dataset is unavailable.'
            : 'This legacy run has no dataset ID; canonical dataset retrieval is unavailable.'),
  )
}

function PersistedRunProvenance({ run, context, dataset }) {
  const dateProvenance = run.effectiveDateProvenance ?? dataset.effectiveMetadata ?? null
  const effectiveRanges = dateProvenance?.symbols ?? {}
  const configuration = run.effectiveExperimentConfiguration
  const fields = [
    ['Dataset ID', dataset.datasetId ?? researchRunDatasetId(run)],
    ['Provider', dataset.provider],
    ['Adjustment mode', context.adjustmentMode ?? dataset.adjustmentMode],
    ['Timeframe', context.timeframe ?? dataset.timeframe],
    ['Requested date range', [context.requestedStart, context.requestedEnd].filter(Boolean).join(' – ') || 'Unbounded'],
    ['Code revision', context.codeRevision],
  ]
  return h(DetailSection, { title: 'Persisted run provenance' }, h(React.Fragment, null,
    h('dl', { className: 'research-detail-metadata' }, fields.map(([label, value]) => h('div', { key: label }, h('dt', null, label), h('dd', null, displayStoredValue(value))))),
    Object.keys(effectiveRanges).length
      ? h(React.Fragment, null,
        h('h4', null, 'Effective and calculation ranges by symbol'),
        h('ul', { className: 'workbench-plain-list' }, Object.entries(effectiveRanges).map(([symbol, range]) => h('li', { key: symbol }, `${symbol}: ${displayStoredValue(range?.actualStart)} to ${displayStoredValue(range?.actualEnd)} actual; ${displayStoredValue(range?.calculationStart)} to ${displayStoredValue(range?.calculationEnd)} calculation`))),
      )
      : null,
    h('h4', null, 'Effective experiment configuration'),
    configuration && Object.keys(configuration).length
      ? h('dl', { className: 'research-detail-metadata' }, Object.entries(configuration).map(([experimentId, value]) => h('div', { key: experimentId }, h('dt', null, experimentId), h('dd', null, displayStoredValue(value)))))
      : h('p', { className: 'workbench-muted' }, 'No effective experiment configuration was persisted for this run.'),
  ))
}
