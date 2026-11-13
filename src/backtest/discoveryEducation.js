import React from 'react'
import { TermHelp } from '../TermHelp.js'
import { DISCOVERY_MIN_EXPLORATORY } from '../research/interpretation.js'

const h = React.createElement
const rows = value => Array.isArray(value) ? value : []
const knownCount = value => Number.isInteger(value) && value >= 0
const formatR = value => Number.isFinite(value) ? `${value > 0 ? '+' : ''}${value.toFixed(2)}R` : 'unavailable'
const dimensionNames = { year: 'By year', symbol: 'By symbol', period: 'Research periods' }
const statusLabel = status => ({
  'mixed': 'mixed evidence', 'same-direction': 'same direction',
  'cost-sensitive': 'cost sensitive', 'no-weakening-observed': 'no weakening observed',
  'insufficient-evidence': 'insufficient evidence',
})[status] ?? status ?? 'unavailable'

// Presentation only: use the existing interpretation's decisions and scoped rows.
// In particular, never infer a direction from rows whose provenance was rejected.
export function explainDiscoveryLabel(observation) {
  if (!observation || observation.status === 'unavailable') {
    return ['Comparable evidence or its required provenance is unavailable. No direction or cost conclusion can be explained from these rows.']
  }
  const count = observation.parentResolvedCount
  if (observation.status === 'insufficient-evidence') {
    return [
      `${knownCount(count) ? count : 'An unknown number of'} resolved parent observations; the current Discovery guideline requires at least ${DISCOVERY_MIN_EXPLORATORY} for exploratory evidence, not validation.`,
      'Splitting the same small sample into years, symbols, or periods does not add observations. Cost tiers reuse that same sample.',
    ]
  }
  const points = rows(observation.observations)
  const describe = point => `${point.label}: ${formatR(point.expectancy)} (n=${knownCount(point.resolvedCount) ? point.resolvedCount : 'unknown'})`
  if (observation.status === 'mixed') {
    return ['Positive: ' + points.filter(point => point.direction === 'positive').map(describe).join('; ') + '.',
      'Negative: ' + points.filter(point => point.direction === 'negative').map(describe).join('; ') + '.',
      'These are descriptive differences within the same historical sample, not independent confirmations.']
  }
  if (['cost-sensitive', 'no-weakening-observed'].includes(observation.status)) {
    return [observation.text, points.map(describe).join('; ') + '.',
      'Costs are modeled assumptions, not measured historical bid/ask fills or actual executions.']
  }
  if (observation.status === 'incomplete') {
    return ['There are not enough populated, comparable buckets for this dimension.',
      points.map(point => `${point.label}: ${knownCount(point.resolvedCount) ? point.resolvedCount : 'unknown'} resolved observations`).join('; ') + '.']
  }
  return [observation.text, points.map(describe).join('; ') + '.',
    'Matching historical direction does not establish future persistence; small buckets may be unreliable.']
}

export function DiscoveryLabelExplanation({ observation }) {
  return h('details', { className: 'discovery-label-explanation' },
    h('summary', null, 'Why this label?'),
    ...explainDiscoveryLabel(observation).map((text, i) => h('p', { key: i }, text)))
}

export function discoveryResearchJourney({ result, interpretation }) {
  const count = result?.summary?.overall?.occurrenceCount
  const sample = interpretation?.candidate?.sample
  const checks = [...rows(interpretation?.stability), ...(interpretation?.cost ? [interpretation.cost] : [])]
  const available = checks.filter(check => check.status !== 'unavailable')
  // A historical run can be complete even when no outcomes resolved. Unknown
  // provenance/sample classification must not become an implied successful check.
  return [
    { label: 'Hypothesis Defined', text: 'Defined — implemented research rules' },
    { label: 'Historical Sample', text: result
      ? `Run completed — ${knownCount(count) ? `${count} resolved observations` : 'sample unavailable'} · ${sample?.classification === 'insufficient' ? 'insufficient evidence' : sample?.classification === 'exploratory' ? 'exploratory evidence' : 'evidence classification unavailable'}`
      : 'Not yet run — historical results unavailable' },
    { label: 'Stability & Costs', text: !result || available.length === 0
      ? 'Unavailable — comparable checks are not available'
      : `${available.length === 4 && checks.length === 4 && !checks.some(check => check.status === 'incomplete') ? 'Checked' : 'Partially checked'} — ${checks.map(check => `${dimensionNames[check.dimension] ?? 'Modeled costs'}: ${statusLabel(check.status)}`).join('; ')}` },
    // No strategy-specific prospective evidence is connected to this page.
    // A historical holdout and the separate Shadow tracker cannot supply it.
    { label: 'Forward Observation', text: 'Not started here — no strategy-specific forward evidence connected; historical holdout is not prospective observation' },
  ]
}

