import React, { useState } from 'react'
import { LoaderCircle, Play, Save } from 'lucide-react'
import { listResearchExperiments } from './registry.js'
import { saveResearchRun } from './researchRunHistory.js'
import { createWorkbenchRunRequest, executeWorkbenchRun } from './researchWorkbenchModel.js'

const h = React.createElement
const experiments = listResearchExperiments()
const defaultExperimentIds = experiments.map((experiment) => experiment.id)

const statusLabels = {
  idle: 'Ready',
  running: 'Running',
  completed: 'Completed',
  partial: 'Partial',
  unavailable: 'Unavailable',
  failed: 'Failed',
}

export function createWorkbenchActions({ executeRun = executeWorkbenchRun, saveRun = saveResearchRun } = {}) {
  return {
    submit(event, form, onStart = () => {}) {
      event.preventDefault()
      const request = createWorkbenchRunRequest(form)
      onStart()
      return executeRun(request)
    },
    save(result) {
      if (!result) return undefined
      return saveRun(result)
    },
  }
}

function Field({ label, children, className = '' }) {
  return h('label', { className: `workbench-field ${className}` },
    h('span', null, label),
    children,
  )
}

export function RunStateStatus({ status, message }) {
  return h('div', {
    className: `workbench-state workbench-state-${status}`,
    role: status === 'failed' ? 'alert' : 'status',
    'data-testid': 'workbench-run-state',
  },
  status === 'running' ? h(LoaderCircle, { size: 16, className: 'workbench-spinner', 'aria-hidden': true }) : null,
  h('strong', null, statusLabels[status] ?? statusLabels.failed),
  message ? h('span', null, message) : null,
  )
}

function FetchIssueList({ issues }) {
  if (!issues.length) return h('p', { className: 'workbench-muted' }, 'No fetch issues.')
  return h('ul', { className: 'workbench-issue-list' }, issues.map((issue, index) => h('li', { key: `${issue.symbol ?? 'run'}-${issue.type ?? 'issue'}-${index}` },
    h('strong', null, [issue.symbol, issue.type].filter(Boolean).join(' · ') || 'Run issue'),
    issue.error?.message ? h('span', null, issue.error.message) : null,
    issue.type === 'incomplete' ? h('span', null, "Provider marked this symbol's data incomplete.") : null,
    issue.type === 'empty' ? h('span', null, 'No candles were returned for this symbol.') : null,
  )))
}

function ExperimentStatusList({ results }) {
  if (!results.length) return h('p', { className: 'workbench-muted' }, 'No experiments were requested.')
  return h('ul', { className: 'workbench-experiment-list' }, results.map((result) => h('li', { key: result.experimentId },
    h('span', { className: 'workbench-experiment-name' }, result.experimentId),
    h('span', { className: `workbench-status-label workbench-status-${result.status}` }, result.status),
    result.error?.message ? h('span', { className: 'workbench-error-detail' }, result.error.message) : null,
  )))
}

