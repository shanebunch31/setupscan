// Research-only, fixture-first VWAP Reaction v1. No network, persistence, scanner or order effects.
// Input timestamps identify the START of completed 5Min candles, in ISO-8601 UTC.
export const VWAP_REACTION_METHODOLOGY = 'vwap-reaction-research-1'
export const VWAP_REACTION_LONG = 'vwap-reclaim-long-1'
export const VWAP_REACTION_SHORT = 'vwap-rejection-short-1'
export const VWAP_REACTION_COSTS_R = Object.freeze([0, 0.02, 0.05, 0.10, 0.20])
export const VWAP_REACTION_PARAMETERS = Object.freeze({
  timeframe: '5Min', sessionOpen: '09:30', signalStart: '10:45', signalEnd: '14:30',
  atrPeriod: 14, stopAtrBuffer: 0.05, minRiskAtr: 0.15, maxRiskAtr: 2.5,
  targetR: 1.5, maxHoldingBars: 12,
})

const FIVE_MIN = 300_000
const clock = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})
const minuteOf = (hhmm) => {
  if (!/^\d{2}:\d{2}$/.test(hhmm)) return NaN
  const [hour, minute] = hhmm.split(':').map(Number)
  return hour < 24 && minute < 60 ? hour * 60 + minute : NaN
}
function localParts(ms) {
  const parts = Object.fromEntries(clock.formatToParts(new Date(ms))
    .filter(({ type }) => type !== 'literal').map(({ type, value }) => [type, value]))
  return { date: `${parts.year}-${parts.month}-${parts.day}`,
    minute: Number(parts.hour) * 60 + Number(parts.minute) }
}
function emptyResult(symbol, sessionDate, status, reason) {
  return { methodologyId: VWAP_REACTION_METHODOLOGY, symbol, sessionDate, status, reason,
    signals: [], trades: [], skips: [], completedBars: 0, incompleteBarsExcluded: 0,
    costTiers: VWAP_REACTION_COSTS_R.map(costR => ({ costR, byCandidate: {} })) }
}
function validBar(c) {
  const prices = [c?.open, c?.high, c?.low, c?.close]
  return prices.every(n => Number.isFinite(n) && n > 0) && Number.isFinite(c?.volume) &&
    c.volume > 0 && c.high >= c.low && c.high >= Math.max(c.open, c.close) &&
    c.low <= Math.min(c.open, c.close)
}
function costMetrics(trades, costR) {
  const values = trades.map(t => t.grossR - costR)
  const wins = values.filter(v => v > 0)
  const losses = values.filter(v => v < 0)
  const grossProfit = wins.reduce((a, v) => a + v, 0)
  const grossLoss = -losses.reduce((a, v) => a + v, 0)
  let cumulativeR = 0, peakR = 0, maxDrawdownR = 0
  for (const value of values) {
    cumulativeR += value
    peakR = Math.max(peakR, cumulativeR)
    maxDrawdownR = Math.max(maxDrawdownR, peakR - cumulativeR)
  }
  return {
    count: values.length,
    expectancyR: values.length ? cumulativeR / values.length : null,
    totalR: cumulativeR,
    winRate: values.length ? wins.length / values.length : null,
    profitFactor: grossLoss ? grossProfit / grossLoss : grossProfit ? Infinity : null,
    maxDrawdownR,
  }
}
function addMetrics(result) {
  result.costTiers = VWAP_REACTION_COSTS_R.map(costR => ({ costR,
    byCandidate: Object.fromEntries([VWAP_REACTION_LONG, VWAP_REACTION_SHORT]
      .map(id => [id, costMetrics(result.trades.filter(trade => trade.candidateId === id), costR)])),
  }))
  return result
}

/**
 * A verified market-calendar session must be supplied by the caller. The function deliberately
 * cannot infer exchange holidays or half-day closes from weekday arithmetic. completedThrough
 * is mandatory so an unfinished current candle cannot be treated as confirmed evidence.
 * Bar arrays must begin at the RTH open and be consecutive; otherwise cumulative VWAP is unknown.
 */
