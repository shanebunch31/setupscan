// Research Synthesis Layer — Phase 3C.
// Consumes normalized research records (src/research/registry.js + adapters.js) and produces a
// structured evidence report. This module never recomputes research, never mutates nativePayload,
// and never ranks, scores, or recommends a strategy — it only organizes and cross-references
// evidence that already exists in the normalized records.
import { normalizeMetrics } from './researchRecord.js'

/**
 * Evidence families document that several experiments reuse the same underlying trade
 * construction/data and therefore do not count as independent confirmations of the same claim.
 * Kept local to synthesis (not registry.js) until a second consumer needs it.
 */
export const EVIDENCE_FAMILIES = {
  'signal-quality-catalogue': {
    id: 'signal-quality-catalogue',
    experimentIds: ['signal-quality', 'frozen-score-holdout', 'yearly-regime', 'causal-regime', 'walk-forward-regime'],
    note: 'These experiments reuse the same underlying trade construction/catalogue (signalQualityBacktest.js).',
  },
  'walk-forward-windows': {
    id: 'walk-forward-windows',
    experimentIds: ['walk-forward-regime', 'volatility-aware-variants'],
    note: 'volatility-aware-variants consumes walk-forward-regime\'s exact windows/boundaries.',
  },
}

const familiesByExperimentId = new Map()
Object.values(EVIDENCE_FAMILIES).forEach((family) => {
  family.experimentIds.forEach((experimentId) => {
    if (!familiesByExperimentId.has(experimentId)) familiesByExperimentId.set(experimentId, [])
    familiesByExperimentId.get(experimentId).push(family.id)
  })
})

// --- Partition inference: evaluation partitions are NOT strategy variants. ---

function inferPartition(metricsKey) {
  if (/^development/i.test(metricsKey)) return { type: 'development', label: metricsKey }
  if (/^holdout/i.test(metricsKey)) return { type: 'holdout', label: metricsKey }
  if (/^year-/.test(metricsKey)) return { type: 'year', label: metricsKey }
  if (/^trend-/.test(metricsKey)) return { type: 'trend-regime', label: metricsKey }
  if (/^volatility-/.test(metricsKey)) return { type: 'volatility-regime', label: metricsKey }
  if (/^breadth-/.test(metricsKey)) return { type: 'breadth-regime', label: metricsKey }
  if (/^Window\s+\d+$/.test(metricsKey)) return { type: 'walk-forward-window', label: metricsKey }
  return null
}

function inferOutOfSampleRole(metricsKey, outOfSample) {
  if (!outOfSample) return 'not-partitioned'
  if (outOfSample.type === 'holdout') {
    if (/^development/i.test(metricsKey)) return 'development'
    if (/^holdout/i.test(metricsKey)) return 'holdout'
    return 'not-partitioned'
  }
  if (outOfSample.type === 'walk-forward') {
    if (/^Window\s+\d+$/.test(metricsKey)) return 'walk-forward-test'
    return 'not-partitioned'
  }
  // 'partition' type (in/out-of-sample) is record-level, not tied to a single metrics key — see the
  // synthetic '__outOfSample.*' entries appended in flattenRecord().
  return 'not-partitioned'
}

function evidenceId(sourceRecordId, metricsKey) {
  return `${sourceRecordId}::${metricsKey}`
}

function makeEvidence(record, metricsKey, strategyId, ruleSetVariant, metrics, partition, outOfSampleRole, strategyAssociation = 'explicit') {
  return {
    id: evidenceId(record.id, metricsKey),
    sourceRecordId: record.id,
    experimentId: record.id,
    strategyId: strategyId ?? null,
    ruleSetVariant: ruleSetVariant ?? null,
    // 'explicit': strategyId came directly from the adapter's own metrics-key output.
    // 'inferred-uniform': not directly labeled, but every other evidence entry from this same
    //   record shares exactly one strategyId, so it is deterministically the only strategy this
    //   record's split could belong to — not a guess, and not based on entry order.
    // 'unknown': the record contains more than one strategyId and nothing in the normalized
    //   record ties the split to a specific one — represented as unknown rather than invented.
    strategyAssociation,
    partition,
    metricsKey,
    metrics,
    sampleCounts: record.input?.sampleCounts ?? {},
    outOfSampleRole,
    costModelStatus: record.costModel?.status ?? null,
    actualDateRange: { start: record.input?.actualStart ?? null, end: record.input?.actualEnd ?? null },
    provenance: record.provenance ?? {},
    // Captured directly from the source record at flatten time (rather than looked up later by
    // record.id) because record.id is the *experiment* id, not a unique per-run instance id — two
    // records for the same experiment (e.g. robustness run for SPY and again for QQQ) would
    // otherwise collide in an id-keyed lookup.
    symbols: record.input?.symbols ?? [],
    timeframe: record.input?.timeframe ?? null,
    provider: record.input?.provider ?? null,
    requestedDateRange: { start: record.input?.requestedStart ?? null, end: record.input?.requestedEnd ?? null },
  }
}

