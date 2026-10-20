import dotenv from 'dotenv'
import http from 'node:http'
import { fetchAlpacaHistoricalBars } from './alpacaProxy.js'
import {
  getPaperTradingAccount,
} from './alpacaTrading.js'
import { handlePaperAccountRequest } from './paperAccountRoute.js'
import { createPaperDashboardRoute } from './paperDashboardRoute.js'
import { handlePaperOrderRequest } from './paperOrderRoute.js'
import { createPaperService } from './paperService.js'
import { createResearchInvestigationApi } from './researchInvestigationApi.js'
import { createResearchRunApi } from './researchRunApi.js'
import { dispatchResearchRunRoute } from './researchRunRoute.js'
import { createResearchRunStore } from './researchRunStore.js'
import { handleHistoricalRoute } from './historicalRoute.js'
import { createHistoricalCacheKey } from '../src/research/historicalCacheKey.js'

dotenv.config()

const port = Number(process.env.PORT || 3001)
const paperService = createPaperService()
const handlePaperDashboardRequest = createPaperDashboardRoute({
  paperService,
})
const researchRunStore = process.env.DATABASE_URL
  ? createResearchRunStore()
  : null

const researchRunApi = createResearchRunApi({
  store: researchRunStore,
})

const researchInvestigationApi =
  createResearchInvestigationApi({
    store: researchRunStore,
  })

const ALLOWED_ORIGINS = [
  'https://setupscan.vercel.app',
  'http://localhost:5173',
]

function setCorsHeaders(response, requestOrigin) {
  const origin = ALLOWED_ORIGINS.includes(requestOrigin)
    ? requestOrigin
    : ALLOWED_ORIGINS[0]

  response.setHeader(
    'Access-Control-Allow-Origin',
    origin,
  )

  response.setHeader(
    'Access-Control-Allow-Methods',
    'GET, POST, OPTIONS',
  )

  response.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization',
  )
}

function logCredentialStatus() {
  console.log(
    JSON.stringify({
      alpacaApiKeyPresent:
        Boolean(process.env.ALPACA_API_KEY),

      alpacaApiKeyLength:
        process.env.ALPACA_API_KEY?.length ?? 0,

      alpacaApiSecretPresent:
        Boolean(process.env.ALPACA_API_SECRET),

      alpacaApiSecretLength:
        process.env.ALPACA_API_SECRET?.length ?? 0,
    }),
  )
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    'Content-Type':
      'application/json; charset=utf-8',
  })

  response.end(JSON.stringify(body))
}

const server = http.createServer(
  async (request, response) => {
    setCorsHeaders(response, request.headers.origin)

    if (request.method === 'OPTIONS') {
      response.writeHead(204)
      response.end()
      return
    }

    const url = new URL(
      request.url,
      `http://${request.headers.host}`,
    )

    if (url.pathname === '/api/paper-trading') {
      await handlePaperDashboardRequest({
        request,
        response,
        sendJson,
      })

      return
    }

    if (url.pathname === '/api/trading/paper-account') {
      await handlePaperAccountRequest({
        request,
        response,
        authorizationSecret: process.env.PAPER_ORDER_API_SECRET,
        getAccount: getPaperTradingAccount,
        sendJson,
      })

      return
    }

    if (
      url.pathname ===
        '/api/trading/paper-orders' &&
      request.method === 'POST'
    ) {
      await handlePaperOrderRequest({
        request,
        response,
        authorizationSecret: process.env.PAPER_ORDER_API_SECRET,
        sendJson,
      })

      return
    }

    if (
      await dispatchResearchRunRoute({
        pathname: url.pathname,
        request,
        response,
        url,
        researchRunApi,
      })
    ) {
      return
    }

    if (
      url.pathname ===
        '/api/research-investigations' ||
      url.pathname.startsWith(
        '/api/research-investigations/',
      )
    ) {
      await researchInvestigationApi(
        request,
        response,
        url,
      )

      return
    }

    if (url.pathname !== '/api/historical') {
      sendJson(response, 404, {
        error: 'Not found',
      })

      return
    }

    await handleHistoricalRoute({
      response,
      url,
      fetchHistoricalMarketBars:
        fetchAlpacaHistoricalBars,
      researchRunStore,
      sendJson,
      createHistoricalCacheKey,
    })
  },
  )
server.listen(port, () => {
  logCredentialStatus()

  console.log(
    `SetupScan server listening on http://localhost:${port}`,
  )
})
