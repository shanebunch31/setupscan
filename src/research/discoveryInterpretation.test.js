import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createResearchRecordForExperiment } from './registry.js'
import { synthesizeResearch } from './synthesis.js'
import { interpretResearchSummary } from './interpretation.js'
import { projectResearchRunForPersistence } from './researchRunHistory.js'
import { parseResearchJson, stringifyResearchJson } from './researchRunSerialization.js'
import { strategyDiscoveryCostTiers, strategyDiscoveryResearchWindows, summarizeOccurrences } from '../backtest/strategyDiscovery/discoveryMetrics.js'
import { explainDiscoveryLabel, discoveryResearchJourney, discoveryReadout } from '../backtest/discoveryEducation.js'

const context = {
  runId: 'run', datasetId: 'data', codeRevision: 'revision', emaContractVersion: 'ema', adjustmentMode: 'split',
  requestedExperiments: ['strategy-discovery'], symbols: ['SPY', 'QQQ', 'IWM'], timeframe: '1Hour',
  provider: 'ALPACA HISTORICAL', requestedStart: '2022-01-01', requestedEnd: '2026-10-01',
  actualStart: '2022-01-03', actualEnd: '2026-09-30',
  provenance: { runId: 'run', datasetId: 'data', codeRevision: 'revision', adjustmentMode: 'split' },
}
const metric = (expectancy, occurrenceCount, profitFactor = 1) => ({ expectancy, occurrenceCount, profitFactor })
const row = (label, expectancy, size) => ({ label, ...metric(expectancy, size) })
function native() {
  return {
    available: true, costTiers: structuredClone(strategyDiscoveryCostTiers),
    researchWindows: structuredClone(strategyDiscoveryResearchWindows),
    experiments: [{
      experimentId: 'momentum-breakout-v1', parameters: { primaryOutcome: '+1R before -1R within 5 completed candles' },
      summary: {
        overall: metric(.06, 500, 1.14),
        byYear: [row('2022', -.13, 100), row('2023', .15, 100), row('2024', .18, 100), row('2025', -.07, 100), row('2026', .20, 100)],
        bySymbol: [row('IWM', -.09, 170), row('QQQ', .11, 165), row('SPY', .16, 165)],
        byPeriod: [row('Development', .07, 300), row('Out-of-Sample', -.07, 100), row('Holdout (2026 YTD)', .20, 100)],
        costTiers: strategyDiscoveryCostTiers.map((tier, i) => ({ ...tier, metrics: metric([.06, .01, -.09, -.34][i], 500, [1.14, 1.02, .82, .45][i]) })),
        excluded: { ambiguousCount: 9, insufficientDataCount: 2, periodBoundaryCount: 3 },
      },
    }],
  }
}
function pipeline(payload = native()) {
  const record = createResearchRecordForExperiment('strategy-discovery', payload, context)
  const synthesis = synthesizeResearch([record], context)
  const saved = parseResearchJson(stringifyResearchJson(projectResearchRunForPersistence({
    ...context, records: [record], synthesis, experimentResults: [{ nativeOutput: payload }],
  })))
  return { record, saved, evidence: saved.synthesis.strategyGroups[0].evidence[0], result: interpretResearchSummary(saved) }
}

for (const [dimension, positive, negative] of [['year', '2023', '2022'], ['symbol', 'QQQ', 'IWM'], ['period', 'Development', 'Out-of-Sample']]) {
  test(`Discovery label explanation names the actual mixed ${dimension} buckets`, () => {
    const { result } = pipeline()
    const observation = result.stabilityObservations.find(item => item.dimension === dimension)
    const explanation = explainDiscoveryLabel(observation)
    assert.ok(explanation[0].includes(positive))
    assert.ok(explanation[1].includes(negative))
    for (const row of observation.observations.filter(item => item.direction === 'positive' || item.direction === 'negative')) {
      assert.ok(explanation.join(' ').includes(`${row.label}: ${row.expectancy > 0 ? '+' : ''}${row.expectancy.toFixed(2)}R (n=${row.resolvedCount})`))
    }
  })
}

test('Discovery cost explanation uses current tier values and distinguishes weakening from sign reversal', () => {
  const payload = native()
  let cost = pipeline(payload).result.costSensitivityObservations[0]
  let explanation = explainDiscoveryLabel(cost).join(' ')
  for (const value of ['+0.06R', '+0.01R', '-0.09R', '-0.34R']) assert.ok(explanation.includes(value))
  assert.match(explanation, /turned negative/)
  payload.experiments[0].summary.costTiers.forEach((tier, i) => { tier.metrics.expectancy = [.06, .05, .04, .03][i] })
  cost = pipeline(payload).result.costSensitivityObservations[0]
  explanation = explainDiscoveryLabel(cost).join(' ')
  assert.match(explanation, /weakened/)
  assert.doesNotMatch(explanation, /turned negative/)
  assert.match(explanation, /not measured historical bid\/ask fills/)
})

