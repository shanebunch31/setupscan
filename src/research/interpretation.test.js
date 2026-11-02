import { test } from 'node:test'
import assert from 'node:assert/strict'
import { interpretResearchSummary } from './interpretation.js'
import { synthesizeResearch } from './synthesis.js'
import { createResearchRecord } from './researchRecord.js'
import { createResearchRecordForExperiment } from './registry.js'
import { parseResearchJson, stringifyResearchJson } from './researchRunSerialization.js'
import { strategyDiscoveryCostTiers } from '../backtest/strategyDiscovery/discoveryMetrics.js'

const context = {
  runId: 'saved-run',
  datasetId: 'saved-data',
  requestedExperiments: ['strategy-discovery'],
  codeRevision: 'saved-code',
  emaContractVersion: 'ema-contract',
  adjustmentMode: 'split',
  symbols: ['QQQ', 'SPY'],
  timeframe: '1Hour',
  provider: 'ALPACA HISTORICAL',
  requestedStart: '2022-01-01',
  requestedEnd: '2026-09-01',
  actualStart: '2022-01-03',
  actualEnd: '2026-08-31',
  provenance: {
    runId: 'saved-run',
    datasetId: 'saved-data',
    codeRevision: 'saved-code',
    adjustmentMode: 'split',
  },
}
function discovery(strategies = [{ id: 'custom-hypothesis-v7', expectancy: 0.2, size: 140 }]) {
  const record = createResearchRecordForExperiment(
    'strategy-discovery',
    {
      available: true,
      costTiers: strategyDiscoveryCostTiers,
      experiments: strategies.map(({ id, expectancy, size, metrics }) => ({
        experimentId: id,
        summary: {
          overall: {
            occurrenceCount: size,
            expectancy,
            winRate: 0.55,
            profitFactor: 1.4,
            maximumDrawdown: 2.5,
            ...metrics,
          },
        },
      })),
    },
    context,
  )
  return wrap(synthesizeResearch([record], context))
}
function record(id, strength, size = 140) {
  return createResearchRecord({
    id,
    title: id,
    category: 'baseline-validation',
    status: 'completed',
    methodologyVersion: id + '-1',
    input: context,
    provenance: context.provenance,
    costModel: { status: 'modeled' },
    metrics: {
      full: {
        strategyId: 'generic-baseline',
        membershipRule: 'research-eligible',
        tradeCount: size,
        expectancy: 0.4,
        ...(strength ? { evidenceStrength: strength } : {}),
      },
    },
  })
}
// Saved summaries arrive as detached JSON. Clone the fixture at that boundary
// so adversarial test mutations cannot change shared runner/context constants.
function wrap(synthesis) {
  return {
    runId: 'saved-run',
    datasetId: 'saved-data',
    codeRevision: 'saved-code',
    synthesis: parseResearchJson(stringifyResearchJson(synthesis)),
  }
}
const evidence = (summary) => summary.synthesis.strategyGroups.flatMap((group) => group.evidence)
const hasCode = (result, code) => result.cautionPoints.some((point) => point.code === code)
const highest = (result) =>
  result.comparisonScope.comparisons.flatMap((group) =>
    group.highestExpectancy ? [group.highestExpectancy] : [],
  )

test('clean completion describes execution coverage, preserves saved strength, and invents no unresolved questions', () => {
  const result = interpretResearchSummary(
    wrap(
      synthesizeResearch([record('context-study', 'stronger-descriptive-evidence')], {
        ...context,
        requestedExperiments: ['context-study'],
      }),
    ),
  )
  assert.equal(result.schemaVersion, 1)
  assert.equal(result.coverage.state, 'complete')
  assert.equal(result.status, 'neutral', 'completion alone must not become positive performance')
  assert.equal(result.evidenceStrength.classification, 'descriptive')
  assert.deepEqual(result.unresolvedQuestions, [])
  assert.ok(result.supportingPoints.some((point) => point.code === 'coverage-complete'))
  assert.equal(result.provenance.references[0].methodologyVersion, 'context-study-1')
})

