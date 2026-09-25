// Adapters translate each research module's real, unmodified native output (see the runXResearch
// functions under src/backtest/) into the normalized research-record envelope defined in
// researchRecord.js. Every native payload is preserved verbatim as `nativePayload` — adapters only
// read from it to populate summary fields; they never recompute or alter a research conclusion.
import { createFinding, createResearchRecord, deriveResearchStatus, normalizeMetrics } from './researchRecord.js'

function firstObject(...values) {
  return values.find((value) => value && typeof value === 'object' && !Array.isArray(value)) ?? {}
}

function firstCandleMeta(candles) {
  if (!Array.isArray(candles) || !candles.length) return {}
  const first = candles[0]
  const last = candles[candles.length - 1]
  return {
    symbols: first.symbol ? [first.symbol] : undefined,
    timeframe: first.timeframe ?? undefined,
    candleCount: candles.length,
    actualStart: first.timestamp ?? undefined,
    actualEnd: last.timestamp ?? undefined,
  }
}

function alignedMeta(aligned) {
  if (!aligned?.raw) return {}
  const symbols = Object.keys(aligned.raw)
  const firstSymbolCandles = symbols.length ? aligned.raw[symbols[0]] : []
  const timeframe = firstSymbolCandles?.[0]?.timeframe
  const timestamps = aligned.timestamps ?? []
  return {
    symbols: symbols.length ? symbols : undefined,
    timeframe,
    candleCount: timestamps.length || undefined,
    actualStart: timestamps[0] ?? undefined,
    actualEnd: timestamps.at(-1) ?? undefined,
  }
}

/**
 * Best-effort, non-inventive metadata derivation from a native payload's own shape (candle
 * `symbol`/`timeframe` fields already carried through the Alpaca pipeline, `aligned` series, or
 * Strategy Discovery's `universe`/`datasetInfo`). Only ever surfaces values the native module
 * already computed — never guesses values the payload does not contain.
 */
function deriveMetadataFromPayload(payload) {
  if (payload?.aligned?.raw) return alignedMeta(payload.aligned)
  if (Array.isArray(payload?.thresholdResults) && payload.thresholdResults[0]?.candles) {
    return firstCandleMeta(payload.thresholdResults[0].candles)
  }
  if (payload?.control?.candles) return firstCandleMeta(payload.control.candles)
  if (Array.isArray(payload?.universe)) {
    const datasetInfo = Array.isArray(payload.datasetInfo) ? payload.datasetInfo : []
    const candleCount = datasetInfo.length ? datasetInfo.reduce((sum, entry) => sum + (entry.candleCount ?? 0), 0) : undefined
    return {
      symbols: payload.universe,
      timeframe: payload.timeframe ?? undefined,
      candleCount: candleCount || undefined,
      provider: datasetInfo[0]?.provider ?? undefined,
    }
  }
  return {}
}

function derivedProvenance(payload) {
  if (payload?.generatedAt || payload?.gitCommit) {
    return { generatedAt: payload.generatedAt ?? null, gitCommit: payload.gitCommit ?? null }
  }
  return {}
}

function derivedCostModel(payload) {
  if (payload?.options?.executionCostR !== undefined) return { executionCostR: payload.options.executionCostR }
  if (Array.isArray(payload?.costTiers)) return { costTiers: payload.costTiers }
  return null
}

function normalizeInput(context = {}, derived = {}) {
  return {
    symbols: context.symbols ?? context.input?.symbols ?? derived.symbols ?? [],
    timeframe: context.timeframe ?? context.input?.timeframe ?? derived.timeframe ?? null,
    provider: context.provider ?? context.input?.provider ?? derived.provider ?? null,
    requestedStart: context.requestedStart ?? context.input?.requestedStart ?? null,
    requestedEnd: context.requestedEnd ?? context.input?.requestedEnd ?? null,
    actualStart: context.actualStart ?? context.input?.actualStart ?? derived.actualStart ?? null,
    actualEnd: context.actualEnd ?? context.input?.actualEnd ?? derived.actualEnd ?? null,
    candleCount: context.candleCount ?? context.input?.candleCount ?? derived.candleCount ?? null,
    sampleCounts: context.sampleCounts ?? context.input?.sampleCounts ?? {},
    available: context.available,
    complete: context.complete,
    status: context.status,
  }
}

