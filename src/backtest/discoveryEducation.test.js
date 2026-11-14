import { test } from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { DISCOVERY_METRIC_DEFINITIONS, DiscoveryMetricLabel, DiscoveryLabelExplanation, DiscoveryResearchJourney, discoveryResearchJourney, explainDiscoveryLabel, discoveryReadout, discoveryReadoutPresentation, DiscoveryReadoutLabel } from './discoveryEducation.js'

const render = (component, props) => renderToStaticMarkup(React.createElement(component, props))
const observation = (dimension, status = 'same-direction') => ({ dimension, status, text: 'Available partitions have no sign reversal.', parentResolvedCount: 120, observations: [{ label: 'A', resolvedCount: 60, expectancy: 0, direction: 'zero' }, { label: 'B', resolvedCount: 60, expectancy: .1, direction: 'positive' }] })
const props = () => ({ result: { summary: { overall: { occurrenceCount: 120 } } }, interpretation: { candidate: { sample: { classification: 'exploratory', size: 120 } }, stability: ['year', 'symbol', 'period'].map(key => observation(key)), cost: { ...observation(undefined, 'no-weakening-observed'), text: 'No weakening was observed.' } } })

test('research journey records historical progress with neutral semantics and never infers forward evidence from holdout', () => {
  const journey = discoveryResearchJourney(props())
  assert.deepEqual(journey.map(step => step.label), ['Hypothesis Defined', 'Historical Sample', 'Stability & Costs', 'Forward Observation'])
  assert.match(journey[1].text, /120 resolved observations · exploratory evidence/)
  assert.match(journey[2].text, /^Checked — By year:/)
  assert.match(journey[3].text, /no strategy-specific forward evidence connected/)
  const html = render(DiscoveryResearchJourney, props())
  assert.match(html, /aria-label="Research journey"/)
  assert.equal((html.match(/<li>/g) ?? []).length, 4)
  assert.match(html, /Research progress, not strategy quality/)
  assert.doesNotMatch(html, /is-success|validated|confidence|aria-current="step"/i)
})

test('journey keeps absent results, missing sample counts and partial checks distinct', () => {
  assert.match(discoveryResearchJourney({})[1].text, /Not yet run/)
  const input = props()
  input.result.summary.overall.occurrenceCount = null
  delete input.interpretation.candidate
  input.interpretation.stability[1].status = 'unavailable'
  input.interpretation.stability[2].status = 'incomplete'
  const journey = discoveryResearchJourney(input)
  assert.match(journey[1].text, /sample unavailable · evidence classification unavailable/)
  assert.doesNotMatch(journey[1].text, /0 resolved/)
  assert.match(journey[2].text, /^Partially checked/)
  assert.match(journey[2].text, /By symbol: unavailable/)
})

test('completed zero-sample historical run is insufficient and not described as not yet run', () => {
  const input = props()
  input.result.summary.overall.occurrenceCount = 0
  input.interpretation.candidate.sample = { size: 0, classification: 'insufficient' }
  assert.match(discoveryResearchJourney(input)[1].text, /Run completed — 0 resolved observations · insufficient evidence/)
})

test('label disclosure is native keyboard-operable details and keeps zero separate from missing expectancy', () => {
  const item = observation('year')
  item.observations.push({ label: 'C', resolvedCount: 0, expectancy: null, direction: null })
  const html = render(DiscoveryLabelExplanation, { observation: item })
  assert.match(html, /<details class="discovery-label-explanation"><summary>Why this label\?<\/summary>/)
  assert.match(html, /A: 0\.00R \(n=60\)/)
  assert.match(html, /C: unavailable \(n=0\)/)
  assert.doesNotMatch(html, /<details[^>]* open/)
})

test('incomplete partition explanation uses actual counts without inventing direction', () => {
  const item = observation('period', 'incomplete')
  item.observations = [{ label: 'Development', resolvedCount: 120, expectancy: .2 }, { label: 'Holdout', resolvedCount: 0, expectancy: null }]
  const text = explainDiscoveryLabel(item).join(' ')
  assert.match(text, /Development: 120 resolved observations; Holdout: 0 resolved observations/)
  assert.doesNotMatch(text, /Positive:|Negative:/)
})

test('metric help covers required units, caveats and keyboard names using the shared TermHelp pattern', () => {
  assert.deepEqual(DISCOVERY_METRIC_DEFINITIONS.map(item => item.term), ['Sample / Occurrences', 'Win Rate', 'Profit Factor', 'Average R', 'Median R', 'Total R', 'Max Drawdown', 'Average Hold', 'Development', 'Out-of-Sample', 'Holdout', 'Modeled Trading Costs'])
  for (const { term, description } of DISCOVERY_METRIC_DEFINITIONS) {
    const html = render(DiscoveryMetricLabel, { label: term })
    assert.match(html, /tabindex="0"/)
    assert.match(html, /role="note"/)
    assert.ok(html.includes(`aria-label="${term}: ${description}"`))
  }
  assert.match(render(DiscoveryMetricLabel, { label: 'PF' }), /Gross gains divided by gross losses/)
  assert.match(render(DiscoveryMetricLabel, { label: 'Max DD' }), /not an account-equity drawdown/)
  assert.match(render(DiscoveryMetricLabel, { label: 'Avg hold' }), /Missing bars are not invented/)
  assert.match(render(DiscoveryMetricLabel, { label: 'Holdout' }), /not prospective forward observation/)
  assert.match(render(DiscoveryMetricLabel, { label: 'Win rate' }), /size of wins versus losses/)
})

