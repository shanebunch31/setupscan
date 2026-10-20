import assert from 'node:assert/strict'
import { test } from 'node:test'
import { handlePaperOrderRequest, isAuthorizedPaperOrderRequest } from './paperOrderRoute.js'

function request({ authorization, body = '' } = {}) {
  return {
    headers: authorization === undefined ? {} : { authorization },
    async *[Symbol.asyncIterator]() {
      if (body) yield body
    },
  }
}

function responseRecorder() {
  const calls = []
  return { calls, sendJson: (_response, status, payload) => calls.push({ status, payload }) }
}

test('paper-order authorization rejects missing and malformed bearer credentials', () => {
  assert.equal(isAuthorizedPaperOrderRequest(undefined, 'test-secret'), false)
  assert.equal(isAuthorizedPaperOrderRequest('Basic test-secret', 'test-secret'), false)
  assert.equal(isAuthorizedPaperOrderRequest('Bearer ', 'test-secret'), false)
  assert.equal(isAuthorizedPaperOrderRequest('Bearer wrong-secret', 'test-secret'), false)
  assert.equal(isAuthorizedPaperOrderRequest('Bearer test-secret', ''), false)
})

test('missing paper-order authorization configuration disables submission before reading or submitting an order', async () => {
  const recorder = responseRecorder()
  let submitted = 0
  await handlePaperOrderRequest({
    request: request({ authorization: 'Bearer test-secret', body: '{"symbol":"SPY"}' }),
    response: {},
    authorizationSecret: undefined,
    submitOrder: async () => { submitted += 1 },
    sendJson: recorder.sendJson,
  })

  assert.equal(submitted, 0)
  assert.deepEqual(recorder.calls, [{
    status: 503,
    payload: {
      error: 'Paper-order submission is disabled because its authorization secret is not configured.',
      code: 'PAPER_ORDER_AUTH_NOT_CONFIGURED',
    },
  }])
})

test('missing or invalid paper-order authorization never reaches submitPaperOrder', async () => {
  for (const authorization of [undefined, 'Bearer wrong-secret']) {
    const recorder = responseRecorder()
    let submitted = 0
    await handlePaperOrderRequest({
      request: request({ authorization, body: '{"symbol":"SPY"}' }),
      response: {},
      authorizationSecret: 'test-secret',
      submitOrder: async () => { submitted += 1 },
      sendJson: recorder.sendJson,
    })

    assert.equal(submitted, 0)
    assert.deepEqual(recorder.calls, [{
      status: 401,
      payload: { error: 'Unauthorized.', code: 'UNAUTHORIZED' },
    }])
  }
})

test('valid paper-order authorization reaches submitPaperOrder with the parsed request body', async () => {
  const recorder = responseRecorder()
  const submittedOrders = []
  await handlePaperOrderRequest({
    request: request({ authorization: 'Bearer test-secret', body: '{"symbol":"SPY","side":"buy","qty":1}' }),
    response: {},
    authorizationSecret: 'test-secret',
    submitOrder: async (order) => {
      submittedOrders.push(order)
      return { id: 'paper-order-1' }
    },
    sendJson: recorder.sendJson,
  })

  assert.deepEqual(submittedOrders, [{ symbol: 'SPY', side: 'buy', qty: 1 }])
  assert.deepEqual(recorder.calls, [{ status: 201, payload: { id: 'paper-order-1' } }])
})
