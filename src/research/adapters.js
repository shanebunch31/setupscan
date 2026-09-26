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
  if (payload?.bySymbol && typeof payload.bySymbol === 'object' && !Array.isArray(payload.bySymbol)) {
    return { symbols: Object.keys(payload.bySymbol) }
  }
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

/**
 * `status` records whether the native research module models transaction/execution costs at all
 * — 'not-modeled' must never be read as zero cost. Any cost fields derivedCostModel() already
 * finds (executionCostR / costTiers) are preserved alongside it.
 */
function withCostStatus(status, payload) {
  return { status, ...(derivedCostModel(payload) ?? {}) }
}

/**
 * Stable, non-display strategy identifiers. Display labels (control, baseline, A/B/C/D, 75+,
 * bucket ranges) are presentation only and must never be relied on as identity.
 */
const STRATEGY_IDS = {
  baseline: 'setup-scan-baseline',
  rvConfirmationFilter: 'rv-confirmation-filter',
  rvMeanReversion: 'rv-mean-reversion',
  // Relative-value Variant D (baseline AND RV confirmation) is the exact same predicate reused as
  // "RV-confirmed" by frozen-score-holdout/yearly-regime/causal-regime/walk-forward-regime — all
  // five gate on `entry.components.rvConfirmation` sourced from the same computeRelativeStrengthConfirmation().
  rvCombined: 'rv-combined',
  trendMomentum: 'trend-momentum-v1',
  volAwareSkipHigh: 'vol-aware-skip-high',
  volAwareHigh90: 'vol-aware-high-90',
  volAwareHigh95: 'vol-aware-high-95',
}

function withStrategy(metrics, strategyId, ruleSetVariant) {
  return { ...metrics, strategyId, ...(ruleSetVariant ? { ruleSetVariant } : {}) }
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
    provenance: { ...derivedProvenance(payload), ...(context.provenance ?? {}) },
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
  const metrics = Object.fromEntries(thresholdResults.map((result) => [
    `${result.minimumScore}+`,
    withStrategy(normalizeMetrics(result.metrics), STRATEGY_IDS.baseline, `threshold-${result.minimumScore}`),
  ]))
  const baseline = thresholdResults[0] ?? null
  const outOfSample = baseline
    ? { type: 'partition', inSampleMetrics: baseline.inSampleMetrics, outOfSampleMetrics: baseline.outOfSampleMetrics }
    : null
  const available = context.available ?? (thresholdResults.length > 0)
  const costModel = context.costModel ?? withCostStatus('not-modeled', payload)
  return createAdaptedRecord(definition, payload, { ...context, available, costModel, outOfSample: context.outOfSample ?? outOfSample }, metrics)
}

// Variant A is the unmodified baseline; B/C/D are genuinely different rule constructions, not
// variants of one strategy — see STRATEGY_IDS.rvCombined's note on why D === the RV-confirmed
// predicate reused elsewhere.
const RELATIVE_VALUE_STRATEGY_IDS = {
  A: STRATEGY_IDS.baseline,
  B: STRATEGY_IDS.rvConfirmationFilter,
  C: STRATEGY_IDS.rvMeanReversion,
  D: STRATEGY_IDS.rvCombined,
}

/** Relative Value's native output has no single "overall" — it reports four independent variants (A–D), each before/after costs. */
export function adaptRelativeValueOutput(definition, payload, context = {}) {
  const summaries = payload?.summaries ?? {}
  const metrics = Object.fromEntries(Object.entries(summaries).map(([key, summary]) => [
    key,
    {
      strategyId: RELATIVE_VALUE_STRATEGY_IDS[key] ?? null,
      beforeCosts: normalizeMetrics(summary.overallBeforeCosts),
      afterCosts: normalizeMetrics(summary.overallAfterCosts),
    },
  ]))
  const costModel = context.costModel ?? withCostStatus('modeled', payload)
  return createAdaptedRecord(definition, payload, { ...context, costModel }, metrics)
}

/** Signal Quality's native output is organized by score bucket rather than a single overall summary. */
export function adaptSignalQualityOutput(definition, payload, context = {}) {
  const scoreBuckets = Array.isArray(payload?.scoreBuckets) ? payload.scoreBuckets : []
  const metrics = Object.fromEntries(scoreBuckets.map((bucket) => [
    bucket.label,
    withStrategy(normalizeMetrics(bucket.overall), STRATEGY_IDS.baseline),
  ]))
  // Score buckets are evaluation cohorts of the baseline strategy, not rule-set variants.
  // Components (aboveVwap, rvConfirmation, ...) are never assigned a strategyId.
  const costModel = context.costModel ?? withCostStatus('modeled', payload)
  return createAdaptedRecord(definition, payload, { ...context, costModel }, metrics)
}

