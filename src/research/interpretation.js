export const INTERPRETATION_SCHEMA_VERSION = 1
const DISCOVERY = 'strategy-discovery'
const DISCOVERY_VERSION = 'strategy-discovery-2'
const DISCOVERY_MIN_EXPLORATORY = 100
const array = (value) => (Array.isArray(value) ? value : [])
const text = (value) => (typeof value === 'string' && value.trim() ? value : null)
const finite = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null)
const count = (value) => (Number.isInteger(value) && value >= 0 ? value : null)
const known = (value) => text(value) && value !== 'legacy-unknown'
const order = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
const unique = (values) => [...new Set(values.filter((value) => text(value)))].sort(order)
const label = (value) =>
  text(value)
    ?.replaceAll('-', ' ')
    .replaceAll('_', ' ')
    .replace(/^./, (letter) => letter.toUpperCase()) ?? 'Unnamed evidence'
const r = (value) => `${value > 0 ? '+' : ''}${value.toFixed(2)}R`
const sampleLabels = new Map([
  ['insufficient', 'insufficient'],
  ['insufficient-evidence', 'insufficient'],
  ['insufficient evidence', 'insufficient'],
  ['exploratory', 'exploratory'],
  ['small-exploratory-sample', 'exploratory'],
  ['exploratory-small-sample', 'exploratory'],
  ['descriptive', 'descriptive'],
  ['descriptive-only', 'descriptive'],
  ['stronger-descriptive-evidence', 'descriptive'],
])

function sampleAssessment(evidence) {
  const metrics = evidence.metrics ?? {}
  // These are the compact fields retained by the existing adapters. Do not walk
  // native payloads or infer sample strength from unrelated sample-count totals.
  const rawLabel =
    text(metrics.evidenceStrength) ??
    text(metrics.ablation?.evidenceStrength) ??
    text(metrics.scoreStability?.evidenceStrength) ??
    text(metrics.qualificationStack?.evidenceStrength)
  const size = count(metrics.occurrenceCount) ?? count(metrics.tradeCount)
  const saved = sampleLabels.get(rawLabel) ?? null
  const protocol = evidence.experimentId === DISCOVERY && evidence.methodologyVersion === DISCOVERY_VERSION
  return {
    classification:
      size === 0
        ? 'insufficient'
        : protocol && size !== null && size < DISCOVERY_MIN_EXPLORATORY
          ? 'insufficient'
          : (saved ?? (protocol && size !== null ? 'exploratory' : 'unknown')),
    size,
    rawLabel,
    basis:
      protocol && size !== null && (!saved || size < DISCOVERY_MIN_EXPLORATORY)
        ? 'strategy-discovery-protocol-section-7'
        : saved
          ? 'saved-experiment-classification'
          : 'not-recorded',
  }
}

function reference(evidence, provenance) {
  return {
    evidenceId: text(evidence.id),
    experimentId: text(evidence.experimentId) ?? text(evidence.sourceRecordId),
    strategyId: text(evidence.strategyId),
    metricsKey: text(evidence.metricsKey),
    methodologyVersion: text(evidence.methodologyVersion),
    runId: text(evidence.provenance?.runId) ?? provenance.runId,
    datasetId: text(evidence.provenance?.datasetId) ?? provenance.datasetId,
    codeRevision: text(evidence.provenance?.codeRevision) ?? provenance.codeRevision,
  }
}

