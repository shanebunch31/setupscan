import assert from 'node:assert/strict'
import { test } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { deriveResearchFollowUps, investigationFollowUps } from './researchFollowUps.js'
import { prepareFollowUpForm, investigationPlanForRun, linkFollowUpResult } from './researchWorkbenchModel.js'
import { createWorkbenchActions, ResearchInvestigationPanel } from './ResearchWorkbench.js'
import { ResearchFollowUpQuestions } from './ResearchFollowUpQuestions.js'
import { projectResearchInvestigationDetail } from './researchInvestigationDetailModel.js'
import { listResearchExperiments } from './registry.js'

const id = 'candidate-context-robustness'
function row(symbol, period, averageR, extra = {}) {
  const count = 40
  return { symbol, period: { key: period, type: period.startsWith('year') ? 'year' : period }, ...extra,
    matched: { resolvedCount: count, costTiers: [0, .02, .05, .1].map((costR) => ({ costR, metrics: { averageR: averageR + .1 - costR, totalR: count * (averageR + .1 - costR) } })) },
    clustering: { multiSignalDayTradePercent: 80, topFivePercentOfNetR: 60 },
  }
}
function savedRun() {
  const rows = [row('AAPL', 'development', .05), row('AAPL', 'recent', .4), row('MSFT', 'development', .005), row('MSFT', 'recent', -.05),
    row('AAPL', 'year-2022', -.1), row('AAPL', 'year-2023', .3),
    row('AAPL', 'recent', .4, { session: 'regular' }), row('AAPL', 'recent', -.1, { session: 'outside' })]
  return { status: 'completed', runContext: { runId: 'source-run', requestedAt: '2026-10-21T12:00:00Z', symbols: ['MSFT', 'AAPL'], timeframe: '1Hour', requestedStart: '2022-01-01', requestedEnd: '2026-10-21', requestedExperiments: [id] },
    records: [{ id, status: 'completed', methodologyVersion: 'candidate-context-robustness-2', metrics: Object.fromEntries(rows.map((r) => [`${r.period.key}::${r.symbol}${r.session ? `::${r.session}` : ''}`, { robustness: r }])) }],
  }
}

test('fixed clustering, session, recent, year, cost and symbol triggers carry traceable evidence for arbitrary symbols', () => {
  const questions = deriveResearchFollowUps(savedRun())
  for (const kind of ['clustering', 'session-dependence', 'recent-difference', 'year-consistency', 'cost-sensitivity', 'symbol-difference']) {
    const found = questions.find((q) => q.id.includes(`::${kind}::`))
    assert.ok(found, kind)
    assert.ok(found.triggerEvidence.length)
    assert.ok(found.triggerEvidence.every((e) => e.sourceRunId === 'source-run' && e.metricsKey && e.methodologyVersion))
    assert.deepEqual(found.suggestedExperimentIds, [id])
    assert.ok(found.reason && found.decisionHelp)
    assert.equal(found.status, 'suggested')
  }
  assert.ok(questions.every((q) => !/RSI|RVOL|10:17|optimiz/i.test(q.question)))
  assert.ok(questions.some((q) => q.suggestedSettings.focus.symbols.includes('MSFT')))
})

test('follow-ups are deterministic under evidence ordering, do not mutate sources and preserve full universe', () => {
  const source = savedRun(), before = structuredClone(source)
  const reversed = structuredClone(source)
  reversed.records[0].metrics = Object.fromEntries(Object.entries(reversed.records[0].metrics).reverse())
  reversed.runContext.symbols.reverse()
  assert.deepEqual(deriveResearchFollowUps(source), deriveResearchFollowUps(reversed))
  assert.deepEqual(source, before)
  assert.deepEqual(deriveResearchFollowUps(source)[0].suggestedSettings.symbols, ['AAPL', 'MSFT'])
})

test('small or missing samples do not manufacture directional follow-ups; legacy records remain readable', () => {
  const source = savedRun()
  Object.values(source.records[0].metrics).forEach((value) => { value.robustness.matched.resolvedCount = 29 })
  assert.deepEqual(deriveResearchFollowUps(source), [])
  assert.deepEqual(deriveResearchFollowUps({ runContext: { runId: 'legacy' }, records: [] }), [])
  assert.deepEqual(deriveResearchFollowUps({}), [])
})