/** Frozen Score Holdout reports baseline/RV-confirmed metrics separately for the development and holdout splits. */
export function adaptFrozenScoreHoldoutOutput(definition, payload, context = {}) {
  // development/holdout are evaluation partitions of the same two strategies, not rule variants —
  // that distinction is already preserved by the metrics key itself, so no ruleSetVariant here.
  const metrics = {
    developmentBaseline: withStrategy(normalizeMetrics(payload?.developmentBaseline?.overall), STRATEGY_IDS.baseline),
    developmentRvConfirmed: withStrategy(normalizeMetrics(payload?.developmentRvConfirmed?.overall), STRATEGY_IDS.rvCombined),
    holdoutBaseline: withStrategy(normalizeMetrics(payload?.holdoutBaseline?.overall), STRATEGY_IDS.baseline),
    holdoutRvConfirmed: withStrategy(normalizeMetrics(payload?.holdoutRvConfirmed?.overall), STRATEGY_IDS.rvCombined),
  }
  const sampleCounts = {
    developmentCandleCount: payload?.developmentRange?.candleCount ?? null,
    holdoutCandleCount: payload?.holdoutRange?.candleCount ?? null,
  }
  const costModel = context.costModel ?? withCostStatus('modeled', payload)
  return createAdaptedRecord(definition, payload, { ...context, sampleCounts: context.sampleCounts ?? sampleCounts, costModel }, metrics)
}

/** Yearly Regime reports a combined baseline/RV-confirmed summary plus one summary per calendar year. */
export function adaptYearlyRegimeOutput(definition, payload, context = {}) {
  const years = Array.isArray(payload?.years) ? payload.years : []
  // Calendar year is an evaluation partition of the baseline strategy, not a rule variant — the
  // `year-YYYY` metrics key already preserves that partition, so no ruleSetVariant here.
  const metrics = {
    combinedBaseline: withStrategy(normalizeMetrics(payload?.combinedBaseline?.overall), STRATEGY_IDS.baseline),
    combinedRvConfirmed: withStrategy(normalizeMetrics(payload?.combinedRvConfirmed?.overall), STRATEGY_IDS.rvCombined),
    ...Object.fromEntries(years.map((year) => [
      `year-${year.year}`,
      withStrategy(normalizeMetrics(year.baseline?.overall), STRATEGY_IDS.baseline),
    ])),
  }
  const costModel = context.costModel ?? withCostStatus('modeled', payload)
  return createAdaptedRecord(definition, payload, { ...context, costModel }, metrics)
}

/** Causal Regime reports a combined baseline/RV-confirmed summary plus per-regime (trend/volatility/breadth) baselines. */
export function adaptCausalRegimeOutput(definition, payload, context = {}) {
  const trendGroups = Array.isArray(payload?.trendGroups) ? payload.trendGroups : []
  const volatilityGroups = Array.isArray(payload?.volatilityGroups) ? payload.volatilityGroups : []
  const breadthGroups = Array.isArray(payload?.breadthGroups) ? payload.breadthGroups : []
  // Trend/volatility/breadth regimes are evaluation partitions of the baseline strategy, not rule
  // variants — the `trend-`/`volatility-`/`breadth-` metrics key already preserves the partition.
  const metrics = {
    combinedBaseline: withStrategy(normalizeMetrics(payload?.combinedBaseline?.overall), STRATEGY_IDS.baseline),
    combinedRvConfirmed: withStrategy(normalizeMetrics(payload?.combinedRvConfirmed?.overall), STRATEGY_IDS.rvCombined),
    ...Object.fromEntries(trendGroups.map((group) => [
      `trend-${group.label}`,
      withStrategy(normalizeMetrics(group.baseline?.overall), STRATEGY_IDS.baseline),
    ])),
    ...Object.fromEntries(volatilityGroups.map((group) => [
      `volatility-${group.label}`,
      withStrategy(normalizeMetrics(group.baseline?.overall), STRATEGY_IDS.baseline),
    ])),
    ...Object.fromEntries(breadthGroups.map((group) => [
      `breadth-${group.label}`,
      withStrategy(normalizeMetrics(group.baseline?.overall), STRATEGY_IDS.baseline),
    ])),
  }
  const costModel = context.costModel ?? withCostStatus('modeled', payload)
  return createAdaptedRecord(definition, payload, { ...context, costModel }, metrics)
}

