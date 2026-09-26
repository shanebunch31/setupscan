import dotenv from 'dotenv'
import http from 'node:http'
import { fetchAlpacaHistoricalBars } from './alpacaProxy.js'
import { createPaperService } from './paperService.js'
import { createResearchRunApi } from './researchRunApi.js'
import { createResearchRunStore } from './researchRunStore.js'

dotenv.config()

const port = Number(process.env.PORT || 3001)
const paperService = createPaperService()
const researchRunStore = process.env.DATABASE_URL ? createResearchRunStore() : null
const researchRunApi = createResearchRunApi({ store: researchRunStore })
const ALLOWED_ORIGIN = 'https://setupscan.vercel.app'

function setCorsHeaders(response) {
  response.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN)
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
}

function logCredentialStatus() {
  console.log(JSON.stringify({
    alpacaApiKeyPresent: Boolean(process.env.ALPACA_API_KEY),
    alpacaApiKeyLength: process.env.ALPACA_API_KEY?.length ?? 0,
    alpacaApiSecretPresent: Boolean(process.env.ALPACA_API_SECRET),
    alpacaApiSecretLength: process.env.ALPACA_API_SECRET?.length ?? 0,
  }))
}

function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(body))
}

const server = http.createServer(async (request, response) => {
  setCorsHeaders(response)
  if (request.method === 'OPTIONS') {
    response.writeHead(204)
    response.end()
    return
  }

  const url = new URL(request.url, `http://${request.headers.host}`)
  if (url.pathname === '/api/paper-trading') {
    try {
      sendJson(response, 200, await paperService.refresh())
    } catch (error) {
      sendJson(response, error.code === 'MISSING_ALPACA_ENV' ? 503 : 502, { error: error.message })
    }
    return
  }
  if (url.pathname === '/api/research-runs' || url.pathname.startsWith('/api/research-runs/')) {
    await researchRunApi(request, response, url)
    return
  }
  if (url.pathname !== '/api/historical') {
    sendJson(response, 404, { error: 'Not found' })
    return
  }

  try {
    const data = await fetchAlpacaHistoricalBars({
      symbol: url.searchParams.get('symbol') || 'SPY',
      timeframe: url.searchParams.get('timeframe') || '1Hour',
      start: url.searchParams.get('start') || undefined,
      end: url.searchParams.get('end') || undefined,
    })
    sendJson(response, 200, data)
  } catch (error) {
    const status = error.code === 'MISSING_ALPACA_ENV' ? 503 : error.status || 502
    sendJson(response, status, { error: error.message })
  }
})

server.listen(port, () => {
  logCredentialStatus()
  console.log(`SetupScan server listening on http://localhost:${port}`)
})