test('Discovery explanation and journey retain seven-observation insufficiency despite completed historical checks', () => {
  const payload = native(), summary = payload.experiments[0].summary
  summary.overall.occurrenceCount = 7
  summary.byYear = [row('2022', .2, 3), row('2023', -.1, 4)]
  summary.bySymbol = [row('SPY', .2, 3), row('QQQ', -.1, 4)]
  summary.byPeriod = [row('Development', .2, 3), row('Out-of-Sample', -.1, 2), row('Holdout (2026 YTD)', .1, 2)]
  summary.costTiers.forEach(tier => { tier.metrics.occurrenceCount = 7 })
  const { result } = pipeline(payload)
  for (const observation of [...result.stabilityObservations, ...result.costSensitivityObservations]) {
    const text = explainDiscoveryLabel(observation).join(' ')
    assert.match(text, /7 resolved parent observations/)
    assert.match(text, /at least 100 for exploratory evidence, not validation/)
    assert.match(text, /does not add observations/)
    assert.doesNotMatch(text, /Positive:|Negative:|turned negative/)
  }
  const journey = discoveryResearchJourney({ result: payload.experiments[0], interpretation: { candidate: result.discoveryCandidates[0], stability: result.stabilityObservations, cost: result.costSensitivityObservations[0] } })
  assert.match(journey[1].text, /Run completed — 7 resolved observations · insufficient evidence/)
  assert.match(journey[2].text, /^Checked — .*insufficient evidence/)
  assert.match(journey[3].text, /Not started here/)
})

test('Discovery readout describes existing partitions and directs further investigation rather than repeating completed checks', () => {
  const { result } = pipeline()
  const before = structuredClone(result)
  const readout = discoveryReadout(result)
  assert.deepEqual(discoveryReadout(result), readout)
  assert.deepEqual(result, before)
  assert.match(readout.statements.join(' '), /checks are present/)
  for (const label of ['By year', 'By symbol', 'Research periods', 'Modeled costs']) assert.ok(readout.statements.join(' ').includes(label))
  assert.match(readout.next.join(' '), /Investigate why results differ across symbols/)
  assert.match(readout.next.join(' '), /development\/out-of-sample\/holdout disagreement/)
  assert.match(readout.next.join(' '), /execution assumptions/)
  assert.match(readout.next.join(' '), /prospective observation/)
  assert.doesNotMatch(readout.next.join(' '), /Check whether these results survive/)
})

test('Discovery unavailable provenance cannot yield explanatory comparisons or completed journey checks', () => {
  const { saved, evidence } = pipeline()
  evidence.provenance.datasetId = 'wrong'
  const result = interpretResearchSummary(saved)
  for (const item of [...result.stabilityObservations, ...result.costSensitivityObservations]) {
    assert.equal(item.status, 'unavailable')
    assert.match(explainDiscoveryLabel(item).join(' '), /provenance is unavailable/)
    assert.doesNotMatch(explainDiscoveryLabel(item).join(' '), /\+0\.06R|Positive:|Negative:/)
  }
  const journey = discoveryResearchJourney({ result: native().experiments[0], interpretation: { candidate: result.discoveryCandidates[0], stability: result.stabilityObservations, cost: result.costSensitivityObservations[0] } })
  assert.match(journey[2].text, /^Unavailable/)
  const readout = discoveryReadout(result)
  assert.match(readout.statements[0], /unavailable or incomplete/)
  assert.match(readout.next.join(' '), /Resolve missing data or provenance/)
  assert.doesNotMatch(readout.statements.join(' '), /positive and negative|Modeled costs weaken/)
})

for (const field of ['byYear', 'bySymbol', 'byPeriod', 'costTiers']) test(`${field} survives normalization, synthesis and compact save projection`, () => {
  const payload = native(), before = structuredClone(payload)
  const { record, evidence, saved } = pipeline(payload)
  assert.deepEqual(evidence.discoveryDetail[field], record.metrics['momentum-breakout-v1'].discoveryDetail[field])
  assert.equal(evidence.discoveryDetail[field].length, payload.experiments[0].summary[field].length)
  for (const source of payload.experiments[0].summary[field]) {
    const target = evidence.discoveryDetail[field].find(item => item.label === source.label)
    assert.deepEqual(target.metrics, field === 'costTiers' ? source.metrics : metric(source.expectancy, source.occurrenceCount, source.profitFactor))
  }
  assert.equal(evidence.metrics.periodBoundaryCount, 3)
  assert.equal(evidence.discoveryDetail.methodologyVersion, 'strategy-discovery-2')
  assert.equal(evidence.provenance.datasetId, 'data')
  assert.equal(saved.synthesis.strategyGroups[0].evidence.length, 1, 'partitions are not independent evidence')
  assert.equal('nativePayload' in saved.records[0], false)
  assert.equal('nativeOutput' in saved.experimentResults[0], false)
  assert.deepEqual(payload, before)
})

