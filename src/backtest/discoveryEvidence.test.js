import { test } from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { transformWithOxc } from 'vite'
import { summarizeOccurrences } from './strategyDiscovery/discoveryMetrics.js'
import { DiscoveryEvidenceTable, directionalEvidence, formatEvidenceR, discoveryEvidenceModel, discoveryEvidenceNote, discoveryEvidenceSelection, discoveryEvidenceKeyAt } from './discoveryEvidence.js'

// Use the already-installed build transformer entirely in memory: no service,
// fixture files, provider calls, or new test framework.
const reactUrl = pathToFileURL(createRequire(import.meta.url).resolve('react')).href
async function jsxModule(file, dependencies = {}) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8')
  const transformed = await transformWithOxc(source, file, { jsx: { runtime: 'classic', development: false } })
  const code = transformed.code.replace(/from "([^"]+)"/g, (whole, name) => {
    const url = name === 'react' ? reactUrl : dependencies[name] ?? new URL(name, new URL(file, import.meta.url)).href
    return `from ${JSON.stringify(url)}`
  })
  const url = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
  return { url, module: await import(url) }
}
const chartModule = await jsxModule('./LabsCharts.jsx')
const { InspectableLineChart, InspectableBarChart } = chartModule.module
const { module: { DiscoveryEvidenceExplorer } } = await jsxModule('./DiscoveryEvidenceExplorer.jsx', { './LabsCharts.jsx': chartModule.url })
const render = (Component, props) => renderToStaticMarkup(React.createElement(Component, props))
const row = (label, averageR, occurrenceCount = 120) => ({ label, occurrenceCount, averageR, winRate: .55, profitFactor: 1.14, totalR: 14.4, maximumDrawdown: 3.2 })
const interpreted = (rows, status = 'mixed') => ({ status, parentResolvedCount: rows.reduce((n, item) => n + item.occurrenceCount, 0),
  reference: { strategyId: 'internal-strategy-v99' },
  observations: rows.map(item => ({ label: item.label, resolvedCount: item.occurrenceCount, expectancy: item.occurrenceCount > 0 ? item.averageR : null })),
})
const chartProps = (model, index) => ({ id: 'test-chart', title: 'Historical evidence', question: 'Compare existing observations.', observations: model.observations,
  series: [{ key: 'r', label: 'Average R', metricLabel: 'Average R', countLabel: 'Occurrences' }], selectedIndex: index, onSelectionChange() {}, formatValue: formatEvidenceR, sampleUnit: 'occurrences' })

for (const dimension of ['year', 'symbol']) test(`${dimension} table copies the actual native research summary without recalculation or fabricated rows`, () => {
  const occurrences = Array.from({ length: 240 }, (_, i) => ({ symbol: i % 2 ? 'QQQ' : 'SPY', timestamp: i < 120 ? '2023-06-01T15:00:00Z' : '2024-06-03T15:00:00Z',
    primaryR: i % 3 ? 1 : -1, primaryStatus: i % 3 ? 'Target' : 'Stop', period: 'Development', entryPrice: 100, risk: 1, holdingBars: 2, mfeR: 1, maeR: -1 }))
  const native = summarizeOccurrences(occurrences)[dimension === 'year' ? 'byYear' : 'bySymbol']
  const before = structuredClone(native)
  const model = discoveryEvidenceModel(native, interpreted(native, 'same-direction'))
  assert.equal(model.comparable, true)
  assert.equal(model.rows.length, native.length)
  model.rows.forEach((record, i) => {
    for (const field of ['label', 'occurrenceCount', 'winRate', 'profitFactor', 'averageR', 'totalR', 'maximumDrawdown']) assert.equal(record[field], native[i][field])
    assert.deepEqual(model.observations[i], { label: record.label, series: [{ label: 'Average R', value: record.averageR, tradeCount: record.occurrenceCount }] })
  })
  const html = render(DiscoveryEvidenceTable, { id: 'evidence', dimension, model, selectedKey: model.rows[0].key, onSelect() {} })
  for (const record of model.rows) assert.ok(html.includes(`Inspect ${dimension} ${record.label}`))
  for (const heading of ['Occurrences', 'Win rate', 'Profit factor', 'Average R', 'Total R', 'Max DD']) assert.ok(html.includes(heading))
  assert.deepEqual(native, before)
})

test('table and chart preserve exact zero, missing metrics, empty samples and infinite profit factor', () => {
  const input = [row('SPY', 0), { ...row('QQQ', -.1), totalR: undefined, maximumDrawdown: null, profitFactor: Infinity }, row('IWM', 0, 0)]
  const model = discoveryEvidenceModel(input, interpreted(input))
  assert.equal(model.rows[0].averageR, 0)
  assert.equal(model.rows[1].totalR, null)
  assert.equal(model.rows[1].maximumDrawdown, null)
  assert.equal(model.rows[1].profitFactor, Infinity)
  assert.equal(model.rows[2].averageR, null)
  assert.equal(model.observations[2].series[0].value, null)
  const html = render(DiscoveryEvidenceTable, { id: 'test', dimension: 'symbol', model, onSelect() {} })
  assert.match(html, /data-direction="zero">0\.00R/)
  assert.match(html, /data-direction="unavailable">—/)
  assert.match(html, /<td>∞<\/td>/)
  assert.equal((html.match(/data-direction=/g) ?? []).length, input.length * 2, 'only Average R and Total R receive sign semantics')
})

