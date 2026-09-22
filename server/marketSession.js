const nyFormatter = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour12: false, weekday: 'short', hour: '2-digit', minute: '2-digit' })

export function isRegularSession(now = new Date()) {
  const parts = Object.fromEntries(nyFormatter.formatToParts(now).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]))
  return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(parts.weekday) && Number(parts.hour) * 60 + Number(parts.minute) >= 570 && Number(parts.hour) * 60 + Number(parts.minute) < 960
}

export function completedHourlyCandles(candles, now = new Date()) {
  return candles.filter((candle) => new Date(candle.timestamp).getTime() + 60 * 60 * 1000 <= now.getTime())
}

export function nextPollTime(now = new Date(), intervalMs = 60000) {
  return new Date(now.getTime() + intervalMs)
}
