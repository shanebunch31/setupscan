export const RESEARCH_STATUSES = Object.freeze([
  'loading',
  'untested',
  'completed',
  'unavailable',
  'incomplete',
  'error',
])

export const FINDING_STATES = Object.freeze([
  'observed',
  'mixed',
  'contradictory',
  'insufficient-sample',
  'untested',
])

// 'not-modeled' must never be read as zero cost — it means the native research doesn't touch
// costs at all. 'not-applicable' is reserved for results with no trade-level cost concept.
export const COST_MODEL_STATUSES = Object.freeze(['modeled', 'not-modeled', 'not-applicable'])

function assertAllowed(value, allowed, label) {
  if (!allowed.includes(value)) {
    throw new Error(`Unknown ${label}: ${value}`)
  }
}

export function createFinding({
  id,
  experimentId,
  state,
  title,
  message,
  evidenceRefs = [],
  scope = null,
  sampleSize = null,
  outOfSampleScope = null,
  caveats = [],
}) {
  if (!id || !experimentId || !title) {
    throw new Error('A finding requires id, experimentId, and title')
  }
  assertAllowed(state, FINDING_STATES, 'finding state')

  return {
    id,
    experimentId,
    state,
    title,
    message: message ?? null,
    evidenceRefs: [...evidenceRefs],
    scope,
    sampleSize,
    outOfSampleScope,
    caveats: [...caveats],
  }
}

export function createResearchRecord({
  id,
  title,
  category,
  status = 'untested',
  methodology = null,
  input = {},
  parameters = {},
  costModel = null,
  outOfSample = null,
  metrics = {},
  findings = [],
  provenance = {},
  nativePayload = null,
}) {
  if (!id || !title || !category) {
    throw new Error('A research record requires id, title, and category')
  }
  assertAllowed(status, RESEARCH_STATUSES, 'research status')
  if (costModel?.status !== undefined) assertAllowed(costModel.status, COST_MODEL_STATUSES, 'cost model status')

  return {
    id,
    title,
    category,
    status,
    methodology,
    input: { ...input },
    parameters: { ...parameters },
    costModel,
    outOfSample,
    metrics: { ...metrics },
    findings: findings.map((finding) => ({ ...finding })),
    provenance: { ...provenance },
    nativePayload,
  }
}

export function deriveResearchStatus(nativePayload, input = {}) {
  if (input.status && RESEARCH_STATUSES.includes(input.status)) return input.status
  if (nativePayload == null) return 'untested'
  if (nativePayload.available === false || input.available === false) return 'unavailable'
  if (nativePayload.incomplete === true || input.complete === false) return 'incomplete'
  return 'completed'
}

const metricAliases = {
  tradeCount: ['tradeCount', 'totalTrades', 'numberOfTrades'],
  occurrenceCount: ['occurrenceCount'],
  winRate: ['winRate'],
  profitFactor: ['profitFactor'],
  expectancy: ['expectancy'],
  averageR: ['averageR'],
  // `totalPositiveR` (strategy.js) is gross profit, not net return — never alias it as totalR.
  // `netReturn` (strategy.js) is the actual net total R, so it maps onto normalized totalR instead.
  totalR: ['totalR', 'netReturn'],
  maximumDrawdown: ['maximumDrawdown'],
}

export function normalizeMetrics(source = {}) {
  const metrics = {}
  Object.entries(metricAliases).forEach(([name, aliases]) => {
    const key = aliases.find((alias) => Number.isFinite(source[alias]))
    if (key) metrics[name] = source[key]
  })
  return metrics
}
