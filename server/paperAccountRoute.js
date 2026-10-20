import { getPaperTradingAccount } from './alpacaTrading.js'
import { isAuthorizedBearerRequest } from './paperTradingAuthorization.js'

function accountResponse(account) {
  const { raw: _raw, ...summary } = account ?? {}
  return summary
}

export async function handlePaperAccountRequest({
  request,
  response,
  authorizationSecret,
  getAccount = getPaperTradingAccount,
  sendJson,
}) {
  if (request.method !== 'GET') {
    sendJson(response, 405, {
      error: 'Method not allowed.',
      code: 'METHOD_NOT_ALLOWED',
    })
    return
  }

  if (typeof authorizationSecret !== 'string' || authorizationSecret.length === 0) {
    sendJson(response, 503, {
      error: 'Paper-account access is disabled because its authorization secret is not configured.',
      code: 'PAPER_ACCOUNT_AUTH_NOT_CONFIGURED',
    })
    return
  }

  if (!isAuthorizedBearerRequest(request.headers?.authorization, authorizationSecret)) {
    sendJson(response, 401, { error: 'Unauthorized.', code: 'UNAUTHORIZED' })
    return
  }

  try {
    sendJson(response, 200, accountResponse(await getAccount()))
  } catch (error) {
    const status = error.code === 'MISSING_ALPACA_ENV'
      ? 503
      : error.status || 502
    sendJson(response, status, { error: error.message, code: error.code ?? null })
  }
}
