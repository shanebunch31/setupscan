import { createDatasetId, createResearchRunContext } from './orchestration.js'
import { createResearchRecordForExperiment } from './registry.js'
import { synthesizeResearch } from './synthesis.js'
import { interpretResearchSummary } from './interpretation.js'

// Batch results and fetched datasets are immutable React inputs. Keep one identity
// for their lifetime, including a repeated render of the same in-memory result.
const summaries = new WeakMap()
const known = value => typeof value === 'string' && value.trim() && value !== 'legacy-unknown'
const date = value => known(value) && Number.isFinite(Date.parse(value))

function contextFor(batch, datasets) {
  if (!batch.available || !Array.isArray(batch.universe) || !batch.universe.length ||
    new Set(batch.universe).size !== batch.universe.length) return null
  const results = []
  for (const symbol of batch.universe) {
    const matches = datasets.filter(dataset => dataset.symbol === symbol)
    if (matches.length !== 1 || matches[0].status !== 'AVAILABLE') return null
    const result = matches[0].data
    const native = batch.datasetInfo?.filter(info => info.symbol === symbol)
    if (!result || result.symbol !== symbol || result.complete !== true ||
      !Number.isInteger(result.candleCount) || result.candleCount <= 0 ||
      !Array.isArray(result.candles) || result.candles.length !== result.candleCount ||
      !['provider', 'timeframe', 'adjustmentMode'].every(field => known(result[field])) ||
      !['requestedStart', 'requestedEnd', 'start', 'end'].every(field => date(result[field])) ||
      Date.parse(result.requestedStart) >= Date.parse(result.requestedEnd) ||
      Date.parse(result.start) > Date.parse(result.end) || result.timeframe !== batch.timeframe ||
      native?.length !== 1 || native[0].provider !== result.provider ||
      native[0].adjustmentMode !== result.adjustmentMode ||
      Date.parse(native[0].start) !== Date.parse(result.start) || Date.parse(native[0].end) !== Date.parse(result.end)) return null
    results.push(result)
  }
  const first = results[0]
  if (!results.every(result => ['provider', 'timeframe', 'requestedStart', 'requestedEnd', 'adjustmentMode']
    .every(field => result[field] === first[field]))) return null
  const run = createResearchRunContext({
    symbols: results.map(result => result.symbol), timeframe: first.timeframe,
    requestedStart: first.requestedStart, requestedEnd: first.requestedEnd,
    requestedExperiments: ['strategy-discovery'],
  })
  // The standard context owns the current contracts. Never stamp them onto an
  // incompatible fetch result or replace missing fetch metadata with defaults.
  if (run.adjustmentMode !== first.adjustmentMode) return null
  const datasetId = createDatasetId(results, run.adjustmentMode, run)
  return {
    ...run, datasetId, provider: first.provider,
    // Batch A pools each symbol's observations; use the union, not an invented
    // common intersection. These are actual candle timestamps, not period ends.
    actualStart: results.reduce((earliest, result) => Date.parse(result.start) < Date.parse(earliest) ? result.start : earliest, first.start),
    actualEnd: results.reduce((latest, result) => Date.parse(result.end) > Date.parse(latest) ? result.end : latest, first.end),
    provenance: {
      runId: run.runId, datasetId, requestedAt: run.requestedAt, codeRevision: run.codeRevision,
      emaContractVersion: run.emaContractVersion, adjustmentMode: run.adjustmentMode,
    },
  }
}

/** Identify an already-computed Batch A result without fetching or recomputing it. */
export function createStrategyDiscoveryLiveSummary(batch, datasets) {
  if (!batch?.available) return null
  let byDatasets = summaries.get(batch)
  if (byDatasets?.has(datasets)) return byDatasets.get(datasets)
  const context = contextFor(batch, datasets)
  const record = createResearchRecordForExperiment('strategy-discovery', batch, context ?? {})
  const synthesis = synthesizeResearch([record], context ?? { requestedExperiments: ['strategy-discovery'] })
  const summary = { context, record, synthesis, interpretation: interpretResearchSummary(synthesis) }
  if (!byDatasets) { byDatasets = new WeakMap(); summaries.set(batch, byDatasets) }
  byDatasets.set(datasets, summary)
  return summary
}