function discoveryScope(evidence, ref, provenance) {
  if (
    evidence.experimentId !== DISCOVERY ||
    evidence.methodologyVersion !== DISCOVERY_VERSION ||
    !ref.strategyId ||
    evidence.metricsKey !== ref.strategyId ||
    evidence.partition != null ||
    evidence.outOfSampleRole !== 'not-partitioned'
  )
    return null
  const symbols = unique(array(evidence.symbols))
  const required = [
    ref.runId,
    ref.datasetId,
    evidence.membershipRule,
    evidence.timeframe,
    evidence.provider,
    evidence.emaContractVersion,
    evidence.adjustmentMode,
    evidence.costModelStatus,
    evidence.actualDateRange?.start,
    evidence.actualDateRange?.end,
    evidence.requestedDateRange?.start,
    evidence.requestedDateRange?.end,
  ]
  if (!symbols.length || required.some((value) => !known(value))) return null
  if (
    (provenance.runId && ref.runId !== provenance.runId) ||
    (provenance.datasetId && ref.datasetId !== provenance.datasetId) ||
    (provenance.codeRevision && ref.codeRevision !== provenance.codeRevision) ||
    (known(provenance.emaContractVersion) && evidence.emaContractVersion !== provenance.emaContractVersion) ||
    (known(provenance.adjustmentMode) && evidence.adjustmentMode !== provenance.adjustmentMode)
  )
    return null
  for (const range of [evidence.actualDateRange, evidence.requestedDateRange]) {
    if (
      !Number.isFinite(Date.parse(range.start)) ||
      !Number.isFinite(Date.parse(range.end)) ||
      Date.parse(range.start) > Date.parse(range.end)
    )
      return null
  }
  const costModel = costScope(evidence.costModel, evidence.costModelStatus)
  if (!costModel) return null
  return {
    runId: ref.runId,
    datasetId: ref.datasetId,
    methodologyVersion: evidence.methodologyVersion,
    symbols,
    timeframe: evidence.timeframe,
    provider: evidence.provider,
    emaContractVersion: evidence.emaContractVersion,
    adjustmentMode: evidence.adjustmentMode,
    membershipRule: evidence.membershipRule,
    codeRevision: ref.codeRevision,
    actualDateRange: { start: evidence.actualDateRange.start, end: evidence.actualDateRange.end },
    requestedDateRange: { start: evidence.requestedDateRange.start, end: evidence.requestedDateRange.end },
    // Canonicalize the cost description rather than relying on object-key order.
    costModelStatus: evidence.costModelStatus,
    costModel,
    outOfSampleRole: evidence.outOfSampleRole,
  }
}

function costScope(model, status) {
  if (
    !model ||
    model.status !== status ||
    Object.keys(model).some((key) => !['status', 'executionCostR', 'costTiers'].includes(key))
  )
    return null
  if (status === 'not-modeled') return { status }
  if (status !== 'modeled') return null
  if (finite(model.executionCostR) !== null && model.executionCostR >= 0)
    return { status, executionCostR: model.executionCostR }
  if (
    !array(model.costTiers).length ||
    model.costTiers.some(
      (tier) =>
        !known(tier?.label) ||
        finite(tier.entryBps) === null ||
        tier.entryBps < 0 ||
        finite(tier.exitBps) === null ||
        tier.exitBps < 0 ||
        Object.keys(tier).some((key) => !['label', 'entryBps', 'exitBps'].includes(key)),
    )
  )
    return null
  return {
    status,
    costTiers: model.costTiers.map((tier) => ({
      label: tier.label,
      entryBps: tier.entryBps,
      exitBps: tier.exitBps,
    })),
  }
}

function candidate(evidence, provenance) {
  const ref = reference(evidence, provenance),
    sample = sampleAssessment(evidence),
    metrics = evidence.metrics ?? {}
  const expectancy = finite(metrics.expectancy)
  const status =
    sample.classification === 'insufficient'
      ? 'insufficient-evidence'
      : sample.size === null || expectancy === null
        ? 'unavailable'
        : expectancy > 0
          ? 'positive'
          : expectancy < 0
            ? 'negative'
            : 'neutral'
  const winRate = finite(metrics.winRate),
    factor = finite(metrics.profitFactor),
    drawdown = finite(metrics.maximumDrawdown)
  return {
    reference: ref,
    label: label(ref.strategyId),
    status,
    sample,
    metrics: {
      expectancy,
      occurrenceCount: sample.size,
      profitFactor: factor !== null && factor >= 0 ? factor : null,
      winRate: winRate !== null && winRate >= 0 && winRate <= 1 ? winRate : null,
      maximumDrawdown: drawdown !== null && drawdown >= 0 ? drawdown : null,
    },
    scope: discoveryScope(evidence, ref, provenance),
    summary:
      expectancy === null || sample.size === null
        ? 'The saved summary does not contain a usable expectancy and sample count.'
        : sample.size === 0
          ? 'No resolved occurrences were recorded; zero-valued metrics do not establish a result.'
          : `Historical expectancy was ${r(expectancy)} across ${sample.size} resolved occurrences; sample classification: ${sample.classification}.`,
  }
}

