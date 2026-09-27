import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { test } from 'node:test'
import { MarketStatus } from './MarketStatus.js'

test('market header derives weekend status and ET clock from the supplied current time', () => {
  const saturday = renderToStaticMarkup(React.createElement(MarketStatus, { now: new Date('2026-09-26T14:15:00.000Z') }))
  const regular = renderToStaticMarkup(React.createElement(MarketStatus, { now: new Date('2026-09-22T14:15:00.000Z') }))
  const later = renderToStaticMarkup(React.createElement(MarketStatus, { now: new Date('2026-09-22T15:25:00.000Z') }))
  assert.match(saturday, /Outside Regular Session/)
  assert.match(saturday, /10:15 AM ET/)
  assert.match(regular, /Regular Session/)
  assert.match(regular, /10:15 AM ET/)
  assert.match(later, /11:25 AM ET/)
  assert.doesNotMatch(later, /10:15 AM ET/)
  assert.doesNotMatch(saturday, /Market open|09:41/)
})