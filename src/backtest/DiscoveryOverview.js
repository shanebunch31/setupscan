import React, { useState } from 'react'
import { DISCOVERY_METRIC_DEFINITIONS } from './discoveryEducation.js'
import { summarizeRequiredResearchData } from './labEvidence.js'

const h = React.createElement
export const DISCOVERY_QUESTIONS = [
  { id: 'a', title: 'Setup Ideas', question: 'Do trading ideas actually hold up?', investigation: 'Compare four defined setup families: moments when price breaks out, returns toward an average, reclaims a prior high, or expands after a quiet period.', lesson: 'Read the sample and the result together. A positive average from a small sample is a reason to ask more questions, not a reason to trade.', limitation: 'These families reuse historical data. Period checks are not independent confirmation, and modeled costs are assumptions rather than actual fills.' },
  { id: 'b', title: 'Market Conditions', question: 'Does market environment matter?', investigation: 'Keep the Momentum Breakout rules fixed and group the same signals by eight conditions, such as time of day, market trend and volatility.', lesson: 'Variation asks “when did outcomes differ?” It does not tell us which condition to choose. Inspect each group’s sample size before interpreting a difference.', limitation: 'These overlapping groups describe the same historical signals. Differences do not establish cause, a ranking, or a new entry rule.' },
  { id: 'c', title: 'Regular-Hours Test', question: 'Do trading hours change the results?', investigation: 'Compare the frozen Momentum Breakout rules on the full provider session and on hourly bars entirely inside regular U.S. market hours.', lesson: 'Changing the available bars can change which setups appear and how they finish, even when the strategy rules stay the same.', limitation: 'This compares two historical data universes, not matched trades or live executions. Hourly bars cannot represent the partial opening hour exactly; neither session is declared superior.' },
]
const count = value => Number.isInteger(value) && value >= 0 ? value : '—'
const r = value => Number.isFinite(value) ? `${value.toFixed(2)}R` : '—'
const pf = value => value === Infinity ? '∞' : Number.isFinite(value) ? value.toFixed(2) : '—'

export function overviewAvailability(datasets, available) {
  const data = summarizeRequiredResearchData(datasets, ['SPY', 'QQQ', 'IWM'])
  if (data.state === 'loading') return `Loading historical data for ${data.loadingSymbols.join(', ')}. Results appear when the required data is ready.`
  if (data.state === 'partial') return `Partial data: missing ${data.unavailableSymbols.join(', ')}. This question needs all required symbols; no result is substituted.`
  if (data.state === 'unavailable') return `Historical data unavailable for ${data.unavailableSymbols.join(', ')}. No demo results are substituted.`
  return available ? null : 'This comparison is unavailable in the loaded results. Open the batch to inspect its data limitations.'
}

function LearningMoments() {
  const definitions = ['Average R', 'Sample / Occurrences', 'Profit Factor'].map(term => ({
    term: term === 'Average R' ? 'R and Average R' : term,
    description: DISCOVERY_METRIC_DEFINITIONS.find(item => item.term === term).description +
      (term === 'Average R' ? ' R is a risk unit, not an account return: +0.06R does not mean a 6% investment gain.' : ''),
  }))
  definitions.push(
    { term: 'Evidence sufficiency versus performance', description: 'Sufficiency asks how much evidence we have; performance describes what happened. Discovery uses 100 resolved observations as its exploratory guideline. Reaching it does not validate a strategy.' },
    { term: 'Historical versus forward evidence', description: 'Historical results look back at known data. Forward observation collects new outcomes under rules fixed beforehand. A historical holdout is not prospective evidence.' },
  )
  return h('aside', { id: 'discovery-quick-glossary', className: 'discovery-question-learning', 'aria-label': 'Quick learning moments' },
    h('h3', null, 'New to these terms? Start here.'),
    h('p', null, 'Open a short explanation. The existing Need help panel has the deeper glossary.'),
    h('div', null, definitions.map(item => h('details', { key: item.term }, h('summary', null, item.term), h('p', null, item.description)))))
}