/**
 * Flattens one normalized record's `metrics` dictionary into one evidence entry per key. Never
 * mutates the record and never touches `nativePayload`.
 */
function flattenRecord(record) {
  const entries = []
  const metrics = record?.metrics ?? {}
  Object.entries(metrics).forEach(([metricsKey, value]) => {
    if (!value || typeof value !== 'object') return
    const { strategyId, ruleSetVariant, ...rest } = value
    entries.push(makeEvidence(
      record,
      metricsKey,
      strategyId,
      ruleSetVariant,
      rest,
      inferPartition(metricsKey),
      inferOutOfSampleRole(metricsKey, record.outOfSample),
    ))
  })

  // The in-sample/out-of-sample split for a 'partition'-type outOfSample lives once at the record
  // level, not per metrics key (adapters.js discards which metrics key it came from when building
  // the normalized outOfSample object, and adapters.js is frozen — not modified here). Rather than
  // assuming the split belongs to the first flattened entry (order-dependent, not verifiable),
  // determine the strategy identity deterministically from the record's own evidence: if every
  // other entry from this record shares exactly one strategyId, the split can only belong to that
  // strategy (order-independent, provably correct). If the record spans more than one strategyId
  // (e.g. strategy-comparison's control vs trendMomentum), the association is genuinely
  // unrecoverable from the normalized record and is represented as unknown rather than guessed.
  if (record?.outOfSample?.type === 'partition' && entries.length) {
    const distinctStrategyIds = new Set(entries.map((entry) => entry.strategyId))
    const distinctRuleSetVariants = new Set(entries.map((entry) => entry.ruleSetVariant))
    const uniform = distinctStrategyIds.size === 1
    const inferredStrategyId = uniform ? [...distinctStrategyIds][0] : null
    const inferredRuleSetVariant = uniform && distinctRuleSetVariants.size === 1 ? [...distinctRuleSetVariants][0] : null
    const strategyAssociation = uniform ? 'inferred-uniform' : 'unknown'
    if (record.outOfSample.inSampleMetrics) {
      entries.push(makeEvidence(
        record, '__outOfSample.inSample', inferredStrategyId, inferredRuleSetVariant,
        normalizeMetrics(record.outOfSample.inSampleMetrics), null, 'in-sample', strategyAssociation,
      ))
    }
    if (record.outOfSample.outOfSampleMetrics) {
      entries.push(makeEvidence(
        record, '__outOfSample.outOfSample', inferredStrategyId, inferredRuleSetVariant,
        normalizeMetrics(record.outOfSample.outOfSampleMetrics), null, 'out-of-sample', strategyAssociation,
      ))
    }
  }
  return entries
}

// --- Compatibility ---

function isKnown(value) {
  if (value === null || value === undefined) return false
  if (Array.isArray(value)) return value.length > 0
  return true
}

function valuesEqual(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) return JSON.stringify([...a].sort()) === JSON.stringify([...b].sort())
  return a === b
}

function compareKnownField(field, valueA, valueB, bucket, unknowns) {
  if (!isKnown(valueA) || !isKnown(valueB)) {
    unknowns.push({ field, reason: `${field} is missing on ${!isKnown(valueA) ? 'the first' : 'the second'} evidence entry` })
    return
  }
  if (!valuesEqual(valueA, valueB)) bucket.push({ field, valueA, valueB })
}

function numericMetric(metrics, key) {
  const value = metrics?.[key]
  return Number.isFinite(value) ? value : null
}

/**
 * Structured compatibility result for a pair of evidence entries. Reads symbol/timeframe/
 * provider/requested-date metadata directly off each evidence entry (captured at flatten time)
 * rather than looking the source record up by id, since record.id is an experiment id and is not
 * guaranteed unique across multiple records of the same experiment in one synthesis call.
 */
