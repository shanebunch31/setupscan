import test from 'node:test'
import assert from 'node:assert/strict'
import { createDatasetId } from './orchestration.js'
import { resolveCurrentEffectiveExperimentConfiguration } from './effectiveExperimentConfiguration.js'
import { checkResearchReplayCompatibility } from './replayCompatibility.js'
import { reconstructResearchDataset } from '../data/marketData.js'
import { listResearchExperiments } from './registry.js'

const revision = 'abc123'
const emaVersion = 'setupscan-ema-sma-seeded-recursive-v1'
const baseSymbols = ['SPY', 'QQQ', 'IWM']
const allExperimentIds = listResearchExperiments().map(({ id }) => id)

function makeCandles(symbol) {
  return Array.from({ length: 32 }, (_, index) => {
    const close = 100 + index + (symbol === 'QQQ' ? 10 : symbol === 'IWM' ? 20 : 0)
    return {
      symbol,
      timeframe: '1Hour',
      timestamp: new Date(Date.UTC(2025, 0, 1) + index * 60 * 60 * 1000).toISOString(),
      open: close - 0.5,
      high: close + 1,
      low: close - 1,
      close,
      volume: 1000 + index,
    }
  })
}

function makeModernRun({ symbols = baseSymbols, experimentIds = allExperimentIds, unavailableSymbols = [], incompleteSymbols = [], emptySymbols = [] } = {}) {
  const requestedStart = makeCandles('SPY')[20].timestamp
  const requestedEnd = makeCandles('SPY').at(-1).timestamp
  const bySymbol = {}
  const fetchResults = []
  const calculationSeries = []
  const fetchIssues = []
  const successfulSymbols = []

  for (const symbol of symbols) {
    if (unavailableSymbols.includes(symbol)) {
      bySymbol[symbol] = null
      fetchIssues.push({ symbol, type: 'fetch-error', error: { message: 'fixture unavailable' } })
      continue
    }
    const calculationCandles = emptySymbols.includes(symbol) ? [] : makeCandles(symbol)
    const requestedCandles = calculationCandles.filter((candle) => candle.timestamp >= requestedStart && candle.timestamp <= requestedEnd)
    const complete = incompleteSymbols.includes(symbol) ? false : true
    const metadata = {
      provider: 'ALPACA HISTORICAL',
      adjustmentMode: 'split',
      timeframe: '1Hour',
      requestedStart,
      requestedEnd,
      actualStart: requestedCandles[0]?.timestamp ?? null,
      actualEnd: requestedCandles.at(-1)?.timestamp ?? null,
      calculationStart: calculationCandles[0]?.timestamp ?? null,
      calculationEnd: calculationCandles.at(-1)?.timestamp ?? null,
      requestedCandleCount: requestedCandles.length,
      calculationCandleCount: calculationCandles.length,
      complete,
    }
    bySymbol[symbol] = metadata
    if (incompleteSymbols.includes(symbol)) fetchIssues.push({ symbol, type: 'incomplete' })
    if (emptySymbols.includes(symbol)) fetchIssues.push({ symbol, type: 'empty' })
    if (requestedCandles.length) {
      successfulSymbols.push(symbol)
      calculationSeries.push({ symbol, timeframe: '1Hour', candles: calculationCandles })
      const result = {
        provider: metadata.provider,
        adjustmentMode: metadata.adjustmentMode,
        symbol,
        timeframe: metadata.timeframe,
        start: metadata.actualStart,
        end: metadata.actualEnd,
        requestedStart,
        requestedEnd,
        candleCount: requestedCandles.length,
        requestedCandleCount: requestedCandles.length,
        calculationStart: metadata.calculationStart,
        calculationEnd: metadata.calculationEnd,
        calculationCandleCount: calculationCandles.length,
        complete,
        candles: requestedCandles,
      }
      Object.defineProperty(result, 'calculationCandles', { value: calculationCandles })
      fetchResults.push(result)
    }
  }
  calculationSeries.sort((left, right) => left.symbol.localeCompare(right.symbol))
  const effectiveDateProvenance = { requestedStart, requestedEnd, symbols: bySymbol }
  const adjustmentMode = 'split'
  const datasetId = fetchResults.length ? createDatasetId(fetchResults, adjustmentMode) : null
  const provider = 'ALPACA HISTORICAL'
  const timeframe = '1Hour'
  const fetchStatus = successfulSymbols.length === 0
    ? 'unavailable'
    : successfulSymbols.length !== symbols.length || fetchIssues.length ? 'partial' : 'complete'
  const dataset = datasetId ? {
    datasetId,
    provider,
    adjustmentMode,
    timeframe,
    requestedStart,
    requestedEnd,
    effectiveMetadata: effectiveDateProvenance,
    fetchResultsBySymbol: Object.fromEntries(Object.entries(bySymbol).map(([symbol, metadata]) => [symbol, metadata])),
  } : null
  const canonicalDataset = datasetId ? {
    datasetId,
    provider,
    adjustmentMode,
    timeframe,
    effectiveMetadata: effectiveDateProvenance,
    calculationSeries,
  } : null
  const experimentResults = experimentIds.map((experimentId) => {
    const definition = listResearchExperiments().find((item) => item.id === experimentId)
    const unavailable = definition.requiredSymbols.some((symbol) => !successfulSymbols.includes(symbol) || incompleteSymbols.includes(symbol))
      || (experimentId === 'strategy-comparison' && !symbols.some((symbol) => successfulSymbols.includes(symbol) && !incompleteSymbols.includes(symbol)))
    return { experimentId, status: unavailable ? 'unavailable' : 'succeeded', nativeOutput: null, error: null }
  })
  const run = {
    runContext: {
      runId: 'run-fixture',
      requestedAt: '2025-01-02T00:00:00.000Z',
      symbols: [...symbols],
      timeframe,
      requestedStart,
      requestedEnd,
      requestedExperiments: [...experimentIds],
      emaContractVersion: emaVersion,
      adjustmentMode,
      codeRevision: revision,
    },
    status: fetchStatus === 'complete' && experimentResults.every(({ status }) => status === 'succeeded') ? 'completed' : successfulSymbols.length ? 'partial' : 'unavailable',
    fetchStatus,
    fetchIssues,
    dataset,
    effectiveDateProvenance,
    experimentResults,
    effectiveExperimentConfiguration: {},
    synthesis: { provenance: { datasetId } },
  }
  if (datasetId) {
    const reconstructed = reconstructResearchDataset(canonicalDataset)
    const expectedConfiguration = resolveCurrentEffectiveExperimentConfiguration({ run, dataset: reconstructed, codeRevision: revision })
    run.effectiveExperimentConfiguration = Object.fromEntries(experimentResults.map(({ experimentId, status }) => [experimentId, { status, configuration: expectedConfiguration.experiments[experimentId] }]))
  }
  return { run, canonicalDataset }
}