test('readout unknown remains unknown and insufficient parents prompt more observations', () => {
  assert.match(discoveryReadout(null).statements[0], /unavailable or incomplete/)
  const readout = discoveryReadout({ discoveryCandidates: [{ label: 'Small family', sample: { size: 7, classification: 'insufficient' } }] })
  assert.match(readout.statements.join(' '), /Small family \(7 resolved observations\)/)
  assert.match(readout.next.join(' '), /Collect more observations/)
})

test('page wires education without nested interactive controls in evidence links or changing Phase 1 navigation', () => {
  const source = readFileSync(new URL('./StrategyDiscoveryLab.jsx', import.meta.url), 'utf8')
  assert.match(source, /<DiscoveryLabelExplanation observation=\{observation\}/)
  assert.match(source, /<DiscoveryLabelExplanation observation=\{interpretation.cost\}/)
  assert.match(source, /family.experimentId && <DiscoveryResearchJourney/)
  assert.match(source, /\.\.\.DISCOVERY_METRIC_DEFINITIONS/)
  assert.match(source, /<p>\{readout.summary\}<\/p>/)
  assert.match(source, /<p>\{readout.next\}<\/p>/)
  assert.doesNotMatch(source, /Not yet available for any family below|Every family below currently has neither|Check whether these results survive/)
  const evidenceLinks = [...source.matchAll(/<a\b[\s\S]*?<\/a>/g)].filter(([link]) => link.includes('className="discovery-evidence-card"'))
  assert.ok(evidenceLinks.length > 0)
  for (const [link] of evidenceLinks) assert.doesNotMatch(link, /DiscoveryMetricLabel|TermHelp/)
  const css = readFileSync(new URL('./robustness.css', import.meta.url), 'utf8')
  assert.match(css, /\.discovery-page \.discovery-evidence-card \{[^}]*color: var\(--terminal-text\)/)
  assert.match(css, /@media \(max-width: 560px\).*discovery-research-journey/)
})

const families = [
  { experimentId: 'momentum-breakout-v1', label: 'Momentum / Breakout' },
  { experimentId: 'mean-reversion-v1', label: 'Mean Reversion' },
  { experimentId: 'prior-day-high-reclaim-v1', label: 'Market Structure' },
  { experimentId: 'volatility-compression-expansion-v1', label: 'Volatility Expansion / Contraction' },
]
function readoutFixture() {
  const candidates = families.map((family, i) => ({
    reference: { strategyId: family.experimentId }, label: family.experimentId,
    sample: { size: [1072, 7, 300, 200][i], classification: i === 1 ? 'insufficient' : 'exploratory' },
    status: ['positive', 'insufficient-evidence', 'negative', 'negative'][i], scope: {},
  }))
  return {
    evidenceStrength: { classification: 'mixed' }, discoveryCandidates: candidates,
    stabilityObservations: candidates.flatMap((candidate, i) => ['year', 'symbol', 'period'].map(dimension => ({ ...observation(dimension, i === 1 ? 'insufficient-evidence' : i === 3 ? 'same-direction' : 'mixed'), reference: candidate.reference }))),
    costSensitivityObservations: candidates.map((candidate, i) => ({ reference: candidate.reference, status: i === 1 ? 'insufficient-evidence' : i === 0 ? 'cost-sensitive' : 'no-weakening-observed' })),
  }
}

test('top readout uses page names and one natural summary driven by current decisions without modifying them', () => {
  const input = readoutFixture(), before = structuredClone(input)
  const result = discoveryReadoutPresentation(input, families)
  assert.deepEqual(input, before)
  assert.deepEqual(discoveryReadoutPresentation(input, families), result)
  assert.equal(result.badge, 'MIXED EVIDENCE')
  assert.match(result.summary, /Momentum \/ Breakout has 1072 resolved historical setups and a positive average result, but/)
  assert.match(result.summary, /across years, symbols, and research periods/)
  assert.match(result.summary, /Mean Reversion has 7 resolved observations, which is not enough evidence to judge fairly/)
  assert.match(result.summary, /Market Structure has 300 resolved historical setups and a negative average result/)
  assert.match(result.summary, /Volatility Expansion \/ Contraction has 200 resolved historical setups and a negative average result/)
  assert.match(result.why, /do not all have the same level of sample evidence/)
  assert.match(result.why, /Some years, symbols, and research periods have positive results while others have negative results/)
  assert.match(result.why, /Mean Reversion does not yet have enough observations/)
  const all = Object.values(result).flat().join(' ')
  assert.doesNotMatch(all, /breakout-v1|reclaim-v1|By year:|best|winner|validated|profitable strategy/i)
  assert.equal(result.limitations.length, 3)
  assert.match(result.limitations.join(' '), /holdout.*historical data.*not prospective/)
  assert.match(result.limitations.join(' '), /not independent confirmation/)
  assert.match(result.limitations.join(' '), /not actual historical fills/)
})