test('partial, missing and unavailable experiments stay visible even when some metrics look positive', () => {
  for (const kind of ['incomplete', 'unavailable', 'missing']) {
    const input = discovery()
    input.synthesis.coverage.requested.push('other-experiment')
    if (kind !== 'missing') input.synthesis.coverage[kind].push('other-experiment')
    const result = interpretResearchSummary(input)
    assert.equal(result.status, 'incomplete')
    assert.ok(result.coverage[kind].includes('other-experiment'))
    assert.deepEqual(highest(result), [])
  }
  const unavailable = wrap(
    synthesizeResearch(
      [
        createResearchRecord({
          id: 'unavailable-study',
          title: 'Unavailable study',
          category: 'baseline-validation',
          status: 'unavailable',
        }),
      ],
      { ...context, requestedExperiments: ['unavailable-study'] },
    ),
  )
  assert.equal(interpretResearchSummary(unavailable).status, 'unavailable')
})

test('every saved conflict becomes a plain-English caution with links; conflicts suppress comparative leaders', () => {
  const input = discovery([
    { id: 'one', expectancy: 0.2, size: 200 },
    { id: 'two', expectancy: 0.1, size: 200 },
  ])
  const source = evidence(input)[0]
  input.synthesis.conflicts = ['expectancy-sign-disagreement', 'totalR-sign-disagreement'].map(
    (dimension) => ({
      id: dimension,
      strategyId: source.strategyId,
      dimension,
      observation: 'Saved opposite signs.',
      sides: [{ sourceRecordId: source.sourceRecordId, metricsKey: source.metricsKey }],
    }),
  )
  const result = interpretResearchSummary(input)
  assert.equal(result.status, 'mixed')
  const cautions = result.cautionPoints.filter((point) => point.code === 'conflict')
  assert.equal(cautions.length, 2)
  assert.match(cautions[0].text, /conflict/)
  assert.equal(cautions[0].references[0].evidenceId, source.id)
  assert.equal(cautions[0].references[0].runId, 'saved-run')
  assert.equal(cautions[0].observation, 'Saved opposite signs.')
  assert.deepEqual(highest(result), [])
  delete input.synthesis.contrastSummary
  assert.ok(hasCode(interpretResearchSummary(input), 'legacy-conflicts'))
})

test('unresolved questions remain separate from conclusions without inventing new ones', () => {
  const input = discovery()
  input.synthesis.unresolvedQuestions = [
    'Was the recorded cost model sufficient?',
    'Are the overlapping samples dependent?',
  ]
  const result = interpretResearchSummary(input)
  assert.deepEqual(result.unresolvedQuestions, input.synthesis.unresolvedQuestions)
  assert.notEqual(result.unresolvedQuestions, input.synthesis.unresolvedQuestions)
  assert.equal(interpretResearchSummary(discovery()).unresolvedQuestions.length, 0)
})

test('Discovery direction uses saved expectancy, sample count, profit factor, win rate and drawdown without fixed strategy names', () => {
  for (const [expectancy, status] of [
    [0.25, 'positive'],
    [-0.12, 'negative'],
    [0, 'neutral'],
  ]) {
    const result = interpretResearchSummary(discovery([{ id: 'new-rule-v42', expectancy, size: 250 }]))
    assert.equal(result.status, status)
    assert.equal(result.discoveryCandidates[0].label, 'New rule v42')
    assert.equal(result.discoveryCandidates[0].metrics.expectancy, expectancy)
    assert.equal(result.discoveryCandidates[0].metrics.occurrenceCount, 250)
    assert.equal(result.discoveryCandidates[0].metrics.profitFactor, 1.4)
    assert.match(result.supportingPoints[0].text, /historical win rate 55.0%/)
    assert.match(result.supportingPoints[0].text, /maximum drawdown 2.50R/)
    assert.equal(
      result.evidenceStrength.classification,
      'exploratory',
      'large Discovery samples are not automatically descriptive',
    )
    assert.equal(result.provenance.codeRevision, 'saved-code')
  }
})

