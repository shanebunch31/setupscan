import { createHash } from 'node:crypto'
import path from 'node:path'
import { paperObserverCycleHealth } from './paperObserverHealth.js'

// Bind the probe to the API's selected store without publishing its address or credentials.
export function paperStorageIdentity(environment = process.env) {
  let target
  if (environment.DATABASE_URL) {
    try {
      const url = new URL(environment.DATABASE_URL)
      target = `postgres:${url.hostname}:${url.port || '5432'}:${url.pathname}`
    } catch { return null }
  } else target = `json:${path.resolve('server/data/paper-trades.json')}`
  return createHash('sha256').update(target).digest('hex')
}

export function createPaperObserverStatusReader({ environment = process.env, fetchStatus = fetch, timeoutMs = 3000 } = {}) {
  const endpoint = environment.PAPER_OBSERVER_STATUS_URL || `http://127.0.0.1:${environment.OBSERVER_PORT || 3102}/api/paper-observer/status`
  const identity = paperStorageIdentity(environment)
  return async () => {
    const controller = new AbortController()
    let timer
    try {
      const response = await Promise.race([
        Promise.resolve().then(async () => {
          const response = await fetchStatus(endpoint, { signal: controller.signal, redirect: 'error', cache: 'no-store' })
          if (![200, 503].includes(response.status)) throw new Error('Invalid health response')
          return response.json()
        }),
        new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Probe timeout')) }, timeoutMs) }),
      ])
      if (response?.healthVersion !== 1 || !identity || response.storageIdentity !== identity) return { available: true, verified: false }
      return { available: true, verified: true, observer: response }
    } catch { return { available: false, verified: false } }
    finally { clearTimeout(timer) }
  }
}

