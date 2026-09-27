import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isRegularSession } from './marketSession.js'

test('regular-session calculation uses New York weekday and session boundaries across DST', () => {
  assert.equal(isRegularSession(new Date('2026-09-26T14:30:00.000Z')), false) // Saturday, daylight time
  assert.equal(isRegularSession(new Date('2026-09-27T14:30:00.000Z')), false) // Sunday
  assert.equal(isRegularSession(new Date('2026-09-22T14:30:00.000Z')), true) // Tuesday 10:30 EDT
  assert.equal(isRegularSession(new Date('2026-09-22T13:29:00.000Z')), false) // 09:29 EDT
  assert.equal(isRegularSession(new Date('2026-09-22T20:00:00.000Z')), false) // 16:00 EDT
  assert.equal(isRegularSession(new Date('2026-01-13T14:30:00.000Z')), true) // Tuesday 09:30 EST
})