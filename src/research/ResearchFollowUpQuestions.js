import React from 'react'
const h = React.createElement

export function ResearchFollowUpQuestions({ questions = [], onPrepare = null }) {
  return h('section', { 'aria-label': 'Suggested follow-up research questions' },
    h('h3', null, 'Suggested follow-up research questions'),
    h('p', null, 'Settings select data; experiments define analysis; these questions challenge recorded evidence. Fixed descriptive flags are not significance tests or trading rules. Investigate prepares settings only; you must click Run research, then explicitly save and attach the result.'),
    questions.length ? h('ul', null, questions.map((q) => h('li', { key: q.id },
      h('h4', null, q.question), h('p', null, `${q.status} · ${q.suggestedSettings.focus.symbols.join(', ')} · ${q.suggestedSettings.focus.period}`),
      h('p', null, q.reason), h('p', null, q.decisionHelp),
      h('details', null, h('summary', null, 'What triggered this question?'),
        h('ul', null, q.triggerEvidence.map((e, i) => h('li', { key: i }, `${e.sourceRunId} / ${e.metricsKey}: ${e.metric} = ${e.value == null ? 'unavailable' : Number(e.value).toFixed(3)} (${e.methodologyVersion ?? 'Legacy / unknown'}).`)))),
      q.investigatedByRunIds?.length ? h('p', null, `Investigated by attached run(s): ${q.investigatedByRunIds.join(', ')}. This records research activity, not validation of the hypothesis.`) : null,
      onPrepare ? h('button', { type: 'button', className: 'workbench-secondary', onClick: () => onPrepare(q) }, 'Investigate — prepare Workbench') : h('p', null, 'Open this Investigation in Workbench to prepare a follow-up.'),
    ))) : h('p', null, 'No follow-up flags from the available saved evidence. Missing or small samples do not establish resilience.'),
  )
}
