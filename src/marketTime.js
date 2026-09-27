const EASTERN_TIME_ZONE = 'America/New_York'

export function formatMarketTime(value, { includeDate = false, includeSeconds = false } = {}) {
  if (value === null || value === undefined || value === '') return 'Unavailable'
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) return 'Unavailable'

  const options = {
    timeZone: EASTERN_TIME_ZONE,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    ...(includeDate ? { month: 'short', day: 'numeric', year: 'numeric' } : {}),
    ...(includeSeconds ? { second: '2-digit' } : {}),
  }
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', options)
    .formatToParts(date)
    .filter((part) => part.type !== 'literal')
    .map((part) => [part.type, part.value]))
  const dateLabel = includeDate ? `${parts.month} ${parts.day}, ${parts.year} · ` : ''
  const seconds = includeSeconds ? `:${parts.second}` : ''
  return `${dateLabel}${parts.hour}:${parts.minute}${seconds} ${parts.dayPeriod} ET`
}

export function createRefreshTimestamp(now = () => new Date()) {
  return now()
}

export function formatLastRefresh(value) {
  return value ? `Last refreshed ${formatMarketTime(value)}` : 'Not refreshed'
}

export { EASTERN_TIME_ZONE }