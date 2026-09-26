import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compareResearchEvidence } from './researchRunComparison.js'

function evidence(overrides = {}) {
  return {
    id: 'signal-quality::75-79',
    sourceRecordId: 'signal-quality',
    experimentId: 'signal-quality',
    strategyId: 'setup-scan-baseline',
    ruleSetVariant: null,
    strategyAssociation: 'explicit',
    partition: null,
    metricsKey: '75-79',
    metrics: { tradeCount: 20, expectancy: 0.2, totalR: 4 },
    sampleCounts: {},
    outOfSampleRole: 'not-partitioned',
    costModelStatus: 'modeled',
    actualDateRange: { start: '2022-01-03T14:00:00Z', end: '2022-12-30T20:00:00Z' },
    provenance: { runId: 'run-a', datasetId: 'dataset-a', requestedAt: '2026-09-20T00:00:00Z' },
    symbols: ['SPY', 'QQQ', 'IWM'],
    timeframe: '1Hour',
    provider: 'ALPACA HISTORICAL',
    requestedDateRange: { start: '2022-01-01T00:00:00Z', end: '2023-01-01T00:00:00Z' },
    ...overrides,
  }
}

function synthesis({ runId = 'run-a', datasetId = 'dataset-a', entries = [evidence()], families = [], requested = ['signal-quality'] } = {}) {
  return {
    schemaVersion: 1,
    coverage: { requested, unavailable: [], incomplete: [], evaluated: requested },
    strategyGroups: [{ strategyId: 'setup-scan-baseline', evidence: entries, evidenceFamilies: families }],
    provenance: { runId, datasetId },
  }
}

function familyAnnotation() {
  return {
    id: 'signal-quality-catalogue',
    experimentIds: ['signal-quality', 'frozen-score-holdout'],
    sourceRecordIds: ['signal-quality', 'frozen-score-holdout'],
    note: 'Shared catalogue evidence.',
  }
}

function forbiddenKeys(value, path = 'comparison') {
  const forbidden = new Set(['winner', 'ranking', 'rank', 'score', 'recommendation', 'confidence', 'probability', 'verdict', 'buy', 'sell'])
  if (Array.isArray(value)) return value.forEach((item) => forbiddenKeys(item, path))
  if (!value || typeof value !== 'object') return
  Object.entries(value).forEach(([key, nested]) => {
    assert.equal(forbidden.has(key), false, `forbidden field ${path}.${key}`)
    forbiddenKeys(nested, `${path}.${key}`)
  })
}

test('identical evidence is paired deterministically and preserves metrics/provenance references', () => {
  const matchedEvidence = evidence({ ruleSetVariant: 'score-75-baseline' })
  const result = compareResearchEvidence(
    synthesis({ entries: [matchedEvidence] }),
    synthesis({ runId: 'run-b', datasetId: 'dataset-b', entries: [matchedEvidence] }),
  )
  assert.equal(result.comparisons.length, 1)
  assert.equal(result.unmatched.length, 0)
  const comparison = result.comparisons[0]
  assert.equal(comparison.compatibility.compatible, true)
  assert.equal(comparison.evidenceA.runId, 'run-a')
  assert.equal(comparison.evidenceB.runId, 'run-b')
  assert.equal(comparison.evidenceA.evidenceId, 'signal-quality::75-79')
  assert.equal(comparison.evidenceA.id, 'run-a::signal-quality::75-79')
  assert.equal(comparison.evidenceB.id, 'run-b::signal-quality::75-79')
  assert.deepEqual(comparison.evidenceA.evidence.metrics, { tradeCount: 20, expectancy: 0.2, totalR: 4 })
  assert.equal(result.runA.requestedAt, '2026-09-20T00:00:00Z')
})

test('different strategy identities remain unmatched rather than being treated as comparable', () => {
  const result = compareResearchEvidence(
    synthesis(),
    synthesis({ runId: 'run-b', datasetId: 'dataset-b', entries: [evidence({ strategyId: 'rv-combined' })] }),
  )
  assert.equal(result.comparisons.length, 0)
  assert.equal(result.unmatched.length, 2)
  assert.ok(result.unmatched.every((entry) => entry.reason === 'identity-mismatch'))
  assert.ok(result.unmatched.every((entry) => entry.compatibility.compatible === 'unknown'))
})

test('different strategy-association certainty remains unmatched rather than being called compatible', () => {
  const result = compareResearchEvidence(
    synthesis(),
    synthesis({ runId: 'run-b', datasetId: 'dataset-b', entries: [evidence({ strategyAssociation: 'unknown' })] }),
  )
  assert.equal(result.comparisons.length, 0)
  assert.equal(result.unmatched.length, 2)
  assert.ok(result.unmatched.every((entry) => entry.compatibility.compatible === 'unknown'))
})