test('Discovery minimum-evidence guideline is experiment-specific and preserves tiny or zero samples without leaders', () => {
  for (const size of [0, 4, 99]) {
    const result = interpretResearchSummary(
      discovery([
        { id: 'small', expectancy: 9, size },
        { id: 'large', expectancy: 0.1, size: 200 },
      ]),
    )
    assert.equal(result.status, 'insufficient-evidence')
    assert.equal(
      result.discoveryCandidates.find((item) => item.reference.strategyId === 'small').metrics
        .occurrenceCount,
      size,
    )
    assert.deepEqual(highest(result), [])
    assert.ok(hasCode(result, 'insufficient-sample'))
  }
  const other = wrap(
    synthesizeResearch([record('other-method', 'descriptive-only', 10)], {
      ...context,
      requestedExperiments: ['other-method'],
    }),
  )
  assert.equal(
    interpretResearchSummary(other).evidenceStrength.classification,
    'descriptive',
    'do not impose Discovery thresholds on another method',
  )
})

test('matched Discovery candidates expose mixed direction and highest recorded expectancy with ties retained', () => {
  const input = discovery([
    { id: 'losing-rule', expectancy: -0.2, size: 200 },
    { id: 'second-rule', expectancy: 0.3, size: 180 },
    { id: 'first-rule', expectancy: 0.3, size: 150 },
  ])
  const result = interpretResearchSummary(input)
  assert.equal(result.status, 'mixed')
  assert.equal(result.comparisonScope.comparisons[0].kind, 'directly-comparable')
  assert.deepEqual(highest(result), [{ value: 0.3, strategyIds: ['first-rule', 'second-rule'] }])
  assert.equal('score' in result, false)
  assert.equal('recommendation' in result, false)
})

test('different periods, populations, data, methodologies or costs never share a Discovery ordering', () => {
  for (const change of [
    (item) => {
      item.actualDateRange.end = '2025-01-01'
    },
    (item) => {
      item.symbols = ['IWM']
    },
    (item) => {
      item.provenance.datasetId = 'different-data'
    },
    (item) => {
      item.methodologyVersion = 'future-unknown-version'
    },
    (item) => {
      item.costModel.costTiers[0].entryBps = 9
    },
    (item) => {
      item.costModel = null
    },
    (item) => {
      item.adjustmentMode = 'legacy-unknown'
    },
    (item) => {
      item.partition = { type: 'year', label: '2025' }
    },
    (item) => {
      item.metricsKey = 'subgroup-without-overall-identity'
    },
    (item) => {
      item.actualDateRange.start = 'not-a-date'
    },
    (item) => {
      item.actualDateRange.start = '2030-01-01'
    },
  ]) {
    const input = discovery([
      { id: 'first', expectancy: 0.1, size: 150 },
      { id: 'second', expectancy: 0.2, size: 150 },
    ])
    change(evidence(input)[1])
    assert.deepEqual(highest(interpretResearchSummary(input)), [])
  }
})

test('unrelated families stay unranked and saved shared-family notes are not independent confirmation', () => {
  const records = [
    record('signal-quality', 'exploratory'),
    record('yearly-regime', 'exploratory'),
    record('relative-value', 'descriptive-only'),
  ]
  const input = wrap(
    synthesizeResearch(records, { ...context, requestedExperiments: records.map((item) => item.id) }),
  )
  const result = interpretResearchSummary(input)
  assert.equal(result.comparisonScope.crossExperimentRanking, false)
  assert.equal(result.comparisonScope.comparisons.length, 0)
  assert.equal(result.comparisonScope.families[0].kind, 'same-family-not-rankable')
  assert.ok(
    result.comparisonScope.unrelatedExperimentPairs.some(
      (pair) =>
        pair.experimentIds.includes('relative-value') && pair.experimentIds.includes('signal-quality'),
    ),
  )
  assert.ok(hasCode(result, 'shared-evidence-family'))
  assert.equal(result.comparisonScope.unrankedReferences.length, 3)
})

