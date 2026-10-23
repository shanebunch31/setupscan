import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compareResearchRuns, getResearchDataset, getResearchRun, listResearchRuns, projectResearchRunForPersistence, saveResearchRun } from './researchRunHistory.js'
import { stringifyResearchJson } from './researchRunSerialization.js'

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
      records: [{ id: 'x', metrics: { expectancy: 0.4 }, nativePayload: { profitFactor: Infinity } }],
      synthesis: { contrastSummary: { 'cost-model': { pairCount: 2 } } },
    }
    const response = await saveResearchRun(run)
    assert.deepEqual(response, { runId: 'r1' })
    assert.match(request.url, /\/api\/research-runs$/)
    assert.equal(request.options.method, 'POST')
    assert.equal(request.options.headers['Content-Type'], 'application/json')
    const body = JSON.parse(request.options.body)
    assert.equal('rawSeriesBySymbol' in body.dataset, false)
    assert.equal('candles' in body.dataset.fetchResultsBySymbol.SPY, false)
    assert.equal('nativeOutput' in body.experimentResults[0], false)
    assert.equal('nativePayload' in body.records[0], false)
    assert.deepEqual(body.records[0].metrics, { expectancy: 0.4 })
    assert.deepEqual(body.synthesis.contrastSummary, { 'cost-model': { pairCount: 2 } })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('all-experiment persistence projection keeps normalized evidence while excluding redundant native payloads', () => {
  const experimentIds = [
    'robustness', 'relative-value', 'signal-quality', 'frozen-score-holdout',
    'yearly-regime', 'causal-regime', 'walk-forward-regime',
    'volatility-aware-variants', 'strategy-discovery', 'strategy-comparison',
    'joined-context',
  ]
  const repeatedWorkingData = Array.from({ length: 20_000 }, (_, index) => ({
    timestamp: `2026-01-01T${String(index % 24).padStart(2, '0')}:00:00Z`,
    value: index,
  }))
  const run = {
    runContext: { runId: 'all-experiments', requestedExperiments: experimentIds },
    dataset: null,
    experimentResults: experimentIds.map((experimentId) => ({
      experimentId, status: 'succeeded', nativeOutput: { repeatedWorkingData }, error: null,
    })),
    records: experimentIds.map((id) => ({
      id,
      metrics: { overall: { tradeCount: 40, expectancy: 0.2 } },
      ...(id === 'joined-context' ? { findings: [{ key: 'joined-context-evidence' }] } : {}),
      nativePayload: { repeatedWorkingData },
    })),
    synthesis: {
      strategyGroups: [{ experimentIds }],
      conflicts: [{ type: 'comparable-metric-conflict' }],
      contrastSummary: { 'cost-model': { pairCount: 3, opposingSignPairCount: 1 } },
    },
  }
  const unprojectedBytes = Buffer.byteLength(stringifyResearchJson(run))
  const projected = projectResearchRunForPersistence(run)
  const projectedJson = stringifyResearchJson(projected)
  assert.ok(unprojectedBytes > 10_000_000)
  assert.ok(Buffer.byteLength(projectedJson) < 25_000)
  assert.deepEqual(projected.records.map(({ id }) => id), experimentIds)
  assert.ok(projected.records.every((record) => !('nativePayload' in record)))
  assert.ok(projected.experimentResults.every((execution) => !('nativeOutput' in execution)))
  assert.deepEqual(projected.records.at(-1).findings, [{ key: 'joined-context-evidence' }])
  assert.deepEqual(projected.synthesis, run.synthesis)
})

test('saveResearchRun distinguishes non-JSON upstream responses from malformed JSON', async () => {
  const originalFetch = globalThis.fetch
  const run = { runContext: { runId: 'r-non-json' }, dataset: null, experimentResults: [] }
  try {
    globalThis.fetch = async () => ({
      ok: false,
      status: 502,
      headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
      text: async () => '<html><title>Bad Gateway</title></html>',
    })
    await assert.rejects(saveResearchRun(run), /non-JSON response \(HTTP 502; Content-Type text\/html\)/)

    globalThis.fetch = async () => ({
      ok: false,
      status: 502,
      headers: new Headers({ 'content-type': 'application/problem+json' }),
      text: async () => '{"error":',
    })
    await assert.rejects(saveResearchRun(run), /malformed JSON \(HTTP 502; Content-Type application\/problem\+json\)/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('saveResearchRun exposes structured persistence-unavailable and server errors', async () => {
  const originalFetch = globalThis.fetch
  const run = { runContext: { runId: 'r-api-error' }, dataset: null, experimentResults: [] }
  try {
    globalThis.fetch = async () => ({
      ok: false,
      status: 503,
      headers: new Headers({ 'content-type': 'application/json; charset=utf-8' }),
      text: async () => '{"error":"Research Run History storage is not configured"}',
    })
    await assert.rejects(saveResearchRun(run), /Research Run History storage is not configured/)

    globalThis.fetch = async () => ({
      ok: false,
      status: 500,
      headers: new Headers({ 'content-type': 'application/json; charset=utf-8' }),
      text: async () => '{"error":"Research Run History storage failed","code":"23503"}',
    })
    await assert.rejects(saveResearchRun(run), (error) => {
      assert.match(error.message, /Research Run History storage failed.*23503/)
      assert.equal(error.code, '23503')
      assert.equal(error.status, 500)
      return true
    })
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

test('getResearchDataset retrieves the canonical calculation series by datasetId', async () => {
  const originalFetch = globalThis.fetch
  let requestedUrl
  globalThis.fetch = async (url) => {
    requestedUrl = String(url)
    return { ok: true, text: async () => '{"datasetId":"dataset%2F1","calculationSeries":[]}' }
  }
  try {
    const dataset = await getResearchDataset('dataset/1')
    assert.match(requestedUrl, /\/api\/research-datasets\/dataset%2F1$/)
    assert.equal(dataset.datasetId, 'dataset%2F1')
    assert.deepEqual(dataset.calculationSeries, [])
  } finally {
    globalThis.fetch = originalFetch
  }
})