export function RunResultSummary({ result }) {
  if (!result) return null
  const synthesis = result.synthesis ?? {}
  const coverage = synthesis.coverage ?? {}
  return h('section', { className: 'workbench-result', 'aria-label': 'Research run result' },
    h('div', { className: 'workbench-result-heading' },
      h('div', null,
        h('p', { className: 'workbench-eyebrow' }, 'RESEARCH RUN'),
        h('h2', null, 'Run summary'),
      ),
      h(RunStateStatus, { status: result.status }),
    ),
    h('dl', { className: 'workbench-metadata' },
      h('div', null, h('dt', null, 'Run ID'), h('dd', null, result.runContext?.runId ?? '—')),
      h('div', null, h('dt', null, 'Fetch status'), h('dd', null, result.fetchStatus ?? '—')),
      h('div', null, h('dt', null, 'Dataset ID'), h('dd', null, result.dataset?.datasetId ?? 'Unavailable')),
      h('div', null, h('dt', null, 'Requested'), h('dd', null, (result.runContext?.requestedExperiments ?? []).join(', ') || 'None')),
    ),
    h('section', { className: 'workbench-summary-section' },
      h('h3', null, 'Fetch issues'),
      h(FetchIssueList, { issues: result.fetchIssues ?? [] }),
    ),
    h('section', { className: 'workbench-summary-section' },
      h('h3', null, 'Experiment execution'),
      h(ExperimentStatusList, { results: result.experimentResults ?? [] }),
    ),
    h('section', { className: 'workbench-summary-section' },
      h('h3', null, 'Synthesis coverage'),
      h('p', { className: 'workbench-muted' }, `Requested: ${(coverage.requested ?? []).join(', ') || 'None'} · Evaluated: ${(coverage.evaluated ?? []).join(', ') || 'None'}`),
      (coverage.unavailable ?? []).length ? h('p', { className: 'workbench-muted' }, `Unavailable: ${coverage.unavailable.join(', ')}`) : null,
      (coverage.incomplete ?? []).length ? h('p', { className: 'workbench-muted' }, `Incomplete: ${coverage.incomplete.join(', ')}`) : null,
    ),
    h('section', { className: 'workbench-summary-section' },
      h('h3', null, 'Strategy groups'),
      (synthesis.strategyGroups ?? []).length
        ? h('ul', { className: 'workbench-group-list' }, synthesis.strategyGroups.map((group) => h('li', { key: String(group.strategyId) },
          h('strong', null, group.strategyId ?? 'Unknown strategy'),
          h('span', null, `${group.evidence?.length ?? 0} evidence entries`),
          (group.evidenceFamilies ?? []).map((family) => h('small', { key: family.id }, `Shared family: ${family.id}`)),
        )))
        : h('p', { className: 'workbench-muted' }, 'No normalized evidence groups.'),
    ),
    h('section', { className: 'workbench-summary-section' },
      h('h3', null, 'Conflicts'),
      (synthesis.conflicts ?? []).length
        ? h('ul', { className: 'workbench-issue-list' }, synthesis.conflicts.map((conflict) => h('li', { key: conflict.id }, conflict.observation ?? conflict.dimension)))
        : h('p', { className: 'workbench-muted' }, 'No conflicts reported.'),
    ),
    h('section', { className: 'workbench-summary-section' },
      h('h3', null, 'Unresolved questions'),
      (synthesis.unresolvedQuestions ?? []).length
        ? h('ul', { className: 'workbench-plain-list' }, synthesis.unresolvedQuestions.map((question, index) => h('li', { key: `${index}-${question}` }, question)))
        : h('p', { className: 'workbench-muted' }, 'None reported.'),
      (synthesis.compatibilityNotes ?? []).length
        ? h(React.Fragment, null,
          h('h3', { className: 'workbench-subheading' }, 'Compatibility notes'),
          h('ul', { className: 'workbench-plain-list' }, synthesis.compatibilityNotes.map((note, index) => h('li', { key: `${note.type ?? 'note'}-${index}` }, note.note ?? note.message ?? note.type))),
        )
        : null,
    ),
  )
}

