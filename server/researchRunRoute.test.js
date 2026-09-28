import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { test } from 'node:test'
import { createResearchRunApi } from './researchRunApi.js'
import { dispatchResearchRunRoute } from './researchRunRoute.js'

function invokeApi(api, { method = 'GET', path } = {}) {
  const request = Readable.from([])
  request.method = method
  let status
  let body
  const response = {
    writeHead(code) { status = code },
    end(payload) { body = payload },
  }
  const url = new URL(path, 'http://localhost')
  return dispatchResearchRunRoute({
    pathname: url.pathname,
    request,
    response,
    url,
    researchRunApi: api,
  }).then((dispatched) => ({ dispatched, status, body: body ? JSON.parse(body) : null }))
}

test('main server research routing dispatches dataset GET and returns the canonical dataset', async () => {
  const dataset = { datasetId: 'dataset-1', calculationSeries: [{ symbol: 'SPY', candles: [] }] }
  const api = createResearchRunApi({ store: {
    getResearchDataset: async (datasetId) => datasetId === 'dataset-1' ? dataset : null,
  } })

  const result = await invokeApi(api, { path: '/api/research-datasets/dataset-1' })
  assert.equal(result.dispatched, true)
  assert.equal(result.status, 200)
  assert.deepEqual(result.body, dataset)
})

test('main server research routing preserves dataset 404 behavior', async () => {
  const api = createResearchRunApi({ store: { getResearchDataset: async () => null } })

  const result = await invokeApi(api, { path: '/api/research-datasets/missing' })
  assert.equal(result.dispatched, true)
  assert.equal(result.status, 404)
})

test('main server research routing continues to dispatch research-run routes', async () => {
  const run = { runContext: { runId: 'run-1' } }
  const api = createResearchRunApi({ store: {
    getResearchRun: async (runId) => runId === 'run-1' ? run : null,
  } })

  const result = await invokeApi(api, { path: '/api/research-runs/run-1' })
  assert.equal(result.dispatched, true)
  assert.equal(result.status, 200)
  assert.deepEqual(result.body, run)
})

test('main server research routing leaves investigation and unrelated routes for their existing handlers', async () => {
  let called = false
  const researchRunApi = async () => { called = true }
  const request = Readable.from([])
  const response = {}

  for (const pathname of ['/api/research-investigations', '/api/historical', '/api/paper-trading', '/unrelated']) {
    const url = new URL(pathname, 'http://localhost')
    const dispatched = await dispatchResearchRunRoute({ pathname, request, response, url, researchRunApi })
    assert.equal(dispatched, false, `${pathname} should not use the research-run API`)
  }
  assert.equal(called, false)
})
