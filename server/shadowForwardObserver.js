import { validateAndOrderHistoricalCandles } from '../src/data/marketData.js'
import { candleCompletesBy, historicalCandleEndTime } from '../src/data/historicalDataContract.js'
import { evaluateShadowDecision, resolveShadowOccurrence, shadowFreshnessMs, shadowCandidate } from '../src/research/shadowForward.js'

const canonical = (bar) => ({ timestamp: new Date(bar.timestamp).toISOString(), open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume, timeframe: '1Hour' })
export async function prepareShadowCycle(before, { fetchBars, observedAt, sourceFingerprint, clock = () => observedAt }) {
  const { tracking, checkpoint } = before
  if (tracking.sourceFingerprint !== sourceFingerprint || tracking.candidate.forwardVersion !== shadowCandidate.forwardVersion) throw new Error('Frozen calculation source differs; create a separately reviewed version')
  const raw = structuredClone(before.raw)
  const newCandles = []
  for (const symbol of tracking.symbols) {
    const existing = raw[symbol]
    const payload = await fetchBars({ symbol, timeframe: '1Hour', start: existing.at(-1)?.timestamp ?? tracking.historyStart, end: observedAt })
    // The provider's count heuristic expects >=20 bars even for one-bar incremental ranges.
    // The dedicated adapter confirms that pagination finished; retain the count check for bootstrap only.
    if (payload.paginationComplete !== true || (!existing.length && payload.complete !== true) || payload.provider !== tracking.provider || payload.adjustmentMode !== tracking.adjustmentMode) throw new Error('Incomplete or incompatible shadow data')
    const validated = validateAndOrderHistoricalCandles(payload.candles)
    if (validated.dataQuality.rejectedCandleCount) throw new Error('Invalid shadow candles; cycle not committed')
    // Reject conflicting duplicates instead of silently choosing a revised observation.
    const seen = new Map(existing.map((bar) => [bar.timestamp, JSON.stringify(canonical(bar))]))
    for (const supplied of payload.candles) {
      if (supplied.timeframe !== '1Hour' || supplied.symbol !== symbol) throw new Error('Unexpected symbol or timeframe')
      if (!candleCompletesBy(supplied, '1Hour', observedAt)) continue
      const bar = canonical(supplied)
      if (Date.parse(bar.timestamp) < Date.parse(tracking.historyStart)) continue
      const previous = seen.get(bar.timestamp)
      if (previous && previous !== JSON.stringify(bar)) throw new Error('Provider revised a frozen candle; manual review required')
      if (!previous) {
        if (existing.length && bar.timestamp <= existing.at(-1).timestamp) throw new Error('Late historical insertion requires manual review')
        seen.set(bar.timestamp, JSON.stringify(bar))
        newCandles.push({ symbol, candle: bar })
      }
    }
    raw[symbol] = [...seen.values()].map(JSON.parse).sort((a, b) => a.timestamp.localeCompare(b.timestamp))
  }
  const evaluated = evaluateShadowDecision(raw, tracking, observedAt)
  if (!evaluated.latest || evaluated.aligned.timestamps.length < 200) throw new Error('Insufficient shared indicator history')
  const latest = evaluated.latest
  const completedAt = clock()
  // Bootstrap and downtime never turn old bars into fresh detections. Pending outcomes still advance.
  const continuous = checkpoint.lastSuccessfulCycle && Date.parse(observedAt) - Date.parse(checkpoint.lastSuccessfulCycle) <= shadowFreshnessMs
  const newDecision = checkpoint.latestDecisionBar && latest > checkpoint.latestDecisionBar &&
    historicalCandleEndTime(latest, '1Hour') > Date.parse(checkpoint.detectionBoundary ?? checkpoint.baselineEstablishedAt ?? checkpoint.lastSuccessfulCycle)
  const timely = Date.parse(completedAt) - historicalCandleEndTime(latest, '1Hour') <= shadowFreshnessMs
  const found = continuous && newDecision && timely ? evaluated.occurrences.map((row) => ({ ...row, createdAt: completedAt })) : []
  const all = new Map(before.occurrences.map((row) => [row.id, row]))
  for (const row of found) if (!all.has(row.id)) all.set(row.id, row)
  const occurrences = [...all.values()].map((row) => resolveShadowOccurrence(row, evaluated.aligned.raw, completedAt))
  return { newCandles, occurrences, checkpoint: {
    status: 'OBSERVING', lastSuccessfulCycle: completedAt, latestDecisionBar: latest,
    baselineEstablishedAt: checkpoint.baselineEstablishedAt ?? completedAt,
    detectionBoundary: continuous ? checkpoint.detectionBoundary ?? checkpoint.baselineEstablishedAt ?? checkpoint.lastSuccessfulCycle : completedAt,
    skippedDetectionCycles: (checkpoint.skippedDetectionCycles ?? 0) + (!continuous || !newDecision ? 1 : 0),
    detectionPolicy: 'Latest completed shared bar only; 5-minute freshness and polling continuity; no downtime backfill',
  } }
}

export function createShadowObserver({ store, trackingId, fetchBars, sourceFingerprint, now = () => new Date(), schedule = setTimeout, cancel = clearTimeout, onStatus = () => {} }) {
  let active = null, running = false, timer, failures = 0
  let status = { status: 'NOT_STARTED' }
  function processOnce() {
    if (active) return active
    active = store.cycle(trackingId, (before) => prepareShadowCycle(before, { fetchBars, sourceFingerprint, observedAt: now().toISOString(), clock: () => now().toISOString() }))
      .then((result) => { failures = 0; status = result; return result })
      .catch(() => { failures += 1; status = { status: 'ERROR', consecutiveFailures: failures, message: 'Shadow cycle failed; no checkpoint or evidence committed. Check configuration, provider availability and frozen-data compatibility.' }; return status })
      .finally(() => { active = null; try { onStatus(status) } catch {} })
    return active
  }
  return { processOnce, status: () => status,
    start() { if (running) return; running = true; const tick = async () => { await processOnce(); if (running) timer = schedule(tick, Math.min(900_000, 60_000 * 2 ** Math.min(failures, 4))) }; void tick() },
    async stop() { running = false; cancel(timer); if (active) await active },
  }
}