function QuestionEvidence({ selected, rowsA, rowsB, comparison, experiments, readout }) {
  if (selected === 'a') return h(React.Fragment, null,

    h('p', null, 'We studied four types of trading setups. Some have more historical examples than others, but more examples do not automatically mean better results. Trading costs can also turn a positive average into a negative one. Explore each card to see what the evidence tells us.'),
    h('details', { className: 'discovery-question-explanation' },
  h('summary', null, 'What else did the research find?'),


h('ol', { className: 'discovery-finding-takeaways' },
  (readout?.summary ?? '')
    .split(/(?<=[.!?])\s+(?=[A-Z])/)
    .filter(Boolean)
    .map((finding, index) =>
      h('li', { key: index }, finding)
    )
)),


  h('p', { className: 'discovery-question-evidence-guide' }, 'Understanding the labels: Exploratory means at least 100 resolved historical observations. There is enough evidence to investigate further, but the strategy is not validated. Insufficient means fewer than 100 observations, so the evidence is too limited to draw a reliable conclusion.'),
  h('div', { className: 'discovery-question-results' }, rowsA.map(row => {
      const result = experiments.find(item => item.experimentId === row.key)
      return h('article', { key: row.key }, h('h4', null, row.label),
        h('dl', null,
          h('div', null, h('dt', null, 'Resolved observations'), h('dd', null, count(row.sample))),
          h('div', null, h('dt', null, 'Average R · before costs'), h('dd', null, row.sample > 0 ? row.averageR : '—')),
          h('div', null, h('dt', null, 'Evidence sufficiency'), h('dd', null, Number.isInteger(row.sample) ? row.evidence : 'Unavailable'))),
          h('p', null, `Historical periods: ${row.periodStatus === 'MIXED' ? 'results varied across periods' : row.periodStatus === 'LIMITED DATA' ? 'not enough data to compare periods' : row.periodStatus}. Modeled trading costs: ${row.costStatus === 'CROSSES ZERO' ? 'the average can turn negative after costs' : row.costStatus === 'STAYS NEGATIVE' ? 'the average remains negative' : row.costStatus === 'LIMITED DATA' ? 'not enough data to compare cost levels' : row.costStatus}.`),
          h('details', { className: 'discovery-cost-explorer' },
          h('summary', null, 'What happens when trading costs are added?'),
          h('p', null, 'These are estimated trading costs, not actual trade fills. A basis point (bp) equals 0.01%. R measures the result relative to the amount risked. Higher trading costs can reduce the average historical result, turning a gain into a loss or making an existing loss larger. These results describe past observations, not future performance.'),
  result?.summary?.costTiers?.length
    ? h('div', { className: 'discovery-cost-levels' },
        result.summary.costTiers.map(tier =>
          h('details', { key: tier.label },
            h('summary', null, tier.label),
            h('p', null,
              tier.metrics?.occurrenceCount > 0
                ? `Average historical result: ${r(tier.metrics.averageR)}`
                : 'No usable resolved observations for this cost level.'))))
    : h('p', null, 'Modeled-cost evidence unavailable.')))
    })))
  if (selected === 'b') return h(React.Fragment, null,
    h('p', null, 'Each value is the gap between the highest and lowest populated group’s historical Average R within that condition. These are variations, not recommendations.'),
    h('div', { className: 'discovery-question-conditions' }, rowsB.map(row => h('article', { key: row.key },
      h('h4', null, row.label), h('strong', null, r(row.spread)), h('p', null, row.status),
      h('small', null, `${count(row.bucketCount)} groups; inspect group sizes in Batch B.`)))))
  const overall = comparison.overall
  return h(React.Fragment, null,
    h('p', null, 'Same frozen Momentum Breakout rules; different available trading hours.'),

    h('div', { className: 'discovery-question-results' }, ['batchA', 'batchC'].map(key => {
      const n = overall.occurrenceCount[key]
      return h('article', { key }, h('h4', null, key === 'batchA' ? 'Full session · Batch A' : 'Regular hours · Batch C'),
        h('dl', null,
          h('div', null, h('dt', null, 'Resolved observations'), h('dd', null, count(n))),
          h('div', null, h('dt', null, 'Average R · before costs'), h('dd', null, n > 0 ? r(overall.expectancy[key]) : '—')),
          h('div', null, h('dt', null, 'Profit factor'), h('dd', null, n > 0 ? pf(overall.profitFactor[key]) : '—'))))
    })),
    h('p', null, `Average R difference (regular minus full): ${overall.occurrenceCount.batchA > 0 && overall.occurrenceCount.batchC > 0 ? r(overall.expectancy.diff) : '—'}. A larger value is not proof of a better strategy.`))
}

// Controlled view keeps selection testable without running research or fetching data.


