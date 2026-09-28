import { reconstructResearchDataset } from '../data/marketData.js'
import { createDatasetId } from './orchestration.js'
import { getResearchExperiment } from './registry.js'

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function equal(left, right) {
  return canonicalJson(left) === canonicalJson(right)
}

function blocker(code, field, expected, actual, message) {
  return { code, field, expected: expected ?? null, actual: actual ?? null, message }
}

function contextFor(run) {
  return run?.runContext ?? run ?? {}
}

function savedDatasetId(run) {
  return run?.dataset?.datasetId ?? run?.datasetId ?? run?.synthesis?.provenance?.datasetId ?? null
}

function nonemptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function addIfDifferent(blockers, code, field, expected, actual, message) {
  if (!equal(expected, actual)) blockers.push(blocker(code, field, expected, actual, message))
}

function validateCanonicalMetadata(run, canonicalDataset, reconstructed, blockers) {
  const context = contextFor(run)
  const savedMetadata = run?.effectiveDateProvenance
  const effectiveMetadata = canonicalDataset?.effectiveMetadata
  if (!savedMetadata || !effectiveMetadata) {
    blockers.push(blocker('effective-date-metadata-mismatch', 'effectiveDateProvenance', 'persisted and canonical effective metadata', null, 'Effective date provenance is missing.'))
    return
  }
  addIfDifferent(blockers, 'effective-date-metadata-mismatch', 'effectiveDateProvenance', savedMetadata, effectiveMetadata, 'Run and canonical dataset effective date metadata differ.')
  addIfDifferent(blockers, 'effective-date-metadata-mismatch', 'dataset.effectiveMetadata', savedMetadata, run?.dataset?.effectiveMetadata, 'Run dataset metadata differs from persisted effective date provenance.')
  addIfDifferent(blockers, 'requested-input-mismatch', 'requestedStart', context.requestedStart ?? null, effectiveMetadata.requestedStart ?? null, 'Canonical dataset requested start differs from the saved run.')
  addIfDifferent(blockers, 'requested-input-mismatch', 'requestedEnd', context.requestedEnd ?? null, effectiveMetadata.requestedEnd ?? null, 'Canonical dataset requested end differs from the saved run.')
  addIfDifferent(blockers, 'requested-input-mismatch', 'dataset.requestedStart', context.requestedStart ?? null, run?.dataset?.requestedStart ?? null, 'Run dataset requested start differs from the saved run context.')
  addIfDifferent(blockers, 'requested-input-mismatch', 'dataset.requestedEnd', context.requestedEnd ?? null, run?.dataset?.requestedEnd ?? null, 'Run dataset requested end differs from the saved run context.')

  const symbols = context.symbols ?? []
  const symbolMetadata = effectiveMetadata.symbols
  if (!symbolMetadata || !equal(Object.keys(symbolMetadata).sort(), [...symbols].sort())) {
    blockers.push(blocker('effective-date-metadata-mismatch', 'effectiveDateProvenance.symbols', [...symbols].sort(), Object.keys(symbolMetadata ?? {}).sort(), 'Per-symbol effective metadata does not match the requested symbol set.'))
    return
  }

  const seriesSymbols = (canonicalDataset.calculationSeries ?? []).map((entry) => entry.symbol)
  if (new Set(seriesSymbols).size !== seriesSymbols.length || !equal(seriesSymbols, [...seriesSymbols].sort())) {
    blockers.push(blocker('dataset-metadata-mismatch', 'calculationSeries.symbols', [...seriesSymbols].sort(), seriesSymbols, 'Canonical symbol series must be unique and in the stored deterministic order.'))
  }
  const calculationBySymbol = new Map((canonicalDataset.calculationSeries ?? []).map((entry) => [entry.symbol, entry]))
  const expectedCalculationSymbols = []
  symbols.forEach((symbol) => {
    const metadata = symbolMetadata[symbol]
    const result = reconstructed.fetchResultsBySymbol[symbol]
    const calculationEntry = calculationBySymbol.get(symbol)
    const candles = calculationEntry?.candles ?? []
    if (metadata === null) {
      if (calculationBySymbol.has(symbol)) blockers.push(blocker('dataset-metadata-mismatch', `calculationSeries.${symbol}`, 'no series for unavailable symbol', candles.length, `Unavailable symbol ${symbol} has canonical candles.`))
      if (!(run?.fetchIssues ?? []).some((issue) => issue.symbol === symbol && issue.type === 'fetch-error')) blockers.push(blocker('fetch-status-not-replayable', `fetchIssues.${symbol}`, 'fetch-error diagnostic', null, `Unavailable symbol ${symbol} is missing its saved fetch error.`))
      return
    }
    if (!metadata || !result) {
      blockers.push(blocker('effective-date-metadata-mismatch', `effectiveDateProvenance.symbols.${symbol}`, 'available metadata and reconstructed fetch result', metadata ?? null, `Per-symbol metadata for ${symbol} cannot be reconstructed.`))
      return
    }
    if (calculationEntry) {
      addIfDifferent(blockers, 'dataset-metadata-mismatch', `calculationSeries.${symbol}.timeframe`, canonicalDataset.timeframe ?? null, calculationEntry.timeframe ?? null, `${symbol} calculation-series timeframe differs from the dataset.`)
    }
    // effectiveDateProvenance.symbols is the authoritative persisted per-symbol metadata.
    // Do not require a duplicate run.dataset.fetchResultsBySymbol representation.
    const hasIssue = (type) => (run?.fetchIssues ?? []).some((issue) => issue.symbol === symbol && issue.type === type)
    if (metadata.requestedCandleCount === 0 && !hasIssue('empty')) blockers.push(blocker('fetch-status-not-replayable', `fetchIssues.${symbol}`, 'empty diagnostic', null, `Empty result for ${symbol} is missing its saved diagnostic.`))
    if (metadata.complete === false && !hasIssue('incomplete')) blockers.push(blocker('fetch-status-not-replayable', `fetchIssues.${symbol}`, 'incomplete diagnostic', null, `Incomplete result for ${symbol} is missing its saved diagnostic.`))
    for (const [field, actual] of [
      ['provider', canonicalDataset.provider],
      ['adjustmentMode', canonicalDataset.adjustmentMode],
      ['timeframe', context.timeframe],
      ['requestedStart', context.requestedStart ?? null],
      ['requestedEnd', context.requestedEnd ?? null],
    ]) {
      addIfDifferent(blockers, field === 'adjustmentMode' ? 'adjustment-mode-mismatch' : 'dataset-metadata-mismatch', `effectiveDateProvenance.symbols.${symbol}.${field}`, actual, metadata[field] ?? null, `${symbol} ${field} differs from the canonical run contract.`)
    }

    for (const [field, actual] of [
      ['actualStart', result.start ?? null],
      ['actualEnd', result.end ?? null],
      ['requestedCandleCount', result.requestedCandleCount],
    ]) {
      addIfDifferent(blockers, 'effective-date-metadata-mismatch', `effectiveDateProvenance.symbols.${symbol}.${field}`, actual, metadata[field] ?? null, `${symbol} ${field} does not match the reconstructed requested-range series.`)
    }
    addIfDifferent(blockers, 'effective-date-metadata-mismatch', `effectiveDateProvenance.symbols.${symbol}.complete`, metadata.complete ?? null, result.complete ?? null, `${symbol} completeness differs from the saved fetch result.`)

    if (result.requestedCandleCount > 0) {
      expectedCalculationSymbols.push(symbol)
      for (const [field, actual] of [
        ['calculationStart', candles[0]?.timestamp ?? null],
        ['calculationEnd', candles.at(-1)?.timestamp ?? null],
        ['calculationCandleCount', candles.length],
      ]) {
        addIfDifferent(blockers, 'effective-date-metadata-mismatch', `effectiveDateProvenance.symbols.${symbol}.${field}`, actual, metadata[field] ?? null, `${symbol} ${field} does not match its canonical calculation series.`)
      }
    } else if (candles.length) {
      blockers.push(blocker('dataset-metadata-mismatch', `calculationSeries.${symbol}`, 'no executor input for empty requested range', candles.length, `Empty requested symbol ${symbol} unexpectedly has a canonical calculation series.`))
    }
  })
  addIfDifferent(
    blockers,
    'dataset-metadata-mismatch',
    'calculationSeries.symbols',
    expectedCalculationSymbols.sort(),
    [...calculationBySymbol.keys()].sort(),
    'Canonical calculation-series symbols do not match symbols with requested-range input.',
  )
}

