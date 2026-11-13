import { shadowTiming } from '../src/research/shadowTiming.js'
import { validateAndOrderHistoricalCandles } from '../src/data/marketData.js'
import { candleCompletesBy, historicalCandleEndTime } from '../src/data/historicalDataContract.js'
import { evaluateShadowDecision, resolveShadowOccurrence } from '../src/research/shadowForward.js'

const canonical = (bar) => ({ timestamp: new Date(bar.timestamp).toISOString(), open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume, timeframe: '1Hour' })
export async function prepareShadowCycle(before, { fetchBars, observedAt, sourceFingerprint, clock = () => observedAt }) {
  const { tracking, checkpoint } = before
  if (tracking.sourceFingerprint !== sourceFingerprint || !['shadow-forward-1', 'shadow-forward-2'].includes(tracking.candidate.forwardVersion)) throw failure('SOURCE_MISMATCH', 'Frozen calculation source differs; create a separately reviewed version')
  const timing = shadowTiming(tracking.candidate.forwardVersion)
  const raw = structuredClone(before.raw)
  const newCandles = []
  for (const symbol of tracking.symbols) {
    const existing = raw[symbol]
    let payload
    try { payload = await fetchBars({ symbol, timeframe: '1Hour', start: existing.at(-1)?.timestamp ?? tracking.historyStart, end: observedAt }) }
    catch (error) { throw Object.assign(error, { shadowCode: 'PROVIDER_REQUEST_FAILED' }) }
    // The provider's count heuristic expects >=20 bars even for one-bar incremental ranges.
    // The dedicated adapter confirms that pagination finished; retain the count check for bootstrap only.
    if (payload.paginationComplete !== true || (!existing.length && payload.complete !== true) || payload.provider !== tracking.provider || payload.adjustmentMode !== tracking.adjustmentMode) throw failure('INCOMPATIBLE_DATA', 'Incomplete or incompatible shadow data')
    const validated = validateAndOrderHistoricalCandles(payload.candles)
    if (validated.dataQuality.rejectedCandleCount) throw failure('INVALID_CANDLES', 'Invalid shadow candles; cycle not committed')
    // Reject conflicting duplicates instead of silently choosing a revised observation.
    const seen = new Map(existing.map((bar) => [bar.timestamp, JSON.stringify(canonical(bar))]))
    for (const supplied of payload.candles) {
      if (supplied.timeframe !== '1Hour' || supplied.symbol !== symbol) throw failure('INCOMPATIBLE_DATA', 'Unexpected symbol or timeframe')
      if (!candleCompletesBy(supplied, '1Hour', observedAt) || historicalCandleEndTime(supplied.timestamp, '1Hour') + timing.publicationGraceMs > Date.parse(observedAt)) continue
      const bar = canonical(supplied)
      if (Date.parse(bar.timestamp) < Date.parse(tracking.historyStart)) continue
      const previous = seen.get(bar.timestamp)
      if (previous && previous !== JSON.stringify(bar)) throw failure('PROVIDER_REVISION', 'Provider revised a frozen candle; manual review required')
      if (!previous) {
        if (existing.length && bar.timestamp <= existing.at(-1).timestamp) throw failure('LATE_INSERTION', 'Late historical insertion requires manual review')
        seen.set(bar.timestamp, JSON.stringify(bar))
        newCandles.push({ symbol, candle: bar })
      }
    }
    raw[symbol] = [...seen.values()].map(JSON.parse).sort((a, b) => a.timestamp.localeCompare(b.timestamp))
  }
  const evaluated = evaluateShadowDecision(raw, tracking, observedAt)
  if (!evaluated.latest || evaluated.aligned.timestamps.length < 200) throw failure('INSUFFICIENT_HISTORY', 'Insufficient shared indicator history')
  const latest = evaluated.latest
  const completedAt = clock()
  // Bootstrap and downtime never turn old bars into fresh detections. Pending outcomes still advance.
  const continuous = checkpoint.lastSuccessfulCycle && Date.parse(observedAt) - Date.parse(checkpoint.lastSuccessfulCycle) <= timing.continuityMs
  const newDecision = checkpoint.latestDecisionBar && latest > checkpoint.latestDecisionBar &&
    historicalCandleEndTime(latest, '1Hour') > Date.parse(checkpoint.detectionBoundary ?? checkpoint.baselineEstablishedAt ?? checkpoint.lastSuccessfulCycle)
  const timely = Date.parse(completedAt) - (historicalCandleEndTime(latest, '1Hour') + timing.publicationGraceMs) <= timing.detectionWindowMs
  const found = continuous && newDecision && timely ? evaluated.occurrences.map((row) => ({ ...row, createdAt: completedAt })) : []
  const all = new Map(before.occurrences.map((row) => [row.id, row]))
  for (const row of found) if (!all.has(row.id)) all.set(row.id, row)
  const occurrences = [...all.values()].map((row) => resolveShadowOccurrence(row, evaluated.aligned.raw, completedAt))
  return { newCandles, occurrences, checkpoint: {
    status: 'OBSERVING', lastSuccessfulCycle: completedAt, latestDecisionBar: latest,
    baselineEstablishedAt: checkpoint.baselineEstablishedAt ?? completedAt,
    detectionBoundary: continuous ? checkpoint.detectionBoundary ?? checkpoint.baselineEstablishedAt ?? checkpoint.lastSuccessfulCycle : completedAt,
    skippedDetectionCycles: (checkpoint.skippedDetectionCycles ?? 0) + (!continuous || !newDecision ? 1 : 0),
    detectionPolicy: tracking.candidate.forwardVersion === 'shadow-forward-2' ? 'Latest shared bar only; 10-minute publication grace, then 5-minute detection window; 5-minute polling continuity; no downtime backfill' : 'Latest completed shared bar only; 5-minute freshness and polling continuity; no downtime backfill',
    ...(tracking.candidate.forwardVersion === 'shadow-forward-2' ? { forwardVersion: 'shadow-forward-2', timingPolicy: timing } : {}),
  } }
}

