import assert from 'node:assert/strict'
import { test } from 'node:test'
import { handlePaperAccountRequest } from './paperAccountRoute.js'

function request({ method = 'GET', authorization } = {}) {
  return {
    method,
    headers: authorization === undefined ? {} : { authorization },
  }
}

function responseRecorder() {
  const calls = []
  return { calls, sendJson: (_response, status, payload) => calls.push({ status, payload }) }
}

test('paper-account access fails closed when its authorization secret is missing', async () => {
  const recorder = responseRecorder()
  let requested = 0
  await handlePaperAccountRequest({
    request: request({ authorization: 'Bearer test-secret' }),
    response: {},
    getAccount: async () => { requested += 1 },
    sendJson: recorder.sendJson,
  })

  assert.equal(requested, 0)
  assert.equal(recorder.calls[0].status, 503)
  assert.equal(recorder.calls[0].payload.code, 'PAPER_ACCOUNT_AUTH_NOT_CONFIGURED')
})

test('paper-account access rejects missing or invalid credentials before retrieving Alpaca data', async () => {
  for (const authorization of [undefined, 'Basic test-secret', 'Bearer wrong-secret']) {
    const recorder = responseRecorder()
    let requested = 0
    await handlePaperAccountRequest({
      request: request({ authorization }),
      response: {},
      authorizationSecret: 'test-secret',
      getAccount: async () => { requested += 1 },
      sendJson: recorder.sendJson,
    })

    assert.equal(requested, 0)
    assert.deepEqual(recorder.calls, [{
      status: 401,
      payload: { error: 'Unauthorized.', code: 'UNAUTHORIZED' },
    }])
  }
})

test('paper-account access accepts an authorized GET and omits Alpaca raw data', async () => {
  const recorder = responseRecorder()
  await handlePaperAccountRequest({
    request: request({ authorization: 'Bearer test-secret' }),
    response: {},
    authorizationSecret: 'test-secret',
    getAccount: async () => ({ environment: 'paper', cash: '1000', equity: '1000', raw: { id: 'sensitive-provider-payload' } }),
    sendJson: recorder.sendJson,
  })

  assert.deepEqual(recorder.calls, [{
    status: 200,
    payload: { environment: 'paper', cash: '1000', equity: '1000' },
  }])
})

test('paper-account access only accepts GET and never retrieves Alpaca data for another method', async () => {
  const recorder = responseRecorder()
  let requested = 0
  await handlePaperAccountRequest({
    request: request({ method: 'POST', authorization: 'Bearer test-secret' }),
    response: {},
    authorizationSecret: 'test-secret',
    getAccount: async () => { requested += 1 },
    sendJson: recorder.sendJson,
  })

  assert.equal(requested, 0)
  assert.deepEqual(recorder.calls, [{
    status: 405,
    payload: { error: 'Method not allowed.', code: 'METHOD_NOT_ALLOWED' },
  }])
})
