import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ResearchEvidence } from './ResearchEvidence.js'
import { RESEARCH_EVIDENCE, RESEARCH_EVIDENCE_STATUSES, RESEARCH_LIMITATIONS, evidenceDefinitions } from './researchEvidenceLibrary.js'
import { getResearchExperiment } from './registry.js'

const html = () => renderToStaticMarkup(ResearchEvidence({}))
function elements(tree) {
  if (!React.isValidElement(tree)) return []
  return [tree, ...React.Children.toArray(tree.props.children).flatMap(elements)]
}

test('curated evidence renders all eight documented studies, statuses and visible production decisions', () => {
  const tree = ResearchEvidence({})
  const articles = elements(tree).filter(element => element.type === 'article')
  assert.equal(articles.length, 8)
  assert.equal(new Set(RESEARCH_EVIDENCE.map(study => study.id)).size, 8)
  for (const [i, article] of articles.entries()) {
    const study = RESEARCH_EVIDENCE[i]
    const markup = renderToStaticMarkup(article)
    assert.ok(markup.includes(RESEARCH_EVIDENCE_STATUSES[study.status]))
    const visible = React.Children.toArray(article.props.children).filter(child => child.type !== 'details')
    const visibleMarkup = renderToStaticMarkup(React.createElement('div', null, visible))
    assert.ok(visibleMarkup.includes(study.title.replaceAll('&', '&amp;')))
    assert.match(visibleMarkup, /Did this change production\?/)
    assert.match(visibleMarkup, /NO PRODUCTION CHANGE/)
    assert.ok(study.question && study.finding && study.meaning && study.tested)
    assert.ok(study.limitations.length && study.sources.length)
  }
})

