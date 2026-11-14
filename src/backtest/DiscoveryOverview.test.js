import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { DISCOVERY_QUESTIONS, DiscoveryOverviewView, overviewAvailability } from './DiscoveryOverview.js'
import { runStrategyDiscoveryBatchA } from './strategyDiscovery/discoveryRunner.js'
import { runRegularSessionBreakoutResearch, compareToBatchA } from './strategyDiscovery/regularSessionBreakout.js'

const datasets = ['SPY', 'QQQ', 'IWM'].map(symbol => ({ symbol, status: 'AVAILABLE' }))
function fixture() {
  return { datasets, batch: { available: true, experiments: [{ experimentId: 'momentum', summary: { costTiers: [
    { label: 'Low friction', metrics: { occurrenceCount: 137, averageR: .01 } },
    { label: 'High friction', metrics: { occurrenceCount: 137, averageR: -.34 } },
  ] } }] }, batchB: { available: true },
    rowsA: [{ key: 'momentum', label: 'Fixture Momentum', sample: 137, averageR: '0.06R', evidence: 'Exploratory', periodStatus: 'MIXED', costStatus: 'CROSSES ZERO' }],
    rowsB: Array.from({ length: 8 }, (_, i) => ({ key: String(i), label: `Condition ${i}`, spread: i === 0 ? null : i / 10, status: i === 0 ? 'LIMITED DATA' : 'CONTEXT VARIATION', bucketCount: 3 })),
    comparison: { overall: { occurrenceCount: { batchA: 137, batchC: 52 }, expectancy: { batchA: .06, batchC: 0, diff: -.06 }, profitFactor: { batchA: 1.14, batchC: 1 } } },
    onSelect() {}, navigate() {},
  }
}
const render = props => renderToStaticMarkup(React.createElement(DiscoveryOverviewView, props))
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return []
  return [tree, ...React.Children.toArray(tree.props?.children).flatMap(nodes)]
}

test('question selection updates the shared view and every next action uses the existing batch destination', () => {
  const props = fixture(), events = []
  let selected = 'a'
  props.onSelect = value => { selected = value }
  props.navigate = (event, id) => events.push([event, id])
  for (const question of DISCOVERY_QUESTIONS) {
    const tree = DiscoveryOverviewView({ ...props, selected })
    const buttons = nodes(tree).filter(node => node.type === 'button')
    buttons[DISCOVERY_QUESTIONS.indexOf(question)].props.onClick()
    assert.equal(selected, question.id)
    const updated = DiscoveryOverviewView({ ...props, selected })
    assert.equal(nodes(updated).filter(node => node.type === 'button' && node.props['aria-pressed']).length, 1)
    const link = nodes(updated).find(node => node.type === 'a')
    assert.equal(link.props.href, `#discovery-batch-${question.id}`)
    const event = { fixture: question.id }
    link.props.onClick(event)
    assert.deepEqual(events.at(-1), [event, `discovery-batch-${question.id}`])
    assert.match(render({ ...props, selected }), new RegExp(question.question.replace('?', '\\?')))
  }
})

test('loaded evidence uses supplied values, cost tiers and variations without changing inputs or fetching', t => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('presentation must not fetch'))
  const props = fixture(), before = JSON.stringify(props)
  const a = render(props)


  for (const text of ['Fixture Momentum', '137', '0.06R', 'Low friction', '0.01R', 'High friction', '-0.34R', 'results varied across periods', 'Exploratory']) {
    assert.ok(a.includes(text), text)
  }
  const b = render({ ...props, selected: 'b' })
  assert.equal((b.match(/<h4>Condition/g) ?? []).length, 8)
  assert.match(b, /0\.70R/)
  assert.match(b, /variations, not recommendations/)
  const c = render({ ...props, selected: 'c' })
  for (const text of ['52', '0.00R', '-0.06R', '1.14', 'Full session', 'Regular hours']) assert.ok(c.includes(text), text)
  assert.equal(JSON.stringify(props), before)
})