function check(run, canonicalDataset) {
  const reconstructed = canonicalDataset ? reconstructResearchDataset(canonicalDataset) : null
  return checkResearchReplayCompatibility({
    run,
    canonicalDataset,
    runtime: {
      codeRevision: revision,
      emaContractVersion: emaVersion,
      expectedConfiguration: reconstructed
        ? resolveCurrentEffectiveExperimentConfiguration({ run, dataset: reconstructed, codeRevision: revision })
        : null,
    },
  })
}

function hasBlocker(result, code) {
  return result.blockers.some((item) => item.code === code)
}

test('accepts a fully compatible modern run using its exact canonical dataset', () => {
  const { run, canonicalDataset } = makeModernRun()
  const result = check(run, canonicalDataset)
  assert.deepEqual(result, { compatible: true, blockers: [] }, JSON.stringify(result.blockers, null, 2))
})

test('blocks missing canonical dataset and missing datasetId', () => {
  const { run, canonicalDataset } = makeModernRun({ experimentIds: ['strategy-comparison'] })
  assert.ok(hasBlocker(check(run, null), 'canonical-dataset-missing'))
  run.dataset.datasetId = null
  run.synthesis.provenance.datasetId = null
  assert.ok(hasBlocker(check(run, canonicalDataset), 'dataset-id-missing'))
})

