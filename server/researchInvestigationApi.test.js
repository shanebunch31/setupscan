import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { test } from 'node:test'
import { stringifyResearchJson } from '../src/research/researchRunSerialization.js'
import { createResearchInvestigationApi } from './researchInvestigationApi.js'

function invoke(api, { method = 'GET', path = '/api/research-investigations', body = '' } = {}) {
  const request = Readable.from(body ? [Buffer.from(body)] : [])
  request.method = method
  let status
  let responseBody
  const response = {
    writeHead(code) { status = code },
    end(payload) { responseBody = payload },
  }
  return api(request, response, new URL(path, 'http://localhost'))
    .then(() => ({ status, body: responseBody ? JSON.parse(responseBody) : null }))
}

test('investigation API reports unavailable storage and creates investigation metadata', async () => {
  const unavailable = await invoke(createResearchInvestigationApi())
  assert.equal(unavailable.status, 503)

  let received
  const api = createResearchInvestigationApi({ store: {
    createResearchInvestigation: async (input) => {
      received = input
      return { investigationId: 'investigation-1', ...input, status: 'active', runIds: [] }
    },
  } })
  const response = await invoke(api, {
    method: 'POST',
    body: stringifyResearchJson({ question: 'Question?', requestedExperiments: ['robustness'] }),
  })
  assert.equal(response.status, 201)
  assert.deepEqual(received, { question: 'Question?', requestedExperiments: ['robustness'] })
  assert.deepEqual(response.body, {
    investigationId: 'investigation-1',
    question: 'Question?',
    requestedExperiments: ['robustness'],
    status: 'active',
    runIds: [],
  })
})

test('investigation API gets and lists investigations with pagination', async () => {
  const calls = []
  const api = createResearchInvestigationApi({ store: {
    getResearchInvestigation: async (id) => id === 'inv-1' ? { investigationId: id, runIds: [] } : null,
    listResearchInvestigations: async (filters) => { calls.push(filters); return [{ investigationId: 'inv-1' }] },
  } })
  const found = await invoke(api, { path: '/api/research-investigations/inv-1' })
  const missing = await invoke(api, { path: '/api/research-investigations/missing' })
  const list = await invoke(api, { path: '/api/research-investigations?limit=10&offset=20' })
  assert.equal(found.status, 200)
  assert.equal(missing.status, 404)
  assert.deepEqual(list.body.investigations, [{ investigationId: 'inv-1' }])
  assert.deepEqual(calls, [{ limit: 10, offset: 20 }])
})

test('investigation API attaches existing run IDs and maps reference errors', async () => {
  const api = createResearchInvestigationApi({ store: {
    attachResearchRunToInvestigation: async (investigationId, runId) => {
      if (investigationId === 'missing') {
        const error = new Error('investigation missing')
        error.code = 'RESEARCH_INVESTIGATION_NOT_FOUND'
        error.statusCode = 404
        throw error
      }
      if (runId === 'missing-run') {
        const error = new Error('run missing')
        error.code = 'RESEARCH_RUN_NOT_FOUND'
        error.statusCode = 404
        throw error
      }
      if (runId === 'duplicate') {
        const error = new Error('already attached')
        error.code = 'RESEARCH_INVESTIGATION_RUN_EXISTS'
        throw error
      }
      return { investigationId, runIds: [runId] }
    },
  } })
  const attached = await invoke(api, {
    method: 'POST',
    path: '/api/research-investigations/inv-1/runs',
    body: '{"runId":"run-1"}',
  })
  const missingInvestigation = await invoke(api, {
    method: 'POST', path: '/api/research-investigations/missing/runs', body: '{"runId":"run-1"}',
  })
  const missingRun = await invoke(api, {
    method: 'POST', path: '/api/research-investigations/inv-1/runs', body: '{"runId":"missing-run"}',
  })
  const duplicate = await invoke(api, {
    method: 'POST', path: '/api/research-investigations/inv-1/runs', body: '{"runId":"duplicate"}',
  })
  assert.deepEqual(attached.body, { investigationId: 'inv-1', runIds: ['run-1'] })
  assert.equal(attached.status, 200)
  assert.equal(missingInvestigation.status, 404)
  assert.equal(missingRun.status, 404)
  assert.equal(duplicate.status, 409)
})

test('investigation API rejects malformed and invalid requests and hides storage details', async () => {
  const api = createResearchInvestigationApi({ store: {
    createResearchInvestigation: async () => {
      const error = new Error('question must not be empty')
      error.code = 'RESEARCH_INVESTIGATION_INVALID'
      throw error
    },
    listResearchInvestigations: async () => { throw new Error('database secret') },
  } })
  const malformed = await invoke(api, { method: 'POST', body: '{' })
  const invalid = await invoke(api, { method: 'POST', body: '{"question":""}' })
  const storageFailure = await invoke(api)
  assert.equal(malformed.status, 400)
  assert.equal(invalid.status, 400)
  assert.equal(storageFailure.status, 500)
  assert.equal(storageFailure.body.error, 'Research Investigation storage failed')
  const unsupported = await invoke(api, { method: 'DELETE' })
  assert.equal(unsupported.status, 405)
})