test('different rule variants remain unmatched because they are distinct identity partitions', () => {
  const result = compareResearchEvidence(
    synthesis({ entries: [evidence({ ruleSetVariant: 'rule-v1' })] }),
    synthesis({ runId: 'run-b', datasetId: 'dataset-b', entries: [evidence({ ruleSetVariant: 'rule-v2' })] }),
  )
  assert.equal(result.comparisons.length, 0)
  assert.equal(result.unmatched.length, 2)
  assert.ok(result.unmatched.every((entry) => entry.reason === 'identity-mismatch'))
  assert.ok(result.unmatched.every((entry) => entry.compatibility.compatible === 'unknown'))
})

test('exact identity pairs still preserve compareEvidence hard conflicts from incompatible metadata', () => {
  const result = compareResearchEvidence(
    synthesis({ entries: [evidence({ ruleSetVariant: 'score-75-baseline' })] }),
    synthesis({
      runId: 'run-b',
      datasetId: 'dataset-b',
      entries: [evidence({ ruleSetVariant: 'score-75-baseline', symbols: ['QQQ'] })],
    }),
  )
  assert.equal(result.comparisons.length, 1)
  assert.equal(result.comparisons[0].compatibility.compatible, false)
  assert.ok(result.comparisons[0].compatibility.hardConflicts.some((item) => item.field === 'symbols'))
})

test('evidence present in only one run is retained as unmatched without negative evidence', () => {
  const result = compareResearchEvidence(synthesis(), synthesis({ runId: 'run-b', datasetId: 'dataset-b', entries: [] }))
  assert.equal(result.comparisons.length, 0)
  assert.equal(result.unmatched.length, 1)
  assert.equal(result.unmatched[0].side, 'A')
  assert.equal(result.unmatched[0].counterpartStatus, 'unavailable')
  assert.equal(result.unmatched[0].compatibility.compatible, 'unknown')
  assert.match(result.unmatched[0].compatibility.unknowns[0].reason, /absence is not negative evidence/)
})

test('dataset identity differences are provenance context, not automatic compatibility conflicts', () => {
  const matchedEvidence = evidence({ ruleSetVariant: 'score-75-baseline' })
  const result = compareResearchEvidence(
    synthesis({ entries: [matchedEvidence] }),
    synthesis({ runId: 'run-b', datasetId: 'dataset-b', entries: [matchedEvidence] }),
  )
  assert.equal(result.provenance.datasetIdsEqual, false)
  assert.ok(result.compatibilityNotes.some((note) => note.type === 'dataset-identity-differs'))
  assert.equal(result.comparisons[0].compatibility.compatible, true)
})

test('different actual/requested date ranges remain existing soft mismatches', () => {
  const result = compareResearchEvidence(
    synthesis(),
    synthesis({ runId: 'run-b', datasetId: 'dataset-b', entries: [evidence({
      actualDateRange: { start: '2023-01-03T14:00:00Z', end: '2023-12-29T20:00:00Z' },
      requestedDateRange: { start: '2023-01-01T00:00:00Z', end: '2024-01-01T00:00:00Z' },
    })] }),
  )
  const mismatches = result.comparisons[0].compatibility.softMismatches.map((item) => item.field)
  assert.ok(mismatches.includes('actualDateRange.start'))
  assert.ok(mismatches.includes('actualDateRange.end'))
  assert.ok(mismatches.includes('requestedStart'))
  assert.ok(mismatches.includes('requestedEnd'))
})

test('different cost models remain an existing soft mismatch', () => {
  const result = compareResearchEvidence(
    synthesis(),
    synthesis({ runId: 'run-b', datasetId: 'dataset-b', entries: [evidence({ costModelStatus: 'not-modeled' })] }),
  )
  assert.ok(result.comparisons[0].compatibility.softMismatches.some((item) => item.field === 'costModelStatus'))
})

test('shared evidence families remain a non-independence annotation', () => {
  const family = familyAnnotation()
  const snapshotA = synthesis({ families: [family] })
  const snapshotB = synthesis({ runId: 'run-b', datasetId: 'dataset-b', families: [family] })
  const result = compareResearchEvidence(snapshotA, snapshotB)
  assert.equal(result.comparisons[0].nonIndependentEvidence, true)
  assert.deepEqual(result.comparisons[0].sharedEvidenceFamilies.map((item) => item.id), ['signal-quality-catalogue'])
  assert.ok(result.compatibilityNotes.some((note) => note.type === 'shared-evidence-families'))
})

