import { projectPaperOperationalStatus } from './paperObserverStatus.js'
const DEFAULT_REFRESH_INTERVAL_MS = 60_000

export function createPaperDashboardRoute({
  paperService,
  readWorkerStatus = null,
  now = () => Date.now(),
  refreshIntervalMs = DEFAULT_REFRESH_INTERVAL_MS,
}) {
  let snapshot = null
  let refreshedAtMs = null
  let refreshInFlight = null

  return async function handlePaperDashboardRequest({ request, response, sendJson }) {
    if (request.method !== 'GET') {
      sendJson(response, 405, {
        error: 'Method not allowed.',
        code: 'METHOD_NOT_ALLOWED',
      })
      return
    }

    const refreshDue = snapshot === null
      || refreshedAtMs === null
      || now() - refreshedAtMs >= refreshIntervalMs

    if (refreshDue && !refreshInFlight) {
      refreshInFlight = Promise.resolve()
        .then(() => paperService.readSnapshot())
        .then((nextSnapshot) => {
          snapshot = nextSnapshot
          refreshedAtMs = now()
          return snapshot
        })
        .finally(() => {
          refreshInFlight = null
        })
    }

    // Probe on every request, independently of the read-only journal cache.
    const workerPromise = readWorkerStatus ? Promise.resolve().then(readWorkerStatus).catch(() => ({ available: false })) : null
    try {
      const journal = await (refreshInFlight ?? snapshot)
      const operational = workerPromise ? projectPaperOperationalStatus(journal, await workerPromise, new Date(now())) : null
      response.setHeader?.('Cache-Control', 'no-store')
      sendJson(response, 200, operational ? { ...journal, operational, refreshIntervalMs } : journal)
    } catch (error) {
      sendJson(
        response,
        error.code === 'MISSING_ALPACA_ENV' ? 503 : 502,
        { error: 'Paper journal unavailable.', ...(workerPromise ? { operational: projectPaperOperationalStatus(null, await workerPromise, new Date(now())), refreshIntervalMs } : {}) },
      )
    }
  }
}
