import assert from 'node:assert/strict'
import { test } from 'node:test'
import { projectPaperTrade, projectPaperTrades, sortPaperTradesNewestFirst } from './paperTradingModel.js'

const oldTrade = { id: 'old', status: 'open', entryTimestamp: '2026-09-25T14:00:00.000Z', signalTimestamp: '2026-09-25T13:00:00.000Z' }
const newTrade = { id: 'new', status: 'open', entryTimestamp: '2026-09-26T14:00:00.000Z', signalTimestamp: '2026-09-26T13:00:00.000Z' }

test('projects trades newest-first by entry time without mutating the input array', () => {
  const trades = [oldTrade, newTrade]
  assert.deepEqual(sortPaperTradesNewestFirst(trades).map(({ id }) => id), ['new', 'old'])
  assert.deepEqual(trades, [oldTrade, newTrade])
})

test('uses signalTimestamp only when an older trade has no entryTimestamp', () => {
  const fallbackTrade = { id: 'fallback', status: 'open', signalTimestamp: '2026-09-27T14:00:00.000Z' }
  assert.deepEqual(sortPaperTradesNewestFirst([oldTrade, fallbackTrade]).map(({ id }) => id), ['fallback', 'old'])
})

test('projects entry and closed exit timestamps in ET, identifying expiration from existing status and reason', () => {
  const closed = projectPaperTrade({
    status: 'closed',
    signalTimestamp: '2026-09-26T14:00:00.000Z',
    entryTimestamp: '2026-09-26T14:15:00.000Z',
    exitTimestamp: '2026-09-26T15:42:00.000Z',
    exitReason: 'Target',
  })
  assert.equal(closed.signalTime, 'Sep 26, 2026 · 10:00 AM ET')
  assert.equal(closed.entryTime, 'Sep 26, 2026 · 10:15 AM ET')
  assert.equal(closed.exitLabel, 'Closed')
  assert.equal(closed.exitReason, 'Target')
  assert.equal(closed.exitTime, 'Sep 26, 2026 · 11:42 AM ET')

  const expired = projectPaperTrade({
    status: 'closed',
    entryTimestamp: '2026-09-26T14:15:00.000Z',
    exitTimestamp: '2026-09-26T18:00:00.000Z',
    exitReason: 'Expired',
  })
  assert.equal(expired.exitLabel, 'Expired')
  assert.equal(expired.exitTime, 'Sep 26, 2026 · 2:00 PM ET')
})

test('missing or malformed timestamps display as unavailable and are not inferred', () => {
  const projection = projectPaperTrade({ status: 'closed', exitReason: 'Expired' })
  assert.equal(projection.entryTime, 'Unavailable')
  assert.equal(projection.exitLabel, 'Expired')
  assert.equal(projection.exitTime, 'Unavailable')
  assert.equal(projectPaperTrade({ status: 'open', entryTimestamp: 'invalid' }).entryTime, 'Unavailable')
})

test('projectPaperTrades sorts and projects without altering stored trade objects', () => {
  const trades = [oldTrade, newTrade]
  const rows = projectPaperTrades(trades)
  assert.deepEqual(rows.map(({ trade }) => trade.id), ['new', 'old'])
  assert.equal(rows[0].entryTime, 'Sep 26, 2026 · 10:00 AM ET')
  assert.deepEqual(trades, [oldTrade, newTrade])
})