test('missing provenance is surfaced as unknown and run code revision remains unknown', () => {
  const result = compareResearchEvidence(
    synthesis({ entries: [evidence({ provenance: {} })] }),
    synthesis({ runId: 'run-b', datasetId: 'dataset-b', entries: [evidence({ provenance: {} })] }),
  )
  assert.equal(result.comparisons[0].compatibility.compatible, 'unknown')
  assert.ok(result.comparisons[0].compatibility.unknowns.some((item) => item.field === 'provenance'))
  assert.equal(result.runA.requestedAt, null)
  assert.equal(result.runA.codeRevision.status, 'unknown')
  assert.ok(result.compatibilityNotes.some((note) => note.type === 'requested-at-unknown'))
})

test('Strategy Comparison evidence is retained but never treated as symbol-scoped', () => {
  const strategyComparisonEvidence = evidence({
    id: 'strategy-comparison::SPY::control',
    sourceRecordId: 'strategy-comparison',
    experimentId: 'strategy-comparison',
    strategyId: 'setup-scan-baseline',
    metricsKey: 'SPY::control',
  })
  const result = compareResearchEvidence(
    synthesis({ entries: [strategyComparisonEvidence] }),
    synthesis({ runId: 'run-b', datasetId: 'dataset-b', entries: [strategyComparisonEvidence] }),
  )
  assert.equal(result.comparisons.length, 0)
  assert.equal(result.unmatched.length, 2)
  assert.ok(result.unmatched.every((entry) => entry.reason === 'symbol-scope-unavailable'))
  assert.ok(result.unmatched.every((entry) => entry.compatibility.compatible === 'unknown'))
  assert.ok(result.unmatched[0].evidence.evidence.metricsKey.includes('SPY::control'))
})

test('same synthesis evidence IDs are independently qualified by their run IDs', () => {
  const result = compareResearchEvidence(synthesis(), synthesis({ runId: 'run-b', datasetId: 'dataset-b' }))
  const pair = result.comparisons[0]
  assert.equal(pair.evidenceA.evidenceId, pair.evidenceB.evidenceId)
  assert.notEqual(pair.evidenceA.id, pair.evidenceB.id)
  assert.match(pair.id, /^run-a::.*run-b::/)
})

test('pairing and unmatched ordering are deterministic regardless of input evidence order', () => {
  const entries = [
    evidence({ id: 'signal-quality::90-94', metricsKey: '90-94' }),
    evidence({ id: 'signal-quality::75-79', metricsKey: '75-79' }),
  ]
  const first = compareResearchEvidence(synthesis({ entries }), synthesis({ runId: 'run-b', datasetId: 'dataset-b', entries }))
  const reversed = compareResearchEvidence(synthesis({ entries: [...entries].reverse() }), synthesis({ runId: 'run-b', datasetId: 'dataset-b', entries: [...entries].reverse() }))
  assert.deepEqual(first.comparisons.map((pair) => pair.id), reversed.comparisons.map((pair) => pair.id))
})

test('comparison never mutates either synthesis snapshot', () => {
  const snapshotA = synthesis({ families: [familyAnnotation()] })
  const snapshotB = synthesis({ runId: 'run-b', datasetId: 'dataset-b', families: [familyAnnotation()] })
  const beforeA = structuredClone(snapshotA)
  const beforeB = structuredClone(snapshotB)
  compareResearchEvidence(snapshotA, snapshotB)
  assert.deepEqual(snapshotA, beforeA)
  assert.deepEqual(snapshotB, beforeB)
})

test('comparison rejects malformed snapshots clearly', () => {
  assert.throws(() => compareResearchEvidence({}, synthesis()), /strategyGroups array/)
})

test('comparison output contains no ranking, winner, score, recommendation, confidence, or trading action', () => {
  const result = compareResearchEvidence(synthesis(), synthesis({ runId: 'run-b', datasetId: 'dataset-b' }))
  const forbidden = new Set(['winner', 'ranking', 'rank', 'score', 'recommendation', 'confidence', 'probability', 'verdict', 'buy', 'sell'])
  const inspect = (value) => {
    if (Array.isArray(value)) return value.forEach(inspect)
    if (!value || typeof value !== 'object') return
    Object.entries(value).forEach(([key, nested]) => {
      assert.equal(forbidden.has(key), false, `unexpected field ${key}`)
      inspect(nested)
    })
  }
  inspect(result)
})