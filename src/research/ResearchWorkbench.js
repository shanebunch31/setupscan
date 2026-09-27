import React, { useEffect, useRef, useState } from 'react'
import { Link2, LoaderCircle, Play, Plus, Save } from 'lucide-react'
import { listResearchExperiments } from './registry.js'
import { getResearchRun, saveResearchRun } from './researchRunHistory.js'
import {
  attachResearchRunToInvestigation,
  createResearchInvestigation as createResearchInvestigationRequest,
  getResearchInvestigation,
  listResearchInvestigations,
} from './researchInvestigationHistory.js'
import { ResearchRunDetail } from './ResearchRunDetail.js'
import { ResearchInvestigationDetail } from './ResearchInvestigationDetail.js'
import { TermHelp } from '../TermHelp.js'
import {
  createInvestigationRunRequest,
  createWorkbenchInvestigationRequest,
  createWorkbenchRunRequest,
  executeWorkbenchRun,
  setWorkbenchRunFailure,
} from './researchWorkbenchModel.js'

const h = React.createElement
const experiments = listResearchExperiments()
const defaultExperimentIds = experiments.map((experiment) => experiment.id)

function evidencePartitionLabel(partition) {
  if (typeof partition === 'string') return partition
  return partition?.label ?? partition?.type ?? null
}

const statusLabels = {
  idle: 'Ready',
  running: 'Running',
  completed: 'Completed',
  partial: 'Partial',
  unavailable: 'Unavailable',
  failed: 'Failed',
}

