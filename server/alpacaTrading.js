const PAPER_TRADING_BASE_URL = 'https://paper-api.alpaca.markets/v2'

const requiredEnvironmentVariables = [
  'ALPACA_API_KEY',
  'ALPACA_API_SECRET',
]

function getMissingEnvironmentVariables(environment = process.env) {
  return requiredEnvironmentVariables.filter((name) => !environment[name])
}

async function alpacaRequest(path, {
  method = 'GET',
  body = null,
  environment = process.env,
  fetchImpl = fetch,
} = {}) {
  const missing = getMissingEnvironmentVariables(environment)

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
        'APCA-API-KEY-ID': environment.ALPACA_API_KEY,
        'APCA-API-SECRET-KEY': environment.ALPACA_API_SECRET,
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
      message: text || 'Alpaca returned a non-JSON response.',
    }
  }

  if (!response.ok) {
    const error = new Error(
      payload?.message ||
        `Alpaca trading request failed with status ${response.status}`,
    )

    error.code = 'ALPACA_TRADING_REQUEST_FAILED'
    error.status = response.status
    error.alpaca = payload

    throw error
  }

  return payload
}

export async function getPaperTradingAccount(options = {}) {
  const account = await alpacaRequest('/account', options)

  return {
    environment: 'paper',
    accountId: account.id ?? null,
    status: account.status ?? null,
    currency: account.currency ?? null,
    buyingPower: account.buying_power ?? null,
    cash: account.cash ?? null,
    equity: account.equity ?? null,
    lastEquity: account.last_equity ?? null,
    optionsBuyingPower: account.options_buying_power ?? null,
    optionsApprovedLevel: account.options_approved_level ?? null,
    optionsTradingLevel: account.options_trading_level ?? null,
    tradingBlocked: account.trading_blocked ?? null,
    accountBlocked: account.account_blocked ?? null,
    raw: account,
  }
}

export { alpacaRequest, getMissingEnvironmentVariables }