test('loading, partial and unavailable gates hide even previously populated results', () => {
  const props = fixture()
  for (const selected of ['a', 'b', 'c']) {
    const loading = render({ ...props, selected, datasets: [] })
    assert.match(loading, /Loading historical data/)
    assert.match(loading, /aria-busy="true"/)
    assert.doesNotMatch(loading, /137|0\.06R<\/dd>|Fixture Momentum/)
    const unavailable = render({ ...props, selected, datasets: datasets.map(d => ({ ...d, status: 'ERROR' })) })
    assert.match(unavailable, /Historical data unavailable/)
    assert.doesNotMatch(unavailable, /137|0\.06R<\/dd>/)
  }
  assert.match(overviewAvailability([datasets[0], ...datasets.slice(1).map(d => ({ ...d, status: 'ERROR' }))], false), /Partial data: missing QQQ, IWM/)
  assert.match(render({ ...props, selected: 'c', comparison: null }), /comparison is unavailable/)
})

test('zero and missing samples never become measured zero performance', () => {
  const props = fixture()
  props.comparison.overall.occurrenceCount.batchC = 0
  let html = render({ ...props, selected: 'c' })
  assert.doesNotMatch(html, /0\.00R|difference \(regular minus full\): -0\.06R/)
  assert.match(html, /difference \(regular minus full\): —/)
  props.rowsA[0].sample = null
  html = render(props)
  assert.match(html, /<dd>Unavailable<\/dd>/)
  assert.doesNotMatch(html, /<dd>0\.06R<\/dd>/)
})

test('learning disclosures use native keyboard controls and existing definitions with explicit limits', () => {
  const html = render(fixture())

  assert.equal((html.match(/<button\b[^>]*aria-pressed=/g) ?? []).length, 3)
  assert.equal((html.match(/aria-controls="discovery-question-answer"/g) ?? []).length, 3)
  assert.match(html, /role="group" aria-label="Choose a research question"/)
  assert.match(html, /aria-labelledby="discovery-question-title"/)
  assert.match(html, /role="status" aria-live="polite"/)
  for (const term of ['R and Average R', 'Sample / Occurrences', 'Profit Factor', 'Evidence sufficiency versus performance', 'Historical versus forward evidence']) {
    assert.ok(html.includes(`<summary>${term}</summary>`), term)
  }
  assert.doesNotMatch(html, /<details[^>]*\bopen=/)
  assert.match(html, /does not mean a 6% investment gain/)
  assert.match(html, /Above 1 means gains were larger than losses in that sample/)
  assert.match(html, /Reaching it does not validate a strategy/)
  assert.match(html, /historical holdout is not prospective evidence/)
})

test('real research result contracts render empty outcomes honestly without inventing observations', () => {
  const source = ['SPY', 'QQQ', 'IWM'].map(symbol => ({ symbol, status: 'AVAILABLE', data: { candles: Array.from({ length: 40 }, (_, i) => ({
    symbol, timeframe: '1Hour', timestamp: new Date(Date.UTC(2024, 0, 3) + i * 3600000).toISOString(), open: 100, high: 101, low: 99, close: 100, volume: 1000,
  })) } }))
  const batch = runStrategyDiscoveryBatchA(source)
  const regular = runRegularSessionBreakoutResearch(source)
  const momentum = batch.experiments.find(item => item.experimentId === 'momentum-breakout-v1')
  const comparison = compareToBatchA(momentum.summary, regular.summary)
  assert.equal(momentum.summary.overall.occurrenceCount, 0)
  const html = render({ ...fixture(), datasets: source, batch, selected: 'c', comparison })
  assert.match(html, /<dd>0<\/dd>/)
  assert.doesNotMatch(html, /<dd>0\.00R<\/dd>/)
})

test('integration preserves deeper batches, technical evidence and navigation; styles are scoped and responsive', () => {
  const source = readFileSync(new URL('./StrategyDiscoveryLab.jsx', import.meta.url), 'utf8')
  assert.match(source, /<DiscoveryOverview datasets=\{datasets\}/)
  assert.match(source, /readout=\{readout\} navigate=\{navigation.navigate\}/)
  assert.match(source, /<details className="discovery-overview-technical">\s*<summary>Detailed overview evidence<\/summary>/)
  for (const text of ['overviewBatchARows.map', 'overviewBatchBRows.map', 'FamilyResult result={result}', 'BreakoutContextResearchSection datasets={datasets}', 'RegularSessionBreakoutSection datasets={datasets}']) assert.ok(source.includes(text), text)
  const css = readFileSync(new URL('./robustness.css', import.meta.url), 'utf8').split('/* Question-first Overview.')[1]
  assert.match(css, /focus-visible/)
  assert.match(css, /max-width: 640px/)
  assert.match(css, /var\(--terminal-text, var\(--ink\)\)/)
  assert.doesNotMatch(css, /animation:|transition:|\.discovery-section-nav/)
})