export function createWorkbenchActions({
  executeRun = executeWorkbenchRun,
  saveRun = saveResearchRun,
  createInvestigation: createInvestigationRequest = createResearchInvestigationRequest,
  listInvestigations: listInvestigationsRequest = listResearchInvestigations,
  getInvestigation: getInvestigationRequest = getResearchInvestigation,
  attachRun: attachRunRequest = attachResearchRunToInvestigation,
} = {}) {
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
    createInvestigation(question, requestedExperiments) {
      const request = createWorkbenchInvestigationRequest(question, requestedExperiments)
      return createInvestigationRequest(request)
    },
    listInvestigations(filters) {
      return listInvestigationsRequest(filters)
    },
    getInvestigation(investigationId) {
      return getInvestigationRequest(investigationId)
    },
    attachRun(investigationId, runId) {
      return attachRunRequest(investigationId, runId)
    },
    runInvestigationPlan(form, investigation, onStart = () => {}) {
      const request = createInvestigationRunRequest(form, investigation)
      onStart()
      return executeRun(request)
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
  const runContext = result.runContext ?? {}
  const synthesis = result.synthesis ?? {}
  const coverage = synthesis.coverage ?? {}
  const experimentResults = result.experimentResults ?? []
  const requested = coverage.requested?.length ? coverage.requested : runContext.requestedExperiments ?? []
  const evaluated = coverage.evaluated ?? []
  const unavailable = coverage.unavailable ?? []
  const incomplete = coverage.incomplete ?? []
  const strategyGroups = synthesis.strategyGroups ?? []
  const conflicts = synthesis.conflicts ?? []
  const unresolvedQuestions = synthesis.unresolvedQuestions ?? []
  const compatibilityNotes = synthesis.compatibilityNotes ?? []
  const fetchIssues = result.fetchIssues ?? []
  const evidenceCount = strategyGroups.reduce((total, group) => total + (group.evidence?.length ?? 0), 0)
  const completedCount = experimentResults.filter((item) => item.status === 'succeeded' || item.status === 'completed').length
  const experimentCount = requested.length || experimentResults.length
  const requestedDates = [runContext.requestedStart, runContext.requestedEnd].filter(Boolean).join(' – ') || 'Unbounded'
  const resultHeadline = result.status === 'completed'
    ? 'Your research run is complete'
    : result.status === 'partial'
      ? 'Your research run has partial results'
      : result.status === 'unavailable'
        ? 'Your research run has unavailable evidence'
        : `Your research run status: ${statusLabels[result.status] ?? result.status ?? 'Unknown'}`
  return h('section', { className: 'workbench-result', 'aria-label': 'Research run result' },
    h('div', { className: 'workbench-result-heading' },
      h('div', null,
        h('p', { className: 'workbench-eyebrow' }, 'RESEARCH RUN', h(TermHelp, { term: 'Research Run', explanation: 'One saved execution of selected experiments using shared historical data.' })),
        h('h2', null, 'Run summary'),
      ),
      h(RunStateStatus, { status: result.status }),
    ),
    h('dl', { className: 'workbench-result-overview-grid' },
      h('div', null, h('dt', null, 'Symbols'), h('dd', null, (runContext.symbols ?? []).join(', ') || 'Unavailable')),
      h('div', null, h('dt', null, 'Timeframe'), h('dd', null, runContext.timeframe ?? 'Unavailable')),
      h('div', null, h('dt', null, 'Requested period'), h('dd', null, requestedDates)),
      h('div', null, h('dt', null, 'Historical dataset'), h('dd', null, result.dataset?.datasetId ? 'Available' : 'Unavailable')),
      h('div', null, h('dt', null, 'Evidence entries'), h('dd', null, String(evidenceCount))),
      h('div', null, h('dt', null, 'Fetch issues'), h('dd', null, String(fetchIssues.length))),
    ),
    h('p', { className: 'workbench-result-caveat' }, 'Historical results describe past data and do not establish future performance.'),
    h('section', { className: 'workbench-summary-section' },
      h('h3', null, 'Experiment execution', h(TermHelp, { term: 'Experiment', explanation: 'One registered research method tested during a run.' })),
      h('p', { className: 'workbench-muted' }, `${completedCount} of ${experimentCount} ${experimentCount === 1 ? 'experiment' : 'experiments'} completed`),
      h('details', { className: 'workbench-result-disclosure' },
        h('summary', null, 'More details'),
        h(ExperimentStatusList, { results: experimentResults }),
      ),
    ),
    h('section', { className: 'workbench-summary-section' },
      h('h3', null, 'Synthesis coverage', h(TermHelp, { term: 'Synthesis coverage', explanation: 'Shows which requested research was available and evaluated.' })),
      h('p', { className: 'workbench-muted' }, `${requested.length} requested · ${evaluated.length} evaluated · ${unavailable.length} unavailable · ${incomplete.length} incomplete`),
      h('details', { className: 'workbench-result-disclosure' },
        h('summary', null, 'More details'),
        h('p', null, h('strong', null, 'Requested experiment identifiers: '), requested.join(', ') || 'None'),
        h('p', null, h('strong', null, 'Evaluated experiment identifiers: '), evaluated.join(', ') || 'None'),
        h('p', null, h('strong', null, 'Unavailable experiment identifiers: '), unavailable.join(', ') || 'None'),
        h('p', null, h('strong', null, 'Incomplete experiment identifiers: '), incomplete.join(', ') || 'None'),
      ),
    ),
    h('section', { className: 'workbench-summary-section' },
      h('h3', null, 'Unresolved questions', h(TermHelp, { term: 'Unresolved questions', explanation: 'Evidence gaps or limitations the current research did not settle.' })),
      unresolvedQuestions.length
        ? h('ul', { className: 'workbench-plain-list' }, unresolvedQuestions.map((question, index) => h('li', { key: `${index}-${question}` }, question)))
        : h('p', { className: 'workbench-muted' }, 'None reported.'),
    ),
    h('section', { className: 'workbench-summary-section' },
      h('h3', null, 'Conflicts', h(TermHelp, { term: 'Conflicts', explanation: 'Some evidence produced different metric results under different research conditions. Conflicts are shown as recorded, without ranking or resolution.' })),
      conflicts.length
        ? h(React.Fragment, null,
          h('p', { className: 'workbench-muted' }, 'Conflicts mean some evidence produced different metric results under different research conditions.'),
          h('details', { className: 'workbench-result-disclosure research-detail-conflicts' },
            h('summary', null, `View conflicts (${conflicts.length})`),
            h('ul', { className: 'workbench-issue-list' }, conflicts.map((conflict, index) => h('li', { className: 'research-detail-conflict-row', key: conflict.id ?? index },
              h('span', { className: 'research-detail-conflict-text' }, conflict.observation ?? conflict.dimension ?? conflict.message ?? 'Conflict recorded'),
            ))),
          ),
        )
        : h('p', { className: 'workbench-muted' }, 'No conflicts reported.'),
    ),
    h('section', { className: 'workbench-summary-section' },
      h('h3', null, 'Strategy groups and evidence', h(TermHelp, { term: 'Evidence', explanation: 'A measured result from an experiment and sample. It is not a conclusion by itself.' })),
      strategyGroups.length
        ? h(React.Fragment, null,
          h('p', { className: 'workbench-muted' }, `${strategyGroups.length} strategy groups · ${evidenceCount} evidence entries`),
          h('ul', { className: 'workbench-group-list' }, strategyGroups.map((group, groupIndex) => {
            const groupEvidence = group.evidence ?? []
            const families = group.evidenceFamilies ?? []
            return h('li', { key: String(group.strategyId ?? groupIndex) },
              h('details', { className: 'workbench-result-disclosure workbench-result-group' },
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
                families.length ? h('p', { className: 'workbench-muted' }, `Shared evidence families: ${families.map((family) => family.id).join(', ')}`) : null,
              ),
              families.length ? h('small', { className: 'research-detail-family-note' }, `${families.length} shared evidence families. Related results may reuse data, trades, or test windows and are not independent confirmations.`) : null,
            )
          })),
        )
        : h('p', { className: 'workbench-muted' }, 'No normalized evidence groups.'),
    ),
    h('section', { className: 'workbench-summary-section' },
      h('details', { className: 'workbench-result-disclosure workbench-result-technical' },
        h('summary', null, 'How was this tested? View technical details'),
        h('dl', { className: 'workbench-metadata' },
          h('div', null, h('dt', null, 'Run ID'), h('dd', null, runContext.runId ?? '—')),
          h('div', null, h('dt', null, 'Fetch status'), h('dd', null, result.fetchStatus ?? '—')),
          h('div', null, h('dt', null, 'Dataset ID'), h('dd', null, result.dataset?.datasetId ?? 'Unavailable')),
          h('div', null, h('dt', null, 'Requested dates'), h('dd', null, requestedDates)),
        ),
        h('h4', null, 'Fetch issues'),
        h(FetchIssueList, { issues: fetchIssues }),
        compatibilityNotes.length ? h(React.Fragment, null,
          h('h4', null, 'Compatibility notes'),
          h('ul', { className: 'workbench-plain-list' }, compatibilityNotes.map((note, index) => h('li', { key: `${note.type ?? 'note'}-${index}` }, note.note ?? note.message ?? note.type))),
        ) : null,
      ),
    ),
    h('section', { className: 'workbench-investigation-handoff', 'aria-label': 'Optional Investigation workflow' },
      h('p', { className: 'workbench-eyebrow' }, 'OPTIONAL NEXT STEP'),
      h('h3', null, resultHeadline),
      h('p', null, 'Want to organize this research into an Investigation?'),
      h('p', { className: 'workbench-muted' }, 'An Investigation groups a research question and experiment plan across saved Research Runs. Creating one does not save or attach this run; those actions remain explicit.'),
    ),
  )
}

function dateLabel(value) {
  return typeof value === 'string' && value ? value.slice(0, 10) : '—'
}

const experimentTitles = new Map(experiments.map((experiment) => [experiment.id, experiment.title]))
const experimentExplanations = {
  'relative-value': 'Looks at the relationship between related instruments or prices rather than one price alone.',
  'causal-regime': 'Groups results using information available at the time. It does not prove that a market condition caused the result.',
  'walk-forward-regime': 'Repeated tests that move forward through time, using earlier data for each later test.',
  'volatility-aware-variants': 'Tests predefined strategy variants (alternative rule sets) under different volatility conditions; it does not automatically adapt live trading.',
  'strategy-discovery': 'Tests predefined strategy ideas historically; discovery is not validation.',
  'strategy-comparison': 'Places predefined strategies side by side using the same research evidence.',
  'yearly-regime': 'Groups results by year and experiment-specific labels for observed market conditions.',
}

export function ResearchInvestigationPanel({
  investigations = [],
  listLoading = false,
  listError = null,
  onSelectInvestigation = () => {},
  selectedInvestigationId = null,
  selectedInvestigation = null,
  investigationLoading = false,
  investigationError = null,
  onRunPlan = () => {},
  runLoading = false,
  question = '',
  onQuestionChange = () => {},
  requestedExperiments = [],
  onToggleExperiment = () => {},
  creating = false,
  createError = null,
  createMessage = null,
  onCreate = () => {},
  savedRunId = null,
  attaching = false,
  attachError = null,
  attachMessage = null,
  onAttachRun = () => {},
  selectedRunId = null,
  onOpenDetail = () => {},
  getRun = getResearchRun,
  onSelectRun = () => {},
}) {
  const listContent = listError
    ? h('p', { className: 'workbench-form-error', role: 'alert' }, listError)
    : listLoading
      ? h('p', { className: 'workbench-muted', role: 'status' }, h(LoaderCircle, { size: 14, className: 'workbench-spinner', 'aria-hidden': true }), ' Loading investigations')
      : investigations.length
        ? h('ul', { className: 'workbench-investigation-list' }, investigations.map((investigation) => h('li', { key: investigation.investigationId },
          h('button', {
            type: 'button',
            className: `workbench-investigation-select${selectedInvestigationId === investigation.investigationId ? ' is-selected' : ''}`,
            'aria-pressed': selectedInvestigationId === investigation.investigationId,
            onClick: () => onSelectInvestigation(investigation.investigationId),
          },
          h('strong', null, investigation.question),
          h('span', null, `${investigation.status} · ${dateLabel(investigation.createdAt)} · ${investigation.runIds?.length ?? 0} runs`),
          ),
        )))
        : h('p', { className: 'workbench-muted' }, 'No Investigations yet.')

  let selectedContent
  if (investigationError) {
    selectedContent = h('p', { className: 'workbench-form-error', role: 'alert' }, investigationError)
  } else if (investigationLoading) {
    selectedContent = h('p', { className: 'workbench-muted', role: 'status' }, h(LoaderCircle, { size: 14, className: 'workbench-spinner', 'aria-hidden': true }), ' Loading investigation')
  } else if (!selectedInvestigation) {
    selectedContent = h('p', { className: 'workbench-muted' }, 'Select an Investigation to view its plan and saved runs.')
  } else {
    const runIds = selectedInvestigation.runIds ?? []
    const alreadyAttached = savedRunId ? runIds.includes(savedRunId) : false
    selectedContent = h(React.Fragment, null,
      h('dl', { className: 'workbench-investigation-metadata' },
        h('div', null, h('dt', null, 'Question'), h('dd', null, selectedInvestigation.question)),
        h('div', null, h('dt', null, 'Status'), h('dd', null, selectedInvestigation.status)),
        h('div', null, h('dt', null, 'Created'), h('dd', null, selectedInvestigation.createdAt ?? '—')),
        h('div', null, h('dt', null, 'Updated'), h('dd', null, selectedInvestigation.updatedAt ?? '—')),
        h('div', null, h('dt', null, 'Experiments'), h('dd', null, (selectedInvestigation.requestedExperiments ?? []).map((id) => experimentTitles.get(id) ?? id).join(', ') || 'None')),
        h('div', null, h('dt', null, 'Associated runs'), h('dd', null, String(runIds.length))),
      ),
      h('div', { className: 'workbench-investigation-run-heading' },
        h('h3', null, 'Saved Research Runs'),
        h('button', { className: 'workbench-secondary', type: 'button', onClick: onOpenDetail }, 'Open Investigation Detail'),
        h('button', {
          className: 'workbench-secondary',
          type: 'button',
          disabled: runLoading,
          onClick: onRunPlan,
        },
        runLoading ? h(LoaderCircle, { size: 14, className: 'workbench-spinner', 'aria-hidden': true }) : h(Play, { size: 14, 'aria-hidden': true }),
        runLoading ? 'Running plan' : 'Run investigation plan',
        ),
      ),
      runIds.length
        ? h('ul', { className: 'workbench-investigation-runs' }, runIds.map((runId) => h('li', { key: runId },
          h('code', null, runId),
          h('button', { type: 'button', className: 'research-history-select', onClick: () => onSelectRun(runId) }, 'View run'),
        )))
        : h('p', { className: 'workbench-muted' }, 'No runs associated yet.'),
      h('div', { className: 'workbench-investigation-attach' },
        h('p', { className: 'workbench-muted' }, savedRunId ? `Saved run ready to attach: ${savedRunId}` : 'Save a Research Run to enable attachment.'),
        h('button', {
          className: 'workbench-secondary',
          type: 'button',
          disabled: !savedRunId || attaching || alreadyAttached,
          onClick: onAttachRun,
        },
        attaching ? h(LoaderCircle, { size: 14, className: 'workbench-spinner', 'aria-hidden': true }) : h(Link2, { size: 14, 'aria-hidden': true }),
        attaching ? 'Adding run' : 'Add Run to Investigation',
        ),
        alreadyAttached ? h('p', { className: 'workbench-muted', role: 'status' }, 'This run is already attached.') : null,
        attachError ? h('p', { className: 'workbench-form-error', role: 'alert' }, attachError) : null,
        attachMessage ? h('p', { className: 'workbench-muted', role: 'status' }, attachMessage) : null,
      ),
      selectedRunId ? h(ResearchRunDetail, { runId: selectedRunId, getRun }) : null,
    )
  }

  return h('section', { className: 'workbench-investigations', 'aria-labelledby': 'workbench-investigations-title' },
    h('header', { className: 'workbench-investigations-heading' },
      h('div', null,
        h('p', { className: 'workbench-eyebrow' }, 'RESEARCH ORGANIZATION'),
        h('h2', { id: 'workbench-investigations-title' }, 'Investigations'),
        h('p', { className: 'workbench-muted' }, 'An Investigation is a question and experiment plan used to organize related Research Runs. Evidence stays with each saved run.'),
      ),
    ),
    h('div', { className: 'workbench-investigation-layout' },
      h('div', { className: 'workbench-investigation-create-column' },
        h('form', { className: 'workbench-investigation-create', onSubmit: onCreate, noValidate: true },
          h(Field, { label: 'Research question' }, h('textarea', {
            name: 'investigationQuestion',
            value: question,
            maxLength: 1000,
            required: true,
            onChange: (event) => onQuestionChange(event.target.value),
            'aria-label': 'Research question',
          })),
          h('fieldset', { className: 'workbench-experiment-picker workbench-investigation-plan' },
            h('legend', null, 'Experiment plan', h(TermHelp, { term: 'Experiment plan', explanation: 'The experiments selected for this question.' })),
            h('div', { className: 'workbench-experiment-grid' }, experiments.map((experiment) => h('label', { className: 'workbench-check', key: experiment.id },
              h('input', {
                type: 'checkbox',
                name: 'investigationExperiments',
                value: experiment.id,
                checked: requestedExperiments.includes(experiment.id),
                onChange: () => onToggleExperiment(experiment.id),
                'aria-label': `Investigation experiment ${experiment.title}`,
              }),
              h('span', null, experiment.title, experimentExplanations[experiment.id] ? h(TermHelp, { term: experiment.title, explanation: experimentExplanations[experiment.id] }) : null),
            ))),
            h('p', { className: 'workbench-muted' }, `${requestedExperiments.length} selected · plan order is preserved.`),
          ),
          createError ? h('p', { className: 'workbench-form-error', role: 'alert' }, createError) : null,
          h('div', { className: 'workbench-actions' },
            h('button', { className: 'workbench-primary', type: 'submit', disabled: creating },
              creating ? h(LoaderCircle, { size: 14, className: 'workbench-spinner', 'aria-hidden': true }) : h(Plus, { size: 14, 'aria-hidden': true }),
              creating ? 'Creating Investigation' : 'Create Investigation',
            ),
            createMessage ? h('span', { className: 'workbench-muted', role: 'status' }, createMessage) : null,
          ),
        ),
      ),
      h('div', { className: 'workbench-investigation-context' },
        h('h3', null, 'Existing Investigations'),
        listContent,
        h('div', { className: 'workbench-investigation-selected' },
          h('h3', null, selectedInvestigation ? 'Investigation detail' : 'Selected Investigation'),
          selectedContent,
        ),
      ),
    ),
  )
}

export function ResearchWorkbench({
  executeRun = executeWorkbenchRun,
  saveRun = saveResearchRun,
  createInvestigation = createResearchInvestigationRequest,
  listInvestigations = listResearchInvestigations,
  getInvestigation = getResearchInvestigation,
  attachRun = attachResearchRunToInvestigation,
  getRun = getResearchRun,
}) {
  const actions = createWorkbenchActions({ executeRun, saveRun, createInvestigation, listInvestigations, getInvestigation, attachRun })
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
  const [savedRunId, setSavedRunId] = useState(null)
  const [investigations, setInvestigations] = useState([])
  const [investigationListLoading, setInvestigationListLoading] = useState(true)
  const [investigationListError, setInvestigationListError] = useState(null)
  const [investigationQuestion, setInvestigationQuestion] = useState('')
  const [investigationPlan, setInvestigationPlan] = useState(defaultExperimentIds)
  const [creatingInvestigation, setCreatingInvestigation] = useState(false)
  const [investigationCreateError, setInvestigationCreateError] = useState(null)
  const [investigationCreateMessage, setInvestigationCreateMessage] = useState(null)
  const [selectedInvestigationId, setSelectedInvestigationId] = useState(null)
  const [selectedInvestigation, setSelectedInvestigation] = useState(null)
  const [investigationLoading, setInvestigationLoading] = useState(false)
  const [investigationError, setInvestigationError] = useState(null)
  const [attachingRun, setAttachingRun] = useState(false)
  const [attachError, setAttachError] = useState(null)
  const [attachMessage, setAttachMessage] = useState(null)
  const [selectedInvestigationRunId, setSelectedInvestigationRunId] = useState(null)
  const [investigationDetailOpen, setInvestigationDetailOpen] = useState(false)
  const investigationLoadSequence = useRef(0)

  useEffect(() => {
    let active = true
    setInvestigationListLoading(true)
    setInvestigationListError(null)
    listInvestigations({ limit: 20, offset: 0 })
      .then((response) => {
        if (active) {
          const loaded = Array.isArray(response?.investigations) ? response.investigations : []
          const loadedIds = new Set(loaded.map((item) => item.investigationId))
          setInvestigations((current) => [...loaded, ...current.filter((item) => !loadedIds.has(item.investigationId))])
        }
      })
      .catch((error) => {
        if (active) setInvestigationListError(error.message)
      })
      .finally(() => {
        if (active) setInvestigationListLoading(false)
      })
    return () => { active = false }
  }, [listInvestigations])

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

  function toggleInvestigationExperiment(experimentId) {
    setInvestigationPlan((current) => current.includes(experimentId)
      ? current.filter((id) => id !== experimentId)
      : [...current, experimentId])
  }

  async function selectInvestigation(investigationId) {
    const loadSequence = investigationLoadSequence.current + 1
    investigationLoadSequence.current = loadSequence
    setSelectedInvestigationId(investigationId)
    setSelectedInvestigation(null)
    setSelectedInvestigationRunId(null)
    setInvestigationDetailOpen(true)
    setInvestigationError(null)
    setAttachError(null)
    setAttachMessage(null)
    setInvestigationLoading(true)
    try {
      const investigation = await actions.getInvestigation(investigationId)
      if (loadSequence !== investigationLoadSequence.current) return
      setSelectedInvestigation(investigation)
      setForm((current) => ({ ...current, requestedExperiments: investigation.requestedExperiments ?? [] }))
    } catch (error) {
      if (loadSequence === investigationLoadSequence.current) setInvestigationError(error.message)
    } finally {
      if (loadSequence === investigationLoadSequence.current) setInvestigationLoading(false)
    }
  }

  async function handleCreateInvestigation(event) {
    event.preventDefault()
    setInvestigationCreateError(null)
    setInvestigationCreateMessage(null)
    setCreatingInvestigation(true)
    try {
      const investigation = await actions.createInvestigation(investigationQuestion, investigationPlan)
      investigationLoadSequence.current += 1
      setInvestigations((current) => [investigation, ...current.filter((item) => item.investigationId !== investigation.investigationId)])
      setSelectedInvestigationId(investigation.investigationId)
      setSelectedInvestigation(investigation)
      setSelectedInvestigationRunId(null)
      setInvestigationDetailOpen(true)
      setInvestigationError(null)
      setInvestigationLoading(false)
      setForm((current) => ({ ...current, requestedExperiments: investigation.requestedExperiments ?? [] }))
      setInvestigationCreateMessage('Investigation created. Research has not been run.')
    } catch (error) {
      setInvestigationCreateError(error.message)
    } finally {
      setCreatingInvestigation(false)
    }
  }

  async function runInvestigationPlan() {
    if (!selectedInvestigation) return
    setFormError(null)
    setSaveMessage(null)
    try {
      const result = await actions.runInvestigationPlan(form, selectedInvestigation, () => {
        setRunState('running')
        setRunResult(null)
        setSavedRunId(null)
        setAttachError(null)
        setAttachMessage(null)
      })
      setRunResult(result)
      setRunState(result.status)
    } catch (error) {
      setWorkbenchRunFailure(error, setFormError, setRunState)
    }
  }

  async function handleAttachRun() {
    if (!selectedInvestigation || !savedRunId) return
    setAttachError(null)
    setAttachMessage(null)
    setAttachingRun(true)
    try {
      const investigation = await actions.attachRun(selectedInvestigation.investigationId, savedRunId)
      setSelectedInvestigation(investigation)
      setInvestigations((current) => current.map((item) => item.investigationId === investigation.investigationId ? investigation : item))
      setAttachMessage('Saved run added to this Investigation.')
    } catch (error) {
      setAttachError(error.message)
    } finally {
      setAttachingRun(false)
    }
  }

  async function submit(event) {
    setFormError(null)
    setSaveMessage(null)
    try {
      const result = await actions.submit(event, form, () => {
        setRunState('running')
        setRunResult(null)
        setSavedRunId(null)
        setAttachError(null)
        setAttachMessage(null)
      })
      setRunResult(result)
      setRunState(result.status)
    } catch (error) {
      setWorkbenchRunFailure(error, setFormError, setRunState)
    }
  }

  async function saveResult() {
    if (!runResult) return
    setSaving(true)
    setSaveMessage(null)
    try {
      const saved = await actions.save(runResult)
      if (typeof saved?.runId !== 'string' || !saved.runId) {
        setSavedRunId(null)
        setSaveMessage('Run save could not be confirmed; attachment is unavailable.')
        return
      }
      setSavedRunId(saved.runId)
      setAttachError(null)
      setAttachMessage(null)
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
        h('p', { className: 'workbench-intro' }, 'Configure and execute a registered research run. A Research Run is one saved execution of selected experiments using shared historical data.'),
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
        h('legend', null, 'Experiments', h(TermHelp, { term: 'Experiment', explanation: 'One registered research method tested during a run.' })),
        h('div', { className: 'workbench-experiment-grid' }, experiments.map((experiment) => h('label', { className: 'workbench-check', key: experiment.id },
          h('input', {
            type: 'checkbox',
            name: 'requestedExperiments',
            value: experiment.id,
            'aria-label': experiment.title,
            checked: form.requestedExperiments.includes(experiment.id),
            onChange: () => toggleExperiment(experiment.id),
          }),
          h('span', null, experiment.title, experimentExplanations[experiment.id] ? h(TermHelp, { term: experiment.title, explanation: experimentExplanations[experiment.id] }) : null),
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
    h(ResearchInvestigationPanel, {
      investigations,
      listLoading: investigationListLoading,
      listError: investigationListError,
      onSelectInvestigation: selectInvestigation,
      selectedInvestigationId,
      selectedInvestigation,
      investigationLoading,
      investigationError,
      onRunPlan: runInvestigationPlan,
      runLoading: runState === 'running',
      question: investigationQuestion,
      onQuestionChange: setInvestigationQuestion,
      requestedExperiments: investigationPlan,
      onToggleExperiment: toggleInvestigationExperiment,
      creating: creatingInvestigation,
      createError: investigationCreateError,
      createMessage: investigationCreateMessage,
      onCreate: handleCreateInvestigation,
      savedRunId,
      attaching: attachingRun,
      attachError,
      attachMessage,
      onAttachRun: handleAttachRun,
      selectedRunId: selectedInvestigationRunId,
      getRun,
      onSelectRun: setSelectedInvestigationRunId,
      onOpenDetail: () => setInvestigationDetailOpen(true),
    }),
    investigationDetailOpen && selectedInvestigation ? h(ResearchInvestigationDetail, {
      investigationId: selectedInvestigation.investigationId,
      investigation: selectedInvestigation,
      getRun,
      onClose: () => setInvestigationDetailOpen(false),
    }) : null,
  )
}