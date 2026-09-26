import { compareEvidence } from './synthesis.js'

function partitionIdentity(partition) {
  return partition ? { type: partition.type ?? null, label: partition.label ?? null } : null
}

function structuralIdentity(evidence) {
  return JSON.stringify([
    evidence.experimentId ?? null,
    evidence.metricsKey ?? null,
    partitionIdentity(evidence.partition),
    evidence.outOfSampleRole ?? null,
  ])
}

function completeIdentity(evidence) {
  return JSON.stringify([
    evidence.strategyId ?? null,
    evidence.experimentId ?? null,
    evidence.metricsKey ?? null,
    evidence.ruleSetVariant ?? null,
    partitionIdentity(evidence.partition),
    evidence.outOfSampleRole ?? null,
    evidence.strategyAssociation ?? null,
  ])
}

function sortKey(evidence) {
  return JSON.stringify([
    evidence.strategyId ?? null,
    evidence.experimentId ?? null,
    evidence.metricsKey ?? null,
    evidence.ruleSetVariant ?? null,
    partitionIdentity(evidence.partition),
    evidence.outOfSampleRole ?? null,
    evidence.strategyAssociation ?? null,
    evidence.id ?? null,
  ])
}

function groupBy(items, keyFn) {
  const groups = new Map()
  items.forEach((item) => {
    const key = keyFn(item.evidence)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(item)
  })
  return groups
}

function collectEvidence(synthesis, side) {
  if (!Array.isArray(synthesis?.strategyGroups)) {
    throw new TypeError(`synthesis${side} must contain a strategyGroups array`)
  }
  const runId = synthesis.provenance?.runId ?? null
  const datasetId = synthesis.provenance?.datasetId ?? null
  const entries = []

  synthesis.strategyGroups.forEach((group) => {
    const families = Array.isArray(group.evidenceFamilies) ? group.evidenceFamilies : []
    ;(group.evidence ?? []).forEach((evidence) => {
      const evidenceFamilies = families
        .filter((family) => family.experimentIds?.includes(evidence.experimentId))
        .map((family) => ({ id: family.id, note: family.note ?? null }))
      entries.push({ evidence, runId, datasetId, side, evidenceFamilies })
    })
  })

  entries.sort((left, right) => {
    const leftKey = sortKey(left.evidence)
    const rightKey = sortKey(right.evidence)
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0
  })
  return entries
}

function requestedAtFromEvidence(entries) {
  const values = [...new Set(entries
    .map((entry) => entry.evidence.provenance?.requestedAt)
    .filter((value) => typeof value === 'string' && value))]
  return values.length === 1 ? values[0] : null
}

function runSummary(synthesis, entries) {
  return {
    runId: synthesis.provenance?.runId ?? null,
    datasetId: synthesis.provenance?.datasetId ?? null,
    requestedAt: requestedAtFromEvidence(entries),
    requestedExperiments: synthesis.coverage?.requested ?? [],
    codeRevision: { status: 'unknown', value: null, reason: 'No run-level code revision is stored.' },
  }
}

function qualifyReference(entry) {
  const evidenceId = entry.evidence.id ?? null
  const qualifiedId = `${entry.runId ?? 'unknown-run'}::${evidenceId ?? 'unknown-evidence'}`
  const evidence = structuredClone(entry.evidence)
  evidence.id = qualifiedId
  return {
    runId: entry.runId,
    datasetId: entry.datasetId,
    evidenceId,
    id: qualifiedId,
    evidence,
    evidenceFamilies: entry.evidenceFamilies.map((family) => ({ ...family })),
  }
}

function sharedFamilies(familiesA, familiesB) {
  const idsB = new Set(familiesB.map((family) => family.id))
  return familiesA.filter((family) => idsB.has(family.id)).map((family) => ({ ...family }))
}

function unknownCompatibility(field, reason) {
  const unknown = { field, reason }
  return {
    compatible: 'unknown',
    hardConflicts: [],
    softMismatches: [],
    unknowns: [unknown],
    reasons: [`unknown ${field}`],
  }
}

function makeUnmatched(entry, side, reason, field = 'counterpart') {
  return {
    runId: entry.runId,
    side,
    counterpartStatus: reason === 'missing' ? 'unavailable' : 'unknown',
    reason,
    evidence: qualifyReference(entry),
    compatibility: unknownCompatibility(
      field,
      reason === 'missing'
        ? 'No matching evidence exists in the other run; absence is not negative evidence.'
        : 'The available evidence does not establish a unique comparable counterpart.',
    ),
  }
}

function makeComparison(entryA, entryB) {
  const sharedEvidenceFamilies = sharedFamilies(entryA.evidenceFamilies, entryB.evidenceFamilies)
  return {
    id: `${entryA.runId ?? 'unknown-run'}::${entryA.evidence.id}::${entryB.runId ?? 'unknown-run'}::${entryB.evidence.id}`,
    matchType: 'exact',
    evidenceA: qualifyReference(entryA),
    evidenceB: qualifyReference(entryB),
    sharedEvidenceFamilies,
    nonIndependentEvidence: sharedEvidenceFamilies.length > 0,
    compatibility: compareEvidence(entryA.evidence, entryB.evidence),
  }
}

function pairUniqueGroups(left, right, identityFn, comparisons, pairedLeft, pairedRight) {
  const groupsLeft = groupBy(left, identityFn)
  const groupsRight = groupBy(right, identityFn)
  const keys = [...new Set([...groupsLeft.keys(), ...groupsRight.keys()])].sort()
  keys.forEach((key) => {
    const leftGroup = groupsLeft.get(key) ?? []
    const rightGroup = groupsRight.get(key) ?? []
    if (leftGroup.length === 1 && rightGroup.length === 1) {
      pairedLeft.add(leftGroup[0])
      pairedRight.add(rightGroup[0])
      comparisons.push(makeComparison(leftGroup[0], rightGroup[0], 'exact'))
    }
  })
}

