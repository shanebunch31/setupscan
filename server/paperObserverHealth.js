/** Timestamp-based health only: a persisted snapshot cannot prove process liveness. */
export function paperObserverCycleHealth(observer, current = new Date(), live = false) {
  const active = live ? observer?.cycleActive === true : null
  const deadlineAt = live && active ? observer?.cycleDeadlineAt : observer?.nextCycleOverdueAt
  const deadline = Date.parse(deadlineAt)
  // A closed-session snapshot is deliberately not a heartbeat. Do not infer a
  // dead worker from a weekend snapshot or invent health for legacy records.
  const assessable = Number.isFinite(deadline) && (live || observer?.cycleOutcome !== 'MARKET_CLOSED')
  return {
    source: live ? 'LIVE_WORKER' : 'PERSISTED_SNAPSHOT',
    active,
    startedAt: observer?.cycleStartedAt ?? null,
    lastCompletedAt: observer?.lastCycleCompletedAt ?? null,
    deadlineAt: deadlineAt ?? null,
    overdue: assessable ? current.getTime() > deadline : null,
  }
}
