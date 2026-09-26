import React from 'react'
import { ResearchComparison } from './ResearchComparison.js'
import { ResearchHistory } from './ResearchHistory.js'
import { ResearchWorkbench } from './ResearchWorkbench.js'

const h = React.createElement

const researchViews = [
  { id: 'workbench', label: 'Research Workbench' },
  { id: 'history', label: 'Run History' },
  { id: 'comparison', label: 'Compare Runs' },
  { id: 'labs', label: 'Labs' },
]

export function projectResearchComparisonRuns(runs) {
  if (!Array.isArray(runs)) return []
  return runs.map((run) => ({
    runId: run.runId,
    requestedAt: run.requestedAt,
    status: run.status,
    symbols: Array.isArray(run.symbols) ? [...run.symbols] : [],
    timeframe: run.timeframe,
    datasetId: run.datasetId ?? null,
  }))
}

export function ResearchWorkspace({
  activeView = 'labs',
  onNavigate = () => {},
  existingLabs = null,
  selectedRunId = null,
  onRunSelected = () => {},
  runs = [],
  comparisonRunsLoading = false,
  comparisonRunsError = null,
  workbenchProps = {},
  historyProps = {},
  comparisonProps = {},
}) {
  let content = existingLabs
  if (activeView === 'workbench') content = h(ResearchWorkbench, workbenchProps)
  if (activeView === 'history') content = h(ResearchHistory, {
    ...historyProps,
    initialSelectedRunId: selectedRunId,
    onSelectRun: onRunSelected,
  })
  if (activeView === 'comparison') {
    content = comparisonRunsError
      ? h('section', { className: 'research-placeholder', role: 'alert' }, h('p', null, comparisonRunsError))
      : comparisonRunsLoading
        ? h('section', { className: 'research-placeholder', role: 'status' }, h('p', null, 'Loading saved research runs…'))
        : h(ResearchComparison, { ...comparisonProps, runs })
  }

  return h(React.Fragment, null,
    h('nav', { className: 'research-subnav', 'aria-label': 'Research workspace views' }, researchViews.map((item) => h('button', {
      key: item.id,
      type: 'button',
      className: `research-tab ${activeView === item.id ? 'active' : ''}`,
      'aria-current': activeView === item.id ? 'page' : undefined,
      onClick: () => onNavigate(item.id),
    }, item.label))),
    content,
  )
}