function coverageFor(synthesis) {
  const saved = synthesis.coverage
  const fieldsKnown =
    saved && ['requested', 'evaluated', 'incomplete', 'unavailable'].every((key) => Array.isArray(saved[key]))
  const requested = unique(array(saved?.requested)),
    evaluated = unique(array(saved?.evaluated))
  const unavailable = unique(array(saved?.unavailable)),
    incomplete = unique(array(saved?.incomplete))
  const missing = requested.filter(
    (id) => !evaluated.includes(id) && !unavailable.includes(id) && !incomplete.includes(id),
  )
  const state = !fieldsKnown
    ? 'unknown'
    : requested.length === 0
      ? 'empty'
      : requested.every((id) => unavailable.includes(id))
        ? 'unavailable'
        : incomplete.length || unavailable.length || missing.length
          ? 'incomplete'
          : 'complete'
  return { state, requested, evaluated, incomplete, unavailable, missing }
}

function combinedDirection(candidates) {
  const states = new Set(candidates.map((item) => item.status))
  if (states.has('insufficient-evidence')) return 'insufficient-evidence'
  if (states.has('unavailable')) return states.size > 1 ? 'incomplete' : 'unavailable'
  if (states.has('positive') && states.has('negative')) return 'mixed'
  return states.has('positive') ? 'positive' : states.has('negative') ? 'negative' : 'neutral'
}

/**
 * Pure view-model over a compact saved run summary (or schema-v1 synthesis).
 * Does not run experiments, qualify/promote strategies, persist, fetch or read a
 * clock. Completion describes coverage; direction describes saved Discovery
 * expectancy only. Neither constitutes confidence or forward validation.
 */