test('modeled cost sign reversal retains exact tiers, counts and a bounded caution', () => {
  const { result } = pipeline()
  const cost = result.costSensitivityObservations[0]
  assert.equal(cost.status, 'cost-sensitive')
  assert.equal(cost.positiveToNegative, true)
  assert.deepEqual(cost.observations.map(item => item.expectancy), [.06, .01, -.09, -.34])
  assert.equal(cost.observations[2].differenceFromBeforeCostsR, -.15)
  assert.equal(cost.observations[2].resolvedCount, 500)
  assert.match(cost.note, /research assumptions, not measured execution costs/)
  assert.ok(result.cautionPoints.some(item => item.code === 'discovery-modeled-cost-sensitivity'))
})

test('mixed years, symbols and development/OOS/holdout remain distinct descriptive observations', () => {
  const { result } = pipeline()
  assert.equal(result.status, 'mixed')
  assert.deepEqual(result.stabilityObservations.map(item => [item.dimension, item.status]), [['year', 'mixed'], ['symbol', 'mixed'], ['period', 'mixed']])
  const year = result.stabilityObservations[0], period = result.stabilityObservations[2]
  assert.match(year.text, /entry-year cohorts; outcomes can extend/)
  assert.deepEqual(period.researchWindows.map(item => item.role), ['development', 'outOfSample', 'holdout'])
  assert.equal(period.researchWindows[2].end, null, 'no invented holdout end date')
  assert.equal(result.stabilityObservations.every(item => item.independentConfirmation === false), true)
  assert.equal(result.comparisonScope.crossExperimentRanking, false)
  assert.deepEqual(result.comparisonScope.comparisons.flatMap(item => item.highestExpectancy ? [item.highestExpectancy] : []), [])
  assert.equal('confidenceScore' in result, false)
  assert.equal('recommendation' in result, false)
})

test('Mean Reversion with seven primary observations cannot gain strength from its partitions', () => {
  const payload = native(), experiment = payload.experiments[0], summary = experiment.summary
  experiment.experimentId = 'mean-reversion-v1'
  summary.overall.occurrenceCount = 7
  summary.byYear.forEach((item, i) => { item.occurrenceCount = i < 2 ? 2 : 1 })
  summary.bySymbol.forEach((item, i) => { item.occurrenceCount = i === 0 ? 3 : 2 })
  summary.byPeriod.forEach((item, i) => { item.occurrenceCount = i === 0 ? 3 : 2 })
  summary.costTiers.forEach(item => { item.metrics.occurrenceCount = 7 })
  const { result } = pipeline(payload)
  assert.equal(result.status, 'insufficient-evidence')
  assert.equal(result.discoveryCandidates[0].sample.classification, 'insufficient')
  assert.ok(result.stabilityObservations.every(item => item.status === 'insufficient-evidence' && item.observations.every(row => row.direction === null)))
  assert.equal(result.costSensitivityObservations[0].status, 'insufficient-evidence')
  assert.equal(result.costSensitivityObservations[0].positiveToNegative, null)
})

test('missing or incompatible parent metadata withholds deeper conclusions', () => {
  for (const mutate of [
    input => { input.runId = 'wrong-run' },
    (_, entry) => { entry.provenance.datasetId = 'other-data' },
    (_, entry) => { entry.membershipRule = 'legacy-unknown' },
    (_, entry) => { entry.discoveryDetail.strategyId = 'other-strategy' },
    (_, entry) => { entry.discoveryDetail.methodologyVersion = 'future-method' },
    (_, entry) => { entry.discoveryDetail.primaryOutcome = null },
    (_, entry) => { delete entry.discoveryDetail },
  ]) {
    const { saved, evidence } = pipeline()
    mutate(saved, evidence)
    const result = interpretResearchSummary(saved)
    assert.ok(result.stabilityObservations.every(item => item.status === 'unavailable'))
    assert.equal(result.costSensitivityObservations[0].status, 'unavailable')
    assert.ok(!result.cautionPoints.some(item => item.code.endsWith('-mixed')))
  }
})