export function compareEvidence(evidenceA, evidenceB) {
  const hardConflicts = []
  const softMismatches = []
  const unknowns = []

  if (evidenceA.strategyId !== evidenceB.strategyId) {
    hardConflicts.push({ field: 'strategyId', valueA: evidenceA.strategyId, valueB: evidenceB.strategyId })
  }
  compareKnownField('symbols', evidenceA.symbols, evidenceB.symbols, hardConflicts, unknowns)
  compareKnownField('timeframe', evidenceA.timeframe, evidenceB.timeframe, hardConflicts, unknowns)
  compareKnownField('provider', evidenceA.provider, evidenceB.provider, hardConflicts, unknowns)

  // Out-of-sample role differences (e.g. development vs holdout, in-sample vs out-of-sample) are
  // deliberately NOT a hard conflict here — comparing them side by side to see whether they agree
  // or disagree is exactly what conflict detection (below) needs to do. They remain visible on
  // each evidence entry's own outOfSampleRole field so a reader never mistakes them as equivalent.

  compareKnownField('ruleSetVariant', evidenceA.ruleSetVariant, evidenceB.ruleSetVariant, softMismatches, unknowns)
  compareKnownField('actualDateRange.start', evidenceA.actualDateRange?.start, evidenceB.actualDateRange?.start, softMismatches, unknowns)
  compareKnownField('actualDateRange.end', evidenceA.actualDateRange?.end, evidenceB.actualDateRange?.end, softMismatches, unknowns)
  compareKnownField('requestedStart', evidenceA.requestedDateRange?.start, evidenceB.requestedDateRange?.start, softMismatches, unknowns)
  compareKnownField('requestedEnd', evidenceA.requestedDateRange?.end, evidenceB.requestedDateRange?.end, softMismatches, unknowns)
  compareKnownField('costModelStatus', evidenceA.costModelStatus, evidenceB.costModelStatus, softMismatches, unknowns)

  const familiesA = familiesByExperimentId.get(evidenceA.experimentId) ?? []
  const familiesB = familiesByExperimentId.get(evidenceB.experimentId) ?? []
  const sharedFamily = familiesA.find((familyId) => familiesB.includes(familyId))
  if (sharedFamily && evidenceA.experimentId !== evidenceB.experimentId) {
    softMismatches.push({ field: 'evidenceFamily', valueA: sharedFamily, valueB: sharedFamily })
  }

  const sampleA = numericMetric(evidenceA.metrics, 'tradeCount') ?? numericMetric(evidenceA.metrics, 'occurrenceCount')
  const sampleB = numericMetric(evidenceB.metrics, 'tradeCount') ?? numericMetric(evidenceB.metrics, 'occurrenceCount')
  if (Number.isFinite(sampleA) && Number.isFinite(sampleB) && sampleA > 0 && sampleB > 0) {
    const ratio = Math.max(sampleA, sampleB) / Math.min(sampleA, sampleB)
    if (ratio >= 3) softMismatches.push({ field: 'sampleSize', valueA: sampleA, valueB: sampleB })
  } else {
    unknowns.push({ field: 'sampleSize', reason: 'tradeCount/occurrenceCount missing on one or both evidence entries' })
  }

  ;[evidenceA, evidenceB].forEach((entry) => {
    if (Object.keys(entry.provenance ?? {}).length === 0) {
      unknowns.push({ field: 'provenance', reason: `source record for ${entry.sourceRecordId} has no provenance metadata` })
    }
  })

  const compatible = hardConflicts.length ? false : (unknowns.length ? 'unknown' : true)
  const reasons = [
    ...hardConflicts.map((entry) => `hard conflict on ${entry.field}`),
    ...softMismatches.map((entry) => `soft mismatch on ${entry.field}`),
    ...unknowns.map((entry) => `unknown ${entry.field}`),
  ]

  return { compatible, hardConflicts, softMismatches, unknowns, reasons }
}

// --- Conflict detection (deliberately minimal: sign disagreement only, same strategy only). ---

function signOf(value) {
  if (value > 0) return 1
  if (value < 0) return -1
  return 0
}

function detectSignConflict(dimension, metricKey, evidenceA, evidenceB) {
  const valueA = numericMetric(evidenceA.metrics, metricKey)
  const valueB = numericMetric(evidenceB.metrics, metricKey)
  if (valueA === null || valueB === null) return null
  const signA = signOf(valueA)
  const signB = signOf(valueB)
  if (signA === 0 || signB === 0 || signA === signB) return null
  return {
    id: `${evidenceA.strategyId}::${dimension}::${evidenceA.id}::${evidenceB.id}`,
    strategyId: evidenceA.strategyId,
    dimension,
    sides: [evidenceA, evidenceB].map((entry) => ({
      sourceRecordId: entry.sourceRecordId,
      metricsKey: entry.metricsKey,
      metrics: entry.metrics,
      outOfSampleRole: entry.outOfSampleRole,
      partition: entry.partition,
    })),
    observation: `${metricKey} disagrees in sign (${valueA} vs ${valueB}) for the same strategy.`,
  }
}

function detectConflicts(evidenceList) {
  const conflicts = []
  for (let i = 0; i < evidenceList.length; i += 1) {
    for (let j = i + 1; j < evidenceList.length; j += 1) {
      const a = evidenceList[i]
      const b = evidenceList[j]
      if (a.strategyId !== b.strategyId) continue
      if (a.sourceRecordId === b.sourceRecordId && a.metricsKey === b.metricsKey) continue
      const compatibility = compareEvidence(a, b)
      if (compatibility.compatible === false) continue // unsafe to compare — never manufacture a conflict
      const expectancyConflict = detectSignConflict('expectancy-sign-disagreement', 'expectancy', a, b)
      if (expectancyConflict) conflicts.push(expectancyConflict)
      const totalRConflict = detectSignConflict('totalR-sign-disagreement', 'totalR', a, b)
      if (totalRConflict) conflicts.push(totalRConflict)
    }
  }
  return conflicts
}