const providerFailures = new Set(['EMPTY', 'STALE', 'INCOMPLETE', 'FETCH_ERROR', 'TIMEOUT'])
const safeFailureCodes = new Set(['PAPER_STATE_CONFLICT', 'PAPER_COMMIT_UNCERTAIN', 'PAPER_DB_TIMEOUT', 'PAPER_CYCLE_FAILED', 'PAPER_SAVE_FAILED'])
export function projectPaperOperationalStatus(journal, probe, now = new Date()) {
  const live = probe?.verified ? probe.observer : null
  const cycle = live ? paperObserverCycleHealth(live, now, true) : null
  const observations = Object.values(live?.symbolResults ?? {})
  // Baseline requirements are recovered by the worker. A live scheduler or a
  // closed-market poll does not establish readiness for those symbols.
  const baselinePendingSymbols = Array.isArray(live?.baselinePendingSymbols) ? [...live.baselinePendingSymbols] : null
  const provider = !live ? 'UNKNOWN' : live.cycleOutcome === 'MARKET_CLOSED' ? 'NOT_REQUESTED'
    : observations.some(row => providerFailures.has(row.dataStatus)) ? 'FAILED'
    : observations.some(row => row.dataStatus === 'PROCESSING_ERROR') ? 'UNKNOWN'
    : observations.length && observations.every(row => ['FRESH', 'NO_NEW_DATA', 'WAITING_FOR_COMPLETION'].includes(row.dataStatus)) ? 'AVAILABLE' : 'UNKNOWN'
  const worker = !probe?.available ? 'UNAVAILABLE' : !live ? 'UNVERIFIED'
    : live.shuttingDown ? 'STOPPING' : live.failureStage === 'STARTUP' ? 'STARTING'
    : live.schedulerRunning !== true ? 'STOPPED' : cycle.overdue ? 'OVERDUE' : 'ALIVE'
  const processing = live?.failureStage === 'PERSISTENCE' ? 'PERSISTENCE_FAILED'
    : live?.cycleOutcome === 'ERROR' || observations.some(row => row.dataStatus === 'PROCESSING_ERROR') ? 'FAILED' : live ? 'OK' : 'UNKNOWN'
  const healthy = worker === 'ALIVE' && live.runtimeCycleCompleted === true && baselinePendingSymbols?.length === 0 && processing === 'OK' &&
    (provider === 'AVAILABLE' || live.cycleOutcome === 'MARKET_CLOSED' || live.cycleOutcome === 'NO_SYMBOLS') && cycle.overdue === false
  const state = worker !== 'ALIVE' ? worker : processing === 'PERSISTENCE_FAILED' ? 'PERSISTENCE_FAILED'
    : processing === 'FAILED' ? 'PROCESSING_FAILED' : provider === 'FAILED' ? 'PROVIDER_FAILED'
    : live?.runtimeCycleCompleted !== true ? 'CHECKING' : baselinePendingSymbols === null ? 'RECOVERY_UNVERIFIED'
    : baselinePendingSymbols.length ? 'BASELINE_PENDING' : !healthy ? 'CHECKING' : live.cycleOutcome === 'MARKET_CLOSED' ? 'MARKET_CLOSED'
    : live.cycleOutcome === 'NO_SYMBOLS' ? 'NO_SYMBOLS' : live.cycleOutcome === 'NO_NEW_DATA' ? 'WAITING' : 'HEALTHY'
  const labels = {
    UNAVAILABLE: 'Observer worker unavailable', UNVERIFIED: 'Observer health cannot be verified for this journal',
    STOPPING: 'Observer shutting down', STOPPED: 'Observer scheduler stopped', STARTING: 'Observer not ready; startup pending or failed',
    OVERDUE: 'Observer stale / overdue', PERSISTENCE_FAILED: 'Observer persistence failed or unconfirmed',
    PROCESSING_FAILED: 'Observer processing failed', PROVIDER_FAILED: 'Latest provider cycle failed', CHECKING: 'Observer health not yet confirmed',
    BASELINE_PENDING: 'Observer alive · symbol baseline pending', RECOVERY_UNVERIFIED: 'Observer recovery status unavailable',
    MARKET_CLOSED: 'Observer alive · outside regular session', NO_SYMBOLS: 'Observer alive · no symbols to manage',
    WAITING: 'Observer healthy · waiting for next completed decision bar', HEALTHY: 'Paper Observer healthy',
  }
  return {
    state, label: labels[state], healthy, worker, provider, processing,
    checkedAt: now.toISOString(), deadlineAt: cycle?.deadlineAt ?? null,
    runtimeStartedAt: live?.runtimeStartedAt ?? null, cycleOutcome: live?.cycleOutcome ?? null, baselinePendingSymbols,
    pollIntervalMs: live?.config?.pollIntervalMs ?? null,
    journal: journal ? 'AVAILABLE' : 'UNAVAILABLE', journalReadAt: journal?.refreshedAt ?? null,
    persistedCycleHealth: paperObserverCycleHealth(journal?.observer, now),
    openPositions: journal ? (journal.trades ?? []).filter(row => row.status === 'open').length : null,
    universe: journal?.symbolUniverse ?? null,
    lastCycleCompletedAt: live?.runtimeCycleCompleted ? live.lastCycleCompletedAt ?? null : null,
    lastSuccessfulMarketDataCycleAt: live?.lastSuccessfulMarketDataCycleAt ?? null,
    failureCode: safeFailureCodes.has(live?.failureCode) ? live.failureCode : null,
    errorRecordingFailureCode: safeFailureCodes.has(live?.errorRecordingFailureCode) ? live.errorRecordingFailureCode : null,
    lastUncertainCommitAt: live?.lastUncertainCommitAt ?? null,
    // Only the read journal supplies durable checkpoints. Runtime progress may not have committed.
    checkpoints: Object.entries(journal?.observer?.processedCandles ?? {}).map(([symbol, timestamp]) => ({
      symbol, timestamp, enabled: journal?.symbolUniverse?.initialized === true ? journal.symbolUniverse.symbols.includes(symbol) : null,
      observationStatus: journal?.observer?.symbolResults?.[symbol]?.dataStatus ?? null,
      decisions: (journal?.observer?.decisionHistoryBySymbol?.[symbol] ?? []).slice(-20),
    })),
  }
}