test('actual saved context sample labels are respected, absent labels stay unknown, and contradictory metadata prevents comparison', () => {
  for (const [rawLabel, expected] of [
    ['insufficient-evidence', 'insufficient'],
    ['small-exploratory-sample', 'exploratory'],
    ['stronger-descriptive-evidence', 'descriptive'],
    [undefined, 'unknown'],
  ]) {
    const input = wrap(
      synthesizeResearch([record('scanner-score-redundancy-stability', rawLabel, 25)], {
        ...context,
        requestedExperiments: ['scanner-score-redundancy-stability'],
      }),
    )
    const result = interpretResearchSummary(input)
    assert.equal(result.evidenceStrength.classification, expected)
  }
  const ablation = createResearchRecordForExperiment(
    'scanner-component-ablation',
    {
      rows: [
        {
          key: 'full-baseline',
          group: 'full',
          symbol: 'SPY',
          variant: 'baseline',
          evidenceStrength: 'descriptive-only',
          metrics: { tradeCount: 180, expectancy: 0.2 },
        },
      ],
    },
    context,
  )
  const nested = interpretResearchSummary(
    wrap(
      synthesizeResearch([ablation], { ...context, requestedExperiments: ['scanner-component-ablation'] }),
    ),
  )
  assert.equal(nested.evidenceStrength.classification, 'descriptive')
  assert.equal(nested.evidenceStrength.assessments[0].rawLabel, 'descriptive-only')
  const input = discovery([
    { id: 'first', expectancy: 0.1, size: 100 },
    { id: 'second', expectancy: 0.2, size: 100 },
  ])
  input.runId = 'different-header'
  const result = interpretResearchSummary(input)
  assert.ok(hasCode(result, 'provenance-mismatch'))
  assert.deepEqual(highest(result), [])
})

test('missing/non-finite metrics, unknown schema and duplicate candidate identities fail conservatively', () => {
  assert.equal(interpretResearchSummary(null).status, 'unavailable')
  const unknown = discovery()
  unknown.synthesis.schemaVersion = 42
  assert.equal(interpretResearchSummary(unknown).status, 'unavailable')
  for (const metrics of [{ expectancy: NaN }, { expectancy: Infinity }, { occurrenceCount: NaN }]) {
    const input = discovery()
    Object.assign(evidence(input)[0].metrics, metrics)
    assert.equal(interpretResearchSummary(input).status, 'unavailable')
  }
  const input = discovery([
    { id: 'first', expectancy: 0.1, size: 100 },
    { id: 'second', expectancy: 0.2, size: 100 },
  ])
  input.synthesis.strategyGroups.push(structuredClone(input.synthesis.strategyGroups[0]))
  assert.deepEqual(highest(interpretResearchSummary(input)), [])
})

test('interpretation is deterministic, detached from frozen source evidence, and does not carry large working payloads', (t) => {
  t.mock.method(globalThis, 'fetch', () => {
    assert.fail('interpretation must not make network requests')
  })
  t.mock.method(Date, 'now', () => {
    assert.fail('interpretation must not read the current time')
  })
  const input = discovery()
  evidence(input)[0].metrics.nativePayload = { candles: Array.from({ length: 2000 }, () => ({ close: 100 })) }
  const before = structuredClone(input)
  function freeze(value) {
    if (value && typeof value === 'object') {
      Object.freeze(value)
      Object.values(value).forEach(freeze)
    }
  }
  freeze(input)
  const first = interpretResearchSummary(input),
    second = interpretResearchSummary(input)
  assert.deepEqual(first, second)
  assert.deepEqual(input, before)
  assert.equal(JSON.stringify(first).includes('candles'), false)
  first.provenance.references[0].runId = 'changed-output'
  assert.deepEqual(input, before)
  assert.equal('confidenceScore' in second, false)
  assert.equal('generatedAt' in second, false)
})