// --- Evidence families exposed per strategy group ---

function buildEvidenceFamiliesForGroup(evidenceList) {
  const families = []
  Object.values(EVIDENCE_FAMILIES).forEach((family) => {
    const present = new Map()
    evidenceList.forEach((entry) => {
      if (family.experimentIds.includes(entry.experimentId)) {
        if (!present.has(entry.experimentId)) present.set(entry.experimentId, new Set())
        present.get(entry.experimentId).add(entry.sourceRecordId)
      }
    })
    if (present.size >= 2) {
      families.push({
        id: family.id,
        experimentIds: [...present.keys()],
        sourceRecordIds: [...new Set([...present.values()].flatMap((set) => [...set]))],
        note: family.note,
      })
    }
  })
  return families
}

// --- Cost sensitivity ---

function buildCostSensitivity(strategyId, evidenceList) {
  const statuses = new Set(evidenceList.map((entry) => entry.costModelStatus).filter((status) => status))
  if (statuses.size <= 1) return []
  return [{
    strategyId,
    note: `Evidence for this strategy mixes cost-model statuses (${[...statuses].join(', ')}) — comparisons across them are not cost-equivalent.`,
    affectedEvidenceIds: evidenceList.map((entry) => entry.id),
  }]
}

// --- Coverage ---

function buildCoverage(records, context) {
  const requested = context.requestedExperiments ?? records.map((record) => record.id)
  const unavailable = records.filter((record) => record.status === 'unavailable').map((record) => record.id)
  const incomplete = records.filter((record) => record.status === 'incomplete').map((record) => record.id)
  return { requested, unavailable, incomplete }
}

// --- Public entry point ---

/**
 * synthesizeResearch(records, context) — the sole public entry point. Organizes normalized
 * research records into evidence grouped by strategyId. Never ranks, scores, or recommends.
 */
export function synthesizeResearch(records = [], context = {}) {
  const generatedAt = new Date().toISOString()

  const evidenceByRecordId = new Map()
  records.forEach((record) => {
    if (record.status === 'unavailable') { evidenceByRecordId.set(record.id, []); return }
    evidenceByRecordId.set(record.id, flattenRecord(record))
  })

  const allEvidence = [...evidenceByRecordId.values()].flat()
  const evaluated = records
    .filter((record) => record.status !== 'unavailable' && (evidenceByRecordId.get(record.id)?.length ?? 0) > 0)
    .map((record) => record.id)

  const evidenceByStrategyId = new Map()
  allEvidence.forEach((entry) => {
    const key = entry.strategyId
    if (!evidenceByStrategyId.has(key)) evidenceByStrategyId.set(key, [])
    evidenceByStrategyId.get(key).push(entry)
  })

  const strategyGroups = [...evidenceByStrategyId.entries()].map(([strategyId, evidence]) => ({
    strategyId,
    evidence,
    evidenceFamilies: buildEvidenceFamiliesForGroup(evidence),
  }))

  const costSensitivity = strategyGroups.flatMap((group) => buildCostSensitivity(group.strategyId, group.evidence))
  const conflicts = strategyGroups.flatMap((group) => detectConflicts(group.evidence))

  const unresolvedQuestions = []
  if (!context.runId && !context.datasetId) {
    unresolvedQuestions.push('No runId/datasetId was supplied — it cannot be confirmed that these records originated from the same data pull.')
  }
  if (records.some((record) => !record.input?.provider)) {
    unresolvedQuestions.push('One or more records has no known data provider.')
  }
  if (costSensitivity.length) {
    unresolvedQuestions.push('Cost-model status differs within at least one strategy group — before/after-cost comparisons are not cost-equivalent there.')
  }
  if (strategyGroups.some((group) => group.evidenceFamilies.length)) {
    unresolvedQuestions.push('Some evidence within a strategy group shares underlying trade construction and is not independent confirmation.')
  }
  const incompleteIds = records.filter((record) => record.status === 'incomplete').map((record) => record.id)
  if (incompleteIds.length) {
    unresolvedQuestions.push(`Evidence from ${incompleteIds.join(', ')} is incomplete and should be read with caution.`)
  }

  return {
    schemaVersion: 1,
    generatedAt,
    coverage: { ...buildCoverage(records, context), evaluated },
    strategyGroups,
    costSensitivity,
    conflicts,
    unresolvedQuestions,
    compatibilityNotes: [],
    provenance: {
      runId: context.runId ?? null,
      datasetId: context.datasetId ?? null,
    },
  }
}