export function DiscoveryResearchJourney(props) {
  return h('section', { className: 'discovery-research-journey', 'aria-label': 'Research journey' },
    h('h4', null, 'Research Journey'),
    h('p', null, 'Research progress, not strategy quality. A completed check does not mean it passed.'),
    h('ol', null, ...discoveryResearchJourney(props).map(step => h('li', { key: step.label },
      h('strong', null, step.label), h('span', null, step.text)))))
}

export function discoveryReadout(interpretation) {
  const candidates = rows(interpretation?.discoveryCandidates)
  const stability = rows(interpretation?.stabilityObservations)
  const costs = rows(interpretation?.costSensitivityObservations)
  const statements = [], next = []
  const name = ref => candidates.find(candidate => candidate.reference.strategyId === ref?.strategyId)?.label ?? 'Unnamed family'
  const insufficient = candidates.filter(candidate => candidate.sample?.classification === 'insufficient')
  if (insufficient.length) {
    statements.push(`Insufficient samples: ${insufficient.map(candidate => `${candidate.label} (${knownCount(candidate.sample.size) ? candidate.sample.size : 'unknown'} resolved observations)`).join('; ')}.`)
    next.push('Collect more observations for the insufficient families before drawing stronger conclusions.')
  }
  for (const dimension of ['year', 'symbol', 'period']) {
    const mixed = stability.filter(item => item.dimension === dimension && item.status === 'mixed')
    if (mixed.length) {
      statements.push(`${dimensionNames[dimension]}: positive and negative historical expectancy for ${mixed.map(item => name(item.reference)).join('; ')}.`)
      next.push(({ year: 'Investigate the context behind the year-to-year differences without selecting rules on the same evidence.', symbol: 'Investigate why results differ across symbols without declaring a preferred symbol.', period: 'Investigate the development/out-of-sample/holdout disagreement; repeated exploration weakens their independence.' })[dimension])
    }
  }
  const sensitive = costs.filter(item => item.status === 'cost-sensitive')
  if (sensitive.length) {
    statements.push(`Modeled costs weaken expectancy for ${sensitive.map(item => name(item.reference)).join('; ')}.`)
    next.push('Investigate execution assumptions for the cost-sensitive families; modeled friction is not evidence of actual fills.')
  }
  const partial = !candidates.length || stability.length < candidates.length * 3 || costs.length < candidates.length ||
    [...stability, ...costs].some(item => ['unavailable', 'incomplete'].includes(item.status))
  statements.unshift(partial
    ? 'Some year, symbol, research-period, or modeled-cost checks are unavailable or incomplete.'
    : 'Year, symbol, research-period, and modeled-cost checks are present; they describe overlapping historical observations.')
  if (partial) next.push('Resolve missing data or provenance for the unavailable checks before interpreting them.')
  if (stability.some(item => item.status === 'same-direction')) statements.push('Some partitions share a historical direction; that alone does not establish stability.')
  if (costs.some(item => item.status === 'no-weakening-observed')) statements.push('Some modeled tiers show no weakening; this does not establish execution resilience.')
  next.push('Plan a frozen, strategy-specific prospective observation study before using future observations as new evidence. None is connected here.')
  return { statements, next }
}

