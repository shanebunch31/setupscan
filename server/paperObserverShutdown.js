export function resolvePaperShutdownTimeout(value) {
  const requested = Number(value)
  return Number.isFinite(requested) && requested >= 1 ? Math.min(120000, Math.floor(requested)) : 30000
}

export async function withShutdownDeadline(work, timeoutMs) {
  let timer
  const expiresAt = Date.now() + timeoutMs
  const timeoutError = () => Object.assign(new Error('Paper observer shutdown deadline exceeded.'), { code: 'PAPER_SHUTDOWN_TIMEOUT' })
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(timeoutError()), timeoutMs)
  })
  try {
    const result = await Promise.race([work, deadline])
    // A delayed timer must not turn work that exceeded the deadline into success.
    if (Date.now() >= expiresAt) throw timeoutError()
    return result
  } finally { clearTimeout(timer) }
}

// Dependencies are supplied by the entrypoint; tests need no server or database.
export function createPaperObserverShutdown({ getObserver, stopStartup, waitForStartup, server,
  timeoutMs, signals = process, exit = (code) => process.exit(code), log = console.log, logError = console.error }) {
  let stopping = false
  let finished = false
  let shutdownPromise
  function shutdown() {
    if (shutdownPromise) return shutdownPromise
    stopping = true
    const drainAndClose = async () => {
      stopStartup()
      // stop() synchronously gates new work; observe startup rejection immediately too.
      const initialDrain = getObserver()?.stop()
      await Promise.all([initialDrain, waitForStartup()])
      if (finished) return
      const observer = getObserver()
      await observer?.stop()
      if (finished) return
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
      if (finished) return
      await observer?.close()
    }
    shutdownPromise = withShutdownDeadline(drainAndClose(), timeoutMs).then(() => {
      finished = true
      log('Paper observer graceful shutdown complete; active work drained and resources closed.')
      exit(0)
    }, (error) => {
      finished = true
      // Do not log arbitrary database/provider errors, which may contain secrets.
      logError(error?.code === 'PAPER_SHUTDOWN_TIMEOUT'
        ? 'Paper observer shutdown deadline exceeded; forced termination required. Active work may not have completed.'
        : 'Paper observer shutdown failed; forced termination required. Completion is not confirmed.')
      exit(1)
    })
    return shutdownPromise
  }
  signals.on('SIGINT', shutdown)
  signals.on('SIGTERM', shutdown)
  return { shutdown, isStopping: () => stopping }
}