export function analyzeVwapReactionSession(candles, {
  symbol, sessionDate, sessionClose, completedThrough,
} = {}) {
  const result = emptyResult(symbol, sessionDate, 'UNAVAILABLE', 'INVALID_SESSION_INPUT')
  const open = minuteOf(VWAP_REACTION_PARAMETERS.sessionOpen)
  const close = minuteOf(sessionClose)
  const asOf = Date.parse(completedThrough)
  if (!Array.isArray(candles) || !symbol || !/^\d{4}-\d{2}-\d{2}$/.test(sessionDate ?? '') ||
      !Number.isFinite(asOf) || !Number.isFinite(close) || close <= open || close > 960 ||
      (close - open) % 5 !== 0) return result
  if (!candles.length) { result.reason = 'NO_BARS'; return result }

  let previous = null
  let incomplete = 0
  const complete = []
  for (const bar of candles) {
    const at = Date.parse(bar?.timestamp)
    if (!Number.isFinite(at) || !validBar(bar)) { result.reason = 'INVALID_OHLCV_OR_TIMESTAMP'; return result }
    if (previous !== null && at - previous !== FIVE_MIN) {
      result.reason = at === previous ? 'DUPLICATE_BAR' : at < previous ? 'OUT_OF_ORDER_BAR' : 'MISSING_OR_MISALIGNED_BAR'
      return result
    }
    const eastern = localParts(at)
    if (eastern.date !== sessionDate || eastern.minute < open || eastern.minute + 5 > close || eastern.minute % 5 !== 0) {
      result.reason = 'BAR_OUTSIDE_DECLARED_SESSION'; return result
    }
    if (previous === null && eastern.minute !== open) { result.reason = 'MISSING_SESSION_OPEN'; return result }
    previous = at
    if (at + FIVE_MIN <= asOf) {
      if (incomplete) { result.reason = 'INCOMPLETE_BAR_IN_MIDDLE'; return result }
      complete.push({ ...bar, at, easternMinute: eastern.minute })
    } else incomplete += 1
  }
  result.incompleteBarsExcluded = incomplete
  result.completedBars = complete.length
  if (!complete.length) { result.reason = 'NO_COMPLETED_BARS'; return result }
  result.status = 'AVAILABLE'
  result.reason = null

  let cumulativeVolume = 0, cumulativePv = 0
  const ranges = []
  const entries = complete.map((bar, i) => {
    cumulativeVolume += bar.volume
    cumulativePv += ((bar.high + bar.low + bar.close) / 3) * bar.volume
    const previousClose = i ? complete[i - 1].close : null
    const trueRange = i
      ? Math.max(bar.high - bar.low, Math.abs(bar.high - previousClose), Math.abs(bar.low - previousClose))
      : bar.high - bar.low
    const atrPrior = i >= 14 ? ranges.slice(i - 14, i).reduce((a, n) => a + n, 0) / 14 : null
    ranges.push(trueRange)
    return { ...bar, vwap: cumulativePv / cumulativeVolume, atrPrior }
  })

  const seenDirection = new Set()
  let occupiedThrough = -1
  for (let i = 2; i < entries.length; i += 1) {
    const now = entries[i], prev = entries[i - 1], earlier = entries[i - 2]
    const decisionMinute = now.easternMinute + 5
    if (decisionMinute < minuteOf(VWAP_REACTION_PARAMETERS.signalStart) ||
        decisionMinute > minuteOf(VWAP_REACTION_PARAMETERS.signalEnd) ||
        !(now.atrPrior > 0) || !(prev.close < prev.vwap && earlier.close < earlier.vwap)) continue
    const longSignal = now.close > now.vwap && now.low <= now.vwap
    const shortSignal = now.high >= now.vwap && now.close < now.vwap && now.close < now.open
    const candidateId = longSignal ? VWAP_REACTION_LONG : shortSignal ? VWAP_REACTION_SHORT : null
    if (!candidateId || seenDirection.has(candidateId)) continue
    seenDirection.add(candidateId)
    const direction = candidateId === VWAP_REACTION_LONG ? 1 : -1
    const signal = { candidateId, direction, symbol, timestamp: now.timestamp,
      decisionTimestamp: new Date(now.at + FIVE_MIN).toISOString(), sessionDate,
      vwap: now.vwap, atrPrior: now.atrPrior, signalIndex: i }
    result.signals.push(signal)
    const skip = reason => result.skips.push({ candidateId, symbol, timestamp: now.timestamp, reason })
    if (i <= occupiedThrough) { skip('OVERLAPPING_POSITION'); continue }
    const entry = entries[i + 1]
    if (!entry || entry.at !== now.at + FIVE_MIN) { skip('NEXT_OPEN_UNAVAILABLE'); continue }
    const stop = direction === 1
      ? Math.min(now.low, prev.low) - VWAP_REACTION_PARAMETERS.stopAtrBuffer * now.atrPrior
      : Math.max(now.high, prev.high) + VWAP_REACTION_PARAMETERS.stopAtrBuffer * now.atrPrior
    const risk = direction * (entry.open - stop)
    if (!(risk > 0) || risk < VWAP_REACTION_PARAMETERS.minRiskAtr * now.atrPrior - 1e-10 ||
        risk > VWAP_REACTION_PARAMETERS.maxRiskAtr * now.atrPrior + 1e-10) {
      skip('INVALID_RISK_GEOMETRY'); continue
    }
    const target = entry.open + direction * VWAP_REACTION_PARAMETERS.targetR * risk
    let outcome = null
    for (let offset = 0; offset < VWAP_REACTION_PARAMETERS.maxHoldingBars; offset += 1) {
      const j = i + 1 + offset
      const bar = entries[j]
      if (!bar) break
      const reachedStopAtOpen = direction * (bar.open - stop) <= 0
      const reachedTargetAtOpen = direction * (bar.open - target) >= 0
      const touchedStop = direction === 1 ? bar.low <= stop : bar.high >= stop
      const touchedTarget = direction === 1 ? bar.high >= target : bar.low <= target
      let reason = null, exitPrice = null
      if (reachedStopAtOpen) { reason = 'Stop'; exitPrice = bar.open }
      else if (reachedTargetAtOpen) { reason = 'Target'; exitPrice = target }
      else if (touchedStop) { reason = 'Stop'; exitPrice = stop }
      else if (touchedTarget) { reason = 'Target'; exitPrice = target }
      else if (offset === VWAP_REACTION_PARAMETERS.maxHoldingBars - 1 || bar.easternMinute + 5 === close) {
        reason = 'Time'; exitPrice = bar.close
      }
      if (reason) {
        outcome = { candidateId, symbol, direction, sessionDate,
          signalTimestamp: now.timestamp, entryTimestamp: entry.timestamp, exitTimestamp: bar.timestamp,
          entryPrice: entry.open, stopPrice: stop, targetPrice: target,
          exitPrice, exitReason: reason, holdingBars: offset + 1,
          ambiguousStopTarget: !reachedStopAtOpen && !reachedTargetAtOpen && touchedStop && touchedTarget,
          riskPerShare: risk, grossR: direction * (exitPrice - entry.open) / risk }
        occupiedThrough = j
        break
      }
    }
    if (outcome) result.trades.push(outcome)
    else {
      // No manufactured 12th candle, and no assumed price at a missing early close.
      occupiedThrough = entries.length - 1
      skip('HOLD_WINDOW_UNAVAILABLE')
    }
  }
  return addMetrics(result)
}