export function createShadowObserver({ store, trackingId, fetchBars, sourceFingerprint, now = () => new Date(), schedule = setTimeout, cancel = clearTimeout, onStatus = () => {} }) {
  let active = null, running = false, timer, failures = 0
  let status = { status: 'NOT_STARTED' }, lastSuccessfulCycle = null
  function processOnce() {
    if (active) return active
    active = store.cycle(trackingId, async (before) => {
      lastSuccessfulCycle = before.checkpoint.lastSuccessfulCycle ?? lastSuccessfulCycle
      try { return await prepareShadowCycle(before, { fetchBars, sourceFingerprint, observedAt: now().toISOString(), clock: () => now().toISOString() }) }
      catch (error) { throw Object.assign(new Error('Shadow preparation failed'), { shadowCode: safeShadowFailure(error).code }) }
    })
      .then((result) => { failures = 0; lastSuccessfulCycle = result.lastSuccessfulCycle ?? lastSuccessfulCycle; status = { ...result, consecutiveFailures: 0, lastSuccessfulCycle, failure: null }; return status })
      .catch((error) => { failures += 1; status = { status: 'ERROR', consecutiveFailures: failures, lastSuccessfulCycle, failure: safeShadowFailure(error, 'STORAGE_FAILURE'), message: 'Shadow cycle failed; persistence completion is not confirmed. Review the safe failure code before retrying.' }; return status })
      .finally(() => { active = null; try { onStatus(status) } catch {} })
    return active
  }
  return { processOnce, status: () => ({ ...status, successfulCycleAgeMs: lastSuccessfulCycle ? Math.max(0, now().getTime() - Date.parse(lastSuccessfulCycle)) : null, pollingOverdue: lastSuccessfulCycle ? now().getTime() - Date.parse(lastSuccessfulCycle) > 300000 : null }),
    start() { if (running) return; running = true; const tick = async () => { await processOnce(); if (running) timer = schedule(tick, Math.min(900_000, 60_000 * 2 ** Math.min(failures, 4))) }; void tick() },
    async stop() { running = false; cancel(timer); if (active) await active },
  }
}

const failure = (shadowCode, message) => Object.assign(new Error(message), { shadowCode })
export function safeShadowFailure(error, fallback = 'UNEXPECTED_CYCLE_FAILURE') {
  const manual = ['PROVIDER_REVISION', 'LATE_INSERTION', 'SOURCE_MISMATCH', 'INCOMPATIBLE_PROTOCOL']
  const allowed = [...manual, 'PROVIDER_REQUEST_FAILED', 'INCOMPATIBLE_DATA', 'INVALID_CANDLES', 'INSUFFICIENT_HISTORY', 'UNEXPECTED_CYCLE_FAILURE']
  const code = allowed.includes(error?.shadowCode) ? error.shadowCode : error?.code && /^(08|23|40|53|57|58|ECONN|ETIMEDOUT)/.test(error.code) ? 'STORAGE_FAILURE' : fallback
  return { code, manualReviewRequired: manual.includes(code) }
}