/** Walk-Forward Regime reports a combined baseline/RV-confirmed summary plus one summary per walk-forward window. */
export function adaptWalkForwardRegimeOutput(definition, payload, context = {}) {
  const windows = Array.isArray(payload?.windows) ? payload.windows : []
  // Each walk-forward window is an evaluation partition of the baseline strategy over a specific
  // training/test period, not a rule variant — the window's own metrics key (its display label)
  // already preserves that partition, so no ruleSetVariant here.
  const metrics = {
    combinedBaseline: withStrategy(normalizeMetrics(payload?.combinedBaseline?.overall), STRATEGY_IDS.baseline),
    combinedRvConfirmed: withStrategy(normalizeMetrics(payload?.combinedRvConfirmed?.overall), STRATEGY_IDS.rvCombined),
    ...Object.fromEntries(windows.map((window) => [
      window.label,
      withStrategy(normalizeMetrics(window.baseline?.overall), STRATEGY_IDS.baseline),
    ])),
  }
  const costModel = context.costModel ?? withCostStatus('modeled', payload)
  return createAdaptedRecord(definition, payload, { ...context, costModel }, metrics)
}

// 'control' is the exact same rule as the frozen baseline (proven equal to walk-forward-regime's
// baseline trades by test) — it is not a fifth independent strategy.
const VOLATILITY_AWARE_STRATEGY_IDS = {
  control: STRATEGY_IDS.baseline,
  skipHighVol: STRATEGY_IDS.volAwareSkipHigh,
  highVol90: STRATEGY_IDS.volAwareHigh90,
  highVol95: STRATEGY_IDS.volAwareHigh95,
}

/** Volatility-Aware Variants reports one pooled summary per predefined variant (control, skipHighVol, highVol90, highVol95). */
export function adaptVolatilityAwareVariantsOutput(definition, payload, context = {}) {
  const pooled = Array.isArray(payload?.pooled) ? payload.pooled : []
  const metrics = Object.fromEntries(pooled.map((variant) => [
    variant.key,
    withStrategy(normalizeMetrics(variant.summary?.overall), VOLATILITY_AWARE_STRATEGY_IDS[variant.key] ?? null),
  ]))
  const costModel = context.costModel ?? withCostStatus('modeled', payload)
  return createAdaptedRecord(definition, payload, { ...context, costModel }, metrics)
}

export function adaptStrategyComparisonOutput(definition, payload, context = {}) {
  const bySymbol = payload?.bySymbol && typeof payload.bySymbol === 'object' && !Array.isArray(payload.bySymbol)
    ? payload.bySymbol
    : null
  const metrics = bySymbol
    ? Object.fromEntries(Object.entries(bySymbol).flatMap(([symbol, branches]) => [
      [`${symbol}::control`, withStrategy(
        normalizeMetrics(firstObject(branches?.control?.metrics, branches?.control?.overall)),
        STRATEGY_IDS.baseline,
      )],
      [`${symbol}::trendMomentum`, withStrategy(
        normalizeMetrics(firstObject(branches?.trendMomentum?.metrics, branches?.trendMomentum?.overall)),
        STRATEGY_IDS.trendMomentum,
      )],
    ]))
    : {
      // trend-momentum-v1 here is strategyComparison.js's own construction — distinct from
      // strategy-discovery's independently-implemented momentum-breakout-v1.
      control: withStrategy(normalizeMetrics(firstObject(payload?.control?.metrics, payload?.control?.overall)), STRATEGY_IDS.baseline),
      trendMomentum: withStrategy(normalizeMetrics(firstObject(payload?.trendMomentum?.metrics, payload?.trendMomentum?.overall)), STRATEGY_IDS.trendMomentum),
    }
  // The composite form has per-symbol/per-strategy partitions, so no single record-level split is truthful.
  const outOfSample = context.outOfSample ?? (!bySymbol && payload?.control
    ? { type: 'partition', inSampleMetrics: payload.control.inSampleMetrics ?? null, outOfSampleMetrics: payload.control.outOfSampleMetrics ?? null }
    : null)
  const costModel = context.costModel ?? withCostStatus('not-modeled', payload)
  return createAdaptedRecord(definition, payload, { ...context, outOfSample, costModel }, metrics)
}

export function adaptStrategyDiscoveryOutput(definition, payload, context = {}) {
  const experiments = Array.isArray(payload?.experiments) ? payload.experiments : []
  const metrics = Object.fromEntries(experiments.map((experiment) => [
    experiment.experimentId,
    // Strategy Discovery already versions its own native identity (e.g. momentum-breakout-v1) —
    // reuse it as-is rather than inventing a new one.
    withStrategy(normalizeMetrics(firstObject(experiment.summary?.overall, experiment.summary)), experiment.experimentId),
  ]))
  const costModel = context.costModel ?? withCostStatus('modeled', payload)
  return createAdaptedRecord(definition, payload, { ...context, costModel }, metrics)
}