test('methodology identities are documented versions, not invented Run IDs', () => {
  for (const study of RESEARCH_EVIDENCE) {
    assert.equal(study.runId, null)
    for (const id of study.experimentIds) {
      const experiment = getResearchExperiment(id)
      assert.ok(experiment, id)
      assert.ok(study.methodologyIds.some(version => (experiment.supportedMethodologyVersions ?? [experiment.methodologyVersion]).includes(version)), id)
    }
    for (const source of study.sources) {
      assert.ok(readFileSync(new URL(`../../${source.document}`, import.meta.url), 'utf8').length)
    }
  }
  const markup = html()
  assert.equal((markup.match(/Technical run link unavailable/g) ?? []).length, 8)
  assert.doesNotMatch(markup, /href="[^\"]*(runId|run-|\/runs\/|\/api\/)/)
  assert.match(markup, /matching experiment name alone does not identify this evidence/)
})

test('important findings match the canonical record and completed-study roadmap', () => {
  const record = readFileSync(new URL('../../SETUPSCAN_RESEARCH_EVIDENCE.md', import.meta.url), 'utf8')
  const roadmap = readFileSync(new URL('../../SETUPSCAN_ROADMAP_CHECKLIST.md', import.meta.url), 'utf8')
  assert.match(record, /16,094 observations had both true/)
  assert.match(record, /53 resolved/)
  assert.match(record, /FORWARD VALIDATION IN PROGRESS/)
  assert.match(roadmap, /do not create a separate 5Min execution challenger/)
  assert.match(roadmap, /Treat trailing as a challenger, not a replacement/)
  const markup = html()
  for (const text of ['Trend Up + Medium Volatility', '16,094', '53 resolved observations', 'not a replacement', 'corrected v3 methodology']) {
    assert.ok(markup.includes(text), text)
  }
})

test('forward status is a documented in-progress protocol, not a live health or completion claim', () => {
  const study = RESEARCH_EVIDENCE.find(item => item.id === 'shadow-candidate')
  assert.equal(study.status, 'forward')
  assert.equal(study.candidateId, 'trend-up-medium-volatility-v1')
  assert.ok(study.methodologyIds.includes('shadow-forward-1'))
  assert.match(study.forwardStatus, /does not verify whether the tracker is currently running/)
  assert.match(study.finding, /no historical backfill and no automatic promotion/)
  assert.match(study.productionImpact, /separate from the production scanner and Paper Trader/)
  assert.match(html(), /not a completed forward-validation result/)
})

test('limitations remain visible without expanding cards and no probability or ranking claims are added', () => {
  const tree = ResearchEvidence({})
  const section = elements(tree).find(element => element.props['aria-labelledby'] === 'evidence-limits-heading')
  const markup = renderToStaticMarkup(section)
  for (const text of RESEARCH_LIMITATIONS) assert.ok(markup.includes(text))
  assert.doesNotMatch(markup, /<details/)
  assert.match(markup, /not a probability of winning/)
  assert.match(markup, /does not enable live trading/)
  assert.doesNotMatch(html(), /\b\d+(?:\.\d+)?% (?:confidence|chance|probability)|best strategy|guaranteed returns|validated strategy/i)
})

test('native disclosures are collapsed and evidence navigation uses only explicit user actions', () => {
  const calls = []
  const tree = ResearchEvidence({ onOpenHistory: () => calls.push('history'), onOpenShadow: () => calls.push('shadow') })
  const all = elements(tree)
  assert.deepEqual(calls, [])
  for (const details of all.filter(element => element.type === 'details')) {
    assert.equal(details.props.open, undefined)
    assert.equal(React.Children.toArray(details.props.children)[0].type, 'summary')
  }
  const buttons = all.filter(element => element.type === 'button')
  assert.equal(buttons.length, 2)
  for (const button of buttons) {
    assert.equal(button.props.type, 'button')
    button.props.onClick()
  }
  assert.deepEqual(calls, ['history', 'shadow'])
  assert.ok(all.find(element => element.type === 'a' && element.props.href === '#evidence-library'))
})

test('existing shared metric definitions are reused alongside contextual research concepts', () => {
  const shared = [
    { term: 'Expectancy', description: 'Existing shared definition fixture.' },
    { term: 'R (risk unit)', description: 'Existing risk definition.' },
    { term: 'Win rate', description: 'Not selected here.' },
  ]
  const definitions = evidenceDefinitions(shared)
  assert.equal(definitions[0], shared[0])
  assert.equal(definitions[1], shared[1])
  assert.ok(!definitions.some(item => item.term === 'Win rate'))
  for (const term of ['Regime', 'Volatility', 'Sample size', 'Historical evidence', 'Forward validation', 'Frozen candidate']) {
    assert.ok(definitions.some(item => item.term === term))
  }
  const markup = renderToStaticMarkup(ResearchEvidence({ metricDefinitions: shared }))
  assert.match(markup, /Existing shared definition fixture/)
  assert.match(markup, /tabindex="0"/)
  assert.match(markup, /Research terms — plain-English definitions/)
})

test('About is wired to the shared navigation and existing History/Shadow destinations without changing Labs', () => {
  const main = readFileSync(new URL('../main.jsx', import.meta.url), 'utf8')
  assert.match(main, /\{ id: 'about', label: 'About SetupScan' \}/)
  assert.match(main, /about: CircleHelp/)
  assert.match(main, /view === 'about' &&[\s\S]*?<ResearchEvidence[\s\S]*?metricDefinitions=\{METRIC_DEFINITIONS\}/)
  assert.match(main, /onOpenHistory=\{\(\) => \{\s*setSelectedResearchRunId\(null\)\s*handleResearchWorkspaceNavigate\('history'\)/)
  assert.match(main, /onOpenShadow=\{\(\) => handleResearchWorkspaceNavigate\('shadow'\)\}/)
  const css = readFileSync(new URL('./researchEvidence.css', import.meta.url), 'utf8')
  assert.match(css, /:focus-visible/)
  assert.match(css, /@media \(max-width: 540px\)/)
})