export function ResearchWorkbench({ executeRun = executeWorkbenchRun, saveRun = saveResearchRun }) {
  const actions = createWorkbenchActions({ executeRun, saveRun })
  const [form, setForm] = useState({
    symbols: 'SPY, QQQ, IWM',
    timeframe: '1Hour',
    requestedStart: '2022-01-01',
    requestedEnd: '',
    requestedExperiments: defaultExperimentIds,
  })
  const [runState, setRunState] = useState('idle')
  const [runResult, setRunResult] = useState(null)
  const [formError, setFormError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState(null)

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  function toggleExperiment(experimentId) {
    setForm((current) => ({
      ...current,
      requestedExperiments: current.requestedExperiments.includes(experimentId)
        ? current.requestedExperiments.filter((id) => id !== experimentId)
        : [...current.requestedExperiments, experimentId],
    }))
  }

  async function submit(event) {
    setFormError(null)
    setSaveMessage(null)
    try {
      const result = await actions.submit(event, form, () => {
        setRunState('running')
        setRunResult(null)
      })
      setRunResult(result)
      setRunState(result.status)
    } catch (error) {
      setFormError(error.message)
      setRunState((current) => current === 'running' ? 'failed' : current)
    }
  }

  async function saveResult() {
    if (!runResult) return
    setSaving(true)
    setSaveMessage(null)
    try {
      await actions.save(runResult)
      setSaveMessage('Research run saved to history.')
    } catch (error) {
      setSaveMessage(`Save failed: ${error.message}`)
    } finally {
      setSaving(false)
    }
  }

  return h('section', { className: 'research-workbench', 'aria-labelledby': 'workbench-title' },
    h('header', { className: 'workbench-header' },
      h('div', null,
        h('p', { className: 'workbench-eyebrow' }, 'RESEARCH'),
        h('h1', { id: 'workbench-title' }, 'Research Workbench'),
        h('p', { className: 'workbench-intro' }, 'Configure and execute a registered research run. Historical runs are saved explicitly.'),
      ),
      h(RunStateStatus, { status: runState, message: runState === 'running' ? 'Fetching shared market data and running experiments.' : null }),
    ),
    h('form', { className: 'workbench-form', onSubmit: submit, noValidate: true },
      h('div', { className: 'workbench-form-grid' },
        h(Field, { label: 'Symbols', className: 'workbench-field-wide' }, h('input', {
          name: 'symbols', value: form.symbols, onChange: (event) => updateField('symbols', event.target.value),
          autoComplete: 'off', placeholder: 'SPY, QQQ, IWM', 'aria-label': 'Symbols',
        })),
        h(Field, { label: 'Timeframe' }, h('select', {
          name: 'timeframe', value: form.timeframe, onChange: (event) => updateField('timeframe', event.target.value), 'aria-label': 'Timeframe',
        }, h('option', { value: '1Hour' }, '1 hour'))),
        h(Field, { label: 'Start date' }, h('input', {
          name: 'requestedStart', type: 'date', value: form.requestedStart,
          onChange: (event) => updateField('requestedStart', event.target.value), 'aria-label': 'Start date',
        })),
        h(Field, { label: 'End date' }, h('input', {
          name: 'requestedEnd', type: 'date', value: form.requestedEnd,
          onChange: (event) => updateField('requestedEnd', event.target.value), 'aria-label': 'End date',
        })),
      ),
      h('fieldset', { className: 'workbench-experiment-picker' },
        h('legend', null, 'Experiments'),
        h('div', { className: 'workbench-experiment-grid' }, experiments.map((experiment) => h('label', { className: 'workbench-check', key: experiment.id },
          h('input', {
            type: 'checkbox',
            name: 'requestedExperiments',
            value: experiment.id,
            'aria-label': experiment.title,
            checked: form.requestedExperiments.includes(experiment.id),
            onChange: () => toggleExperiment(experiment.id),
          }),
          h('span', null, experiment.title),
        ))),
        h('p', { className: 'workbench-muted' }, `${form.requestedExperiments.length} selected · no selection runs no experiments and performs no fetch.`),
      ),
      formError ? h('p', { className: 'workbench-form-error', role: 'alert' }, formError) : null,
      h('div', { className: 'workbench-actions' },
        h('button', { className: 'workbench-primary', type: 'submit', disabled: runState === 'running' },
          runState === 'running' ? h(LoaderCircle, { size: 15, className: 'workbench-spinner', 'aria-hidden': true }) : h(Play, { size: 15, 'aria-hidden': true }),
          runState === 'running' ? 'Running' : 'Run research',
        ),
        runResult ? h('button', { className: 'workbench-secondary', type: 'button', onClick: saveResult, disabled: saving },
          h(Save, { size: 15, 'aria-hidden': true }),
          saving ? 'Saving' : 'Save run',
        ) : null,
        saveMessage ? h('span', { className: 'workbench-muted', role: 'status' }, saveMessage) : null,
      ),
    ),
    runResult ? h(RunResultSummary, { result: runResult }) : null,
  )
}