/**
 * Recognizes the three out-of-sample shapes actually produced by the research modules:
 * in/out-of-sample partitions (strategy.js, strategyComparison.js), development/holdout ranges
 * (frozenScoreHoldoutBacktest.js), and walk-forward windows (walkForwardRegimeBacktest.js,
 * volatilityAwareVariantsBacktest.js — whose windows carry `trainRealizedStart`/`testRealizedStart`
 * instead of `trainStart`/`testStart`). Falls back across the known field-name variants without
 * inventing values a payload does not contain.
 */
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
        trainStart: window.trainStart ?? window.trainRealizedStart ?? null,
        trainEnd: window.trainEnd ?? window.trainRealizedEnd ?? null,
        testStart: window.testStart ?? window.testRealizedStart ?? null,
        testEnd: window.testEnd ?? window.testRealizedEnd ?? null,
        testClassification: window.testClassification ?? window.testYear ?? null,
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
  const derived = deriveMetadataFromPayload(payload)
  const input = normalizeInput(context, derived)
  const findings = (context.findings ?? []).map((finding) => createFinding(finding))
  return createResearchRecord({
    id: definition.id,
    title: definition.title,
    category: definition.category,
    status: deriveResearchStatus(payload, input),
    methodology: definition.methodology,
    input,
    parameters: context.parameters ?? payload?.options ?? {},
    costModel: context.costModel ?? derivedCostModel(payload),
    outOfSample: context.outOfSample ?? extractOutOfSample(payload),
    metrics,
    findings,
    provenance: context.provenance ?? derivedProvenance(payload),
    nativePayload: payload,
  })
}

export function adaptStandardResearchOutput(definition, payload, context = {}) {
  return createAdaptedRecord(definition, payload, context)
}

/**
 * Robustness has no single runner function — the lab combines runThresholdResearch's array of
 * per-threshold results with runMarketConditionResearch's array of per-period results. Callers
 * pass both, unmodified, as `{ thresholdResults, periodResults }`.
 */
export function adaptRobustnessOutput(definition, payload, context = {}) {
  const thresholdResults = Array.isArray(payload?.thresholdResults) ? payload.thresholdResults : []
  const metrics = Object.fromEntries(thresholdResults.map((result) => [`${result.minimumScore}+`, normalizeMetrics(result.metrics)]))
  const baseline = thresholdResults[0] ?? null
  const outOfSample = baseline
    ? { type: 'partition', inSampleMetrics: baseline.inSampleMetrics, outOfSampleMetrics: baseline.outOfSampleMetrics }
    : null
  const available = context.available ?? (thresholdResults.length > 0)
  return createAdaptedRecord(definition, payload, { ...context, available, outOfSample: context.outOfSample ?? outOfSample }, metrics)
}

/** Relative Value's native output has no single "overall" — it reports four independent variants (A–D), each before/after costs. */
export function adaptRelativeValueOutput(definition, payload, context = {}) {
  const summaries = payload?.summaries ?? {}
  const metrics = Object.fromEntries(Object.entries(summaries).map(([key, summary]) => [
    key,
    {
      beforeCosts: normalizeMetrics(summary.overallBeforeCosts),
      afterCosts: normalizeMetrics(summary.overallAfterCosts),
    },
  ]))
  return createAdaptedRecord(definition, payload, context, metrics)
}

/** Signal Quality's native output is organized by score bucket rather than a single overall summary. */
export function adaptSignalQualityOutput(definition, payload, context = {}) {
  const scoreBuckets = Array.isArray(payload?.scoreBuckets) ? payload.scoreBuckets : []
  const metrics = Object.fromEntries(scoreBuckets.map((bucket) => [bucket.label, normalizeMetrics(bucket.overall)]))
  return createAdaptedRecord(definition, payload, context, metrics)
}

/** Frozen Score Holdout reports baseline/RV-confirmed metrics separately for the development and holdout splits. */
export function adaptFrozenScoreHoldoutOutput(definition, payload, context = {}) {
  const metrics = {
    developmentBaseline: normalizeMetrics(payload?.developmentBaseline?.overall),
    developmentRvConfirmed: normalizeMetrics(payload?.developmentRvConfirmed?.overall),
    holdoutBaseline: normalizeMetrics(payload?.holdoutBaseline?.overall),
    holdoutRvConfirmed: normalizeMetrics(payload?.holdoutRvConfirmed?.overall),
  }
  const sampleCounts = {
    developmentCandleCount: payload?.developmentRange?.candleCount ?? null,
    holdoutCandleCount: payload?.holdoutRange?.candleCount ?? null,
  }
  return createAdaptedRecord(definition, payload, { ...context, sampleCounts: context.sampleCounts ?? sampleCounts }, metrics)
}