test('recomputes dataset identity and detects changed canonical candle content', () => {
  const { run, canonicalDataset } = makeModernRun({ experimentIds: ['strategy-comparison'] })
  const changed = structuredClone(canonicalDataset)
  changed.calculationSeries[0].candles[0].close += 0.01
  const result = check(run, changed)
  assert.equal(result.compatible, false)
  assert.ok(hasBlocker(result, 'dataset-content-mismatch'))
})

test('blocks provider and timeframe disagreement with the saved run', () => {
  const { run, canonicalDataset } = makeModernRun({ experimentIds: ['strategy-comparison'] })
  const otherProvider = { ...canonicalDataset, provider: 'OTHER PROVIDER' }
  assert.ok(hasBlocker(check(run, otherProvider), 'dataset-metadata-mismatch'))
  const otherTimeframe = {
    ...canonicalDataset,
    timeframe: '15Minute',
    calculationSeries: canonicalDataset.calculationSeries.map((entry) => ({ ...entry, timeframe: '15Minute' })),
  }
  assert.ok(hasBlocker(check(run, otherTimeframe), 'dataset-metadata-mismatch'))
})

test('blocks adjustment mismatch and legacy-unknown adjustment provenance', () => {
  const { run, canonicalDataset } = makeModernRun({ experimentIds: ['strategy-comparison'] })
  const otherAdjustment = { ...canonicalDataset, adjustmentMode: 'raw' }
  assert.ok(hasBlocker(check(run, otherAdjustment), 'adjustment-mode-mismatch'))
  run.runContext.adjustmentMode = 'legacy-unknown'
  run.dataset.adjustmentMode = 'legacy-unknown'
  const legacy = { ...canonicalDataset, adjustmentMode: 'legacy-unknown' }
  assert.ok(hasBlocker(check(run, legacy), 'adjustment-mode-mismatch'))
})

test('blocks EMA contract mismatch', () => {
  const { run, canonicalDataset } = makeModernRun({ experimentIds: ['strategy-comparison'] })
  const result = checkResearchReplayCompatibility({ run, canonicalDataset, runtime: { codeRevision: revision, emaContractVersion: 'different-ema', expectedConfiguration: {} } })
  assert.ok(hasBlocker(result, 'ema-contract-mismatch'))
})

test('requires a non-null matching saved and current code revision', () => {
  const { run, canonicalDataset } = makeModernRun({ experimentIds: ['strategy-comparison'] })
  run.runContext.codeRevision = null
  assert.ok(hasBlocker(check(run, canonicalDataset), 'code-revision-missing'))
  run.runContext.codeRevision = revision
  const missingRuntime = checkResearchReplayCompatibility({ run, canonicalDataset, runtime: { emaContractVersion: emaVersion, expectedConfiguration: {} } })
  assert.ok(hasBlocker(missingRuntime, 'runtime-revision-unavailable'))
  const mismatch = checkResearchReplayCompatibility({ run, canonicalDataset, runtime: { codeRevision: 'def456', emaContractVersion: emaVersion, expectedConfiguration: {} } })
  assert.ok(hasBlocker(mismatch, 'code-revision-mismatch'))
  assert.equal(check(run, canonicalDataset).compatible, true)
})

test('blocks symbol set and requested symbol order mismatches', () => {
  const { run, canonicalDataset } = makeModernRun({ experimentIds: ['strategy-comparison'] })
  run.runContext.symbols = ['SPY', 'QQQ']
  assert.ok(hasBlocker(check(run, canonicalDataset), 'effective-date-metadata-mismatch'))
  const original = makeModernRun({ experimentIds: ['strategy-comparison'] })
  const reconstructed = reconstructResearchDataset(original.canonicalDataset)
  const expected = resolveCurrentEffectiveExperimentConfiguration({ run: original.run, dataset: reconstructed, codeRevision: revision })
  expected.input.symbols.reverse()
  const result = checkResearchReplayCompatibility({ run: original.run, canonicalDataset: original.canonicalDataset, runtime: { codeRevision: revision, emaContractVersion: emaVersion, expectedConfiguration: expected } })
  assert.ok(hasBlocker(result, 'requested-input-mismatch'))
})