export function interpretResearchSummary(input = {}) {
  const synthesis = input?.synthesis ?? input ?? {}
  const source = synthesis.provenance ?? {}
  const provenance = {
    runId: text(input?.runId) ?? text(source.runId),
    datasetId: text(input?.datasetId) ?? text(source.datasetId),
    codeRevision: text(input?.codeRevision) ?? text(source.codeRevision),
    emaContractVersion: text(input?.emaContractVersion) ?? text(source.emaContractVersion),
    adjustmentMode: text(input?.adjustmentMode) ?? text(source.adjustmentMode),
    sourceSchemaVersion: synthesis.schemaVersion ?? null,
  }
  const supported = synthesis.schemaVersion === 1 && Array.isArray(synthesis.strategyGroups)
  const coverage = coverageFor(synthesis)
  const evidence = supported
    ? array(synthesis.strategyGroups)
        .flatMap((group) => array(group?.evidence))
        .filter((item) => item && typeof item === 'object')
    : []
  evidence.sort((a, b) =>
    order(JSON.stringify(reference(a, provenance)), JSON.stringify(reference(b, provenance))),
  )
  const refs = evidence.map((item) => reference(item, provenance))
  const assessments = evidence.map((item, i) => ({ reference: refs[i], ...sampleAssessment(item) }))
  const candidates = evidence
    .filter((item) => item.experimentId === DISCOVERY)
    .map((item) => candidate(item, provenance))
  const supportingPoints = [],
    cautionPoints = []
  const point = (code, message, references = []) => ({ code, text: message, references })
  for (const item of candidates) {
    const details = []
    if (item.sample.size > 0) {
      if (item.metrics.profitFactor !== null)
        details.push(`recorded profit factor ${item.metrics.profitFactor.toFixed(2)}`)
      if (item.metrics.winRate !== null)
        details.push(`historical win rate ${(item.metrics.winRate * 100).toFixed(1)}%`)
      if (item.metrics.maximumDrawdown !== null)
        details.push(`recorded maximum drawdown ${item.metrics.maximumDrawdown.toFixed(2)}R`)
    }
    supportingPoints.push(
      point(
        'discovery-observation',
        `${item.label}: ${item.summary}${details.length ? ' ' + details.join('; ') + '.' : ''}`,
        [item.reference],
      ),
    )
  }
  for (const item of assessments.filter(
    (item) => item.reference.experimentId !== DISCOVERY && item.classification !== 'unknown',
  )) {
    supportingPoints.push(
      point(
        'saved-sample-classification',
        `${label(item.reference.experimentId)} recorded a ${item.classification} sample classification${item.size === null ? '' : ` across ${item.size} observations`}.`,
        [item.reference],
      ),
    )
  }
  const metadataConflicts = [
    'runId',
    'datasetId',
    'codeRevision',
    'emaContractVersion',
    'adjustmentMode',
  ].filter((key) => known(input?.[key]) && known(source[key]) && input[key] !== source[key])
  if (metadataConflicts.length)
    cautionPoints.push(
      point(
        'provenance-mismatch',
        `Saved header and synthesis disagree on ${metadataConflicts.join(', ')}; comparison is withheld.`,
        refs,
      ),
    )
  if (!supported)
    cautionPoints.push(
      point(
        'unsupported-summary',
        'A supported saved synthesis is unavailable; no performance interpretation was inferred.',
      ),
    )
  if (coverage.state === 'complete')
    supportingPoints.push(
      point(
        'coverage-complete',
        `All ${coverage.requested.length} requested experiments have recorded evaluations. Completion describes execution coverage only.`,
      ),
    )
  else
    cautionPoints.push(
      point(
        'coverage-' + coverage.state,
        `Research coverage is ${coverage.state}; ${coverage.incomplete.length} incomplete, ${coverage.unavailable.length} unavailable and ${coverage.missing.length} unaccounted requested experiments.`,
        unique([...coverage.incomplete, ...coverage.unavailable, ...coverage.missing]).map(
          (experimentId) => ({ experimentId }),
        ),
      ),
    )
  const conflicts = array(synthesis.conflicts)
  if (conflicts.length && !synthesis.contrastSummary)
    cautionPoints.push(
      point(
        'legacy-conflicts',
        'Legacy conflicts are retained as saved; their equivalent-scope comparability has not been reclassified.',
      ),
    )
  for (const [index, conflict] of conflicts.entries()) {
    const sides = array(conflict?.sides).flatMap((side) => {
      const experimentId = text(side?.experimentId) ?? text(side?.sourceRecordId)
      const matches = refs.filter(
        (ref) =>
          ref.experimentId === experimentId &&
          ref.metricsKey === side?.metricsKey &&
          (!conflict?.strategyId || ref.strategyId === conflict.strategyId),
      )
      return matches.length
        ? matches
        : [
            {
              experimentId,
              metricsKey: text(side?.metricsKey),
              strategyId: text(conflict?.strategyId),
              evidenceId: text(side?.evidenceId),
              runId: provenance.runId,
              datasetId: provenance.datasetId,
            },
          ]
    })
    const metric =
      conflict?.dimension === 'expectancy-sign-disagreement'
        ? 'historical expectancy'
        : conflict?.dimension === 'totalR-sign-disagreement'
          ? 'historical total R'
          : 'recorded evidence'
    cautionPoints.push({
      ...point(
        'conflict',
        `Saved ${metric} results conflict; inspect the linked evidence before drawing a common conclusion.`,
        sides,
      ),
      sourceId: text(conflict?.id) ?? `conflict-${index}`,
      observation: text(conflict?.observation) ?? text(conflict?.message),
    })
  }
  const experimentIds = unique([...coverage.requested, ...refs.map((ref) => ref.experimentId)])
  const savedFamilies = new Map()
  for (const group of array(synthesis.strategyGroups))
    for (const family of array(group?.evidenceFamilies)) {
      if (!text(family?.id)) continue
      const prior = savedFamilies.get(family.id)
      savedFamilies.set(family.id, {
        id: family.id,
        kind: 'same-family-not-rankable',
        experimentIds: unique([
          ...(prior?.experimentIds ?? []),
          ...array(family.experimentIds).filter((id) => experimentIds.includes(id)),
        ]),
        note: text(family.note) ?? prior?.note ?? 'The saved synthesis records shared evidence construction.',
      })
    }
  const families = [...savedFamilies.values()]
    .filter((family) => family.experimentIds.length > 1)
    .sort((a, b) => order(a.id, b.id))
  for (const family of families)
    cautionPoints.push(
      point(
        'shared-evidence-family',
        family.note +
          ' Shared construction is not independent confirmation or permission to rank experiments.',
        family.experimentIds.map((experimentId) => ({ experimentId })),
      ),
    )
  for (const entry of array(synthesis.costSensitivity))
    cautionPoints.push(
      point(
        'cost-sensitivity',
        text(entry?.note) ?? 'Saved cost assumptions differ; these results are not cost-equivalent.',
        array(entry?.affectedEvidenceIds).map((evidenceId) => ({
          evidenceId,
          strategyId: text(entry?.strategyId),
        })),
      ),
    )
  for (const entry of array(synthesis.compatibilityNotes)) {
    const message = text(entry) ?? text(entry?.note) ?? text(entry?.message)
    if (message) cautionPoints.push(point('saved-compatibility-note', message))
  }
  const unresolvedQuestions = array(synthesis.unresolvedQuestions)
    .filter((value) => text(value))
    .map((value) => value)
  const groups = new Map()
  for (const item of candidates) {
    if (!item.scope) continue
    const key = JSON.stringify(item.scope)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(item)
  }
  const comparisons = [...groups.entries()]
    .sort(([a], [b]) => order(a, b))
    .map(([, items]) => {
      const distinct = new Set(items.map((item) => item.reference.strategyId)).size === items.length
      const rankable =
        items.length >= 2 &&
        distinct &&
        coverage.state === 'complete' &&
        !conflicts.length &&
        !metadataConflicts.length &&
        items.every(
          (item) =>
            ['positive', 'negative', 'neutral'].includes(item.status) &&
            ['exploratory', 'descriptive'].includes(item.sample.classification),
        )
      const maximum = rankable ? Math.max(...items.map((item) => item.metrics.expectancy)) : null
      const highestExpectancy = rankable
        ? {
            value: maximum,
            strategyIds: items
              .filter((item) => item.metrics.expectancy === maximum)
              .map((item) => item.reference.strategyId)
              .sort(order),
          }
        : null
      if (highestExpectancy) {
        const names = items
          .filter((item) => highestExpectancy.strategyIds.includes(item.reference.strategyId))
          .map((item) => item.label)
          .join(' and ')
        supportingPoints.push(
          point(
            'discovery-expectancy-comparison',
            `${names} recorded the highest historical expectancy (${r(maximum)}) within this directly comparable Discovery scope.`,
            items.map((item) => item.reference),
          ),
        )
      }
      return {
        kind: rankable ? 'directly-comparable' : 'not-rankable',
        scope: items[0].scope,
        references: items.map((item) => item.reference),
        highestExpectancy,
        reason: rankable
          ? 'Same saved data, period, methodology, membership and cost scope; expectancy only.'
          : 'Comparison needs multiple distinct strategies, complete coverage, known sample sufficiency and no saved conflicts.',
      }
    })
  if (candidates.length)
    cautionPoints.push(
      point(
        'discovery-limits',
        'Discovery summaries are exploratory historical evidence. Period stability and cost-tier resilience cannot be established from overall metrics alone.',
      ),
    )
  if (evidence.some((item) => item.costModelStatus === 'not-modeled'))
    cautionPoints.push(
      point(
        'costs-not-modeled',
        'Some saved evidence does not model costs. This must not be read as zero execution costs.',
      ),
    )
  if (candidates.some((item) => !item.scope))
    cautionPoints.push(
      point(
        'discovery-scope-unknown',
        'Some Discovery evidence lacks a verified overall comparison scope; no ordering is inferred for it.',
        candidates.filter((item) => !item.scope).map((item) => item.reference),
      ),
    )
  const classifications = unique(assessments.map((item) => item.classification))
  if (classifications.includes('unknown'))
    cautionPoints.push(
      point(
        'sample-rule-unavailable',
        'Some experiment-specific sample classifications were not saved. No universal sample threshold or confidence score was substituted.',
      ),
    )
  if (classifications.includes('insufficient'))
    cautionPoints.push(
      point(
        'insufficient-sample',
        'Some recorded samples are insufficient under their own saved rule or the Discovery protocol; their observations are retained without promoting them to stronger evidence.',
      ),
    )
  const unrelatedExperimentPairs = []
  for (let i = 0; i < experimentIds.length; i++)
    for (let j = i + 1; j < experimentIds.length; j++) {
      if (
        !families.some(
          (family) =>
            family.experimentIds.includes(experimentIds[i]) &&
            family.experimentIds.includes(experimentIds[j]),
        )
      ) {
        unrelatedExperimentPairs.push({
          kind: 'unrelated-not-comparable',
          experimentIds: [experimentIds[i], experimentIds[j]],
          reason: 'No shared comparison contract is recorded in this synthesis.',
        })
      }
    }
  const allDiscoveryOneScope =
    candidates.length > 0 &&
    candidates.length === evidence.length &&
    candidates.every((item) => item.scope) &&
    groups.size === 1
  const status =
    !supported || coverage.state === 'unavailable' || !evidence.length
      ? coverage.state === 'incomplete'
        ? 'incomplete'
        : 'unavailable'
      : coverage.state !== 'complete' || metadataConflicts.length
        ? 'incomplete'
        : conflicts.length
          ? 'mixed'
          : allDiscoveryOneScope
            ? combinedDirection(candidates)
            : assessments.length && assessments.every((item) => item.classification === 'insufficient')
              ? 'insufficient-evidence'
              : 'neutral'
  const headlines = {
    positive: 'Positive historical Discovery expectancy',
    negative: 'Negative historical Discovery expectancy',
    mixed: 'Mixed or conflicting historical evidence',
    neutral: 'Saved evidence requires a scoped interpretation',
    incomplete: 'The research picture is incomplete',
    unavailable: 'Research evidence is unavailable',
    'insufficient-evidence': 'The available sample evidence is insufficient',
  }
  return {
    schemaVersion: INTERPRETATION_SCHEMA_VERSION,
    status,
    headline: headlines[status],
    summary: `${headlines[status]}. ${coverage.evaluated.length} of ${coverage.requested.length} requested experiments have recorded evaluations; ${conflicts.length} saved conflicts and ${unresolvedQuestions.length} unresolved questions. Historical descriptions do not establish forward performance.`,
    coverage,
    evidenceStrength: {
      classification:
        classifications.length === 1 ? classifications[0] : classifications.length ? 'mixed' : 'unavailable',
      assessments,
      note: 'Experiment-specific sample descriptions, not statistical confidence. Overlapping samples are not added together.',
    },
    supportingPoints,
    cautionPoints,
    unresolvedQuestions,
    discoveryCandidates: candidates,
    comparisonScope: {
      crossExperimentRanking: false,
      comparisons,
      families,
      unrelatedExperimentPairs,
      unrankedReferences: refs.filter((ref) => ref.experimentId !== DISCOVERY),
      note: 'Only matched overall Discovery candidates can be compared by recorded expectancy; no combined strategy score or cross-family ordering.',
    },
    provenance: {
      ...provenance,
      experimentIds,
      strategyIds: unique(refs.map((ref) => ref.strategyId)),
      references: refs,
    },
  }
}
