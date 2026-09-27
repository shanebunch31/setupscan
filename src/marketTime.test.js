import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRefreshTimestamp, EASTERN_TIME_ZONE, formatLastRefresh, formatMarketTime } from './marketTime.js'

test('formats the app clock in New York time and labels it ET', () => {
  assert.equal(EASTERN_TIME_ZONE, 'America/New_York')
  assert.equal(formatMarketTime('2026-09-26T14:15:00.000Z'), '10:15 AM ET')
  assert.equal(formatMarketTime('2026-01-15T15:00:00.000Z'), '10:00 AM ET')
})

test('formats paper timestamps as Eastern date/time and safely handles missing or invalid input', () => {
  assert.equal(formatMarketTime('2026-09-26T14:15:00.000Z', { includeDate: true }), 'Sep 26, 2026 · 10:15 AM ET')
  assert.equal(formatMarketTime(null, { includeDate: true }), 'Unavailable')
  assert.equal(formatMarketTime('not-a-time'), 'Unavailable')
})

test('refresh timestamp records the actual supplied refresh-event time', () => {
  const eventTime = new Date('2026-09-26T14:15:00.000Z')
  const refreshedAt = createRefreshTimestamp(() => eventTime)
  assert.equal(refreshedAt, eventTime)
  assert.equal(formatMarketTime(refreshedAt), '10:15 AM ET')
  assert.equal(formatLastRefresh(refreshedAt), 'Last refreshed 10:15 AM ET')
  assert.equal(formatLastRefresh(null), 'Not refreshed')
})