test('incompatible partitions, duplicate labels and cost populations are not silently compared', () => {
  for (const [dimension, mutate] of [
    ['year', detail => { detail.byYear[0].metrics.occurrenceCount = 999 }],
    ['year', detail => { detail.byYear[0].label = '2050' }],
    ['symbol', detail => { detail.bySymbol[0].label = 'OTHER' }],
    ['symbol', detail => { detail.bySymbol[0].label = detail.bySymbol[1].label }],
    ['period', detail => { detail.researchWindows = null }],
    ['period', detail => { detail.researchWindows[1].start = '2023-01-01' }],
    ['cost', detail => { detail.costTiers[1].metrics.occurrenceCount = 499 }],
    ['cost', detail => { detail.costTiers[1].entryBps = 9 }],
    ['cost', detail => { detail.costTiers[0].metrics.expectancy = 42 }],
  ]) {
    const { saved, evidence } = pipeline()
    mutate(evidence.discoveryDetail)
    const result = interpretResearchSummary(saved)
    assert.equal(dimension === 'cost' ? result.costSensitivityObservations[0].status : result.stabilityObservations.find(item => item.dimension === dimension).status, 'unavailable')
  }
})

test('empty and missing partitions are unavailable, not measured zero performance', () => {
  const payload = native(), summary = payload.experiments[0].summary
  summary.byPeriod = [row('Development', .06, 500), row('Out-of-Sample', 0, 0), row('Holdout (2026 YTD)', 0, 0)]
  delete summary.byYear
  summary.bySymbol = []
  const { result } = pipeline(payload)
  assert.equal(result.stabilityObservations[0].status, 'unavailable')
  assert.equal(result.stabilityObservations[1].status, 'unavailable')
  const period = result.stabilityObservations[2]
  assert.equal(period.status, 'incomplete')
  assert.ok(period.observations.filter(item => item.resolvedCount === 0).every(item => item.expectancy === null && item.direction === null))
})

test('native primary summaries match normalized detail and interpretation does not mutate or recompute them', () => {
  const payload = native()
  payload.experiments[0].summary = summarizeOccurrences(Array.from({ length: 120 }, (_, i) => ({
    symbol: ['SPY', 'QQQ', 'IWM'][i % 3], timestamp: '2025-02-03T15:00:00Z',
    primaryR: i % 2 ? 1 : -1, primaryStatus: i % 2 ? 'Target' : 'Stop', period: 'Out-of-Sample',
    entryPrice: 100, risk: 1, holdingBars: 2, mfeR: 1, maeR: -1,
  })))
  const { saved, evidence } = pipeline(payload)
  assert.equal(evidence.discoveryDetail.byYear[0].metrics.occurrenceCount, 120)
  assert.equal(evidence.discoveryDetail.byYear[0].metrics.expectancy, 0)
  const before = structuredClone(saved)
  const freeze = value => { if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(freeze) } }
  freeze(saved)
  const first = interpretResearchSummary(saved), second = interpretResearchSummary(saved)
  assert.deepEqual(first, second)
  assert.deepEqual(saved, before)
  assert.equal(first.stabilityObservations[0].status, 'incomplete')
  assert.equal(first.stabilityObservations[0].observations[0].direction, 'zero')
  first.stabilityObservations[0].observations[0].expectancy = 99
  assert.deepEqual(saved, before)
})

test('different primary outcome contracts and duplicate parents cannot become comparable confirmation', () => {
  const payload = native(), second = structuredClone(payload.experiments[0])
  second.experimentId = 'mean-reversion-v1'
  second.parameters.primaryOutcome = 'Reaches VWAP before -1R within 10 completed candles'
  payload.experiments.push(second)
  const { result, saved } = pipeline(payload)
  assert.equal(result.comparisonScope.comparisons.length, 2)
  assert.ok(result.comparisonScope.comparisons.every(item => item.highestExpectancy === null))
  saved.synthesis.strategyGroups.push(structuredClone(saved.synthesis.strategyGroups[0]))
  const duplicate = interpretResearchSummary(saved)
  const id = saved.synthesis.strategyGroups[0].strategyId
  assert.ok(duplicate.stabilityObservations.filter(item => item.reference.strategyId === id).every(item => item.status === 'unavailable'))
})

test('weaker positive results are described without inventing a significance threshold or stability score', () => {
  const payload = native()
  payload.experiments[0].summary.costTiers.forEach((tier, i) => { tier.metrics.expectancy = .06 - i * .01 })
  const { result } = pipeline(payload)
  const cost = result.costSensitivityObservations[0]
  assert.equal(cost.status, 'cost-sensitive')
  assert.equal(cost.positiveToNegative, false)
  assert.match(cost.text, /weakened/)
  assert.doesNotMatch(cost.text, /significant|validated|winner|promising|best strategy/)
  assert.equal('stabilityScore' in result, false)
})