test('unavailable provenance withholds deeper values without erasing counts or fabricating rows', () => {
  const input = [row('2024', .12), row('2025', -.2)]
  for (const observation of [undefined, interpreted(input, 'unavailable'), { ...interpreted(input), observations: [{ label: 'Other', resolvedCount: 120, expectancy: .12 }] }]) {
    const model = discoveryEvidenceModel(input, observation)
    assert.equal(model.comparable, false)
    assert.deepEqual(model.rows.map(item => item.occurrenceCount), [120, 120])
    assert.ok(model.rows.every(item => item.averageR === null && item.winRate === null))
    assert.ok(model.observations.every(item => item.series[0].value === null))
    assert.match(discoveryEvidenceNote(model, '2024', 'year').text, /overall historical result remains separate/)
  }
  assert.deepEqual(discoveryEvidenceModel(undefined, undefined).rows, [])
  assert.deepEqual(discoveryEvidenceModel([input[0], input[0]], interpreted(input)).rows, [])
})

test('directional styling uses exact signs with no near-zero threshold and missing is neutral', () => {
  assert.equal(directionalEvidence(.000000001), 'positive')
  assert.equal(directionalEvidence(-.000000001), 'negative')
  assert.equal(directionalEvidence(0), 'zero')
  assert.equal(directionalEvidence(-0), 'zero')
  for (const value of [null, undefined, NaN, Infinity, '0.1']) assert.equal(directionalEvidence(value), 'unavailable')
  assert.equal(formatEvidenceR(.15), '+0.15R')
  assert.equal(formatEvidenceR(-.13), '-0.13R')
})

for (const [dimension, labels, Chart] of [['year', ['2022', '2023'], InspectableLineChart], ['symbol', ['QQQ', 'IWM'], InspectableBarChart]]) {
  test(`${dimension} row selection and chart inspector share a key and exact values`, () => {
    const input = [row(labels[0], .15), row(labels[1], -.13)]
    const model = discoveryEvidenceModel(input, interpreted(input))
    let selectedKey = labels[0]
    // The actual native table button's handler updates the same key passed to
    // the controlled chart. Enter/Space are provided by the native button.
    const table = DiscoveryEvidenceTable({ id: 'test', dimension, model, selectedKey, onSelect: key => { selectedKey = key } })
    function buttons(element) {
      if (!element || typeof element !== 'object') return []
      return [...(element.type === 'button' ? [element] : []), ...React.Children.toArray(element.props?.children).flatMap(buttons)]
    }
    buttons(table)[1].props.onClick()
    const selected = discoveryEvidenceSelection(model.rows, selectedKey)
    assert.equal(selected.index, 1)
    let html = render(Chart, chartProps(model, selected.index))
    assert.match(html, /type="range"[^>]*value="1"/)
    assert.ok(html.includes(`aria-valuetext="${labels[1]}: Average R`))
    assert.ok(html.includes('-0.13R'))
    assert.match(html, /lab-chart-zero-line/)
    assert.match(html, /View chart data table/)
    // The chart callback's index maps back to the table's stable key.
    selectedKey = discoveryEvidenceKeyAt(model.rows, 0)
    html = render(DiscoveryEvidenceTable, { id: 'test', dimension, model, selectedKey, onSelect() {} })
    assert.ok(html.includes(`aria-pressed="true" aria-label="Inspect ${dimension} ${labels[0]}"`))
    assert.match(html, /scope="row"/)
    assert.match(html, /· Selected/)
    assert.doesNotMatch(html, /<tr[^>]*role="button"/)
    assert.match(discoveryEvidenceNote(model, selectedKey, dimension).title, /differs from/)
  })
}

test('selection stays attached to the label after reorder and safely handles removed or empty evidence', () => {
  const input = [row('2022', .1), row('2023', -.2)]
  const model = discoveryEvidenceModel(input, interpreted(input))
  assert.equal(discoveryEvidenceSelection([...model.rows].reverse(), '2023').index, 0)
  assert.equal(discoveryEvidenceSelection(model.rows.slice(0, 1), '2023').key, '2022')
  assert.deepEqual(discoveryEvidenceSelection([], '2023'), { index: 0, key: null, row: null })
  for (const index of [-1, NaN, 2, .5]) assert.equal(discoveryEvidenceKeyAt(model.rows, index), null)
})