function DiscoveryQuestionIcon({ id }) {
  const props = {
    viewBox: '0 0 24 24',
    width: 26,
    height: 26,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': 'true',
    focusable: 'false'
  }

  if (id === 'a') {
    return h('svg', props,
      h('path', { d: 'M9 18h6M10 22h4M9 14a6 6 0 1 1 6 0c-.7.5-1 1.2-1 2v1h-4v-1c0-.8-.3-1.5-1-2Z' }))
  }

  if (id === 'b') {
    return h('svg', props,
      h('circle', { cx: 8, cy: 7, r: 3 }),
      h('path', { d: 'M8 1v2M1 7h2M3 2l1.5 1.5M13 2l-1.5 1.5' }),
      h('path', { d: 'M7 20h11a4 4 0 0 0 0-8 5.5 5.5 0 0 0-10.2 1.2A3.5 3.5 0 0 0 7 20Z' }))
  }

  return h('svg', props,
    h('circle', { cx: 12, cy: 12, r: 9 }),
    h('path', { d: 'M12 7v5l3 2' }))
}

export function DiscoveryOverviewView({ selected = 'a', onSelect, navigate, datasets = [], batch, rowsA = [], rowsB = [], batchB, comparison, readout }) {
  const question = DISCOVERY_QUESTIONS.find(item => item.id === selected) ?? DISCOVERY_QUESTIONS[0]
  const destination = `discovery-batch-${question.id}`
  const available = question.id === 'a' ? batch?.available && rowsA.length > 0 : question.id === 'b' ? batchB?.available && rowsB.length > 0 : Boolean(comparison)
  const unavailable = overviewAvailability(datasets, available)
  return h('div', { className: 'discovery-question-overview' },
    h('header', { className: 'discovery-question-intro' },
      h('p', { className: 'eyebrow' }, 'STRATEGY DISCOVERY · ASK. EXPLORE. LEARN.'),
      h('h2', null, 'Every good trading idea starts with a question.'),
      h('p', null, 'Explore real historical market behavior, follow your curiosity, and learn what the evidence can—and cannot—tell you. You do not need trading experience to begin.'),
      h('small', null, 'Exploratory research only. Exploring these questions does not run new research, change scanner rules or place trades.')),
    h('div', { className: 'discovery-question-cards', role: 'group', 'aria-label': 'Choose a research question' }, DISCOVERY_QUESTIONS.map(item =>
      h('button', { key: item.id, type: 'button', 'aria-pressed': question.id === item.id, 'aria-controls': 'discovery-question-answer', onClick: () => onSelect(item.id) },
        h('span', { className: 'discovery-question-icon' },
  h(DiscoveryQuestionIcon, { id: item.id })),
h('span', null, `Batch ${item.id.toUpperCase()} — ${item.title}`),
h('strong', null, item.question),
        h('small', null, question.id === item.id ? 'Selected · evidence below' : 'Explore this question →')))),
    h('p', { className: 'discovery-question-selection', role: 'status', 'aria-live': 'polite' }, `Exploring: ${question.title}`),
    h('section', { id: 'discovery-question-answer', 'aria-labelledby': 'discovery-question-title', 'aria-busy': unavailable?.startsWith('Loading') || undefined },
      h('p', { className: 'eyebrow' }, 'FOLLOW THE EVIDENCE'), h('h3', { id: 'discovery-question-title' }, question.question),
      h('h4', null, 'What we’re investigating'), h('p', null, question.investigation),
      h('h4', null, 'What the historical evidence shows'),
      h('p', { className: 'discovery-glossary-shortcut' },
  'New to trading? ',
  h('button', {
    type: 'button',
    className: 'discovery-glossary-link',
    onClick: () => {
      document.getElementById('discovery-quick-glossary')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, 'Start with the Quick Glossary ↓')),
      unavailable ? h('p', { className: 'discovery-question-unavailable' }, unavailable) : h(QuestionEvidence, { selected: question.id, rowsA, rowsB, comparison, experiments: batch?.experiments ?? [], readout }),
      h('div', { className: 'discovery-question-takeaways' },
        h('div', null, h('h4', null, 'What we can learn'), h('p', null, question.lesson)),
        h('div', null, h('h4', null, 'What this doesn’t prove'), h('p', null, question.limitation))),
      h('h4', null, 'What to explore next'),
      h('a', { className: 'discovery-question-next', href: `#${destination}`, onClick: event => navigate(event, destination) }, `Explore Batch ${question.id.toUpperCase()} — ${question.title} →`)),
    h(LearningMoments))
}

export function DiscoveryOverview(props) {
  const [selected, setSelected] = useState('a')
  return h(DiscoveryOverviewView, { ...props, selected, onSelect: setSelected })
}
