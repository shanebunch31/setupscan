import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { test } from 'node:test'
import { ResearchComparison } from './ResearchComparison.js'
import { ResearchHistory, ResearchHistoryTable } from './ResearchHistory.js'
import { ResearchWorkbench } from './ResearchWorkbench.js'
import { projectResearchComparisonRuns, ResearchWorkspace } from './ResearchWorkspace.js'

function findElement(element, predicate) {
  if (!React.isValidElement(element)) return null
  if (predicate(element)) return element
  for (const child of React.Children.toArray(element.props.children)) {
    const found = findElement(child, predicate)
    if (found) return found
  }
  return null
}

function elementText(element) {
  if (typeof element === 'string' || typeof element === 'number') return String(element)
  if (Array.isArray(element)) return element.map(elementText).join(' ')
  if (!React.isValidElement(element)) return ''
  return elementText(element.props.children)
}

const runs = [
  { runId: 'saved-run-a', requestedAt: '2026-09-20T00:00:00Z', status: 'completed', symbols: ['SPY'], timeframe: '1Hour', datasetId: 'dataset-a' },
  { runId: 'saved-run-b', requestedAt: '2026-09-21T00:00:00Z', status: 'partial', symbols: ['QQQ'], timeframe: '1Hour', datasetId: 'dataset-b' },
]

test('research workspace offers the four nested destinations and routes nav clicks without run/save calls', () => {
  const destinations = []
  let runCalls = 0
  let saveCalls = 0
  const tree = ResearchWorkspace({
    activeView: 'workbench',
    onNavigate: (destination) => destinations.push(destination),
    workbenchProps: {
      executeRun: () => { runCalls += 1 },
      saveRun: () => { saveCalls += 1 },
    },
  })
  const html = renderToStaticMarkup(tree)
  for (const label of ['Research Workbench', 'Run History', 'Compare Runs', 'Labs']) assert.ok(html.includes(label))
  assert.match(html, /Research Workbench/)

  const historyButton = findElement(tree, (element) => element.type === 'button' && elementText(element).trim() === 'Run History')
  const labsButton = findElement(tree, (element) => element.type === 'button' && elementText(element).trim() === 'Labs')
  historyButton.props.onClick()
  labsButton.props.onClick()
  assert.deepEqual(destinations, ['history', 'labs'])
  assert.equal(runCalls, 0)
  assert.equal(saveCalls, 0)
})

test('History row selection reaches the workspace and restores the exact run ID on return', async () => {
  let selectedRunId = null
  const onRunSelected = (runId) => { selectedRunId = runId }
  const tree = ResearchWorkspace({ activeView: 'history', onRunSelected })
  const historyElement = findElement(tree, (element) => element.type === ResearchHistory)
  assert.ok(historyElement)
  assert.equal(historyElement.props.initialSelectedRunId, null)
  assert.equal(historyElement.props.onSelectRun, onRunSelected)

  const table = ResearchHistoryTable({
    runs: [{ runId: 'run/id-preserved', symbols: ['SPY'], requestedExperiments: [] }],
    selectedRunId: null,
    onSelectRun: historyElement.props.onSelectRun,
  })
  const viewButton = findElement(table, (element) => element.type === 'button')
  await viewButton.props.onClick()
  assert.equal(selectedRunId, 'run/id-preserved')

  const returnedTree = ResearchWorkspace({ activeView: 'history', selectedRunId, onRunSelected })
  const returnedHistory = findElement(returnedTree, (element) => element.type === ResearchHistory)
  assert.equal(returnedHistory.props.initialSelectedRunId, 'run/id-preserved')
  const html = renderToStaticMarkup(returnedTree)
  assert.match(html, /History/)
  assert.match(html, /Run detail/)
})

test('Comparison destination renders ResearchComparison with projected persisted run metadata and no automatic compare', () => {
  let compareCalls = 0
  const comparisonProps = { compareRuns: async () => { compareCalls += 1; return {} } }
  const tree = ResearchWorkspace({
    activeView: 'comparison',
    runs: projectResearchComparisonRuns(runs),
    comparisonProps,
  })
  const comparisonElement = findElement(tree, (element) => element.type === ResearchComparison)
  assert.ok(comparisonElement)
  assert.deepEqual(comparisonElement.props.runs, projectResearchComparisonRuns(runs))
  const html = renderToStaticMarkup(tree)
  assert.match(html, /Compare research runs/)
  assert.match(html, /saved-run-a/)
  assert.match(html, /saved-run-b/)
  assert.equal(compareCalls, 0)
})

test('Labs destination renders the existing Labs subtree', () => {
  const html = renderToStaticMarkup(ResearchWorkspace({
    activeView: 'labs',
    existingLabs: React.createElement('section', { id: 'existing-native-labs' }, 'Strategy Robustness Lab'),
  }))
  assert.match(html, /existing-native-labs/)
  assert.match(html, /Strategy Robustness Lab/)
  assert.match(html, /Research Workbench/)
})

test('comparison navigation projection excludes native and raw payload fields', () => {
  const [projected] = projectResearchComparisonRuns([{
    ...runs[0],
    rawSeriesBySymbol: { SPY: [{ close: 100 }] },
    nativeOutput: { raw: true },
    nativePayload: { raw: true },
  }])
  assert.deepEqual(Object.keys(projected).sort(), ['datasetId', 'requestedAt', 'runId', 'status', 'symbols', 'timeframe'])
  assert.doesNotMatch(JSON.stringify(projected), /rawSeriesBySymbol|nativeOutput|nativePayload/)
})

test('available view elements are the existing standalone components', () => {
  const workbench = findElement(ResearchWorkspace({ activeView: 'workbench' }), (element) => element.type === ResearchWorkbench)
  const history = findElement(ResearchWorkspace({ activeView: 'history' }), (element) => element.type === ResearchHistory)
  const comparison = findElement(ResearchWorkspace({ activeView: 'comparison', runs }), (element) => element.type === ResearchComparison)
  assert.ok(workbench)
  assert.ok(history)
  assert.ok(comparison)
})