test('blocks requested date range mismatch', () => {
  const { run, canonicalDataset } = makeModernRun({ experimentIds: ['strategy-comparison'] })
  run.runContext.requestedEnd = '2025-02-01T00:00:00.000Z'
  assert.ok(hasBlocker(check(run, canonicalDataset), 'requested-input-mismatch'))
})

test('blocks experiment identifier and execution order mismatches', () => {
  const { run, canonicalDataset } = makeModernRun({ experimentIds: ['robustness', 'strategy-comparison'] })
  run.runContext.requestedExperiments = ['strategy-comparison', 'robustness']
  assert.ok(hasBlocker(check(run, canonicalDataset), 'requested-input-mismatch'))
  run.runContext.requestedExperiments = ['robustness', 'signal-quality']
  assert.ok(hasBlocker(check(run, canonicalDataset), 'requested-input-mismatch'))
})

test('requires present, structurally matching effective configuration', () => {
  const { run, canonicalDataset } = makeModernRun({ experimentIds: ['relative-value'] })
  assert.equal(check(run, canonicalDataset).compatible, true)
  run.effectiveExperimentConfiguration = null
  assert.ok(hasBlocker(check(run, canonicalDataset), 'experiment-configuration-missing'))
  const next = makeModernRun({ experimentIds: ['relative-value'] })
  next.run.effectiveExperimentConfiguration['relative-value'].configuration.options.lookback += 1
  assert.ok(hasBlocker(check(next.run, next.canonicalDataset), 'experiment-configuration-mismatch'))
})

test('current configuration resolver covers all registered experiments without executing them', () => {
  const { run, canonicalDataset } = makeModernRun()
  const resolved = resolveCurrentEffectiveExperimentConfiguration({ run, dataset: reconstructResearchDataset(canonicalDataset), codeRevision: revision })
  assert.deepEqual(Object.keys(resolved.experiments), allExperimentIds)
  assert.deepEqual(resolved.input.requestedExperiments, allExperimentIds)
  const configurations = resolved.experiments
  assert.deepEqual(configurations.robustness.thresholds, [75, 80, 85, 90, 95])
  assert.equal(configurations.robustness.thresholdRuns[0].settings.splitIndex, 8)
  assert.equal(configurations['relative-value'].options.lookback, 20)
  assert.equal(configurations['signal-quality'].options.negligibleThresholdR, 0.02)
  assert.equal(configurations['frozen-score-holdout'].options.holdoutStart, '2022-01-01T00:00:00Z')
  assert.equal(configurations['yearly-regime'].calendarYear.timezone, 'UTC')
  assert.equal(configurations['causal-regime'].regimeDefinitions.trend.slopeLookback, 10)
  assert.equal(configurations['walk-forward-regime'].windows.length, 4)
  assert.deepEqual(configurations['volatility-aware-variants'].variants.map(({ key }) => key), ['control', 'skipHighVol', 'highVol90', 'highVol95'])
  assert.deepEqual(configurations['strategy-discovery'].experiments.map(({ experimentId }) => experimentId), [
    'momentum-breakout-v1', 'mean-reversion-v1', 'prior-day-high-reclaim-v1', 'volatility-compression-expansion-v1',
  ])
  assert.deepEqual(Object.keys(resolved.experiments['strategy-comparison'].bySymbol), baseSymbols)
  assert.equal(configurations['strategy-comparison'].bySymbol.SPY.control.minimumScore, 75)
  assert.equal(configurations['strategy-comparison'].bySymbol.SPY.trendMomentum.splitIndex, 8)
  assert.equal(resolved.experiments['strategy-discovery'].gitCommit, revision)
  assert.equal('generatedAt' in resolved.experiments['strategy-discovery'], false)
})

