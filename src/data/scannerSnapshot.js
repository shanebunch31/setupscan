
import { enrichHistoricalCandles, fetchHistoricalMarketData, validateAndOrderHistoricalCandles } from './marketData.js'

const HOUR_MS = 60 * 60 * 1000
const FIVE_MINUTES_MS = 5 * 60 * 1000

export function createScannerRange(now = new Date()) {
  const end = new Date(now)
  const start = new Date(end)
  start.setUTCDate(start.getUTCDate() - 7)
  return { start: start.toISOString(), end: end.toISOString() }
}

export function scannerDataQualityNotices(entries = []) {
  const describeCount = (count, singular, plural) => `${count} ${count === 1 ? singular : plural}`
  const fields = [
    ['outOfOrderCandleCount', (count) => `${describeCount(count, 'out-of-order bar', 'out-of-order bars')} reordered`],
    ['duplicateCandleCount', (count) => `${describeCount(count, 'duplicate bar', 'duplicate bars')} skipped`],
    ['rejectedCandleCount', (count) => `${describeCount(count, 'invalid bar', 'invalid bars')} rejected`],
    ['requestedEndExcludedCandleCount', (count) => `${describeCount(count, 'bar', 'bars')} excluded because they extended past the requested cutoff`],
  ]

  return entries.flatMap((entry) => [
    ...(entry.vwapDiagnostic?.reason
      ? [`${entry.symbol}: regular-session VWAP unavailable (${entry.vwapDiagnostic.reason}); hourly indicators remain separate.${entry.vwapDiagnostic.missingSessionSlots?.length ? ` Missing/invalid ET slots: ${entry.vwapDiagnostic.missingSessionSlots.length}; first ${entry.vwapDiagnostic.missingSessionSlots[0]}, last ${entry.vwapDiagnostic.missingSessionSlots.at(-1)}. Latest completed session bar: ${entry.vwapDiagnostic.latestCompletedSessionCandle ?? 'unavailable'}.` : ''}`]
      : []),
    ...(entry.vwapDiagnostic?.providerComplete === false
      ? [`${entry.symbol}: the 5-minute response is marked incomplete; VWAP availability uses a separate regular-session coverage check.`]
      : []),
    ...(entry.incomplete === true
      ? [`${entry.symbol}: the historical hourly data set is incomplete, so no scanner score was produced.`]
      : []),
    ...['hourly', 'fiveMinute'].flatMap((series) => {
      const quality = entry.dataQuality?.[series]
      if (!quality) return []
      const issues = fields.flatMap(([field, describe]) => {
        const count = quality[field]
        return Number.isFinite(count) && count > 0 ? [describe(count)] : []
      })
      return issues.length ? [`${entry.symbol} ${series === 'hourly' ? 'hourly' : '5-minute'} data: ${issues.join(', ')}.`] : []
    }),
  ])
}

function candleEndTime(candle, durationMs) {
  const timestampMs = new Date(candle.timestamp).getTime()
  return Number.isFinite(timestampMs) ? timestampMs + durationMs : NaN
}

function easternDateKey(timestamp) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(timestamp))

  const values = Object.fromEntries(
    parts
      .filter(({ type }) => type !== 'literal')
      .map(({ type, value }) => [type, value]),
  )

  return `${values.year}-${values.month}-${values.day}`
}

