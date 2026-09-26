import React, { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, LoaderCircle, Search } from 'lucide-react'
import { listResearchExperiments } from './registry.js'
import { createResearchHistoryActions, createResearchHistoryPage, normalizeResearchHistoryFilters, RESEARCH_HISTORY_PAGE_SIZE } from './researchHistoryModel.js'
import { getResearchRun } from './researchRunHistory.js'
import { ResearchRunDetail } from './ResearchRunDetail.js'

const h = React.createElement
const experiments = listResearchExperiments()
const EMPTY_FILTERS = { status: '', datasetId: '', symbols: '', experimentId: '' }

export function ResearchHistoryTable({ runs, selectedRunId, onSelectRun }) {
  if (!runs.length) return h('p', { className: 'workbench-muted research-history-empty' }, 'No research runs match these filters.')
  return h('div', { className: 'research-history-table-wrap' },
    h('table', { className: 'research-history-table' },
      h('thead', null,
        h('tr', null,
          ...['Run ID', 'Requested', 'Status', 'Symbols', 'Timeframe', 'Dataset', 'Experiments', ''].map((label) => h('th', { key: label }, label)),
        ),
      ),
      h('tbody', null, runs.map((run) => h('tr', { key: run.runId, className: selectedRunId === run.runId ? 'research-history-selected' : undefined },
        h('td', { className: 'research-history-run-id' }, run.runId),
        h('td', null, run.requestedAt ? h('time', { dateTime: run.requestedAt }, run.requestedAt) : '—'),
        h('td', null, h('span', { className: `workbench-status-label workbench-status-${run.status}` }, run.status ?? 'Unknown')),
        h('td', null, (run.symbols ?? []).join(', ') || '—'),
        h('td', null, run.timeframe ?? '—'),
        h('td', { className: 'research-history-dataset-id' }, run.datasetId ?? '—'),
        h('td', null, (run.requestedExperiments ?? []).join(', ') || 'None'),
        h('td', null, h('button', {
          type: 'button',
          className: 'research-history-select',
          'aria-label': `View details for ${run.runId}`,
          'aria-pressed': selectedRunId === run.runId,
          onClick: () => onSelectRun(run.runId),
        }, 'View')),
      ))),
    ),
  )
}

export function ResearchHistoryPagination({ offset, rowCount, hasNext, loading, onPrevious, onNext }) {
  return h('nav', { className: 'research-history-pagination', 'aria-label': 'Research history pages' },
    h('button', { type: 'button', className: 'workbench-secondary', 'aria-label': 'Previous page', disabled: offset === 0 || loading, onClick: onPrevious }, h(ChevronLeft, { size: 15, 'aria-hidden': true }), 'Previous'),
    h('span', { className: 'workbench-muted' }, `Rows ${rowCount ? offset + 1 : 0}–${rowCount ? offset + rowCount : 0}`),
    h('button', { type: 'button', className: 'workbench-secondary', 'aria-label': 'Next page', disabled: !hasNext || loading, onClick: onNext }, 'Next', h(ChevronRight, { size: 15, 'aria-hidden': true })),
  )
}

export function ResearchHistory({ listRuns, getRun = getResearchRun, onSelectRun, initialSelectedRunId = null }) {
  const [filterDraft, setFilterDraft] = useState(EMPTY_FILTERS)
  const [filters, setFilters] = useState({})
  const [offset, setOffset] = useState(0)
  const [runs, setRuns] = useState([])
  const [hasNext, setHasNext] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedRunId, setSelectedRunId] = useState(initialSelectedRunId)
  const [selectedRun, setSelectedRun] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState(null)
  const actions = createResearchHistoryActions({ listRuns, getRun })

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    setHasNext(false)
    actions.list(filters, offset)
      .then((response) => {
        if (!active) return
        const pageRuns = Array.isArray(response?.runs) ? response.runs : []
        const page = createResearchHistoryPage(offset, pageRuns)
        setRuns(page.rows)
        setHasNext(page.hasNext)
      })
      .catch((loadError) => {
        if (active) setError(loadError.message)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [filters, offset, listRuns])

  function applyFilters(event) {
    event.preventDefault()
    setOffset(0)
    setFilters(normalizeResearchHistoryFilters(filterDraft))
  }

  async function selectRun(runId) {
    setSelectedRunId(runId)
    setSelectedRun(null)
    setDetailLoading(true)
    setDetailError(null)
    try {
      const result = await actions.getRun(runId)
      setSelectedRun(result)
      onSelectRun?.(runId, result)
    } catch (loadError) {
      setDetailError(loadError.message)
    } finally {
      setDetailLoading(false)
    }
  }

  function updateFilter(field, value) {
    setFilterDraft((current) => ({ ...current, [field]: value }))
  }

  return h('section', { className: 'research-history', 'aria-labelledby': 'research-history-title' },
    h('header', { className: 'research-history-heading' },
      h('div', null,
        h('p', { className: 'workbench-eyebrow' }, 'RESEARCH RUNS'),
        h('h2', { id: 'research-history-title' }, 'History'),
      ),
      loading ? h('span', { className: 'workbench-muted', role: 'status' }, h(LoaderCircle, { size: 15, className: 'workbench-spinner', 'aria-hidden': true }), ' Loading runs') : null,
    ),
    h('form', { className: 'research-history-filters', onSubmit: applyFilters },
      h('label', null,
        h('span', null, 'Status'),
        h('select', { value: filterDraft.status, onChange: (event) => updateFilter('status', event.target.value), 'aria-label': 'History status' },
          h('option', { value: '' }, 'All statuses'),
          ...['completed', 'partial', 'unavailable', 'failed'].map((status) => h('option', { key: status, value: status }, status)),
        ),
      ),
      h('label', null, h('span', null, 'Dataset ID'), h('input', { value: filterDraft.datasetId, onChange: (event) => updateFilter('datasetId', event.target.value), 'aria-label': 'Filter by dataset ID' })),
      h('label', null, h('span', null, 'Symbols'), h('input', { value: filterDraft.symbols, onChange: (event) => updateFilter('symbols', event.target.value), placeholder: 'SPY, QQQ', 'aria-label': 'Filter by symbols' })),
      h('label', null,
        h('span', null, 'Experiment'),
        h('select', { value: filterDraft.experimentId, onChange: (event) => updateFilter('experimentId', event.target.value), 'aria-label': 'Filter by experiment' },
          h('option', { value: '' }, 'All experiments'),
          ...experiments.map((experiment) => h('option', { key: experiment.id, value: experiment.id }, experiment.title)),
        ),
      ),
      h('button', { className: 'workbench-primary', type: 'submit' }, h(Search, { size: 14, 'aria-hidden': true }), 'Apply filters'),
    ),
    error ? h('p', { className: 'research-history-error', role: 'alert' }, error) : null,
    !loading && !error ? h(ResearchHistoryTable, { runs, selectedRunId, onSelectRun: selectRun }) : null,
    h(ResearchHistoryPagination, {
      offset,
      rowCount: runs.length,
      hasNext,
      loading,
      onPrevious: () => setOffset(Math.max(0, offset - RESEARCH_HISTORY_PAGE_SIZE)),
      onNext: () => setOffset(offset + RESEARCH_HISTORY_PAGE_SIZE),
    }),
    selectedRunId ? h(ResearchRunDetail, { runId: selectedRunId, run: selectedRun, loading: detailLoading, error: detailError, getRun }) : null,
  )
}