// Plain-English presentation of existing decisions. Keep the diagnostic model
// above and the underlying classifications intact; names come from the page.
export function discoveryReadoutPresentation(interpretation, families = []) {
  const candidates = rows(interpretation?.discoveryCandidates)
  const stability = rows(interpretation?.stabilityObservations)
  const costs = rows(interpretation?.costSensitivityObservations)
  const name = candidate => families.find(family => family.experimentId === candidate.reference?.strategyId)?.label ?? 'This family'
  const list = values => new Intl.ListFormat('en', { style: 'long', type: 'conjunction' }).format([...new Set(values)])
  const match = (item, candidate) => item.reference?.strategyId === candidate.reference?.strategyId
  const dimensionWords = { year: 'years', symbol: 'symbols', period: 'research periods' }
  const insufficient = candidates.filter(candidate => candidate.sample?.classification === 'insufficient')
  const mixed = stability.filter(item => item.status === 'mixed')
  const sensitive = costs.filter(item => item.status === 'cost-sensitive')
  const hasGaps = !candidates.length || stability.length < candidates.length * 3 || costs.length < candidates.length ||
    [...stability, ...costs].some(item => ['unavailable', 'incomplete'].includes(item.status))
  const summary = candidates.map(candidate => {
    const label = name(candidate), count = candidate.sample?.size
    if (candidate.sample?.classification === 'insufficient') {
      return `${label} has ${knownCount(count) ? `${count} resolved observations` : 'an unknown sample size'}, which is not enough evidence to judge fairly.`
    }
            if (!knownCount(count)) {
      return `${label} cannot yet be interpreted fairly because its resolved sample size is unavailable.`
    }

    const outcome = {
      positive: 'a positive average result',
      negative: 'a negative average result',
      neutral: 'an average result of zero',
    }[candidate.status]

    if (!outcome) {
      return `${label} cannot yet be interpreted fairly because its overall historical result is unavailable.`
    }

    if (!candidate.scope) {
      return `${label} has ${count} resolved historical setups and ${outcome}, but some deeper stability checks or their provenance are unavailable or incomplete, so its consistency cannot be assessed as fully yet.`
    }

    const dimensions = mixed
      .filter(item => match(item, candidate))
      .map(item => dimensionWords[item.dimension])
      .filter(Boolean)

    const caveats = []

    if (dimensions.length) {
      caveats.push(`its results change between positive and negative across ${list(dimensions)}`)
    }

    if (sensitive.some(item => match(item, candidate))) {
      caveats.push('modeled trading costs weaken the result')
    }

    return `${label} has ${count} resolved historical setups and ${outcome}${caveats.length ? `, but ${list(caveats)}` : ''}.`
  })
  const classification = interpretation?.evidenceStrength?.classification ?? 'unavailable'
  const badge = classification === 'mixed' ? 'MIXED EVIDENCE' : classification.replaceAll('-', ' ').toUpperCase()
  const why = [({
    mixed: 'SetupScan shows Mixed Evidence because the families do not all have the same level of sample evidence.',
    exploratory: 'SetupScan shows Exploratory because the recorded samples support investigation, not a conclusion that a strategy works.',
    insufficient: 'SetupScan shows Insufficient because the recorded samples are too small for a fair conclusion.',
    descriptive: 'SetupScan shows Descriptive because these samples describe historical results, not future performance.',
    unknown: 'The evidence level is unknown because the required sample classification is not available.',
  })[classification] ?? 'An overall evidence level is unavailable from the current record.']
  if (mixed.length) why.push(`Some ${list(mixed.map(item => dimensionWords[item.dimension]).filter(Boolean))} have positive results while others have negative results.`)
  if (sensitive.length) why.push('Some results also weaken under modeled trading costs.')
  if (insufficient.length) why.push(`${list(insufficient.map(name))} ${insufficient.length === 1 ? 'does' : 'do'} not yet have enough observations for a fair conclusion.`)
  if (hasGaps) why.push('Some checks or their provenance are still unavailable or incomplete.')
  const questions = []
  const varying = candidates.filter(candidate => mixed.some(item => match(item, candidate)))
  if (varying.length) questions.push(`why results for ${list(varying.map(name))} change across ${list(mixed.map(item => dimensionWords[item.dimension]).filter(Boolean))}`)
  if (insufficient.length) questions.push(`how to collect more observations for ${list(insufficient.map(name))}`)
  if (sensitive.length) questions.push('how sensitive the results are to execution assumptions')
  if (hasGaps) questions.push('what evidence or provenance is still missing')
  return {
    badge,
    summary: summary.length ? summary.join(' ') : 'There is not enough usable historical evidence here to describe the strategy results yet.',
    why: why.join(' '),
    limitations: [
      'These results describe historical behavior, not what will happen next; even the holdout period is historical data, not prospective forward observation.',
      'Year, symbol, and research-period views reuse the same observations, so they are not independent confirmation; a small sample remains small when divided up.',
      'Modeled trading costs are assumptions, not actual historical fills.',
    ],
    next: questions.length
      ? `The open questions are ${list(questions)}. No strategy-specific prospective observation evidence is connected here.`
      : 'The next question is whether these historical patterns persist on new observations collected under rules fixed in advance. No strategy-specific prospective observation evidence is connected here.',
    question: questions.length
      ? 'Should SetupScan investigate these gaps first, or plan a frozen prospective observation study to see what happens on new data?'
      : 'Should SetupScan plan a frozen prospective observation study with the research rules fixed before new data arrives?',
  }
}

