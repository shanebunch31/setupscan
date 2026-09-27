import React, { useEffect, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { listResearchExperiments } from './registry.js'
import { getResearchInvestigation } from './researchInvestigationHistory.js'
import { getResearchRun } from './researchRunHistory.js'
import { compareResearchRuns } from './researchRunHistory.js'
import { TermHelp } from '../TermHelp.js'
import { ResearchComparison } from './ResearchComparison.js'
import { ResearchRunDetail } from './ResearchRunDetail.js'
import {
  loadInvestigationRunMetadata,
  projectResearchInvestigationDetail,
} from './researchInvestigationDetailModel.js'

const h = React.createElement
const experimentTitles = new Map(listResearchExperiments().map((experiment) => [experiment.id, experiment.title]))

function displayDate(value) {
  return typeof value === 'string' && value ? value : 'Unavailable'
}

function fieldValue(value) {
  if (Array.isArray(value)) return value.length ? value.join(', ') : 'None'
  return value ?? 'Unavailable'
}

function runMetadata(run) {
  const metadata = run.metadata ?? {}
  return h('dl', { className: 'investigation-detail-run-metadata' },
    ...[
      ['Requested at', displayDate(metadata.requestedAt)],
      ['Status', fieldValue(metadata.status)],
      ['Symbols', fieldValue(metadata.symbols)],
      ['Timeframe', fieldValue(metadata.timeframe)],
      ['Dataset ID', fieldValue(metadata.datasetId)],
      ['Requested experiments', Array.isArray(metadata.requestedExperiments) ? fieldValue(metadata.requestedExperiments.map((id) => experimentTitles.get(id) ?? id)) : 'Unavailable'],
      ['Evaluated experiments', Array.isArray(metadata.evaluatedExperiments) ? fieldValue(metadata.evaluatedExperiments.map((id) => experimentTitles.get(id) ?? id)) : 'Unavailable'],
    ].map(([label, value]) => h('div', { key: label }, h('dt', null, label), h('dd', null, value))),
  )
}

function runStateMessage(run) {
  if (run.metadataStatus === 'loading') return 'Loading saved run metadata.'
  if (run.metadataStatus === 'missing') return `Associated run no longer exists. ${run.error ?? ''}`.trim()
  if (run.metadataStatus === 'unavailable') return `Associated run metadata unavailable. ${run.error ?? ''}`.trim()
  return null
}

export function ResearchInvestigationRunRow({ run, onOpenRun = () => {} }) {
  return h('li', null,
    h('div', { className: 'research-investigation-run-heading' },
      h('h4', null, run.runId),
      h('button', { type: 'button', className: 'research-history-select', onClick: () => onOpenRun(run.runId) }, 'Open run'),
    ),
    run.metadataStatus === 'available'
      ? h(React.Fragment, null,
        h('p', { className: 'workbench-muted' }, `${run.metadata?.status ?? 'Status unavailable'} · ${displayDate(run.metadata?.requestedAt)}`),
        h('details', { className: 'research-investigation-run-details' },
          h('summary', null, 'Run details'),
          runMetadata(run),
        ),
      )
      : h('p', { className: run.metadataStatus === 'missing' || run.metadataStatus === 'unavailable' ? 'research-detail-error' : 'workbench-muted', role: run.metadataStatus === 'missing' || run.metadataStatus === 'unavailable' ? 'alert' : 'status' }, runStateMessage(run)),
  )
}

export function ResearchInvestigationDetailView({
  investigationId = null,
  investigationLoading = false,
  investigationError = null,
  projection = null,
  runsLoading = false,
  runsError = null,
  openRunId = null,
  getRun = getResearchRun,
  compareRuns = compareResearchRuns,
  onOpenRun = () => {},
  onClose = null,
}) {
  const availableRuns = (projection?.associatedRuns ?? [])
    .filter((run) => run.metadataStatus === 'available')
    .map((run) => ({ runId: run.runId, ...run.metadata }))

  return h('section', { className: 'research-investigation-detail', 'aria-labelledby': 'research-investigation-detail-title' },
    h('header', { className: 'research-investigation-detail-heading' },
      h('div', null,
        h('p', { className: 'workbench-eyebrow' }, 'RESEARCH ORGANIZATION'),
        h('h2', { id: 'research-investigation-detail-title' }, 'Investigation'),
      ),
      onClose ? h('button', { type: 'button', className: 'research-history-select', onClick: onClose }, 'Close Investigation Detail') : null,
    ),
    investigationError
      ? h('p', { className: 'research-detail-error', role: 'alert' }, investigationError)
      : investigationLoading
        ? h('p', { className: 'workbench-muted', role: 'status' }, h(LoaderCircle, { size: 15, className: 'workbench-spinner', 'aria-hidden': true }), ' Loading Investigation')
        : !projection
          ? h('p', { className: 'workbench-muted' }, investigationId ? 'Investigation not found.' : 'Select an Investigation to view its evidence workspace.')
          : h(React.Fragment, null,
            h('div', { className: 'research-investigation-detail-context' },
              h('h3', null, projection.question ?? 'Question unavailable'),
              h('p', { className: 'workbench-muted' }, 'An Investigation organizes a question, experiment plan, and related Research Run IDs. Detailed evidence stays with each run.'),
              h('dl', { className: 'research-investigation-detail-metadata' },
                ...[
                  ['Status', projection.status ?? 'Unavailable'],
                  ['Created', displayDate(projection.createdAt)],
                  ['Experiment plan', h(React.Fragment, null, projection.requestedExperiments.map((id) => experimentTitles.get(id) ?? id).join(', ') || 'None', h(TermHelp, { term: 'Experiment plan', explanation: 'The experiments selected for this question.' }))],
                  ['Associated runs', String(projection.associatedRuns.length)],
                ].map(([label, value]) => h('div', { key: label }, h('dt', null, label), h('dd', null, value))),
              ),
            ),
            h('section', { className: 'research-investigation-detail-runs', 'aria-labelledby': 'investigation-associated-runs-title' },
              h('h3', { id: 'investigation-associated-runs-title' }, 'Associated Research Runs'),
              runsError ? h('p', { className: 'research-detail-error', role: 'alert' }, runsError) : null,
              runsLoading && !runsError ? h('p', { className: 'workbench-muted', role: 'status' }, h(LoaderCircle, { size: 14, className: 'workbench-spinner', 'aria-hidden': true }), ' Loading associated runs') : null,
              !runsLoading && !projection.associatedRuns.length ? h('p', { className: 'workbench-muted' }, 'This Investigation has no associated saved runs.') : null,
              h('ul', { className: 'research-investigation-run-list' }, projection.associatedRuns.map((run) => h(ResearchInvestigationRunRow, {
                key: run.runId,
                run,
                onOpenRun,
              }))),
            ),
            openRunId ? h('section', { className: 'research-investigation-open-run', 'aria-label': `Run detail ${openRunId}` },
              h(ResearchRunDetail, { runId: openRunId, getRun }),
            ) : null,
            availableRuns.length < 2
              ? h('section', { className: 'research-investigation-comparison' },
                h('h3', null, 'Compare associated runs'),
                h('p', { className: 'workbench-muted' }, 'Comparison requires two associated saved runs with available metadata.'),
              )
              : h('section', { className: 'research-investigation-comparison', 'aria-label': 'Compare associated Research Runs' },
                h('h3', null, 'Compare associated runs'),
                h(ResearchComparison, { runs: availableRuns, compareRuns, preventDuplicateSelection: true }),
              ),
          ),
  )
}

export function ResearchInvestigationDetail({
  investigationId = null,
  investigation: providedInvestigation = null,
  getInvestigation = getResearchInvestigation,
  getRun = getResearchRun,
  compareRuns = compareResearchRuns,
  onClose = null,
}) {
  const [loadedInvestigation, setLoadedInvestigation] = useState(null)
  const [investigationLoading, setInvestigationLoading] = useState(Boolean(investigationId && !providedInvestigation))
  const [investigationError, setInvestigationError] = useState(null)
  const [runReferences, setRunReferences] = useState([])
  const [runsLoading, setRunsLoading] = useState(false)
  const [runsError, setRunsError] = useState(null)
  const [openRunId, setOpenRunId] = useState(null)

  useEffect(() => {
    if (providedInvestigation) {
      setLoadedInvestigation(null)
      setInvestigationError(null)
      setInvestigationLoading(false)
      return undefined
    }
    if (!investigationId) {
      setLoadedInvestigation(null)
      setInvestigationError(null)
      setInvestigationLoading(false)
      return undefined
    }

    let active = true
    setLoadedInvestigation(null)
    setInvestigationError(null)
    setInvestigationLoading(true)
    getInvestigation(investigationId)
      .then((result) => {
        if (active) setLoadedInvestigation(result)
      })
      .catch((error) => {
        if (active) setInvestigationError(error.message)
      })
      .finally(() => {
        if (active) setInvestigationLoading(false)
      })
    return () => { active = false }
  }, [investigationId, providedInvestigation, getInvestigation])

  const investigation = providedInvestigation ?? loadedInvestigation

  useEffect(() => {
    if (!investigation) {
      setRunReferences([])
      setRunsError(null)
      setRunsLoading(false)
      return undefined
    }
    let active = true
    setRunReferences([])
    setRunsError(null)
    setRunsLoading(true)
    loadInvestigationRunMetadata(investigation, getRun)
      .then((references) => {
        if (active) setRunReferences(references)
      })
      .catch((error) => {
        if (active) setRunsError(error.message)
      })
      .finally(() => {
        if (active) setRunsLoading(false)
      })
    return () => { active = false }
  }, [investigation, getRun])

  const projection = projectResearchInvestigationDetail(investigation, runReferences)
  return h(ResearchInvestigationDetailView, {
    investigationId,
    investigationLoading,
    investigationError,
    projection: investigation ? projection : null,
    runsLoading,
    runsError,
    openRunId,
    getRun,
    compareRuns,
    onOpenRun: setOpenRunId,
    onClose,
  })
}