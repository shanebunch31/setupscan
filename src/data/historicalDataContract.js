export const HISTORICAL_ADJUSTMENT_MODE = 'split'
export const LEGACY_ADJUSTMENT_MODE = 'legacy-unknown'

const FIXED_CANDLE_INTERVALS = {
  minute: 60_000,
  hour: 60 * 60_000,
}

function easternMidnightAfter(timestampMs) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  })
  const parts = Object.fromEntries(formatter.formatToParts(new Date(timestampMs))
    .filter((part) => part.type !== 'literal').map(({ type, value }) => [type, value]))
  const nextDate = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) + 1))
  const targetLocalAsUtc = Date.UTC(nextDate.getUTCFullYear(), nextDate.getUTCMonth(), nextDate.getUTCDate())
  let candidate = targetLocalAsUtc
  // Convert the next Eastern midnight to UTC without assuming a fixed UTC offset across DST.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const local = Object.fromEntries(formatter.formatToParts(new Date(candidate))
      .filter((part) => part.type !== 'literal').map(({ type, value }) => [type, value]))
    const localAsUtc = Date.UTC(Number(local.year), Number(local.month) - 1, Number(local.day), Number(local.hour ?? 0), Number(local.minute ?? 0), Number(local.second ?? 0))
    candidate += targetLocalAsUtc - localAsUtc
  }
  return candidate
}

/**
 * Returns the conservative end of a historical bar whose timestamp marks its start. Daily stock
 * bars are bounded by the next Eastern calendar midnight (so early closes cannot be mistaken for
 * later bars); intraday bars use their fixed elapsed interval. Unknown timeframes are unavailable.
 */
export function historicalCandleEndTime(timestamp, timeframe) {
  const start = Date.parse(timestamp)
  if (!Number.isFinite(start)) return null

  if (timeframe === '1Day' || timeframe === '1D' || timeframe === '1d') {
    return easternMidnightAfter(start)
  }

  const match = String(timeframe ?? '').match(/^(\d+)(Min|Minute|Hour|Day|m|h)$/i)
  if (!match) return null
  const amount = Number(match[1])
  const unit = match[2].toLowerCase()
  if (!(amount > 0)) return null
  if (unit === 'day') return amount === 1 ? easternMidnightAfter(start) : null
  const duration = unit === 'hour' || unit === 'h'
    ? amount * FIXED_CANDLE_INTERVALS.hour
    : amount * FIXED_CANDLE_INTERVALS.minute
  return start + duration
}

/** A bar is usable at a requested end only if its full interval has completed by that instant. */
export function candleCompletesBy(candle, timeframe, requestedEnd) {
  if (!requestedEnd) return true
  const end = Date.parse(requestedEnd)
  const candleEnd = historicalCandleEndTime(candle?.timestamp ?? candle?.t ?? candle?.time, timeframe)
  return Number.isFinite(end) && candleEnd !== null && candleEnd <= end
}
