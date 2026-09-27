import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  attachResearchRunToInvestigation,
  createResearchInvestigation,
  getResearchInvestigation,
  listResearchInvestigations,
} from './researchInvestigationHistory.js'

test('createResearchInvestigation posts question and ordered experiment plan unchanged', async () => {
  const originalFetch = globalThis.fetch
  let request
  globalThis.fetch = async (url, options) => {
    request = { url: String(url), options }
    return { ok: true, text: async () => '{"investigationId":"inv-1"}' }
  }
  try {
    const input = { question: '  Wording as authored? ', requestedExperiments: ['walk-forward-regime', 'robustness'] }
    assert.deepEqual(await createResearchInvestigation(input), { investigationId: 'inv-1' })
    assert.equal(request.url, '/api/research-investigations')
    assert.equal(request.options.method, 'POST')
    assert.deepEqual(JSON.parse(request.options.body), input)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('get and list investigation helpers encode IDs and send pagination', async () => {
  const originalFetch = globalThis.fetch
  const requestedUrls = []
  globalThis.fetch = async (url) => {
    requestedUrls.push(String(url))
    return { ok: true, text: async () => '{"investigations":[]}' }
  }
  try {
    await getResearchInvestigation('inv/1')
    await listResearchInvestigations({ limit: 10, offset: 20 })
    const detail = new URL(requestedUrls[0], 'http://localhost')
    const list = new URL(requestedUrls[1], 'http://localhost')
    assert.equal(detail.pathname, '/api/research-investigations/inv%2F1')
    assert.equal(list.pathname, '/api/research-investigations')
    assert.equal(list.searchParams.get('limit'), '10')
    assert.equal(list.searchParams.get('offset'), '20')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('attachResearchRunToInvestigation posts only the run reference and surfaces API errors', async () => {
  const originalFetch = globalThis.fetch
  let request
  globalThis.fetch = async (url, options) => {
    request = { url: String(url), options }
    return { ok: true, text: async () => '{"runIds":["run-1"]}' }
  }
  try {
    assert.deepEqual(await attachResearchRunToInvestigation('inv/1', 'run-1'), { runIds: ['run-1'] })
    assert.equal(request.url, '/api/research-investigations/inv%2F1/runs')
    assert.deepEqual(JSON.parse(request.options.body), { runId: 'run-1' })
  } finally {
    globalThis.fetch = originalFetch
  }

  globalThis.fetch = async () => ({ ok: false, text: async () => '{"error":"Research run not found"}' })
  try {
    await assert.rejects(attachResearchRunToInvestigation('inv-1', 'missing'), /Research run not found/)
  } finally {
    globalThis.fetch = originalFetch
  }
})