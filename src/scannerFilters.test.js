import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { test } from 'node:test'
import { filterScannerResults, ScannerFiltersButton, ScannerThresholdFilter, SCANNER_TERM_EXPLANATIONS } from './scannerFilters.js'

function findElement(element, predicate) {
  if (!React.isValidElement(element)) return null
  if (predicate(element)) return element
  for (const child of React.Children.toArray(element.props.children)) {
    const match = findElement(child, predicate)
    if (match) return match
  }
  return null
}

test('Filters button exposes an accessible disclosure and toggles the existing threshold control', () => {
  let open = false
  const toggle = () => { open = !open }
  const button = ScannerFiltersButton({ open, onToggle: toggle })
  assert.equal(button.props['aria-expanded'], false)
  assert.equal(ScannerThresholdFilter({ open, threshold: 65 }), null)

  button.props.onClick()
  assert.equal(open, true)
  const panel = ScannerThresholdFilter({ open, threshold: 65 })
  const input = findElement(panel, (element) => element.type === 'input')
  assert.equal(input.props.value, 65)
  assert.equal(input.props.min, 40)
  assert.equal(input.props.max, 90)
  assert.match(renderToStaticMarkup(panel), /Minimum setup score/)
  assert.match(renderToStaticMarkup(panel), /Rows below this score are hidden/)
    assert.match(renderToStaticMarkup(panel), /not a probability of success/i)
})

test('changing the minimum score filters scanner rows and preserves qualified-set filtering semantics', () => {
  const results = [{ symbol: 'SPY', score: 90 }, { symbol: 'QQQ', score: 64 }, { symbol: 'IWM', score: 75 }]
  assert.deepEqual(filterScannerResults(results, 75).map(({ symbol }) => symbol), ['SPY', 'IWM'])
  assert.deepEqual(filterScannerResults(results, 90).map(({ symbol }) => symbol), ['SPY'])
  assert.deepEqual(filterScannerResults(results, 65).map(({ symbol }) => symbol), ['SPY', 'IWM'])
  assert.deepEqual(results.map(({ symbol }) => symbol), ['SPY', 'QQQ', 'IWM'])
})

test('scanner threshold control adds no other filter categories', () => {
  const html = renderToStaticMarkup(ScannerThresholdFilter({ open: true, threshold: 70 }))
  assert.match(html, /Minimum score/)
  assert.doesNotMatch(html, /Trend|Symbol|Date|Setup type/i)
})

test('Scanner explanations preserve technical labels while clarifying status and the VWAP limitation', () => {
  assert.match(SCANNER_TERM_EXPLANATIONS.status, /does not mean SetupScan recommends a short/)
  assert.match(SCANNER_TERM_EXPLANATIONS.vwap, /not a standard volume-weighted session VWAP/)
  assert.match(SCANNER_TERM_EXPLANATIONS.signal, /rule checks/)
  assert.match(SCANNER_TERM_EXPLANATIONS.setupType, /pattern/)
})