function validateFetchSemantics(run, reconstructed, blockers) {
  const context = contextFor(run)
  const symbols = context.symbols ?? []
  const issues = run?.fetchIssues
  if (!Array.isArray(issues)) {
    blockers.push(blocker('fetch-status-not-replayable', 'fetchIssues', 'array', issues, 'Saved fetch diagnostics are missing.'))
    return
  }
  const nonemptyCount = symbols.filter((symbol) => reconstructed.rawSeriesBySymbol[symbol]?.length > 0).length
  const expectedFetchStatus = nonemptyCount === 0
    ? 'unavailable'
    : nonemptyCount !== symbols.length || issues.length > 0 ? 'partial' : 'complete'
  addIfDifferent(blockers, 'fetch-status-not-replayable', 'fetchStatus', expectedFetchStatus, run.fetchStatus, 'Saved fetch status does not match the persisted per-symbol data and diagnostics.')
  if (nonemptyCount === 0) blockers.push(blocker('fetch-status-not-replayable', 'dataset', 'at least one saved requested-range candle series', 0, 'The saved run has no requested-range candle input to replay.'))
}

function validateExperiments(run, reconstructed, runtime, blockers) {
  const context = contextFor(run)
  const requested = context.requestedExperiments
  const results = run?.experimentResults
  if (!Array.isArray(requested) || requested.length === 0 || !Array.isArray(results)) {
    blockers.push(blocker('requested-input-mismatch', 'requestedExperiments', 'non-empty ordered experiment list and saved results', requested ?? null, 'Saved experiment intent or execution results are missing.'))
    return
  }
  const resultIds = results.map((result) => result?.experimentId ?? null)
  addIfDifferent(blockers, 'requested-input-mismatch', 'experimentResults', requested, resultIds, 'Saved experiment execution order does not match requested experiment order.')
  const savedConfiguration = run?.effectiveExperimentConfiguration
  const expectedConfiguration = runtime?.expectedConfiguration
  const expectedExperiments = expectedConfiguration?.experiments ?? expectedConfiguration
  if (!savedConfiguration || typeof savedConfiguration !== 'object') {
    blockers.push(blocker('experiment-configuration-missing', 'effectiveExperimentConfiguration', 'configuration for every requested experiment', savedConfiguration ?? null, 'Effective experiment configuration is missing.'))
  }
  if (!expectedConfiguration || typeof expectedConfiguration !== 'object' || !expectedExperiments || typeof expectedExperiments !== 'object') {
    blockers.push(blocker('experiment-configuration-missing', 'runtime.expectedConfiguration', 'current configuration for every requested experiment', expectedConfiguration ?? null, 'Current effective experiment configuration was not resolved.'))
  }
  if (expectedConfiguration?.input) {
    for (const field of ['symbols', 'timeframe', 'requestedStart', 'requestedEnd', 'requestedExperiments']) {
      addIfDifferent(blockers, 'requested-input-mismatch', `runtime.expectedConfiguration.input.${field}`, context[field] ?? (field === 'symbols' || field === 'requestedExperiments' ? [] : null), expectedConfiguration.input[field] ?? (field === 'symbols' || field === 'requestedExperiments' ? [] : null), `Current replay input ${field} differs from the saved run.`)
    }
  }

  requested.forEach((experimentId, index) => {
    const result = results[index]
    const definition = getResearchExperiment(experimentId)
    if (!definition) {
      blockers.push(blocker('requested-input-mismatch', 'requestedExperiments', 'registered experiment identifiers', experimentId, `Unknown saved experiment ${experimentId}.`))
      return
    }
    if (!result) return
    if (['failed', 'skipped', 'incomplete'].includes(result.status)) {
      blockers.push(blocker('experiment-status-not-replayable', `experimentResults.${experimentId}.status`, 'succeeded or deterministically unavailable', 'failed/skipped/incomplete', `Experiment ${experimentId} did not complete successfully and cannot be promoted during exact replay.`))
    }
    const usable = (symbol) => {
      const fetchResult = reconstructed.fetchResultsBySymbol[symbol]
      return Boolean(fetchResult?.candles?.length && fetchResult.complete !== false)
    }
    const requiredSymbols = definition.requiredSymbols ?? []
    const expectedUnavailable = experimentId === 'strategy-comparison'
      ? !(context.symbols ?? []).some(usable)
      : requiredSymbols.some((symbol) => !(context.symbols ?? []).includes(symbol) || !usable(symbol))
    if ((result.status === 'unavailable') !== expectedUnavailable) {
      blockers.push(blocker('experiment-status-not-replayable', `experimentResults.${experimentId}.status`, expectedUnavailable ? 'unavailable' : 'succeeded', result.status, `Experiment ${experimentId} availability does not match its saved usable symbols.`))
    }
    const savedEntry = savedConfiguration?.[experimentId]
    if (!savedEntry || savedEntry.status !== result.status) {
      blockers.push(blocker('experiment-configuration-missing', `effectiveExperimentConfiguration.${experimentId}`, result.status, savedEntry?.status ?? null, `Saved configuration status for ${experimentId} is missing or inconsistent.`))
    }
    if (result.status === 'succeeded' && expectedExperiments && savedEntry) {
      if (!(experimentId in expectedExperiments)) {
        blockers.push(blocker('experiment-configuration-missing', `runtime.expectedConfiguration.experiments.${experimentId}`, 'resolved configuration', null, `Current configuration for ${experimentId} is missing.`))
      } else {
        addIfDifferent(blockers, 'experiment-configuration-mismatch', `effectiveExperimentConfiguration.${experimentId}.configuration`, expectedExperiments[experimentId], savedEntry.configuration ?? null, `Saved effective configuration for ${experimentId} differs from current code.`)
        if (experimentId === 'strategy-comparison') {
          const expectedOrder = (context.symbols ?? []).filter((symbol) => reconstructed.rawSeriesBySymbol[symbol]?.length && reconstructed.fetchResultsBySymbol[symbol]?.complete !== false)
          const configuredOrder = Object.keys(expectedExperiments[experimentId]?.bySymbol ?? {})
          addIfDifferent(blockers, 'requested-input-mismatch', 'strategy-comparison.usableSymbolOrder', expectedOrder, configuredOrder, 'Strategy Comparison current configuration does not preserve the saved requested symbol order and usable subset.')
        }
      }
    } else if (result.status === 'unavailable' && savedEntry && savedEntry.configuration !== null) {
      blockers.push(blocker('experiment-configuration-mismatch', `effectiveExperimentConfiguration.${experimentId}.configuration`, null, savedEntry.configuration, `Unavailable experiment ${experimentId} unexpectedly has a resolved configuration.`))
    }
  })
  if (savedConfiguration && expectedExperiments) {
    addIfDifferent(blockers, 'experiment-configuration-mismatch', 'effectiveExperimentConfiguration.experiments', [...requested].sort(), Object.keys(savedConfiguration).sort(), 'Saved effective configuration IDs do not match requested experiments.')
  }
}