/** Compares persisted synthesis snapshots without rerunning research or regenerating synthesis. */
export function compareResearchEvidence(synthesisA, synthesisB) {
  const entriesA = collectEvidence(synthesisA, 'A')
  const entriesB = collectEvidence(synthesisB, 'B')
  const runA = runSummary(synthesisA, entriesA)
  const runB = runSummary(synthesisB, entriesB)
  const comparisons = []
  const unmatched = []
  const compatibilityNotes = []

  if (runA.datasetId && runB.datasetId && runA.datasetId !== runB.datasetId) {
    compatibilityNotes.push({
      type: 'dataset-identity-differs',
      datasetIdA: runA.datasetId,
      datasetIdB: runB.datasetId,
      note: 'Dataset identity differs; this is provenance context, not an automatic compatibility conflict.',
    })
  } else if (!runA.datasetId || !runB.datasetId) {
    compatibilityNotes.push({
      type: 'dataset-identity-unknown',
      datasetIdA: runA.datasetId,
      datasetIdB: runB.datasetId,
      note: 'A dataset identity is unavailable for at least one run.',
    })
  }
  compatibilityNotes.push({
    type: 'run-code-revision-unknown',
    runIdA: runA.runId,
    runIdB: runB.runId,
    note: 'No run-level code revision is stored; per-experiment revision metadata cannot establish whole-run reproducibility.',
  })
  if (!runA.requestedAt || !runB.requestedAt) {
    compatibilityNotes.push({
      type: 'requested-at-unknown',
      runIdA: runA.runId,
      runIdB: runB.runId,
      note: 'Requested-at metadata is unavailable in one or both synthesis snapshots.',
    })
  }

  const scopedA = entriesA.filter((entry) => entry.evidence.experimentId !== 'strategy-comparison')
  const scopedB = entriesB.filter((entry) => entry.evidence.experimentId !== 'strategy-comparison')
  entriesA.filter((entry) => entry.evidence.experimentId === 'strategy-comparison')
    .forEach((entry) => unmatched.push(makeUnmatched(entry, 'A', 'symbol-scope-unavailable', 'symbolScope')))
  entriesB.filter((entry) => entry.evidence.experimentId === 'strategy-comparison')
    .forEach((entry) => unmatched.push(makeUnmatched(entry, 'B', 'symbol-scope-unavailable', 'symbolScope')))

  const groupsA = groupBy(scopedA, structuralIdentity)
  const groupsB = groupBy(scopedB, structuralIdentity)
  const structuralKeys = [...new Set([...groupsA.keys(), ...groupsB.keys()])].sort()
  structuralKeys.forEach((key) => {
    const left = groupsA.get(key) ?? []
    const right = groupsB.get(key) ?? []
    const pairedLeft = new Set()
    const pairedRight = new Set()

    pairUniqueGroups(left, right, completeIdentity, comparisons, pairedLeft, pairedRight)

    const remainingLeft = left.filter((entry) => !pairedLeft.has(entry))
    const remainingRight = right.filter((entry) => !pairedRight.has(entry))
    const hasStructuralGroupA = groupsA.has(key)
    const hasStructuralGroupB = groupsB.has(key)
    const unmatchedReasonA = !hasStructuralGroupB
      ? 'missing'
      : (remainingLeft.length === 1 && remainingRight.length === 1 ? 'identity-mismatch' : 'ambiguous-counterpart')
    const unmatchedReasonB = !hasStructuralGroupA
      ? 'missing'
      : (remainingLeft.length === 1 && remainingRight.length === 1 ? 'identity-mismatch' : 'ambiguous-counterpart')

    remainingLeft.forEach((entry) => {
      unmatched.push(makeUnmatched(entry, 'A', unmatchedReasonA, unmatchedReasonA === 'identity-mismatch' ? 'identity' : 'counterpart'))
    })
    remainingRight.forEach((entry) => {
      unmatched.push(makeUnmatched(entry, 'B', unmatchedReasonB, unmatchedReasonB === 'identity-mismatch' ? 'identity' : 'counterpart'))
    })
  })

  const familyIdsA = new Set(entriesA.flatMap((entry) => entry.evidenceFamilies.map((family) => family.id)))
  const sharedFamilyIds = [...new Set(entriesB.flatMap((entry) => entry.evidenceFamilies.map((family) => family.id)))]
    .filter((familyId) => familyIdsA.has(familyId))
    .sort()
  if (sharedFamilyIds.length) {
    compatibilityNotes.push({
      type: 'shared-evidence-families',
      familyIds: sharedFamilyIds,
      note: 'Evidence-family overlap is a non-independence annotation; it does not invalidate either run.',
    })
  }

  unmatched.sort((left, right) => {
    const keyA = `${left.side}::${sortKey(left.evidence.evidence)}`
    const keyB = `${right.side}::${sortKey(right.evidence.evidence)}`
    return keyA < keyB ? -1 : keyA > keyB ? 1 : 0
  })
  comparisons.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)

  return {
    schemaVersion: 1,
    runA,
    runB,
    comparisons,
    unmatched,
    compatibilityNotes,
    provenance: {
      runIdA: runA.runId,
      runIdB: runB.runId,
      datasetIdA: runA.datasetId,
      datasetIdB: runB.datasetId,
      datasetIdsEqual: runA.datasetId && runB.datasetId ? runA.datasetId === runB.datasetId : null,
    },
  }
}