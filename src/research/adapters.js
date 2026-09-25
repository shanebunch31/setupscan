import { createFinding, createResearchRecord, deriveResearchStatus, normalizeMetrics } from './researchRecord.js'

function firstObject(...values) {
  return values.find((value) => value && typeof value === 'object' && !Array.isArray(value)) ?? {}
}

function normalizeInput(context = {}) {
  return {
    symbols: context.symbols ?? context.input?.symbols ?? [],
    timeframe: context.timeframe ?? context.input?.timeframe ?? null,
    provider: context.provider ?? context.input?.provider ?? null,
    requestedStart: context.requestedStart ?? context.input?.requestedStart ?? null,
    requestedEnd: context.requestedEnd ?? context.input?.requestedEnd ?? null,
    actualStart: context.actualStart ?? context.input?.actualStart ?? null,
    actualEnd: context.actualEnd ?? context.input?.actualEnd ?? null,
    candleCount: context.candleCount ?? context.input?.candleCount ?? null,
    sampleCounts: context.sampleCounts ?? context.input?.sampleCounts ?? {},
    available: context.available,
    complete: context.complete,
    status: context.status,
  }
}

function extractOutOfSample(payload) {
  if (payload?.inSampleMetrics || payload?.outOfSampleMetrics) {
    return {
      type: 'partition',
      inSampleMetrics: payload.inSampleMetrics ?? null,
      outOfSampleMetrics: payload.outOfSampleMetrics ?? null,
    }
  }
  if (payload?.developmentRange || payload?.holdoutRange) {
    return {
      type: 'holdout',
      developmentRange: payload.developmentRange ?? null,
      holdoutRange: payload.holdoutRange ?? null,
    }
  }
  if (Array.isArray(payload?.windows)) {
    return {
      type: 'walk-forward',
      windows: payload.windows.map((window) => ({
        trainStart: window.trainStart ?? null,
        trainEnd: window.trainEnd ?? null,
        testStart: window.testStart ?? null,
        testEnd: window.testEnd ?? null,
        testClassification: window.testClassification ?? null,
      })),
    }
  }
  return null
}

function extractMetrics(payload) {
  const source = firstObject(
    payload?.metrics,
    payload?.overallAfterCosts,
    payload?.overall,
    payload?.summary?.overall,
  )
  return normalizeMetrics(source)
}

function createAdaptedRecord(definition, payload, context = {}, metrics = extractMetrics(payload)) {
  const input = normalizeInput(context)
  const findings = (context.findings ?? []).map((finding) => createFinding(finding))
  return createResearchRecord({
    id: definition.id,
    title: definition.title,
    category: definition.category,
    status: deriveResearchStatus(payload, input),
    methodology: definition.methodology,
    input,
    parameters: context.parameters ?? payload?.options ?? {},
    costModel: context.costModel ?? payload?.options?.costModel ?? null,
    outOfSample: context.outOfSample ?? extractOutOfSample(payload),
    metrics,
    findings,
    provenance: context.provenance ?? {},
    nativePayload: payload,
  })
}

export function adaptStandardResearchOutput(definition, payload, context = {}) {
  return createAdaptedRecord(definition, payload, context)
}

export function adaptStrategyComparisonOutput(definition, payload, context = {}) {
  const metrics = {
    control: normalizeMetrics(firstObject(payload?.control?.metrics, payload?.control?.overall)),
    trendMomentum: normalizeMetrics(firstObject(payload?.trendMomentum?.metrics, payload?.trendMomentum?.overall)),
  }
  return createAdaptedRecord(definition, payload, context, metrics)
}

export function adaptStrategyDiscoveryOutput(definition, payload, context = {}) {
  const experiments = Array.isArray(payload?.experiments) ? payload.experiments : []
  const metrics = Object.fromEntries(experiments.map((experiment) => [
    experiment.experimentId,
    normalizeMetrics(firstObject(experiment.summary?.overall, experiment.summary)),
  ]))
  return createAdaptedRecord(definition, payload, context, metrics)
}
