import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compareResearchRuns, getResearchRun, listResearchRuns, saveResearchRun } from './researchRunHistory.js'

test('saveResearchRun posts the persistence projection using the research history API', async () => {
  const originalFetch = globalThis.fetch
  let request
  globalThis.fetch = async (url, options) => {
    request = { url: String(url), options }
    return { ok: true, text: async () => '{"runId":"r1"}' }
  }
  try {
    const run = {
      runContext: { runId: 'r1' },
      dataset: {
        rawSeriesBySymbol: { SPY: [{ close: 100 }] },
        fetchResultsBySymbol: { SPY: { symbol: 'SPY', candles: [{ close: 100 }], candleCount: 1 } },
      },
      experimentResults: [{ experimentId: 'x', status: 'succeeded', nativeOutput: { profitFactor: Infinity }, error: null }],
      records: [{ id: 'x', nativePayload: { profitFactor: Infinity } }],
    }
    const response = await saveResearchRun(run)
    assert.deepEqual(response, { runId: 'r1' })
    assert.match(request.url, /\/api\/research-runs$/)
    assert.equal(request.options.method, 'POST')
    assert.equal(request.options.headers['Content-Type'], 'application/json')
    assert.match(request.options.body, /__setupscan_research_number_v1__/)
    const body = JSON.parse(request.options.body)
    assert.equal('rawSeriesBySymbol' in body.dataset, false)
    assert.equal('candles' in body.dataset.fetchResultsBySymbol.SPY, false)
    assert.equal('nativeOutput' in body.experimentResults[0], false)
    assert.equal(body.records[0].nativePayload.profitFactor.__setupscan_research_number_v1__, 'Infinity')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('getResearchRun encodes runId and parses historical output', async () => {
  const originalFetch = globalThis.fetch
  let requestedUrl
  globalThis.fetch = async (url) => {
    requestedUrl = String(url)
    return { ok: true, text: async () => '{"runContext":{"runId":"run%2F1"}}' }
  }
  try {
    const result = await getResearchRun('run/1')
    assert.match(requestedUrl, /run%2F1$/)
    assert.equal(result.runContext.runId, 'run%2F1')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('compareResearchRuns calls the private comparison endpoint with both run IDs', async () => {
  const originalFetch = globalThis.fetch
  let requestedUrl
  globalThis.fetch = async (url) => {
    requestedUrl = String(url)
    return { ok: true, text: async () => '{"comparisons":[],"unmatched":[]}' }
  }
  try {
    const comparison = await compareResearchRuns('run/a', 'run b')
    const parsed = new URL(requestedUrl, 'http://localhost')
    assert.equal(parsed.pathname, '/api/research-runs/compare')
    assert.equal(parsed.searchParams.get('runIdA'), 'run/a')
    assert.equal(parsed.searchParams.get('runIdB'), 'run b')
    assert.deepEqual(comparison.comparisons, [])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('listResearchRuns sends supported filters and reports API errors', async () => {
  const originalFetch = globalThis.fetch
  let requestedUrl
  globalThis.fetch = async (url) => {
    requestedUrl = String(url)
    return { ok: true, text: async () => '{"runs":[]}' }
  }
  try {
    assert.deepEqual(await listResearchRuns({
      limit: 10, offset: 20, symbols: ['SPY', 'QQQ'], datasetId: 'd1', experimentId: 'robustness', status: 'partial',
    }), { runs: [] })
    const parsed = new URL(requestedUrl, 'http://localhost')
    assert.equal(parsed.pathname, '/api/research-runs')
    assert.equal(parsed.searchParams.get('limit'), '10')
    assert.equal(parsed.searchParams.get('offset'), '20')
    assert.deepEqual(parsed.searchParams.getAll('symbols'), ['SPY', 'QQQ'])
    assert.equal(parsed.searchParams.get('datasetId'), 'd1')
    assert.equal(parsed.searchParams.get('experimentId'), 'robustness')
    assert.equal(parsed.searchParams.get('status'), 'partial')
  } finally {
    globalThis.fetch = originalFetch
  }

  globalThis.fetch = async () => ({ ok: false, text: async () => '{"error":"not found"}' })
  try {
    await assert.rejects(getResearchRun('missing'), /not found/)
  } finally {
    globalThis.fetch = originalFetch
  }
})