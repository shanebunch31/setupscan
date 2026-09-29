const PAPER_TRADING_BASE_URL =
  'https://paper-api.alpaca.markets/v2'

const requiredEnvironmentVariables = [
  'ALPACA_API_KEY',
  'ALPACA_API_SECRET',
]

function getMissingEnvironmentVariables(
  environment = process.env,
) {
  return requiredEnvironmentVariables.filter(
    (name) => !environment[name],
  )
}

async function alpacaRequest(
  path,
  {
    method = 'GET',
    body = null,
    environment = process.env,
    fetchImpl = fetch,
  } = {},
) {
  const missing =
    getMissingEnvironmentVariables(environment)

  if (missing.length) {
    const error = new Error(
      `Missing required environment variables: ${missing.join(', ')}`,
    )
    error.code = 'MISSING_ALPACA_ENV'
    throw error
  }

  const response = await fetchImpl(
    `${PAPER_TRADING_BASE_URL}${path}`,
    {
      method,
      headers: {
        'APCA-API-KEY-ID':
          environment.ALPACA_API_KEY,
        'APCA-API-SECRET-KEY':
          environment.ALPACA_API_SECRET,
        'Content-Type': 'application/json',
      },
      ...(body == null
        ? {}
        : {
            body: JSON.stringify(body),
          }),
    },
  )

  const text = await response.text()

  let payload = null

  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    payload = {
      message:
        text ||
        'Alpaca returned a non-JSON response.',
    }
  }

  if (!response.ok) {
    const error = new Error(
      payload?.message ||
        `Alpaca trading request failed with status ${response.status}`,
    )

    error.code =
      'ALPACA_TRADING_REQUEST_FAILED'
    error.status = response.status
    error.alpaca = payload

    throw error
  }

  return payload
}

async function getPaperTradingAccount(
  options = {},
) {
  const account = await alpacaRequest(
    '/account',
    options,
  )

  return {
    environment: 'paper',
    accountId: account.id ?? null,
    status: account.status ?? null,
    currency: account.currency ?? null,
    buyingPower:
      account.buying_power ?? null,
    cash: account.cash ?? null,
    equity: account.equity ?? null,
    lastEquity:
      account.last_equity ?? null,
    optionsBuyingPower:
      account.options_buying_power ?? null,
    optionsApprovedLevel:
      account.options_approved_level ?? null,
    optionsTradingLevel:
      account.options_trading_level ?? null,
    tradingBlocked:
      account.trading_blocked ?? null,
    accountBlocked:
      account.account_blocked ?? null,
    raw: account,
  }
}

async function submitPaperOrder({
  symbol,
  side,
  qty,
  type = 'market',
  timeInForce = 'day',
  limitPrice = null,
  environment = process.env,
  fetchImpl = fetch,
} = {}) {
  const normalizedSymbol = String(
    symbol || '',
  )
    .trim()
    .toUpperCase()

  const normalizedSide = String(
    side || '',
  )
    .trim()
    .toLowerCase()

  const normalizedType = String(
    type || '',
  )
    .trim()
    .toLowerCase()

  const normalizedTimeInForce = String(
    timeInForce || '',
  )
    .trim()
    .toLowerCase()

  if (!normalizedSymbol) {
    const error = new Error(
      'Symbol is required.',
    )
    error.code = 'INVALID_PAPER_ORDER'
    throw error
  }

  if (!['buy', 'sell'].includes(normalizedSide)) {
    const error = new Error(
      'Side must be buy or sell.',
    )
    error.code = 'INVALID_PAPER_ORDER'
    throw error
  }

  const quantity = Number(qty)

  if (
    !Number.isFinite(quantity) ||
    quantity <= 0
  ) {
    const error = new Error(
      'Quantity must be greater than zero.',
    )
    error.code = 'INVALID_PAPER_ORDER'
    throw error
  }

  if (
    !['market', 'limit'].includes(
      normalizedType,
    )
  ) {
    const error = new Error(
      'Order type must be market or limit.',
    )
    error.code = 'INVALID_PAPER_ORDER'
    throw error
  }

  if (
    !['day', 'gtc'].includes(
      normalizedTimeInForce,
    )
  ) {
    const error = new Error(
      'Time in force must be day or gtc.',
    )
    error.code = 'INVALID_PAPER_ORDER'
    throw error
  }

  if (
    normalizedType === 'limit' &&
    (!Number.isFinite(Number(limitPrice)) ||
      Number(limitPrice) <= 0)
  ) {
    const error = new Error(
      'A positive limit price is required for limit orders.',
    )
    error.code = 'INVALID_PAPER_ORDER'
    throw error
  }

  const body = {
    symbol: normalizedSymbol,
    qty: String(quantity),
    side: normalizedSide,
    type: normalizedType,
    time_in_force: normalizedTimeInForce,
  }

  if (normalizedType === 'limit') {
    body.limit_price = String(
      Number(limitPrice),
    )
  }

  return alpacaRequest('/orders', {
    method: 'POST',
    body,
    environment,
    fetchImpl,
  })
}

export {
  alpacaRequest,
  getMissingEnvironmentVariables,
  getPaperTradingAccount,
  submitPaperOrder,
}