test('top readout changes with evidence without invented weakness, ranking, or unsupported slight/large labels', () => {
  const input = readoutFixture()
  input.evidenceStrength.classification = 'exploratory'
  input.discoveryCandidates.forEach(candidate => { candidate.status = 'neutral'; candidate.sample = { size: 120, classification: 'exploratory' } })
  input.stabilityObservations.forEach(item => { item.status = 'same-direction' })
  input.costSensitivityObservations.forEach(item => { item.status = 'no-weakening-observed' })
  const result = discoveryReadoutPresentation(input, families)
  assert.equal(result.badge, 'EXPLORATORY')
  assert.match(result.summary, /average result of zero/)
  assert.doesNotMatch(result.summary + result.why + result.next, /7 resolved|1072|change between positive and negative|weaken|not enough|slightly|large historical|Mixed Evidence/)
  assert.match(result.question, /rules fixed before new data arrives\?$/)
})

test('top badge explanation retains sample-strength meaning even when historical directions disagree', () => {
  const input = readoutFixture()
  input.evidenceStrength.classification = 'exploratory'
  input.discoveryCandidates.forEach(candidate => { candidate.sample = { size: 200, classification: 'exploratory' } })
  const result = discoveryReadoutPresentation(input, families)
  assert.equal(result.badge, 'EXPLORATORY')
  assert.match(result.why, /^SetupScan shows Exploratory/)
  assert.match(result.why, /positive results while others have negative results/)
  assert.doesNotMatch(result.why, /shows Mixed Evidence/)
})

test('top readout does not interpret unavailable evidence and unknown families never leak internal IDs', () => {
  const input = readoutFixture()
  input.evidenceStrength.classification = 'unavailable'
  input.discoveryCandidates = [{ reference: { strategyId: 'internal-new-v99' }, label: 'Internal new v99', status: 'positive', scope: null, sample: { size: null, classification: 'unknown' } }]
  input.stabilityObservations = []
  input.costSensitivityObservations = []
  const result = discoveryReadoutPresentation(input, families)
  assert.match(result.summary, /resolved sample size is unavailable/)
  assert.match(result.next, /what evidence or provenance is still missing/)
  assert.doesNotMatch(JSON.stringify(result), /internal-new|Internal new|positive average|0 resolved/)
  assert.match(discoveryReadoutPresentation(null).summary, /not enough usable historical evidence/)
})

test('top next-research text includes only supported questions and never starts an action', () => {
  const result = discoveryReadoutPresentation(readoutFixture(), families)
  assert.match(result.next, /why results for Momentum \/ Breakout and Market Structure change/)
  assert.match(result.next, /collect more observations for Mean Reversion/)
  assert.match(result.next, /execution assumptions/)
  assert.match(result.next, /No strategy-specific prospective observation evidence is connected/)
  assert.match(result.question, /^Should SetupScan.*\?$/)
  assert.doesNotMatch(result.question, /buy|sell|trade|start now/i)
})

test('overall Why this label is a visible native disclosure next to the badge outside individual strategy details', () => {
  const model = discoveryReadoutPresentation(readoutFixture(), families)
  const html = render(DiscoveryReadoutLabel, model)
  assert.match(html, /<span class="discovery-readout-status">MIXED EVIDENCE<\/span>/)
  assert.match(html, /<summary aria-label="Why this label\? Overall Batch A evidence">Why this label\?<\/summary>/)
  assert.ok(html.includes(model.why))
  assert.doesNotMatch(html, /<details[^>]* open|<button|onclick/)
  const source = readFileSync(new URL('./StrategyDiscoveryLab.jsx', import.meta.url), 'utf8')
  const top = source.slice(source.indexOf('{discoveryInterpretation && ('), source.indexOf('<section id="discovery-ideas"'))
  assert.match(top, /<DiscoveryReadoutLabel badge=\{readout.badge\} why=\{readout.why\}/)
  assert.match(top, /className="discovery-next-question"/)
  assert.doesNotMatch(top, /readout.statements.map|readout.next.map|cautionPoints/)
  assert.match(source, /discoveryReadoutPresentation\(discoveryInterpretation, STRATEGY_FAMILIES\)/)
  for (const family of families) assert.ok(source.includes(`label: '${family.label}'`))
})
