import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { test } from 'node:test'
import { listResearchExperiments } from './registry.js'
import {
  createWorkbenchActions,
  ResearchWorkbench,
  RunResultSummary,
  RunStateStatus,
} from './ResearchWorkbench.js'

function completedResult() {
  return {
    runContext: { runId: 'run-boundary-1', requestedExperiments: ['robustness'] },
    status: 'completed',
    fetchStatus: 'complete',
    fetchIssues: [],
    dataset: {
      datasetId: 'dataset-boundary-1',
      rawSeriesBySymbol: { SPY: [{ close: 'RAW_CANDLE_PAYLOAD_MARKER' }] },
    },
    experimentResults: [{
      experimentId: 'robustness',
      status: 'succeeded',
      nativeOutput: { secret: 'RAW_NATIVE_OUTPUT_MARKER' },
      error: null,
    }],
    synthesis: {
      coverage: { requested: ['robustness'], evaluated: ['robustness'] },
      strategyGroups: [],
      conflicts: [],
      unresolvedQuestions: [],
      compatibilityNotes: [],
    },
  }
}

test('new-run form renders the registered experiment catalogue and configuration controls', () => {
  const html = renderToStaticMarkup(React.createElement(ResearchWorkbench))
  assert.match(html, /Research Workbench/)
  assert.match(html, /aria-label="Symbols"/)
  assert.match(html, /aria-label="Timeframe"/)
  assert.match(html, /aria-label="Start date"/)
  assert.match(html, /aria-label="End date"/)
  listResearchExperiments().forEach(({ title, id }) => {
    assert.match(html, new RegExp(`>${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}<`))
    assert.match(html, new RegExp(`name="${id}"|value="${id}"|${id}`))
  })
  assert.match(html, /Run research/)
  assert.doesNotMatch(html, /Save run/)
})

test('rendering the Workbench does not execute a research run', () => {
  let executionCount = 0
  const executeRun = () => { executionCount += 1 }
  renderToStaticMarkup(React.createElement(ResearchWorkbench, { executeRun }))
  assert.equal(executionCount, 0)
})

test('valid form submission delegates the normalized Research Run request to the injected executor', async () => {
  const calls = []
  const actions = createWorkbenchActions({ executeRun: async (request) => {
    calls.push(request)
    return { status: 'completed' }
  } })
  let prevented = false
  const form = {
    symbols: ' spy, QQQ, SPY ',
    timeframe: '1Hour',
    requestedStart: '2025-02-01',
    requestedEnd: '2025-03-01',
    requestedExperiments: ['robustness', 'relative-value'],
  }
  await actions.submit({ preventDefault: () => { prevented = true } }, form)
  assert.equal(prevented, true)
  assert.deepEqual(calls, [{
    symbols: ['SPY', 'QQQ'],
    timeframe: '1Hour',
    requestedStart: '2025-02-01',
    requestedEnd: '2025-03-01',
    requestedExperiments: ['robustness', 'relative-value'],
  }])
})

test('explicit save persists the completed result once without executing another research run', async () => {
  const result = completedResult()
  const saveCalls = []
  let runExecutionCount = 0
  const actions = createWorkbenchActions({
    executeRun: () => { runExecutionCount += 1 },
    saveRun: async (savedResult) => { saveCalls.push(savedResult) },
  })
  await actions.save(result)
  assert.deepEqual(saveCalls, [result])
  assert.equal(runExecutionCount, 0)
})

test('result summary does not render native output or raw candle payloads by default', () => {
  const html = renderToStaticMarkup(React.createElement(RunResultSummary, { result: completedResult() }))
  assert.match(html, /run-boundary-1/)
  assert.doesNotMatch(html, /RAW_CANDLE_PAYLOAD_MARKER|RAW_NATIVE_OUTPUT_MARKER/)
})

test('run-state component renders each supported application state without collapsing distinctions', () => {
  const states = ['idle', 'running', 'completed', 'partial', 'unavailable', 'failed']
  const rendered = states.map((status) => renderToStaticMarkup(
    React.createElement(RunStateStatus, { status, message: status === 'running' ? 'Working' : undefined }),
  ))
  states.forEach((status, index) => {
    assert.match(rendered[index], new RegExp(`workbench-state-${status}`))
    assert.match(rendered[index], new RegExp(status === 'idle' ? 'Ready' : status[0].toUpperCase() + status.slice(1)))
  })
  assert.match(rendered[1], /Working/)
})

test('run summary shows identity, fetch diagnostics, execution statuses, and synthesis evidence without conclusions', () => {
  const result = {
    runContext: {
      runId: 'run-ui-1',
      requestedExperiments: ['robustness', 'relative-value'],
    },
    status: 'partial',
    fetchStatus: 'partial',
    fetchIssues: [{ symbol: 'QQQ', type: 'fetch-error', error: { message: 'unavailable from provider' } }],
    dataset: { datasetId: 'dataset-ui-1' },
    experimentResults: [
      { experimentId: 'robustness', status: 'succeeded', error: null },
      { experimentId: 'relative-value', status: 'unavailable', error: null },
    ],
    synthesis: {
      coverage: { requested: ['robustness', 'relative-value'], evaluated: ['robustness'], unavailable: ['relative-value'], incomplete: [] },
      strategyGroups: [{ strategyId: 'setup-scan-baseline', evidence: [{ metricsKey: '75+' }], evidenceFamilies: [] }],
      conflicts: [],
      unresolvedQuestions: ['Provider data for QQQ was unavailable.'],
      compatibilityNotes: [{ type: 'unknown', note: 'Provenance is incomplete.' }],
    },
  }
  const html = renderToStaticMarkup(React.createElement(RunResultSummary, { result }))
  for (const text of ['run-ui-1', 'partial', 'dataset-ui-1', 'QQQ · fetch-error', 'unavailable', 'setup-scan-baseline', 'Provenance is incomplete.']) {
    assert.ok(html.includes(text), `expected rendered summary to include ${text}`)
  }
  assert.doesNotMatch(html, /winner|recommendation|confidence|buy|sell/i)
})

test('run summary handles empty execution and synthesis sections', () => {
  const html = renderToStaticMarkup(React.createElement(RunResultSummary, {
    result: {
      runContext: { runId: 'run-empty', requestedExperiments: [] },
      status: 'unavailable',
      fetchStatus: 'unavailable',
      fetchIssues: [],
      dataset: null,
      experimentResults: [{ experimentId: 'robustness', status: 'unavailable' }],
      synthesis: { coverage: { requested: [], evaluated: [] }, strategyGroups: [], conflicts: [], unresolvedQuestions: [], compatibilityNotes: [] },
    },
  }))
  assert.match(html, /No fetch issues/)
  assert.match(html, /robustness/)
  assert.match(html, /No normalized evidence groups/)
})