/** Pure, fail-closed eligibility check. It never fetches market data or executes an experiment. */
export function checkResearchReplayCompatibility({ run, canonicalDataset, runtime } = {}) {
  const blockers = []
  const context = contextFor(run)
  const savedRevision = context.codeRevision ?? null
  const runtimeRevision = runtime?.codeRevision ?? null
  if (!nonemptyString(savedRevision)) blockers.push(blocker('code-revision-missing', 'runContext.codeRevision', 'non-empty saved Git revision', savedRevision, 'The saved run has no code revision.'))
  if (!nonemptyString(runtimeRevision)) blockers.push(blocker('runtime-revision-unavailable', 'runtime.codeRevision', 'non-empty current Git revision', runtimeRevision, 'The current runtime cannot establish its code revision.'))
  if (savedRevision && runtimeRevision && savedRevision !== runtimeRevision) {
    blockers.push(blocker('code-revision-mismatch', 'codeRevision', savedRevision, runtimeRevision, 'Exact replay requires the saved code revision.'))
  }
  if (!context.emaContractVersion || context.emaContractVersion === 'legacy-unknown' || context.emaContractVersion !== runtime?.emaContractVersion) {
    blockers.push(blocker('ema-contract-mismatch', 'emaContractVersion', context.emaContractVersion ?? null, runtime?.emaContractVersion ?? null, 'Saved and current EMA contracts must be known and identical.'))
  }

  const runDatasetId = savedDatasetId(run)
  if (!runDatasetId) blockers.push(blocker('dataset-id-missing', 'datasetId', 'saved dataset identity', null, 'The saved run has no datasetId.'))
  if (!canonicalDataset) blockers.push(blocker('canonical-dataset-missing', 'canonicalDataset', 'persisted canonical dataset', null, 'Canonical dataset retrieval failed or returned no dataset.'))
  if (!canonicalDataset) return { compatible: false, blockers }

  const canonicalAdjustment = canonicalDataset.adjustmentMode ?? null
  const contextAdjustment = context.adjustmentMode ?? null
  const runDatasetAdjustment = run?.dataset?.adjustmentMode ?? null
  if (!nonemptyString(canonicalAdjustment) || canonicalAdjustment === 'legacy-unknown'
    || !nonemptyString(contextAdjustment) || contextAdjustment === 'legacy-unknown'
    || !nonemptyString(runDatasetAdjustment) || runDatasetAdjustment === 'legacy-unknown'
    || canonicalAdjustment !== contextAdjustment || canonicalAdjustment !== runDatasetAdjustment) {
    blockers.push(blocker('adjustment-mode-mismatch', 'adjustmentMode', { runContext: contextAdjustment, dataset: runDatasetAdjustment }, canonicalAdjustment, 'Exact replay requires known, matching run-context and canonical adjustment modes.'))
  }
  for (const [field, expected, actual] of [
    ['provider', run?.dataset?.provider ?? null, canonicalDataset.provider ?? null],
    ['timeframe', context.timeframe ?? null, canonicalDataset.timeframe ?? null],
  ]) {
    addIfDifferent(blockers, 'dataset-metadata-mismatch', field, expected, actual, `Saved run and canonical dataset ${field} differ.`)
  }
  addIfDifferent(blockers, 'dataset-metadata-mismatch', 'dataset.timeframe', canonicalDataset.timeframe ?? null, run?.dataset?.timeframe ?? null, 'Run dataset timeframe differs from canonical dataset timeframe.')
  if (runDatasetId && canonicalDataset.datasetId && runDatasetId !== canonicalDataset.datasetId) {
    blockers.push(blocker('dataset-metadata-mismatch', 'datasetId', runDatasetId, canonicalDataset.datasetId, 'Canonical dataset is not the dataset referenced by the saved run.'))
  }
  if (canonicalDataset.datasetId && runDatasetId === canonicalDataset.datasetId) {
    try {
      const reconstructed = reconstructResearchDataset(canonicalDataset)
      validateCanonicalMetadata(run, canonicalDataset, reconstructed, blockers)
      validateFetchSemantics(run, reconstructed, blockers)
      const hashInputs = Object.entries(reconstructed.fetchResultsBySymbol)
        .filter(([, result]) => result.requestedCandleCount > 0)
        .map(([symbol, result]) => {
          const input = { ...result, symbol, timeframe: result.timeframe ?? canonicalDataset.timeframe }
          Object.defineProperty(input, 'calculationCandles', { value: result.calculationCandles })
          return input
        })
      const recomputedId = hashInputs.length ? createDatasetId(hashInputs, canonicalAdjustment) : null
      if (!recomputedId || recomputedId !== runDatasetId) {
        blockers.push(blocker('dataset-content-mismatch', 'datasetId', runDatasetId, recomputedId, 'Recomputed canonical candle identity does not match the saved datasetId.'))
      }
      validateExperiments(run, reconstructed, runtime, blockers)
      const nonemptySymbols = (context.symbols ?? []).filter((symbol) => reconstructed.rawSeriesBySymbol[symbol]?.length > 0)
      const expectedRunStatus = run.fetchStatus === 'complete' && (run.experimentResults ?? []).every((result) => result.status === 'succeeded')
        ? 'completed'
        : nonemptySymbols.length ? 'partial' : 'unavailable'
      addIfDifferent(blockers, 'fetch-status-not-replayable', 'status', expectedRunStatus, run.status, 'Saved run status does not agree with its persisted fetch and experiment statuses.')
    } catch (error) {
      blockers.push(blocker('dataset-content-mismatch', 'canonicalDataset', 'reconstructable content with verifiable identity', error?.message ?? String(error), 'Canonical dataset reconstruction or identity verification failed.'))
    }
  } else if (runDatasetId && !canonicalDataset.datasetId) {
    blockers.push(blocker('dataset-metadata-mismatch', 'canonicalDataset.datasetId', runDatasetId, null, 'Canonical dataset has no datasetId.'))
  }

  return { compatible: blockers.length === 0, blockers }
}
