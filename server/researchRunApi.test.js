import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { test } from 'node:test'
import { stringifyResearchJson } from '../src/research/researchRunSerialization.js'
import { createResearchRunApi } from './researchRunApi.js'

function invoke(api, { method = 'GET', path = '/api/research-runs', body = '' } = {}) {
  const request = Readable.from(body ? [Buffer.from(body)] : [])
  request.method = method
  let status
  let responseBody
  const response = {
    writeHead(code) { status = code },
    end(payload) { responseBody = payload },
  }
  const url = new URL(path, 'http://localhost')
  return api(request, response, url).then(() => ({ status, body: responseBody ? JSON.parse(responseBody) : null }))
}

test('research run API returns unavailable when database storage is not configured', async () => {
  const api = createResearchRunApi()
  const response = await invoke(api, { method: 'GET' })
  assert.equal(response.status, 503)
  assert.match(response.body.error, /not configured/)
})

test('POST saves a run result and transports non-finite payload numbers losslessly', async () => {
  let saved
  const api = createResearchRunApi({ store: {
    saveResearchRun: async (run) => { saved = run; return { runId: run.runContext.runId } },
  } })
  const runResult = {
    runContext: { runId: 'run-api', requestedExperiments: [] },
    dataset: null,
    experimentResults: [],
    records: [{ nativePayload: { profitFactor: Infinity } }],
  }
  const response = await invoke(api, {
    method: 'POST',
    body: stringifyResearchJson(runResult),
  })
  assert.equal(response.status, 201)
  assert.equal(saved.records[0].nativePayload.profitFactor, Infinity)
  assert.deepEqual(response.body, { runId: 'run-api' })
})

test('GET retrieves one run and returns 404 when absent', async () => {
  const api = createResearchRunApi({ store: {
    getResearchRun: async (runId) => runId === 'present' ? { runContext: { runId } } : null,
  } })
  const found = await invoke(api, { path: '/api/research-runs/present' })
  const missing = await invoke(api, { path: '/api/research-runs/missing' })
  assert.equal(found.status, 200)
  assert.equal(found.body.runContext.runId, 'present')
  assert.equal(missing.status, 404)
})

test('GET list forwards supported filters and returns runs array', async () => {
  let received
  const api = createResearchRunApi({ store: {
    listResearchRuns: async (filters) => { received = filters; return [{ runId: 'r1' }] },
  } })
  const response = await invoke(api, {
    path: '/api/research-runs?limit=5&offset=2&symbols=SPY&symbols=QQQ&datasetId=d1&experimentId=robustness&status=partial',
  })
  assert.equal(response.status, 200)
  assert.deepEqual(response.body.runs, [{ runId: 'r1' }])
  assert.deepEqual(received, {
    limit: 5,
    offset: 2,
    symbols: ['SPY', 'QQQ'],
    datasetId: 'd1',
    experimentId: 'robustness',
    status: 'partial',
  })
})

test('duplicate run API error maps to conflict and invalid run shape maps to bad request', async () => {
  const api = createResearchRunApi({ store: {
    saveResearchRun: async (run) => {
      if (run.runContext?.runId === 'duplicate') {
        const error = new Error('already exists')
        error.code = 'RESEARCH_RUN_EXISTS'
        throw error
      }
      const error = new Error('missing fields')
      error.code = 'RESEARCH_RUN_INVALID'
      throw error
    },
  } })
  const duplicate = await invoke(api, { method: 'POST', body: '{"runContext":{"runId":"duplicate"}}' })
  const invalid = await invoke(api, { method: 'POST', body: '{}' })
  assert.equal(duplicate.status, 409)
  assert.equal(invalid.status, 400)
})

test('malformed JSON and unsupported methods have explicit client errors', async () => {
  const api = createResearchRunApi({ store: { saveResearchRun: async () => ({}) } })
  const malformed = await invoke(api, { method: 'POST', body: '{' })
  const unsupported = await invoke(api, { method: 'DELETE' })
  assert.equal(malformed.status, 400)
  assert.equal(unsupported.status, 405)
})