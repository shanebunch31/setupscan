const DEFAULT_REFRESH_INTERVAL_MS = 60_000

export function createPaperDashboardRoute({
  paperService,
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

    try {
      sendJson(response, 200, await (refreshInFlight ?? snapshot))
    } catch (error) {
      sendJson(
        response,
        error.code === 'MISSING_ALPACA_ENV' ? 503 : 502,
        { error: error.message },
      )
    }
  }
}
