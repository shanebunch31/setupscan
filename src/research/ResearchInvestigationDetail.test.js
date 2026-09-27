import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { test } from 'node:test'
import { ResearchComparison } from './ResearchComparison.js'
import { ResearchRunDetail } from './ResearchRunDetail.js'
import {
  ResearchInvestigationDetailView,
  ResearchInvestigationRunRow,
} from './ResearchInvestigationDetail.js'
import { projectResearchInvestigationDetail } from './researchInvestigationDetailModel.js'

function findElement(element, predicate) {
  if (!React.isValidElement(element)) return null
  if (predicate(element)) return element
  for (const child of React.Children.toArray(element.props.children)) {
    const found = findElement(child, predicate)
    if (found) return found
  }
  return null
}

function investigation(overrides = {}) {
  return {
    investigationId: 'inv-detail-1',
    question: 'Does relative-value confirmation improve the baseline setup?',
    status: 'active',
    createdAt: '2026-09-20T12:00:00.000Z',
    requestedExperiments: ['relative-value', 'robustness'],
    runIds: ['run-2', 'run-1'],
    ...overrides,
  }
}

function availableReference(runId, overrides = {}) {
  return {
    runId,
    status: 'available',
    run: {
      runContext: {
        requestedAt: `2026-09-2${runId.endsWith('1') ? '1' : '2'}T00:00:00.000Z`,
        symbols: ['SPY', 'QQQ'],
        timeframe: '1Hour',
        requestedExperiments: ['relative-value', 'robustness'],
      },
      status: 'completed',
      dataset: { datasetId: `dataset-${runId}` },
      synthesis: { coverage: { evaluated: ['relative-value'] } },
    },
    ...overrides,
  }
}

function projection(runReferences = [], source = investigation({ runIds: runReferences.map((reference) => reference.runId) })) {
  return projectResearchInvestigationDetail(source, runReferences)
}

test('renders the Investigation question, status, creation time, and ordered registered experiment plan', () => {
  const html = renderToStaticMarkup(React.createElement(ResearchInvestigationDetailView, {
    projection: projection(),
  }))
  for (const value of [
    'Investigation',
    'Does relative-value confirmation improve the baseline setup?',
    'active',
    '2026-09-20T12:00:00.000Z',
    'Relative Value, Robustness',
    'An Investigation organizes a question, experiment plan, and related Research Run IDs.',
  ]) assert.ok(html.includes(value), `expected detail to include ${value}`)
})

test('renders each associated run in saved order with only projected navigation metadata', () => {
  const projected = projection([availableReference('run-2'), availableReference('run-1')])
  const html = renderToStaticMarkup(React.createElement(ResearchInvestigationDetailView, { projection: projected }))
  assert.ok(html.indexOf('run-2') < html.indexOf('run-1'))
  for (const value of ['completed', 'SPY, QQQ', '1Hour', 'dataset-run-2', 'Requested experiments', 'Evaluated experiments', 'Open run']) {
    assert.ok(html.includes(value), `expected run metadata to include ${value}`)
  }
  assert.match(html, /<summary>Run details<\/summary>/)
  assert.doesNotMatch(html, /nativePayload|nativeOutput|rawSeriesBySymbol|records|\[object Object\]/)
})

test('Open run uses the exact run ID and existing Run Detail receives no run payload', () => {
  const opened = []
  const run = projection([availableReference('saved-run-exact')]).associatedRuns[0]
  const row = ResearchInvestigationRunRow({ run, onOpenRun: (runId) => opened.push(runId) })
  const button = findElement(row, (element) => element.type === 'button')
  button.props.onClick()
  assert.deepEqual(opened, ['saved-run-exact'])

  const tree = ResearchInvestigationDetailView({
    projection: projection([availableReference('saved-run-exact')]),
    openRunId: 'saved-run-exact',
  })
  const detail = findElement(tree, (element) => element.type === ResearchRunDetail)
  assert.deepEqual(Object.keys(detail.props).sort(), ['getRun', 'runId'])
  assert.equal(detail.props.runId, 'saved-run-exact')
})

test('one available associated run does not expose comparison controls', () => {
  const tree = ResearchInvestigationDetailView({
    projection: projection([availableReference('run-1')]),
  })
  const html = renderToStaticMarkup(tree)
  assert.match(html, /Comparison requires two associated saved runs/)
  assert.equal(findElement(tree, (element) => element.type === ResearchComparison), null)
})

test('two available associated runs reuse ResearchComparison with only associated metadata and do not compare automatically', () => {
  let compareCalls = 0
  const compareRuns = async () => { compareCalls += 1; return {} }
  const tree = ResearchInvestigationDetailView({
    projection: projection([availableReference('run-2'), availableReference('run-1')]),
    compareRuns,
  })
  const comparison = findElement(tree, (element) => element.type === ResearchComparison)
  assert.ok(comparison)
  assert.deepEqual(comparison.props.runs.map((run) => run.runId), ['run-2', 'run-1'])
  assert.equal(comparison.props.preventDuplicateSelection, true)
  assert.equal(comparison.props.compareRuns, compareRuns)
  assert.deepEqual(Object.keys(comparison.props.runs[0]).sort(), [
    'datasetId', 'evaluatedExperiments', 'requestedAt', 'requestedExperiments', 'runId', 'status', 'symbols', 'timeframe',
  ])
  assert.equal(compareCalls, 0)
})

test('missing and unavailable associated runs stay visible and have explicit states', () => {
  const projected = projection([
    { runId: 'deleted-run', status: 'missing', error: 'Research run was not found.' },
    { runId: 'offline-run', status: 'unavailable', error: 'History service unavailable.' },
  ])
  const html = renderToStaticMarkup(React.createElement(ResearchInvestigationDetailView, { projection: projected }))
  assert.match(html, /deleted-run/)
  assert.match(html, /Associated run no longer exists/)
  assert.match(html, /offline-run/)
  assert.match(html, /Associated run metadata unavailable/)
})

test('empty, loading, not-found, investigation error, and associated-run loading states are explicit', () => {
  const noSelection = renderToStaticMarkup(React.createElement(ResearchInvestigationDetailView))
  assert.match(noSelection, /Select an Investigation/)

  const empty = renderToStaticMarkup(React.createElement(ResearchInvestigationDetailView, {
    projection: projection([], investigation({ runIds: [] })),
  }))
  assert.match(empty, /no associated saved runs/)

  const loading = renderToStaticMarkup(React.createElement(ResearchInvestigationDetailView, {
    investigationId: 'inv-loading', investigationLoading: true,
  }))
  assert.match(loading, /Loading Investigation/)

  const missing = renderToStaticMarkup(React.createElement(ResearchInvestigationDetailView, { investigationId: 'inv-missing' }))
  assert.match(missing, /Investigation not found/)

  const error = renderToStaticMarkup(React.createElement(ResearchInvestigationDetailView, {
    investigationId: 'inv-error', investigationLoading: true, investigationError: 'Investigation storage unavailable.',
  }))
  assert.match(error, /Investigation storage unavailable/)
  assert.doesNotMatch(error, /Loading Investigation/)

  const runLoading = renderToStaticMarkup(React.createElement(ResearchInvestigationDetailView, {
    projection: projection([{
      runId: 'run-loading', status: 'loading', error: null,
    }]),
    runsLoading: true,
  }))
  assert.match(runLoading, /Loading associated runs/)
  assert.match(runLoading, /Loading saved run metadata/)
})