/** Yearly Regime reports a combined baseline/RV-confirmed summary plus one summary per calendar year. */
export function adaptYearlyRegimeOutput(definition, payload, context = {}) {
  const years = Array.isArray(payload?.years) ? payload.years : []
  const metrics = {
    combinedBaseline: normalizeMetrics(payload?.combinedBaseline?.overall),
    combinedRvConfirmed: normalizeMetrics(payload?.combinedRvConfirmed?.overall),
    ...Object.fromEntries(years.map((year) => [`year-${year.year}`, normalizeMetrics(year.baseline?.overall)])),
  }
  return createAdaptedRecord(definition, payload, context, metrics)
}

/** Causal Regime reports a combined baseline/RV-confirmed summary plus per-regime (trend/volatility/breadth) baselines. */
export function adaptCausalRegimeOutput(definition, payload, context = {}) {
  const trendGroups = Array.isArray(payload?.trendGroups) ? payload.trendGroups : []
  const volatilityGroups = Array.isArray(payload?.volatilityGroups) ? payload.volatilityGroups : []
  const breadthGroups = Array.isArray(payload?.breadthGroups) ? payload.breadthGroups : []
  const metrics = {
    combinedBaseline: normalizeMetrics(payload?.combinedBaseline?.overall),
    combinedRvConfirmed: normalizeMetrics(payload?.combinedRvConfirmed?.overall),
    ...Object.fromEntries(trendGroups.map((group) => [`trend-${group.label}`, normalizeMetrics(group.baseline?.overall)])),
    ...Object.fromEntries(volatilityGroups.map((group) => [`volatility-${group.label}`, normalizeMetrics(group.baseline?.overall)])),
    ...Object.fromEntries(breadthGroups.map((group) => [`breadth-${group.label}`, normalizeMetrics(group.baseline?.overall)])),
  }
  return createAdaptedRecord(definition, payload, context, metrics)
}

/** Walk-Forward Regime reports a combined baseline/RV-confirmed summary plus one summary per walk-forward window. */
export function adaptWalkForwardRegimeOutput(definition, payload, context = {}) {
  const windows = Array.isArray(payload?.windows) ? payload.windows : []
  const metrics = {
    combinedBaseline: normalizeMetrics(payload?.combinedBaseline?.overall),
    combinedRvConfirmed: normalizeMetrics(payload?.combinedRvConfirmed?.overall),
    ...Object.fromEntries(windows.map((window) => [window.label, normalizeMetrics(window.baseline?.overall)])),
  }
  return createAdaptedRecord(definition, payload, context, metrics)
}

/** Volatility-Aware Variants reports one pooled summary per predefined variant (control, skipHighVol, highVol90, highVol95). */
export function adaptVolatilityAwareVariantsOutput(definition, payload, context = {}) {
  const pooled = Array.isArray(payload?.pooled) ? payload.pooled : []
  const metrics = Object.fromEntries(pooled.map((variant) => [variant.key, normalizeMetrics(variant.summary?.overall)]))
  return createAdaptedRecord(definition, payload, context, metrics)
}

export function adaptStrategyComparisonOutput(definition, payload, context = {}) {
  const metrics = {
    control: normalizeMetrics(firstObject(payload?.control?.metrics, payload?.control?.overall)),
    trendMomentum: normalizeMetrics(firstObject(payload?.trendMomentum?.metrics, payload?.trendMomentum?.overall)),
  }
  // Control/trend-momentum each carry their own in/out-of-sample split; the shared partition
  // extractor only looks at the top level, so surface the control split explicitly here.
  const outOfSample = context.outOfSample ?? (payload?.control
    ? { type: 'partition', inSampleMetrics: payload.control.inSampleMetrics ?? null, outOfSampleMetrics: payload.control.outOfSampleMetrics ?? null }
    : null)
  return createAdaptedRecord(definition, payload, { ...context, outOfSample }, metrics)
}

export function adaptStrategyDiscoveryOutput(definition, payload, context = {}) {
  const experiments = Array.isArray(payload?.experiments) ? payload.experiments : []
  const metrics = Object.fromEntries(experiments.map((experiment) => [
    experiment.experimentId,
    normalizeMetrics(firstObject(experiment.summary?.overall, experiment.summary)),
  ]))
  return createAdaptedRecord(definition, payload, context, metrics)
}