test('incomplete, unavailable, and empty symbol semantics remain partial and cannot promote required experiments', () => {
  const partial = makeModernRun({ experimentIds: ['strategy-comparison'], incompleteSymbols: ['QQQ'] })
  const reconstructed = reconstructResearchDataset(partial.canonicalDataset)
  const expected = resolveCurrentEffectiveExperimentConfiguration({ run: partial.run, dataset: reconstructed, codeRevision: revision })
  partial.run.effectiveExperimentConfiguration = Object.fromEntries(partial.run.experimentResults.map(({ experimentId, status }) => [experimentId, { status, configuration: expected.experiments[experimentId] }]))
  const partialResult = check(partial.run, partial.canonicalDataset)
  assert.equal(partialResult.compatible, true)
  assert.equal(partial.run.fetchStatus, 'partial')
  assert.equal(partial.run.status, 'partial')
  assert.deepEqual(Object.keys(expected.experiments['strategy-comparison'].bySymbol), ['SPY', 'IWM'])

  const missing = makeModernRun({ experimentIds: ['signal-quality'], unavailableSymbols: ['QQQ'], emptySymbols: ['IWM'] })
  const missingDataset = reconstructResearchDataset(missing.canonicalDataset)
  const missingExpected = resolveCurrentEffectiveExperimentConfiguration({ run: missing.run, dataset: missingDataset, codeRevision: revision })
  missing.run.effectiveExperimentConfiguration = Object.fromEntries(missing.run.experimentResults.map(({ experimentId, status }) => [experimentId, { status, configuration: missingExpected.experiments[experimentId] }]))
  const missingResult = check(missing.run, missing.canonicalDataset)
  assert.equal(missingResult.compatible, true)
  assert.equal(missing.run.experimentResults[0].status, 'unavailable')
  assert.equal(missing.run.status, 'partial')
})

test('failed, skipped, and incomplete experiment statuses cannot be promoted on replay', () => {
  for (const status of ['failed', 'skipped', 'incomplete']) {
    const { run, canonicalDataset } = makeModernRun({ experimentIds: ['strategy-comparison'] })
    run.experimentResults[0].status = status
    run.effectiveExperimentConfiguration['strategy-comparison'].status = status
    assert.ok(hasBlocker(check(run, canonicalDataset), 'experiment-status-not-replayable'))
  }
})

test('Strategy Comparison resolver preserves requested order and only includes usable symbols', () => {
  const { run, canonicalDataset } = makeModernRun({ symbols: ['IWM', 'SPY', 'QQQ'], experimentIds: ['strategy-comparison'], incompleteSymbols: ['SPY'], emptySymbols: ['QQQ'] })
  const resolved = resolveCurrentEffectiveExperimentConfiguration({ run, dataset: reconstructResearchDataset(canonicalDataset), codeRevision: revision })
  assert.deepEqual(Object.keys(resolved.experiments['strategy-comparison'].bySymbol), ['IWM'])
  assert.deepEqual(resolved.input.symbols, ['IWM', 'SPY', 'QQQ'])
  assert.equal(check(run, canonicalDataset).compatible, true)
})

test('Strategy Discovery timestamps are descriptive and legacy runs remain readable but ineligible', () => {
  const { run, canonicalDataset } = makeModernRun({ experimentIds: ['strategy-discovery'] })
  run.experimentResults[0].nativeOutput = { generatedAt: 'old-time', gitCommit: revision }
  assert.equal(check(run, canonicalDataset).compatible, true)
  const legacy = structuredClone(run)
  legacy.runContext.adjustmentMode = 'legacy-unknown'
  legacy.dataset.adjustmentMode = 'legacy-unknown'
  legacy.effectiveDateProvenance.symbols.SPY.adjustmentMode = 'legacy-unknown'
  const legacyDataset = structuredClone(canonicalDataset)
  legacyDataset.adjustmentMode = 'legacy-unknown'
  for (const metadata of Object.values(legacyDataset.effectiveMetadata.symbols)) if (metadata) metadata.adjustmentMode = 'legacy-unknown'
  assert.ok(hasBlocker(check(legacy, legacyDataset), 'adjustment-mode-mismatch'))
  assert.equal(legacy.experimentResults[0].nativeOutput.generatedAt, 'old-time')
})