function hasMissingFiveMinuteCandles(candles, evaluationTime, diagnostic = {}) {
  diagnostic.missingSessionSlots = []
  const evaluationMs = new Date(evaluationTime).getTime()
  if (!Number.isFinite(evaluationMs)) return true

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })

  function getEasternParts(timestamp) {
    return Object.fromEntries(
      formatter.formatToParts(new Date(timestamp))
        .filter(({ type }) => type !== 'literal')
        .map(({ type, value }) => [type, value]),
    )
  }

  const evaluationParts = getEasternParts(evaluationMs)
  const evaluationDate =
    `${evaluationParts.year}-${evaluationParts.month}-${evaluationParts.day}`
  const evaluationMinute =
    Number(evaluationParts.hour) * 60 + Number(evaluationParts.minute)

  if (!['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(evaluationParts.weekday)) {
    return false
  }

  // Before the regular session opens, there are no session candles to validate.
  if (evaluationMinute < 570) return false

  // Validate through the evaluation cutoff, but never beyond 4:00 p.m. Eastern.
  const sessionCutoffMinute = Math.min(
    Math.floor(evaluationMinute / 5) * 5,
    960,
  )

  const availableCandles = new Map()

  for (const candle of candles) {
    const timestamp = new Date(candle.timestamp).getTime()
    if (!Number.isFinite(timestamp)) continue

    const parts = getEasternParts(timestamp)
    const date = `${parts.year}-${parts.month}-${parts.day}`
    const minute = Number(parts.hour) * 60 + Number(parts.minute)
    const second = Number(parts.second)
    const slotStartMinute = Math.floor(minute / 5) * 5

    if (
      date !== evaluationDate ||
      minute < 570 ||
      minute >= 960 ||
      minute !== slotStartMinute ||
      second !== 0 ||
      timestamp % 1000 !== 0 ||
      timestamp + FIVE_MINUTES_MS > evaluationMs
    ) {
      continue
    }

    const validCandle =
      Number.isFinite(candle.high) &&
      Number.isFinite(candle.low) &&
      Number.isFinite(candle.close) &&
      Number.isFinite(candle.volume) &&
      candle.volume > 0

    if (!validCandle) continue

    availableCandles.set(minute, candle)
  }

  for (
    let expectedMinute = 570;
    expectedMinute < sessionCutoffMinute;
    expectedMinute += 5
  ) {
    if (!availableCandles.has(expectedMinute)) {
      diagnostic.missingSessionSlots.push(`${String(Math.floor(expectedMinute / 60)).padStart(2, '0')}:${String(expectedMinute % 60).padStart(2, '0')}`)
    }
  }

  return diagnostic.missingSessionSlots.length > 0
}

// Safe, structured diagnostics only: never copy provider error messages or payloads here.
export function diagnoseScannerVwap(fiveMinuteData, evaluationTime) {
  const input = Array.isArray(fiveMinuteData?.candles) ? fiveMinuteData.candles : []
  const evaluationMs = new Date(evaluationTime).getTime()
  const diagnostic = {
    status: 'UNAVAILABLE', reason: null,
    evaluationTime: Number.isFinite(evaluationMs) ? new Date(evaluationMs).toISOString() : null,
    returnedCandleCount: input.length, sameDateCandleCount: 0, completedCandleCount: 0,
    regularSessionCandleCount: 0, usedCandleCount: 0, latestIncludedCandle: null,
    latestIncludedCandleEnd: null, vwap: null,
    providerComplete: typeof fiveMinuteData?.complete === 'boolean' ? fiveMinuteData.complete : null,
    providerStale: fiveMinuteData?.stale === true,
  }
  const unavailable = reason => ({ ...diagnostic, reason })
  if (!Number.isFinite(evaluationMs)) return unavailable('INVALID_EVALUATION_TIME')
  if (!input.length) return unavailable('EMPTY_RESPONSE')
  const { candles, dataQuality } = validateAndOrderHistoricalCandles(input)
  diagnostic.validation = dataQuality
  const evaluationDate = easternDateKey(evaluationMs)
  const sameDate = candles.filter(c => easternDateKey(c.timestamp) === evaluationDate)
  diagnostic.sameDateCandleCount = sameDate.length
  if (!sameDate.length) return unavailable(candles.length ? 'NO_SAME_EASTERN_DATE' : 'NO_VALID_CANDLES')
  const completed = sameDate.filter(c => candleEndTime(c, FIVE_MINUTES_MS) <= evaluationMs)
  diagnostic.completedCandleCount = completed.length
  const sessionFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  })
  const inSession = timestamp => {
    const parts = Object.fromEntries(sessionFormatter.formatToParts(new Date(timestamp)).map(p => [p.type, p.value]))
    const minute = Number(parts.hour) * 60 + Number(parts.minute)
    return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(parts.weekday) && minute >= 570 && minute < 960
  }
  const session = completed.filter(c => inSession(c.timestamp))
  diagnostic.regularSessionCandleCount = session.length
  diagnostic.latestCompletedSessionCandle = session.at(-1)?.timestamp ?? null
  if (!completed.length) return unavailable('NO_COMPLETED_CANDLES')
  if (!session.length) return unavailable('NO_COMPLETED_REGULAR_SESSION_CANDLES')
  if (diagnostic.providerStale) return unavailable('PROVIDER_MARKED_STALE')
  if (hasMissingFiveMinuteCandles(completed, evaluationTime, diagnostic)) return unavailable('MISSING_OR_INVALID_SESSION_BARS')
  const enriched = enrichHistoricalCandles(completed, '5Min')
  const vwap = enriched.at(-1)?.vwap
  if (!Number.isFinite(vwap)) return unavailable('NON_FINITE_VWAP')
  // A broad-window completeness flag is not a session-coverage test. Preserve it as a warning;
  // the existing exact session-slot check above independently establishes usable VWAP coverage.
  return { ...diagnostic, status: 'AVAILABLE', reason: null, vwap,
    usedCandleCount: session.length, latestIncludedCandle: session.at(-1).timestamp,
    latestIncludedCandleEnd: new Date(candleEndTime(session.at(-1), FIVE_MINUTES_MS)).toISOString() }
}

