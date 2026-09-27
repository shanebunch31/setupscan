import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { test } from 'node:test'
import { TermHelp } from '../TermHelp.js'

test('TermHelp keeps the technical label and exposes a concise keyboard-accessible explanation', () => {
  const html = renderToStaticMarkup(React.createElement(TermHelp, {
    term: 'Score',
    explanation: 'Points from six rule checks. Not a probability of success.',
  }))
  assert.match(html, /Score: Points from six rule checks/)
  assert.match(html, /title=/)
  assert.match(html, /role="note"/)
  assert.match(html, /tabindex="0"/)
})