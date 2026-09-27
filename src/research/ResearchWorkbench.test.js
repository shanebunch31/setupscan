import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { test } from 'node:test'
import { listResearchExperiments } from './registry.js'
import {
  createWorkbenchActions,
  ResearchInvestigationPanel,
  ResearchWorkbench,
  RunResultSummary,
  RunStateStatus,
} from './ResearchWorkbench.js'
import { ResearchRunDetail } from './ResearchRunDetail.js'

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

function savedInvestigation(overrides = {}) {
  return {
    investigationId: 'investigation-1',
    question: 'Does relative-value confirmation improve the baseline setup?',
    status: 'active',
    createdAt: '2026-09-22T12:00:00.000Z',
    updatedAt: '2026-09-23T12:00:00.000Z',
    requestedExperiments: ['relative-value', 'robustness'],
    runIds: ['persisted-run-1'],
    ...overrides,
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
    symbols: ' spy, QQQ, SPY, IWM ',
    timeframe: '1Hour',
    requestedStart: '2025-02-01',
    requestedEnd: '2025-03-01',
    requestedExperiments: ['robustness', 'relative-value'],
  }
  await actions.submit({ preventDefault: () => { prevented = true } }, form)
  assert.equal(prevented, true)
  assert.deepEqual(calls, [{
    symbols: ['SPY', 'QQQ', 'IWM'],
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
  assert.match(html, /Synthesis coverage: Shows which requested research was available and evaluated/)
  assert.match(html, /Unresolved questions: Evidence gaps or limitations the current research did not settle/)
  assert.match(html, /Evidence: A measured result from an experiment and sample/)
  assert.doesNotMatch(html, /winner|recommendation|confidence|buy|sell/i)
})

test('live run results prioritize counts and unresolved questions while retaining exact details and an explicit Investigation handoff', () => {
  const result = completedResult()
  const requested = Array.from({ length: 10 }, (_, index) => `experiment-${index + 1}`)
  result.runContext = {
    runId: 'run-dense-result',
    symbols: ['SPY', 'QQQ'],
    timeframe: '1Hour',
    requestedStart: '2024-01-01',
    requestedEnd: '2025-01-01',
    requestedExperiments: requested,
  }
  result.experimentResults = requested.map((experimentId, index) => ({
    experimentId,
    status: index < 8 ? 'succeeded' : index === 8 ? 'unavailable' : 'incomplete',
  }))
  result.synthesis.coverage = {
    requested,
    evaluated: requested.slice(0, 8),
    unavailable: [requested[8]],
    incomplete: [requested[9]],
  }
  result.synthesis.strategyGroups = [
    { strategyId: 'baseline', evidence: [{ id: 'evidence-baseline', sourceRecordId: 'experiment-1', metricsKey: 'overall', partition: { type: 'year', label: 'year-2024' } }], evidenceFamilies: [{ id: 'family-shared' }] },
    { strategyId: 'variant', evidence: [{ id: 'evidence-variant', sourceRecordId: 'experiment-2', metricsKey: 'holdout' }], evidenceFamilies: [] },
  ]
  result.synthesis.conflicts = Array.from({ length: 34 }, (_, index) => ({
    id: `conflict-${index + 1}`,
    observation: index === 0 ? 'Metric difference retained exactly: 0.12345678901234567' : `Conflict record ${index + 1}`,
  }))
  result.synthesis.unresolvedQuestions = ['The incomplete sample does not settle this question.']

  const html = renderToStaticMarkup(React.createElement(RunResultSummary, { result }))
  assert.match(html, /Your research run is complete/)
  assert.match(html, /8 of 10 experiments completed/)
  assert.match(html, /SPY, QQQ/)
  assert.match(html, /1Hour/)
  assert.match(html, /10 requested · 8 evaluated · 1 unavailable · 1 incomplete/)
  assert.match(html, /2 strategy groups · 2 evidence entries/)
  assert.match(html, /View conflicts \(34\)/)
  assert.match(html, /Metric difference retained exactly: 0\.12345678901234567/)
  assert.match(html, /How was this tested\? View technical details/)
  assert.match(html, /run-dense-result/)
  assert.match(html, /experiment-10/)
  assert.match(html, /Shared evidence families: family-shared/)
  assert.match(html, /1 shared evidence families/)
  assert.match(html, /year-2024/)
  assert.doesNotMatch(html, /\[object Object\]/)
  assert.match(html, /Want to organize this research into an Investigation\?/)
  assert.match(html, /Creating one does not save or attach this run/)
  assert.doesNotMatch(html, /<details[^>]*\bopen(?:=|[ >])/i)
  assert.ok(html.indexOf('The incomplete sample does not settle this question.') < html.indexOf('View conflicts (34)'))
  assert.ok(html.indexOf('Your research run is complete') < html.indexOf('Want to organize this research into an Investigation?'))
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

test('Workbench renders Investigation question, catalogue plan, and explicit create control without automatic actions', () => {
  let createCalls = 0
  let executionCalls = 0
  const html = renderToStaticMarkup(React.createElement(ResearchWorkbench, {
    createInvestigation: async () => { createCalls += 1 },
    executeRun: async () => { executionCalls += 1 },
    listInvestigations: async () => ({ investigations: [] }),
  }))
  assert.match(html, /Research question/)
  assert.match(html, /one saved execution of selected experiments using shared historical data/)
  assert.match(html, /One registered research method tested during a run/)
  assert.match(html, /maxLength="1000"/)
  assert.match(html, /Experiment plan/)
  assert.match(html, /Create Investigation/)
  assert.match(html, /No Investigation selected|Select an Investigation/)
  for (const help of [
    'Relative Value: Looks at the relationship between related instruments or prices rather than one price alone.',
    'Causal Regime: Groups results using information available at the time. It does not prove that a market condition caused the result.',
    'Walk-Forward Regime: Repeated tests that move forward through time, using earlier data for each later test.',
    'Volatility-Aware Variants: Tests predefined strategy variants (alternative rule sets) under different volatility conditions; it does not automatically adapt live trading.',
    'Strategy Discovery: Tests predefined strategy ideas historically; discovery is not validation.',
    'Strategy Comparison: Places predefined strategies side by side using the same research evidence.',
  ]) assert.ok(html.includes(help), `expected experiment help to include ${help}`)
  listResearchExperiments().forEach(({ title }) => assert.ok(html.includes(title)))
  assert.equal(createCalls, 0)
  assert.equal(executionCalls, 0)
})

test('empty question is rejected before the create client is called', async () => {
  let createCalls = 0
  let executionCalls = 0
  const actions = createWorkbenchActions({
    createInvestigation: async () => { createCalls += 1 },
    executeRun: async () => { executionCalls += 1 },
  })
  assert.throws(() => actions.createInvestigation('  \n ', ['robustness']), /question must not be empty/)
  assert.equal(createCalls, 0)
  assert.equal(executionCalls, 0)
})

test('valid question and selected plan create only an Investigation', async () => {
  const calls = []
  let executionCalls = 0
  const actions = createWorkbenchActions({
    createInvestigation: async (request) => { calls.push(request); return savedInvestigation(request) },
    executeRun: async () => { executionCalls += 1 },
  })
  const result = await actions.createInvestigation('  Does relative value help?  ', ['relative-value', 'robustness'])
  assert.equal(result.question, 'Does relative value help?')
  assert.deepEqual(calls, [{ question: 'Does relative value help?', requestedExperiments: ['relative-value', 'robustness'] }])
  assert.equal(executionCalls, 0)
})

test('running a selected Investigation plan delegates to runResearch with its plan and current run configuration', async () => {
  const calls = []
  let started = 0
  let createCalls = 0
  const actions = createWorkbenchActions({
    executeRun: async (request) => { calls.push(request); return { status: 'completed' } },
    createInvestigation: async () => { createCalls += 1 },
  })
  await actions.runInvestigationPlan({
    symbols: 'SPY, QQQ, IWM', timeframe: '1Hour', requestedStart: '2025-01-01', requestedExperiments: ['robustness'],
  }, savedInvestigation(), () => { started += 1 })
  assert.deepEqual(calls, [{
    symbols: ['SPY', 'QQQ', 'IWM'], timeframe: '1Hour', requestedStart: '2025-01-01', requestedEnd: null,
    requestedExperiments: ['relative-value', 'robustness'],
  }])
  assert.equal(started, 1)
  assert.equal(createCalls, 0)
})

test('Investigation list displays question, status, date, and run count; selecting loads by exact ID without running', async () => {
  const investigation = savedInvestigation()
  let loaded
  let executions = 0
  const actions = createWorkbenchActions({
    getInvestigation: async (id) => { loaded = id; return investigation },
    executeRun: async () => { executions += 1 },
  })
  const props = {
    investigations: [investigation],
    onSelectInvestigation: (id) => actions.getInvestigation(id),
  }
  const html = renderToStaticMarkup(React.createElement(ResearchInvestigationPanel, props))
  for (const value of [investigation.question, 'active', '2026-09-22', '1 runs']) assert.ok(html.includes(value))
  const tree = ResearchInvestigationPanel(props)
  const selectButton = findElement(tree, (element) => element.type === 'button' && element.props['aria-pressed'] === false)
  await selectButton.props.onClick()
  assert.equal(loaded, investigation.investigationId)
  assert.equal(executions, 0)
})

test('a selected Investigation exposes an explicit action to open its detail workspace', () => {
  let openCalls = 0
  const tree = ResearchInvestigationPanel({
    selectedInvestigation: savedInvestigation(),
    selectedInvestigationId: 'investigation-1',
    onOpenDetail: () => { openCalls += 1 },
  })
  const openButton = findElement(tree, (element) => element.type === 'button' && elementText(element).includes('Open Investigation Detail'))
  assert.ok(openButton)
  openButton.props.onClick()
  assert.equal(openCalls, 1)
})

test('selected Investigation metadata and associated IDs render without copying full run or payload objects', () => {
  const investigation = savedInvestigation({
    rawSeriesBySymbol: { SPY: [{ close: 'RAW_INVESTIGATION_CANDLES' }] },
    nativePayload: { marker: 'RAW_INVESTIGATION_NATIVE' },
    runPayload: { marker: 'RAW_COMPLETE_RUN' },
  })
  const props = {
    investigations: [investigation],
    selectedInvestigationId: investigation.investigationId,
    selectedInvestigation: investigation,
    savedRunId: null,
  }
  const html = renderToStaticMarkup(React.createElement(ResearchInvestigationPanel, props))
  for (const value of [investigation.question, investigation.status, investigation.createdAt, investigation.updatedAt, 'Relative Value', 'Robustness', 'persisted-run-1', 'Associated runs']) {
    assert.ok(html.includes(value), `expected Investigation UI to show ${value}`)
  }
  assert.doesNotMatch(html, /RAW_INVESTIGATION_CANDLES|RAW_INVESTIGATION_NATIVE|RAW_COMPLETE_RUN|rawSeriesBySymbol|nativePayload|nativeOutput/)
  const tree = ResearchInvestigationPanel({ ...props, selectedRunId: 'persisted-run-1' })
  const detail = findElement(tree, (element) => element.type === ResearchRunDetail)
  assert.deepEqual(Object.keys(detail.props).sort(), ['getRun', 'runId'])
  assert.equal(detail.props.runId, 'persisted-run-1')
})

test('Investigation loading errors take precedence and creation/loading states are visible', () => {
  const emptyList = renderToStaticMarkup(React.createElement(ResearchInvestigationPanel))
  assert.match(emptyList, /No Investigations yet\./)

  const listHtml = renderToStaticMarkup(React.createElement(ResearchInvestigationPanel, {
    listLoading: true,
    listError: 'Could not load list.',
    creating: true,
  }))
  assert.match(listHtml, /Could not load list\./)
  assert.doesNotMatch(listHtml, /Loading investigations/)
  assert.match(listHtml, /Creating Investigation/)
  assert.match(listHtml, /Select an Investigation/)

  const detailHtml = renderToStaticMarkup(React.createElement(ResearchInvestigationPanel, {
    selectedInvestigationId: 'inv-1',
    investigationLoading: true,
    investigationError: 'Could not load details.',
  }))
  assert.match(detailHtml, /Could not load details\./)
  assert.doesNotMatch(detailHtml, /Loading investigation/)
})

test('saved run must have an ID before attach; attach uses that exact ID and never executes research', async () => {
  const calls = []
  let executionCalls = 0
  const actions = createWorkbenchActions({
    attachRun: async (investigationId, runId) => { calls.push([investigationId, runId]); return savedInvestigation({ runIds: [runId] }) },
    executeRun: async () => { executionCalls += 1 },
  })
  const unavailable = renderToStaticMarkup(React.createElement(ResearchInvestigationPanel, {
    selectedInvestigation: savedInvestigation(),
    selectedInvestigationId: 'investigation-1',
  }))
  assert.match(unavailable, /Save a Research Run to enable attachment/)

  const props = {
    selectedInvestigation: savedInvestigation({ runIds: [] }),
    selectedInvestigationId: 'investigation-1',
    savedRunId: 'persisted-run-exact',
    onAttachRun: () => actions.attachRun('investigation-1', 'persisted-run-exact'),
  }
  const attachButton = findElement(ResearchInvestigationPanel(props), (element) => element.type === 'button' && elementText(element).includes('Add Run to Investigation'))
  assert.equal(attachButton.props.disabled, false)
  await attachButton.props.onClick()
  assert.deepEqual(calls, [['investigation-1', 'persisted-run-exact']])
  assert.equal(executionCalls, 0)
})

test('duplicate and attach errors are visible; already-attached IDs cannot be submitted again', () => {
  const duplicate = renderToStaticMarkup(React.createElement(ResearchInvestigationPanel, {
    selectedInvestigation: savedInvestigation(),
    selectedInvestigationId: 'investigation-1',
    savedRunId: 'persisted-run-1',
    attachError: 'Research run is already attached to this investigation.',
  }))
  assert.match(duplicate, /already attached/)
  assert.match(duplicate, /role="alert"/)
  const tree = ResearchInvestigationPanel({
    selectedInvestigation: savedInvestigation(),
    selectedInvestigationId: 'investigation-1',
    savedRunId: 'persisted-run-1',
  })
  const attachButton = findElement(tree, (element) => element.type === 'button' && elementText(element).includes('Add Run to Investigation'))
  assert.equal(attachButton.props.disabled, true)
})
