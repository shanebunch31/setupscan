import { test } from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { DISCOVERY_SECTIONS, DiscoverySectionNav, discoveryFamilyId, discoveryScrollContainer, discoveryExpansion, revealDiscoveryTarget, activeDiscoverySection } from './discoveryNavigation.js'

test('section navigation has native keyboard links, valid destinations and one location indicator', () => {
  const sections = DISCOVERY_SECTIONS
  assert.deepEqual(sections.map(section => section.label), ['Overview', 'Batch A', 'Batch B', 'Batch C'])
  const html = renderToStaticMarkup(React.createElement(DiscoverySectionNav, { sections, active: 'discovery-batch-a', navigate() {} }))
  assert.match(html, /aria-label="Strategy Discovery sections"/)
  assert.match(html, /href="#discovery-overview"/)
  assert.match(html, /href="#discovery-batch-a" aria-current="location"/)
  assert.equal((html.match(/<a /g) ?? []).length, 4)
  assert.doesNotMatch(html, /Research Readout|Setup ideas|Data provenance/)
  assert.equal((html.match(/aria-current=/g) ?? []).length, 1)
})

test('Batch A remains a destination without data and its detailed subsections do not become separate navigation items', () => {
  const source = readFileSync(new URL('./StrategyDiscoveryLab.jsx', import.meta.url), 'utf8')
  assert.match(source, /const sections = DISCOVERY_SECTIONS/)
  assert.match(source, /<div id="discovery-batch-a" tabIndex=\{-1\}>\s*\{batch.available &&/)
  for (const section of DISCOVERY_SECTIONS) assert.equal(source.split(`id="${section.id}"`).length - 1, 1)
  const targets = DISCOVERY_SECTIONS.map((section, i) => ({ ...section, getBoundingClientRect: () => ({ top: i * 400 }) }))
  assert.equal(activeDiscoverySection(targets, 850), 'discovery-batch-b')
  assert.equal(activeDiscoverySection(targets, 1250), 'discovery-batch-c')
})

test('readout preserves its hierarchy and visible guardrails with a primary conclusion and responsive supporting cards', () => {
  const source = readFileSync(new URL('./StrategyDiscoveryLab.jsx', import.meta.url), 'utf8')
  for (const [kind, label] of [['conclusion', 'What the evidence says'], ['limitations', 'What this does not prove'], ['next', 'What should SetupScan investigate next\\?']]) {
    assert.match(source, new RegExp(`className="discovery-readout-section is-${kind}">\\s*<h4>${label}</h4>`))
  }
  assert.match(source, /INTERPRETATION LAYER/)
  assert.match(source, /<h3>Research Readout<\/h3>/)
  assert.match(source, /readout.limitations.map/)
  const css = readFileSync(new URL('./robustness.css', import.meta.url), 'utf8')
  const navStates = css.slice(css.indexOf('.discovery-page .discovery-section-nav a,'), css.indexOf('.discovery-page .discovery-evidence-card {'))
  assert.match(navStates, /a:visited/)
  assert.match(navStates, /a:active/)
  assert.match(navStates, /color: var\(--terminal-text\)/)
  assert.match(navStates, /border-bottom-color: var\(--terminal-green\)/)
  assert.doesNotMatch(navStates, /terminal-red|terminal-blue|#[a-f0-9]{3,8}/i)
  assert.match(css, /\.discovery-page \.discovery-readout-content\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\)/)
  assert.match(css, /@media \(min-width: 1200px\)\s*\{\s*\.discovery-page \.discovery-readout-content/)
})

test('Expand All and Collapse All affect only family details and accurately count independent native toggles', () => {
  const families = Array.from({ length: 8 }, () => ({ open: false }))
  const root = { querySelectorAll(selector) { assert.equal(selector, '.discovery-family-details'); return families } }
  assert.deepEqual(discoveryExpansion(root), { total: 8, open: 0 })
  assert.deepEqual(discoveryExpansion(root, true), { total: 8, open: 8 })
  families[2].open = false
  assert.deepEqual(discoveryExpansion(root), { total: 8, open: 7 })
  // Reading state after data changes must not reset native details selections.
  assert.deepEqual(discoveryExpansion(root), { total: 8, open: 7 })
  assert.deepEqual(discoveryExpansion(root, false), { total: 8, open: 0 })
})

test('evidence navigation opens the exact family and enclosing details, focuses its summary and respects reduced motion', () => {
  for (const reduce of [false, true]) {
    const events = [], outer = { tagName: 'DETAILS', open: false }
    const target = { tagName: 'DETAILS', open: false, parentElement: outer,
      querySelector(selector) { assert.equal(selector, 'summary'); return { focus: options => events.push(['focus', options]) } },
      scrollIntoView(options) { assert.equal(this.open, true); assert.equal(outer.open, true); events.push(['scroll', options]) },
    }
    const sibling = { open: false }
    const root = { contains: node => node === target, ownerDocument: { getElementById(id) { assert.equal(id, discoveryFamilyId('mean-reversion')); return target } } }
    outer.parentElement = root
    const win = { matchMedia: () => ({ matches: reduce }) }
    assert.strictEqual(revealDiscoveryTarget(root, discoveryFamilyId('mean-reversion'), win), target)
    assert.equal(sibling.open, false)
    assert.deepEqual(events, [['focus', { preventScroll: true }], ['scroll', { behavior: reduce ? 'auto' : 'smooth', block: 'start' }]])
  }
})

test('missing or out-of-page destinations do not scroll or expand unrelated content', () => {
  for (const target of [null, { tagName: 'DETAILS', open: false }]) {
    const root = { ownerDocument: { getElementById: () => target }, contains: () => false }
    assert.equal(revealDiscoveryTarget(root, 'elsewhere', {}), null)
    if (target) assert.equal(target.open, false)
  }
})

test('navigation follows document scrolling and supports an actual nested scroll container', () => {
  const win = { getComputedStyle: node => ({ overflowY: node.overflowY }) }
  const parent = { overflowY: 'visible', parentElement: null, scrollHeight: 900, clientHeight: 500 }
  const root = { parentElement: parent }
  assert.equal(discoveryScrollContainer(root, win), win)
  parent.overflowY = 'auto'
  assert.equal(discoveryScrollContainer(root, win), parent)
  parent.scrollHeight = 500
  assert.equal(discoveryScrollContainer(root, win), win)
})

test('active section uses the measured header plus navigation boundary as content scrolls', () => {
  const sections = [0, 300, 900].map((top, i) => ({ id: `section-${i}`, getBoundingClientRect: () => ({ top }) }))
  assert.equal(activeDiscoverySection(sections, 100), 'section-0')
  assert.equal(activeDiscoverySection(sections, 290), 'section-1')
  assert.equal(activeDiscoverySection(sections, 900), 'section-2')
})

test('page wiring preserves detail content, maps cards by experiment identity and does not reset details on refresh', () => {
  const source = readFileSync(new URL('./StrategyDiscoveryLab.jsx', import.meta.url), 'utf8')
  assert.match(source, /STRATEGY_FAMILIES.find\(item => item.experimentId === experiment.experimentId\)/)
  assert.match(source, /href=\{`#\$\{destination\}`\}/)
  assert.match(source, /id=\{discoveryFamilyId\(family.key\)\}/)
  assert.match(source, /key=\{family.key\}/)
  assert.doesNotMatch(
  source,
  /<details(?=[^>]*className="discovery-family-details")[^>]*\bopen=/,
)
  for (const id of ['overview', 'batch-a', 'readout', 'ideas', 'provenance', 'batch-b', 'batch-c']) {
    assert.match(source, new RegExp(`id="discovery-${id}"`))
  }
  assert.match(source, /Expand All/)
  assert.match(source, /Collapse All/)
  for (const content of ['FamilyResult result={result}', 'ReproducibilityInfo batch={batch}', 'BreakoutContextResearchSection datasets={datasets}', 'RegularSessionBreakoutSection datasets={datasets}', 'AmbiguitySummary', 'Strategy Discovery terms', 'Cost sensitivity']) assert.ok(source.includes(content), content)
  assert.doesNotMatch(source, /discoveryInterpretation.discoveryCandidates.map/)
  assert.doesNotMatch(source, /View all 8 setup ideas/)
})

test('provider footer identifies the separately loaded Quick Backtest state rather than claiming Labs is loading', () => {
  const source = readFileSync(new URL('../main.jsx', import.meta.url), 'utf8')
  assert.match(source, /Quick Backtest data \(separate from Labs\)/)
  assert.match(source, /historicalData\?\.provider \?\? \(loadingMode === 'quick-backtest' \? historicalStatus : 'not loaded in this view'\)/)
})
