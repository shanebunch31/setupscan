import assert from 'node:assert/strict'
import { test } from 'node:test'
import { listResearchExperiments } from './registry.js'
import { runResearch } from './runResearch.js'
import {
  createInvestigationRunRequest,
  createWorkbenchInvestigationRequest,
  createWorkbenchRunRequest,
  executeWorkbenchRun,
  setWorkbenchRunFailure,
} from './researchWorkbenchModel.js'

test('run request normalizes symbols and uses registered experiments including an explicit empty list', () => {
  const registeredIds = listResearchExperiments().map(({ id }) => id)
  assert.deepEqual(createWorkbenchRunRequest({
    symbols: ' spy,QQQ,SPY,IWM ',
    timeframe: '1Hour',
    requestedStart: '',
    requestedEnd: '',
    requestedExperiments: registeredIds,
  }), {
    symbols: ['SPY', 'QQQ', 'IWM'],
    timeframe: '1Hour',
    requestedStart: null,
    requestedEnd: null,
    requestedExperiments: registeredIds,
  })
  assert.deepEqual(createWorkbenchRunRequest({ symbols: 'SPY', timeframe: '1Hour', requestedExperiments: [] }).requestedExperiments, [])
})

test('run request rejects invalid configuration and unregistered experiment IDs', () => {
  assert.throws(() => createWorkbenchRunRequest({ symbols: ' , ', timeframe: '1Hour', requestedExperiments: [] }), /at least one symbol/)
  assert.throws(() => createWorkbenchRunRequest({ symbols: 'SPY', timeframe: '1Hour', requestedStart: 'not-a-date', requestedExperiments: [] }), /Start date must be valid/)
  assert.throws(() => createWorkbenchRunRequest({ symbols: 'SPY', timeframe: '1Hour', requestedStart: '2025-02-01', requestedEnd: '2025-01-01', requestedExperiments: [] }), /before end date/)
  assert.throws(() => createWorkbenchRunRequest({ symbols: 'SPY', timeframe: '1Hour', requestedExperiments: ['not-registered'] }), /Unknown research experiment/)
})

test('compatible experiment selections accept their required symbols', () => {
  const request = createWorkbenchRunRequest({
    symbols: 'spy, qqq, iwm',
    timeframe: '1Hour',
    requestedExperiments: ['robustness', 'relative-value', 'strategy-discovery'],
  })
  assert.deepEqual(request.symbols, ['SPY', 'QQQ', 'IWM'])
})

test('incompatible experiment selections are rejected with experiment and symbol details', () => {
  assert.throws(
    () => createWorkbenchRunRequest({
      symbols: 'SPY, QQQ',
      timeframe: '1Hour',
      requestedExperiments: ['relative-value'],
    }),
    /Relative Value requires SPY, QQQ, IWM \(missing IWM\)/,
  )
})

test('mixed selections identify only the experiment whose requirements are unmet', () => {
  assert.throws(
    () => createWorkbenchRunRequest({
      symbols: 'SPY',
      timeframe: '1Hour',
      requestedExperiments: ['robustness', 'relative-value'],
    }),
    /Relative Value requires SPY, QQQ, IWM \(missing QQQ, IWM\)/,
  )
})

test('Robustness requires SPY, while Strategy Comparison accepts any requested symbol', () => {
  assert.throws(
    () => createWorkbenchRunRequest({ symbols: 'AAPL', timeframe: '1Hour', requestedExperiments: ['robustness'] }),
    /Robustness requires SPY \(missing SPY\)/,
  )
  const comparison = createWorkbenchRunRequest({
    symbols: 'AAPL, MSFT',
    timeframe: '1Hour',
    requestedExperiments: ['strategy-comparison'],
  })
  assert.deepEqual(comparison.symbols, ['AAPL', 'MSFT'])
})

test('Workbench execution delegates the request to runResearch rather than native experiments', async () => {
  const calls = []
  const request = { symbols: ['SPY'], timeframe: '1Hour', requestedExperiments: [] }
  const result = await executeWorkbenchRun(request, async (...args) => {
    calls.push(args)
    return { status: 'completed' }
  })
  assert.deepEqual(calls, [[request]])
  assert.deepEqual(result, { status: 'completed' })

  const emptyRun = await runResearch(request)
  assert.equal(emptyRun.status, 'completed')
  assert.deepEqual(emptyRun.runContext.requestedExperiments, [])
})

test('Worker failures clear the running state and surface their message', () => {
  let status = 'running'
  let formError = null
  setWorkbenchRunFailure(
    new Error('Research Worker failed: experiment dispatch failed.'),
    (message) => { formError = message },
    (update) => { status = update(status) },
  )
  assert.equal(status, 'failed')
  assert.equal(formError, 'Research Worker failed: experiment dispatch failed.')
})

test('investigation request trims the question and preserves registered plan order', () => {
  assert.deepEqual(createWorkbenchInvestigationRequest('  Does relative value help?  ', ['relative-value', 'robustness']), {
    question: 'Does relative value help?',
    requestedExperiments: ['relative-value', 'robustness'],
  })
  assert.deepEqual(createWorkbenchInvestigationRequest('Question', []).requestedExperiments, [])
  assert.throws(() => createWorkbenchInvestigationRequest('  ', []), /question must not be empty/)
  assert.throws(() => createWorkbenchInvestigationRequest('x'.repeat(1001), []), /at most 1000/)
  assert.throws(() => createWorkbenchInvestigationRequest('Question', ['unknown']), /unknown experiment id/)
})

test('investigation run request uses the selected saved plan with the existing run configuration', () => {
  assert.deepEqual(createInvestigationRunRequest({
    symbols: 'spy, QQQ, IWM',
    timeframe: '1Hour',
    requestedStart: '2025-01-01',
    requestedExperiments: ['robustness'],
  }, {
    question: 'Question',
    requestedExperiments: ['walk-forward-regime', 'robustness'],
  }), {
    symbols: ['SPY', 'QQQ', 'IWM'],
    timeframe: '1Hour',
    requestedStart: '2025-01-01',
    requestedEnd: null,
    requestedExperiments: ['walk-forward-regime', 'robustness'],
  })
  assert.throws(() => createInvestigationRunRequest({
    symbols: 'SPY',
    timeframe: '1Hour',
  }, {
    question: 'Question',
    requestedExperiments: ['walk-forward-regime'],
  }), /Walk-Forward Regime requires SPY, QQQ, IWM/)
  assert.throws(() => createInvestigationRunRequest({}, null), /Select an investigation/)
})
