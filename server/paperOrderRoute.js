import { submitPaperOrder } from './alpacaTrading.js'
import { isAuthorizedBearerRequest } from './paperTradingAuthorization.js'

export function isAuthorizedPaperOrderRequest(authorizationHeader, authorizationSecret) {
  return isAuthorizedBearerRequest(authorizationHeader, authorizationSecret)
}

export async function handlePaperOrderRequest({
  request,
  response,
  authorizationSecret,
  submitOrder = submitPaperOrder,
  sendJson,
}) {
  if (typeof authorizationSecret !== 'string' || authorizationSecret.length === 0) {
    sendJson(response, 503, {
      error: 'Paper-order submission is disabled because its authorization secret is not configured.',
      code: 'PAPER_ORDER_AUTH_NOT_CONFIGURED',
    })
    return
  }

  if (!isAuthorizedPaperOrderRequest(request.headers?.authorization, authorizationSecret)) {
    sendJson(response, 401, { error: 'Unauthorized.', code: 'UNAUTHORIZED' })
    return
  }

  try {
    let body = ''
    for await (const chunk of request) body += chunk
    const order = body ? JSON.parse(body) : {}
    sendJson(response, 201, await submitOrder(order))
  } catch (error) {
    const status = error.code === 'INVALID_PAPER_ORDER'
      ? 400
      : error.code === 'MISSING_ALPACA_ENV'
        ? 503
        : error.status || 502
    sendJson(response, status, { error: error.message, code: error.code ?? null })
  }
}
