import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { test } from 'node:test'
import { ResearchHistoryPagination, ResearchHistoryTable } from './ResearchHistory.js'
import {
  createResearchHistoryActions,
  createResearchHistoryPage,
  normalizeResearchHistoryFilters,
  RESEARCH_HISTORY_PAGE_SIZE,
} from './researchHistoryModel.js'

test('history passes supported filters and server limit/offset values to listResearchRuns', async () => {
  const requests = []
  const actions = createResearchHistoryActions({
    listRuns: async (filters) => {
      requests.push(filters)
      return { runs: [] }
    },
    getRun: async () => null,
  })
  const filters = normalizeResearchHistoryFilters({
    status: 'partial', datasetId: ' dataset-7 ', symbols: ' spy, QQQ,SPY ', experimentId: 'relative-value',
  })
  await actions.list(filters, 40)
  assert.deepEqual(requests, [{
    status: 'partial', datasetId: 'dataset-7', symbols: ['SPY', 'QQQ'], experimentId: 'relative-value',
    limit: RESEARCH_HISTORY_PAGE_SIZE + 1, offset: 40,
  }])
})

test('history uses one-row lookahead to enable Next only when a following row exists', () => {
  assert.equal(RESEARCH_HISTORY_PAGE_SIZE, 20)
  const terminalPage = createResearchHistoryPage(0, Array.from({ length: 20 }, (_, index) => ({ runId: `run-${index}` })))
  assert.equal(terminalPage.rows.length, 20)
  assert.equal(terminalPage.hasNext, false)
  assert.equal(terminalPage.nextOffset, null)

  const pageWithLookahead = createResearchHistoryPage(0, Array.from({ length: 21 }, (_, index) => ({ runId: `run-${index}` })))
  assert.equal(pageWithLookahead.rows.length, 20)
  assert.equal(pageWithLookahead.rows.at(-1).runId, 'run-19')
  assert.equal(pageWithLookahead.hasNext, true)
  assert.equal(pageWithLookahead.nextOffset, 20)
  assert.equal(pageWithLookahead.rows.some((run) => run.runId === 'run-20'), false)
})

test('advancing a filtered history page preserves filters and uses the next server offset', async () => {
  const requests = []
  const actions = createResearchHistoryActions({ listRuns: async (filters) => {
    requests.push(filters)
    return { runs: [] }
  } })
  const filters = { status: 'partial', datasetId: 'dataset-7', symbols: ['SPY'], experimentId: 'robustness' }
  await actions.list(filters, 0)
  const nextPage = createResearchHistoryPage(0, Array.from({ length: 21 }, (_, index) => ({ runId: `run-${index}` })))
  await actions.list(filters, nextPage.nextOffset)
  assert.deepEqual(requests, [
    { ...filters, limit: RESEARCH_HISTORY_PAGE_SIZE + 1, offset: 0 },
    { ...filters, limit: RESEARCH_HISTORY_PAGE_SIZE + 1, offset: 20 },
  ])
})

function findElement(element, predicate) {
  if (!React.isValidElement(element)) return null
  if (predicate(element)) return element
  for (const child of React.Children.toArray(element.props.children)) {
    const found = findElement(child, predicate)
    if (found) return found
  }
  return null
}

test('selecting a history run requests its persisted detail by the exact run ID', async () => {
  const requestedIds = []
  const actions = createResearchHistoryActions({
    listRuns: async () => ({ runs: [] }),
    getRun: async (runId) => {
      requestedIds.push(runId)
      return { runContext: { runId } }
    },
  })
  assert.deepEqual(await actions.getRun('run/with spaces'), { runContext: { runId: 'run/with spaces' } })
  assert.deepEqual(requestedIds, ['run/with spaces'])
})

test('actual history row click passes its runId into the detail-selection action', async () => {
  const requestedIds = []
  const actions = createResearchHistoryActions({
    listRuns: async () => ({ runs: [] }),
    getRun: async (runId) => {
      requestedIds.push(runId)
      return { runContext: { runId } }
    },
  })
  let selectedRunId = null
  const table = ResearchHistoryTable({
    runs: [{ runId: 'persisted-run-42', symbols: ['SPY'], requestedExperiments: [] }],
    selectedRunId: null,
    onSelectRun: async (runId) => {
      selectedRunId = runId
      return actions.getRun(runId)
    },
  })
  const viewButton = findElement(table, (element) => element.type === 'button')
  assert.ok(viewButton)
  await viewButton.props.onClick()
  assert.equal(selectedRunId, 'persisted-run-42')
  assert.deepEqual(requestedIds, ['persisted-run-42'])
})

test('history renders persisted run rows without ranking or scoring', () => {
  const html = renderToStaticMarkup(React.createElement(ResearchHistoryTable, {
    runs: [{
      runId: 'run-history-1',
      requestedAt: '2026-09-20T12:30:00.000Z',
      status: 'partial',
      symbols: ['SPY', 'QQQ'],
      timeframe: '1Hour',
      datasetId: 'dataset-history-1',
      requestedExperiments: ['robustness', 'relative-value'],
    }],
    selectedRunId: null,
    onSelectRun: () => {},
  }))
  for (const text of ['run-history-1', '2026-09-20T12:30:00.000Z', 'partial', 'SPY, QQQ', '1Hour', 'dataset-history-1', 'robustness, relative-value']) {
    assert.ok(html.includes(text), `expected history row to include ${text}`)
  }
  assert.match(html, /View details for run-history-1/)
  assert.doesNotMatch(html, /rank|score|recommendation/i)
})

test('history pagination control disables Next for a terminal 20-row page and enables it with lookahead', () => {
  const terminal = createResearchHistoryPage(0, Array.from({ length: 20 }, (_, index) => ({ runId: `run-${index}` })))
  const hasMore = createResearchHistoryPage(0, Array.from({ length: 21 }, (_, index) => ({ runId: `run-${index}` })))
  const terminalNav = ResearchHistoryPagination({ offset: 0, rowCount: terminal.rows.length, hasNext: terminal.hasNext, loading: false })
  const hasMoreNav = ResearchHistoryPagination({ offset: 0, rowCount: hasMore.rows.length, hasNext: hasMore.hasNext, loading: false })
  const terminalNext = findElement(terminalNav, (element) => element.type === 'button' && element.props['aria-label'] === 'Next page')
  const hasMoreNext = findElement(hasMoreNav, (element) => element.type === 'button' && element.props['aria-label'] === 'Next page')
  assert.equal(terminalNext.props.disabled, true)
  assert.equal(hasMoreNext.props.disabled, false)
})

test('history actions are read-only list/detail client calls', async () => {
  const calls = []
  const actions = createResearchHistoryActions({
    listRuns: async () => { calls.push('list'); return { runs: [] } },
    getRun: async () => { calls.push('detail'); return null },
  })
  await actions.list()
  await actions.getRun('run-read-only')
  assert.deepEqual(calls, ['list', 'detail'])
  assert.deepEqual(Object.keys(actions).sort(), ['getRun', 'list'])
})