test('current-run Investigation plan selects only its IDs; all experiments remain manually available', () => {
  assert.deepEqual(investigationPlanForRun(savedRun()), [id])
  assert.deepEqual(investigationPlanForRun(null), [])
  const html = renderToStaticMarkup(React.createElement(ResearchInvestigationPanel, { requestedExperiments: [id] }))
  for (const { id: registeredId } of listResearchExperiments()) assert.ok(html.includes(`value="${registeredId}"`))
  assert.equal((html.match(/checked=""/g) ?? []).length, 1)
  assert.ok(html.includes('Creating it does not run research'))
})

test('creating Investigation invokes no save, attach or research action', async () => {
  const calls = []
  const actions = createWorkbenchActions({ executeRun: () => { throw Error('research') }, saveRun: () => { throw Error('save') }, attachRun: () => { throw Error('attach') }, createInvestigation: async (input) => { calls.push(input); return input } })
  await actions.createInvestigation('Does the candidate repeat?', investigationPlanForRun(savedRun()))
  assert.deepEqual(calls, [{ question: 'Does the candidate repeat?', requestedExperiments: [id] }])
})

function findButton(element) {
  if (!element || typeof element !== 'object') return null
  if (element.type === 'button') return element
  return React.Children.toArray(element.props?.children).map(findButton).find(Boolean)
}

test('selecting a question only prepares settings; explicit submit executes once and records small provenance', async () => {
  const q = deriveResearchFollowUps(savedRun())[0]
  let form, calls = 0
  const tree = ResearchFollowUpQuestions({ questions: [q], onPrepare: (question) => { form = prepareFollowUpForm({}, question) } })
  findButton(tree).props.onClick()
  assert.equal(calls, 0)
  assert.deepEqual(form.requestedExperiments, [id])
  assert.equal(form.symbols, 'AAPL, MSFT')
  assert.equal(form.requestedEnd, '2026-10-21')
  const actions = createWorkbenchActions({ executeRun: async () => { calls++; return { status: 'completed', runContext: { runId: 'follow-up' }, records: [{ id }] } } })
  const result = await actions.submit({ preventDefault() {} }, form)
  assert.equal(calls, 1)
  assert.equal(result.records[0].provenance.followUp.id, q.id)
  assert.equal(result.records[0].provenance.followUp.sourceRunId, 'source-run')
  assert.equal('triggerEvidence' in result.records[0].provenance.followUp, false)
  const source = readFileSync(new URL('./ResearchWorkbench.js', import.meta.url), 'utf8')
  assert.ok(source.includes('setInvestigationPlan(investigationPlanForRun(result))'))
  assert.ok(source.includes('Prepare investigation plan'))
  assert.equal(source.includes('await actions.runInvestigationPlan('), false)
})

test('only a completed linked run attached to the same Investigation marks a question investigated', () => {
  const source = savedRun(), before = structuredClone(source), q = deriveResearchFollowUps(source)[0]
  const follow = linkFollowUpResult({ ...savedRun(), runContext: { ...savedRun().runContext, runId: 'follow-up' } }, { id: q.id, sourceRunId: q.sourceRunId })
  const references = [{ runId: 'source-run', status: 'available', run: source }, { runId: 'follow-up', status: 'available', run: follow }]
  const beforeAttach = projectResearchInvestigationDetail({ runIds: ['source-run'] }, references)
  assert.equal(beforeAttach.followUps.find((item) => item.id === q.id).status, 'suggested')
  const attached = projectResearchInvestigationDetail({ runIds: ['source-run', 'follow-up'] }, references)
  const investigated = attached.followUps.find((item) => item.id === q.id)
  assert.equal(investigated.status, 'investigated')
  assert.deepEqual(investigated.investigatedByRunIds, ['follow-up'])
  assert.deepEqual(source, before)
  follow.status = 'failed'
  assert.equal(investigationFollowUps(references).find((item) => item.id === q.id).status, 'suggested')
})

test('follow-up display exposes reason, source metric, methodology, decision help and no automatic run', () => {
  const q = deriveResearchFollowUps(savedRun())[0]
  const html = renderToStaticMarkup(React.createElement(ResearchFollowUpQuestions, { questions: [q], onPrepare() {} }))
  for (const text of ['What triggered this question?', 'source-run', 'candidate-context-robustness-2', 'prepares settings only', 'not significance tests', 'Investigate — prepare Workbench']) assert.ok(html.includes(text))
  assert.ok(html.includes(q.reason))
})
