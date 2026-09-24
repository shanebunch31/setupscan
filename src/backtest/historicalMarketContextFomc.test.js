import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const events = JSON.parse(await readFile(new URL('../../data/historical-market-context/fomc/events.json', import.meta.url), 'utf8'))
const researchStart = Date.parse('2022-01-03T00:00:00Z')
const researchEnd = Date.parse('2026-09-23T23:59:59.999Z')

function parseEventTimestampET(timestamp) {
  const match = timestamp.match(/^(.*) (EST|EDT)$/)
  assert.ok(match, `ET timestamp must preserve EST or EDT: ${timestamp}`)
  const offset = match[2] === 'EST' ? '-05:00' : '-04:00'
  return Date.parse(`${match[1]}${offset}`)
}

test('every included FOMC event has official provenance and retrieval metadata', () => {
  events.forEach((event) => {
    assert.ok(event.sourceUrl)
    assert.ok(event.retrievedAt)
    assert.equal(event.source, 'Federal Reserve Board/FOMC')
    assert.equal(event.availabilityStatus, 'verified')
    assert.equal(event.schedulingClassification, 'regularly_scheduled')
    assert.equal(event.revisionStatus, 'not_applicable')
  })
})

test('ET and UTC timestamps represent the same instant', () => {
  events.forEach((event) => assert.equal(parseEventTimestampET(event.eventTimestampET), Date.parse(event.eventTimestampUTC)))
})

test('UTC timestamps parse correctly and events are chronological', () => {
  events.forEach((event, index) => {
    const timestamp = Date.parse(event.eventTimestampUTC)
    assert.ok(Number.isFinite(timestamp))
    if (index > 0) assert.ok(timestamp > Date.parse(events[index - 1].eventTimestampUTC))
  })
})

test('event IDs are unique and timestamps remain inside the research period', () => {
  assert.equal(new Set(events.map((event) => event.eventId)).size, events.length)
  events.forEach((event) => {
    const timestamp = Date.parse(event.eventTimestampUTC)
    assert.ok(timestamp >= researchStart && timestamp <= researchEnd)
  })
})

test('release dates are not replaced by meeting dates', () => {
  events.forEach((event) => {
    const releaseDate = event.eventId.replace('fomc-', '')
    assert.ok(event.eventTimestampET.startsWith(`${releaseDate.slice(0, 4)}-${releaseDate.slice(4, 6)}-${releaseDate.slice(6)}`))
    assert.match(event.notes, /For release at 2:00 p\.m\. (?:EST|EDT)/)
  })
})

test('cache contains no synthetic or demo fallback records', () => {
  const serialized = JSON.stringify(events).toLowerCase()
  assert.doesNotMatch(serialized, /synthetic|demo|fallback/)
  assert.ok(events.length > 0)
})