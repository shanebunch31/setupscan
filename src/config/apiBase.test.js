import test from 'node:test'
import assert from 'node:assert/strict'

import { apiUrl, resolveApiBase } from './apiBase.js'

test('uses relative API paths in local development so Vite can proxy any dev-server port', () => {
  assert.equal(resolveApiBase({ PROD: false }), '')
})

test('uses the Render API fallback in production when no explicit URL is configured', () => {
  assert.equal(resolveApiBase({ PROD: true }), 'https://setupscan-api.onrender.com')
})

test('uses an explicit API base URL ahead of the environment default', () => {
  assert.equal(
    resolveApiBase({ PROD: false, VITE_API_BASE_URL: 'https://api.example.test' }),
    'https://api.example.test',
  )
})

test('builds a relative API path when the local API base is empty', () => {
  assert.equal(apiUrl('/api/paper-trading'), `${resolveApiBase({ PROD: false })}/api/paper-trading`)
})
