import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createPaperDashboardRoute } from './paperDashboardRoute.js'

function request(method = 'GET') {
  return { method }
}

function responseRecorder() {
  const calls = []
  return { calls, sendJson: (_response, status, payload) => calls.push({ status, payload }) }
}

test('paper dashboard rejects unsupported methods without reading or exposing a journal', async () => {
  let reads = 0
  const handler = createPaperDashboardRoute({
    paperService: { readSnapshot: async () => { reads += 1; return { trades: [{ id: 'private-trade' }] } } },
  })
  const recorder = responseRecorder()

  await handler({ request: request('POST'), response: {}, sendJson: recorder.sendJson })

  assert.equal(reads, 0)
  assert.deepEqual(recorder.calls, [{
    status: 405,
    payload: { error: 'Method not allowed.', code: 'METHOD_NOT_ALLOWED' },
  }])
})

test('paper dashboard coalesces concurrent read-only snapshot requests and serves a cached snapshot', async () => {
  let now = 0
  let reads = 0
  let resolveRead
  const handler = createPaperDashboardRoute({
    now: () => now,
    refreshIntervalMs: 60_000,
    paperService: {
      readSnapshot: () => {
        reads += 1
        return new Promise((resolve) => { resolveRead = resolve })
      },
    },
  })
  const first = responseRecorder()
  const second = responseRecorder()

  const firstRequest = handler({ request: request(), response: {}, sendJson: first.sendJson })
  const secondRequest = handler({ request: request(), response: {}, sendJson: second.sendJson })
  await Promise.resolve()
  assert.equal(reads, 1)

  resolveRead({ trades: [{ id: 'trade-1' }] })
  await Promise.all([firstRequest, secondRequest])
  assert.deepEqual(first.calls, [{ status: 200, payload: { trades: [{ id: 'trade-1' }] } }])
  assert.deepEqual(second.calls, [{ status: 200, payload: { trades: [{ id: 'trade-1' }] } }])

  const cached = responseRecorder()
  await handler({ request: request(), response: {}, sendJson: cached.sendJson })
  assert.equal(reads, 1)
  assert.deepEqual(cached.calls, [{ status: 200, payload: { trades: [{ id: 'trade-1' }] } }])

  now = 60_000
  const afterExpiry = responseRecorder()
  const afterExpiryRequest = handler({ request: request(), response: {}, sendJson: afterExpiry.sendJson })
  await Promise.resolve()
  assert.equal(reads, 2)
  resolveRead({ trades: [{ id: 'trade-2' }] })
  await afterExpiryRequest
  assert.deepEqual(afterExpiry.calls, [{ status: 200, payload: { trades: [{ id: 'trade-2' }] } }])
})
