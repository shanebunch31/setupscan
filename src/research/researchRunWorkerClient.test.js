import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createWorkbenchActions } from './ResearchWorkbench.js'

const resultShape = [
  'runContext', 'status', 'fetchStatus', 'fetchIssues', 'dataset',
  'experimentResults', 'records', 'synthesis',
]

function installWorker(onPostMessage) {
  const originalWorker = globalThis.Worker
  let instance
  globalThis.Worker = class FakeWorker {
    constructor(url, options) {
      this.url = url
      this.options = options
      instance = this
    }

    postMessage(message) {
      this.requestMessage = message
      onPostMessage(this, message)
    }

    terminate() {
      this.terminated = true
    }
  }
  return {
    get instance() { return instance },
    restore() { globalThis.Worker = originalWorker },
  }
}

test('Workbench sends the normalized request to a module Worker and preserves the run result shape', async () => {
  const result = {
    runContext: { runId: 'worker-run', symbols: ['SPY', 'QQQ'], timeframe: '1Hour', requestedExperiments: ['robustness'] },
    status: 'partial',
    fetchStatus: 'partial',
    fetchIssues: [{ symbol: 'QQQ', type: 'fetch-error' }],
    dataset: { datasetId: 'worker-dataset', rawSeriesBySymbol: { SPY: [] } },
    experimentResults: [{ experimentId: 'robustness', status: 'succeeded' }],
    records: [{ id: 'robustness' }],
    synthesis: { coverage: { requested: ['robustness'] }, strategyGroups: [], conflicts: [] },
  }
  const workerHarness = installWorker((worker) => queueMicrotask(() => worker.onmessage({ data: { type: 'result', result } })))
  try {
    const actions = createWorkbenchActions()
    const request = await actions.submit({ preventDefault() {} }, {
      symbols: ' spy, QQQ, SPY ',
      timeframe: '1Hour',
      requestedStart: '2022-01-01',
      requestedEnd: '',
      requestedExperiments: ['robustness'],
    })
    assert.deepEqual(workerHarness.instance.requestMessage, {
      type: 'run',
      request: {
        symbols: ['SPY', 'QQQ'],
        timeframe: '1Hour',
        requestedStart: '2022-01-01',
        requestedEnd: null,
        requestedExperiments: ['robustness'],
      },
    })
    assert.match(workerHarness.instance.url.href, /researchRun\.worker\.js$/)
    assert.deepEqual(workerHarness.instance.options, { type: 'module' })
    assert.deepEqual(Object.keys(request), resultShape)
    assert.deepEqual(request, result)
    assert.equal(workerHarness.instance.terminated, true)
  } finally {
    workerHarness.restore()
  }
})

test('Workbench receives a clear error when the Worker fails unexpectedly', async () => {
  const workerHarness = installWorker((worker) => queueMicrotask(() => worker.onerror({
    message: 'Worker process terminated unexpectedly',
    preventDefault() {},
  })))
  try {
    const actions = createWorkbenchActions()
    await assert.rejects(actions.submit({ preventDefault() {} }, {
      symbols: 'SPY', timeframe: '1Hour', requestedExperiments: [],
    }), /Research Worker failed: Worker process terminated unexpectedly/)
    assert.equal(workerHarness.instance.terminated, true)
  } finally {
    workerHarness.restore()
  }
})

test('Workbench reports Worker creation failures instead of leaving a pending run', async () => {
  const originalWorker = globalThis.Worker
  globalThis.Worker = class {
    constructor() { throw new Error('Workers are blocked') }
  }
  try {
    const actions = createWorkbenchActions()
    await assert.rejects(actions.submit({ preventDefault() {} }, {
      symbols: 'SPY', timeframe: '1Hour', requestedExperiments: [],
    }), /Research Worker could not be started: Workers are blocked/)
  } finally {
    globalThis.Worker = originalWorker
  }
})