export async function fetchScannerSnapshot(
  symbols,
  range,
  fetchData = fetchHistoricalMarketData,
  now = () => new Date(),
) {
  const nowMs = new Date(now()).getTime()

  return Promise.all(symbols.map(async (symbol) => {
    try {
      const hourlyData = await fetchData(symbol, '1Hour', range)
      const candles = hourlyData?.candles ?? []
      const hourlyDataQuality = hourlyData?.dataQuality ?? null

      if (hourlyData?.complete === false) {
        return {
          symbol,
          available: false,
          incomplete: true,
          error: 'The historical hourly candle set is incomplete.',
          dataQuality: { hourly: hourlyDataQuality, fiveMinute: null },
        }
      }

      const completedCandles = candles.filter((candle) => {
        const endMs = candleEndTime(candle, HOUR_MS)
        return Number.isFinite(endMs) && endMs <= nowMs
      })

      if (!completedCandles.length) {
        return {
          symbol,
          available: false,
          dataQuality: { hourly: hourlyDataQuality, fiveMinute: null },
        }
      }

      const enriched = enrichHistoricalCandles(completedCandles, '1Hour')
      const latest = enriched[enriched.length - 1]
      const previous = enriched.length > 1 ? enriched[enriched.length - 2] : latest
      const change = previous.close
        ? ((latest.close - previous.close) / previous.close) * 100
        : 0

      let vwap = null
      let fiveMinuteDataQuality = null
      const evaluationTime = candleEndTime(latest, HOUR_MS)
      let vwapDiagnostic = null
      let fiveMinuteData = null
      let vwapStage = 'request'

      try {
        fiveMinuteData = await fetchData(symbol, '5Min', range)
        vwapStage = 'calculation'
        fiveMinuteDataQuality = fiveMinuteData?.dataQuality ?? null
        vwapDiagnostic = diagnoseScannerVwap(fiveMinuteData, evaluationTime)
        vwap = vwapDiagnostic.vwap
      } catch {
        // Do not expose arbitrary provider errors (which may contain URLs or credentials).
        vwapDiagnostic = { ...diagnoseScannerVwap(null, evaluationTime),
          reason: vwapStage === 'request' ? 'FIVE_MINUTE_REQUEST_FAILED' : 'VWAP_PROCESSING_FAILED',
          returnedCandleCount: Array.isArray(fiveMinuteData?.candles) ? fiveMinuteData.candles.length : null }
      }
      vwapDiagnostic.hourlyCandleTimestamp = latest.timestamp
      vwapDiagnostic.checkedAt = new Date(nowMs).toISOString()

      return {
        symbol,
        available: true,
        dataQuality: { hourly: hourlyDataQuality, fiveMinute: fiveMinuteDataQuality },
        vwapDiagnostic,
        snapshot: {
          vwapDiagnostic,
          symbol,
          price: latest.price,
          change,
          vwap,
          ema9: latest.ema9,
          ema21: latest.ema21,
          rsi: latest.rsi,
          relativeVolume: latest.relativeVolume,
          relativeVolumeMethod: latest.relativeVolumeMethod,
          breakout: latest.breakout,
          trend: latest.trend,
          atr: latest.atr,
          volume: latest.volume,
        },
      }
    } catch (error) {
      return {
        symbol,
        available: false,
        error: error?.message ?? 'Unknown scanner error',
      }
    }
  }))
}

export function isSuccessfulScannerRefresh(entries) {
  return entries.some((entry) => entry.available)
}