test('notes distinguish agreement, disagreement, zero and small peer samples without leaking strategy IDs', () => {
  const input = [row('QQQ', -.1), row('SPY', .1), row('IWM', .2)]
  const model = discoveryEvidenceModel(input, interpreted(input))
  assert.match(discoveryEvidenceNote(model, 'QQQ', 'symbol').title, /QQQ differs from SPY and IWM/)
  input[0].averageR = .1
  let updated = discoveryEvidenceModel(input, interpreted(input, 'same-direction'))
  assert.match(discoveryEvidenceNote(updated, 'QQQ', 'symbol').title, /shares a historical direction/)
  input[0].averageR = 0
  updated = discoveryEvidenceModel(input, interpreted(input, 'same-direction'))
  assert.match(discoveryEvidenceNote(updated, 'QQQ', 'symbol').title, /measured average of zero/)
  input[0].averageR = -.1
  input[1].occurrenceCount = 3
  input[2].occurrenceCount = 7
  updated = discoveryEvidenceModel(input, interpreted(input))
  assert.match(discoveryEvidenceNote(updated, 'QQQ', 'symbol').title, /limited peer comparison/)
  assert.match(discoveryEvidenceNote(updated, 'SPY', 'symbol').title, /small historical sample/)
  assert.doesNotMatch(JSON.stringify(discoveryEvidenceNote(model, 'QQQ', 'symbol')), /internal-strategy|best|profitable|winner|avoid this symbol/)
})

test('insufficient parent samples never gain a directional research conclusion from partitions', () => {
  const input = [row('2022', -.5, 3), row('2023', .5, 4)]
  const model = discoveryEvidenceModel(input, interpreted(input, 'insufficient-evidence'))
  const note = discoveryEvidenceNote(model, '2022', 'year')
  assert.match(note.text, /7 resolved observations/)
  assert.match(note.text, /100 for exploratory evidence, not validation/)
  assert.doesNotMatch(note.title, /differs|shares/)
  assert.deepEqual(model.rows.map(item => item.averageR), [-.5, .5], 'actual descriptive values are retained with an explicit insufficiency warning')
})

test('explorer orders rich table, existing chart, and research note and keeps unavailable evidence honest', () => {
  const input = [row('2022', .1), row('2023', -.2)]
  const html = render(DiscoveryEvidenceExplorer, { id: 'year', dimension: 'year', rows: input, interpretation: interpreted(input) })
  assert.ok(html.indexOf('discovery-detail-evidence-table') < html.indexOf('lab-chart-card'))
  assert.ok(html.indexOf('lab-chart-card') < html.indexOf('discovery-evidence-research-note'))
  assert.match(html, /<details class="lab-chart-table-details">/)
  assert.match(html, /type="range"/)
  assert.match(html, /aria-live="polite"/)
  const unavailable = render(DiscoveryEvidenceExplorer, { id: 'symbol', dimension: 'symbol', rows: input, interpretation: interpreted(input, 'unavailable') })
  assert.match(unavailable, /performance comparisons are withheld/)
  assert.match(unavailable, /No populated observations are available to plot/)
  assert.doesNotMatch(unavailable, /\+0\.10R|-0\.20R/)
})

test('shared charts retain independent defaults and clamp a controlled selection after data shrinks', () => {
  const input = [row('A', .1), row('B', -.1)], model = discoveryEvidenceModel(input, interpreted(input))
  for (const Chart of [InspectableLineChart, InspectableBarChart]) {
    assert.match(render(Chart, { ...chartProps(model, undefined), onSelectionChange: undefined }), /type="range"[^>]*value="0"/)
    assert.match(render(Chart, chartProps(model, 99)), /type="range"[^>]*value="1"/)
    assert.match(render(Chart, chartProps({ observations: [] }, 99)), /No populated observations are available/)
  }
})

test('only Batch A year/symbol pairs opt in; chart selection reveals the row without moving keyboard focus', () => {
  const page = readFileSync(new URL('./StrategyDiscoveryLab.jsx', import.meta.url), 'utf8')
  assert.equal((page.match(/<DiscoveryEvidenceExplorer /g) ?? []).length, 2)
  const batchA = page.slice(page.indexOf('function FamilyResult('), page.indexOf('function FamilyCard('))
  assert.match(batchA, /dimension="year"[\s\S]*rows=\{summary.byYear\}/)
  assert.match(batchA, /dimension="symbol"[\s\S]*rows=\{summary.bySymbol\}/)
  assert.match(batchA, /<BreakdownRows rows=\{summary.byPeriod\}/)
  assert.match(batchA, /summary.costTiers.map/)
  const explorer = readFileSync(new URL('./DiscoveryEvidenceExplorer.jsx', import.meta.url), 'utf8')
  assert.match(explorer, /selectedIndex=\{chartSelected.index\}[\s\S]*?onSelectionChange=\{selectChart\}/)
  assert.match(
  explorer,
  /rowRefs\.current[\s\S]*?\.get\(selected\.key\)[\s\S]*?\?\.scrollIntoView/,
)
  assert.doesNotMatch(explorer, /\.focus\(/)
  const charts = readFileSync(new URL('./LabsCharts.jsx', import.meta.url), 'utf8')
  assert.match(charts, /onClick=\{onSelectionChange \? \(\) => setSelectedIndex\(index\)/)
  assert.match(charts, /onClick=\{onSelectionChange \? \(\) => setSelectedIndex\(rowIndex\)/)
})
