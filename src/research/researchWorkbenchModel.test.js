import assert from 'node:assert/strict'
import { test } from 'node:test'
import { listResearchExperiments } from './registry.js'
import { runResearch } from './runResearch.js'
import {
  createWorkbenchRunRequest,
  executeWorkbenchRun,
} from './researchWorkbenchModel.js'

test('run request normalizes symbols and uses registered experiments including an explicit empty list', () => {
  const registeredIds = listResearchExperiments().map(({ id }) => id)
  assert.deepEqual(createWorkbenchRunRequest({
    symbols: ' spy,QQQ,SPY ',
    timeframe: '1Hour',
    requestedStart: '',
    requestedEnd: '',
    requestedExperiments: registeredIds,
  }), {
    symbols: ['SPY', 'QQQ'],
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