export function DiscoveryReadoutLabel({
  badge,
  why,
  ariaLabel = 'Why this label? Overall Batch A evidence',
}) {
  return h('div', { className: 'discovery-readout-label' },
    h('span', { className: 'discovery-readout-status' }, badge),
    h('details', { className: 'discovery-label-explanation discovery-overall-explanation' },
      h('summary', { 'aria-label': ariaLabel }, 'Why this label?'),
      h('p', null, why)))
}

// One Discovery definition list feeds both the existing glossary and contextual
// TermHelp controls. Units describe this page's existing historical outputs.
export const DISCOVERY_METRIC_DEFINITIONS = [
  { term: 'Sample / Occurrences', description: 'The number of resolved historical setup outcomes in the displayed sample, after the stated exclusions. It is not the number of live trades. Small samples can be unreliable.' },
  { term: 'Win Rate', description: 'The share of resolved historical outcomes above zero. Win rate alone does not show the size of wins versus losses or predict the next outcome.' },
  { term: 'Profit Factor', description: 'Gross gains divided by gross losses in the historical sample. Above 1 means gains were larger than losses in that sample; it does not establish future profitability.' },
  { term: 'Average R', description: 'The average outcome per historical setup relative to its defined initial risk. +0.5R means half one risk unit on average, not a dollar amount. Check the displayed cost assumptions.' },
  { term: 'Median R', description: 'The middle R result after sorting the historical outcomes (the mean of the two middle values for an even sample). It can differ from Average R when a few large outcomes affect the average.' },
  { term: 'Total R', description: 'The sum of historical R outcomes in this sample. It is not account growth: account size, position sizing, capital limits, and overlapping positions are not represented by this total.' },
  { term: 'Max Drawdown', description: 'The largest peak-to-trough fall in the ordered cumulative R results, measured in risk units. It is not an account-equity drawdown or a forecast of future losses.' },
  { term: 'Average Hold', description: 'The average number of observed candles a resolved historical setup remained open. Missing bars are not invented; this is not necessarily elapsed clock time or actual execution duration.' },
  { term: 'Development', description: 'The historical slice used to develop or explore the strategy. Results on data used to choose rules can be optimistic.' },
  { term: 'Out-of-Sample', description: 'A later historical slice outside the original development sample. Repeatedly exploring it weakens its independence; it is not untouched future evidence.' },
  { term: 'Holdout', description: 'A designated later historical research slice. Repeated inspection can influence choices, and historical holdout results are not prospective forward observation.' },
  { term: 'Modeled Trading Costs', description: 'Research assumptions for trading friction, applied to the same historical outcomes. Basis-point tiers are per side; 1 basis point is 0.01% of price. These are not measured historical bid/ask fills or actual executions.' },
]
const aliases = { Sample: 'Sample / Occurrences', Signals: 'Sample / Occurrences', 'Signals tested': 'Sample / Occurrences', Occurrences: 'Sample / Occurrences', 'Win rate': 'Win Rate', 'Profit factor': 'Profit Factor', PF: 'Profit Factor', 'Average result': 'Average R', 'Max DD': 'Max Drawdown', 'Max drawdown': 'Max Drawdown', 'Avg hold': 'Average Hold', 'Cost tier': 'Modeled Trading Costs' }
export function DiscoveryMetricLabel({ label, term = aliases[label] ?? label }) {
  const definition = DISCOVERY_METRIC_DEFINITIONS.find(item => item.term === term)
  return h(React.Fragment, null, label, definition ? h(TermHelp, { term: definition.term, explanation: definition.description }) : null)
}
