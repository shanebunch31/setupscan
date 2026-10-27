import dotenv from 'dotenv'
import http from 'node:http'
import { createPaperObserver } from './paperObserverCore.js'
import { describeDatabaseUrl } from './postgresPaperStore.js'
import { createPaperObserverShutdown, resolvePaperShutdownTimeout } from './paperObserverShutdown.js'

dotenv.config()
const port = Number(process.env.OBSERVER_PORT || 3102)
const requestedStartupRetryBase = Number(process.env.OBSERVER_STARTUP_RETRY_MS || 60000)
const startupRetryBaseMs = Number.isFinite(requestedStartupRetryBase) ? Math.max(1000, requestedStartupRetryBase) : 60000
const requestedStartupRetryMax = Number(process.env.OBSERVER_STARTUP_RETRY_MAX_MS || 15 * 60 * 1000)
const startupRetryMaxMs = Number.isFinite(requestedStartupRetryMax) ? Math.max(startupRetryBaseMs, requestedStartupRetryMax) : 15 * 60 * 1000
let observer = null
let startupError = null
let startupFailures = 0
let startupTimer
let startupPromise

function startupRetryDelay() {
  return Math.min(startupRetryMaxMs, startupRetryBaseMs * (2 ** Math.min(Math.max(0, startupFailures - 1), 8)))
}

function startObserver() {
  if (observer || lifecycle.isStopping()) return
  if (startupPromise) return startupPromise
  startupPromise = initializeObserver().finally(() => { startupPromise = null })
  return startupPromise
}

async function initializeObserver() {
  try {
    if (process.env.DATABASE_URL) {
      const { username, host, port: dbPort, database } = describeDatabaseUrl(process.env.DATABASE_URL)
      console.log(`DATABASE_URL detected -> user=${username} host=${host} port=${dbPort} database=${database} (password redacted)`)
    } else {
      console.log('DATABASE_URL not set — falling back to local JSON store (not suitable for production)')
    }
    observer = await createPaperObserver()
    startupError = null
    startupFailures = 0
    if (!lifecycle.isStopping()) observer.start()
  } catch (error) {
    if (lifecycle.isStopping()) throw error
    startupFailures += 1
    startupError = error.message
    const delay = startupRetryDelay()
    console.error(`Paper observer startup failed; retrying in ${delay}ms:`, error.message)
    startupTimer = setTimeout(() => { startObserver()?.catch(() => {}) }, delay)
  }
}

function observerStatus() {
  if (observer) return observer.status()
  return {
    status: 'ERROR',
    shuttingDown: lifecycle.isStopping(),
    currentError: startupError ?? 'Paper observer has not started.',
    consecutiveFailures: startupFailures,
    mode: 'AUTOMATED PAPER OBSERVER — NO REAL ORDERS',
  }
}

function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(body))
}

const server = http.createServer((request, response) => {
  if (request.url === '/health' || request.url === '/api/paper-observer/status') {
    const status = observerStatus()
    sendJson(response, status.status === 'ERROR' ? 503 : 200, status)
    return
  }
  sendJson(response, 404, { error: 'Not found' })
})

const lifecycle = createPaperObserverShutdown({
  getObserver: () => observer,
  stopStartup: () => { if (startupTimer) clearTimeout(startupTimer) },
  waitForStartup: () => startupPromise,
  server,
  timeoutMs: resolvePaperShutdownTimeout(process.env.PAPER_SHUTDOWN_TIMEOUT_MS),
})

server.listen(port, () => {
  console.log('AUTOMATED PAPER OBSERVER — NO REAL ORDERS')
  console.log(`Observer status listening on http://localhost:${port}`)
  startObserver()?.catch(() => {}) // Shutdown owns any in-flight startup rejection.
})
