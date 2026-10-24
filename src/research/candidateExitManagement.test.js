import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createResearchRecordForExperiment, getResearchExperiment } from './registry.js'
import { executeResearchExperiment } from './experimentExecutors.js'
import { synthesizeResearch, EVIDENCE_FAMILIES } from './synthesis.js'
import { projectResearchRunForPersistence } from './researchRunHistory.js'
import { stringifyResearchJson, parseResearchJson } from './researchRunSerialization.js'
import { createEffectiveExperimentConfiguration, resolveCurrentEffectiveExperimentConfiguration } from './effectiveExperimentConfiguration.js'
import { runCandidateExitManagement, candidateExitConfiguration } from '../backtest/candidateExitManagement.js'
import { shadowSourceFingerprint } from '../../server/shadowForwardCommand.js'

const id = 'candidate-exit-management'
const options = { symbols: ['SPY', 'QQQ', 'IWM'], timeframe: '1Hour', requestedStart: '2024-01-01T00:00:00Z', requestedEnd: '2024-06-01T00:00:00Z' }
const raw = Object.fromEntries(options.symbols.map((symbol) => [symbol, Array.from({ length: 1200 }, (_, i) => {
  const close = 100 + i * .03 + Math.sin(i / 6)
  return { symbol, timeframe: '1Hour', timestamp: new Date(Date.UTC(2024, 0, 1) + i * 3600000).toISOString(), open: close, close, high: close + .2, low: close - .2, volume: 1000 + i }
})]))

test('registry and executor support all requested symbols and reject silently dropped inputs', () => {
  assert.equal(getResearchExperiment(id).methodologyVersion, 'candidate-exit-management-1')
  assert.deepEqual(getResearchExperiment(id).requiredSymbols, [])
  const executed = executeResearchExperiment(id, raw, options)
  assert.equal(executed.status, 'succeeded')
  assert.deepEqual(executed.nativeOutput, runCandidateExitManagement(raw, options))
  assert.ok(executed.nativeOutput.pairs.length > 0)
  assert.equal(executeResearchExperiment(id, raw, { ...options, symbols: [...options.symbols, 'XYZ'] }).status, 'unavailable')
  assert.equal(executeResearchExperiment(id, { SPY: { candles: raw.SPY, complete: false } }, { ...options, symbols: ['SPY'] }).status, 'unavailable')
  assert.equal(executeResearchExperiment(id, raw, { symbols: [] }).status, 'unavailable')
})

test('normalized records preserve candidate, exit method, symbol, period, costs, evidence and provenance', () => {
  const output = runCandidateExitManagement(raw, options)
  const record = createResearchRecordForExperiment(id, output, { ...options, provenance: { datasetId: 'fixture-dataset', codeRevision: 'fixture-revision' } })
  assert.equal(record.methodologyVersion, 'candidate-exit-management-1')
  assert.equal(record.parameters.candidateExitManagement.candidate.id, 'trend-up-medium-volatility-v1')
  assert.equal(record.parameters.candidateExitManagement.candidate.methodologyVersion, 'candidate-context-robustness-2')
  assert.equal(record.provenance.datasetId, 'fixture-dataset')
  assert.equal(record.provenance.codeRevision, 'fixture-revision')
  const evidence = synthesizeResearch([record]).strategyGroups.flatMap((g) => g.evidence)
  const fixed = evidence.find((e) => e.metricsKey === 'full::SPY::fixed')
  const trailing = evidence.find((e) => e.metricsKey === 'full::SPY::trailing')
  assert.deepEqual(fixed.symbols, ['SPY'])
  assert.notEqual(fixed.ruleSetVariant, trailing.ruleSetVariant)
  assert.equal(fixed.membershipRule, 'research-eligible-75-plus')
  assert.equal(fixed.metrics.exitComparison.resolvedCount, trailing.metrics.exitComparison.resolvedCount)
  assert.equal(fixed.costModel.status, 'modeled')
  assert.equal(fixed.metrics.exitComparison.costTiers.length, 4)
  assert.equal(evidence.find((e) => e.metricsKey === 'recent::QQQ::trailing').outOfSampleRole, 'recent')
  assert.ok(EVIDENCE_FAMILIES['signal-quality-catalogue'].experimentIds.includes(id))
})

test('compact saved contract keeps all comparisons and exclusions without raw pairs, and preserves Infinity', () => {
  const payload = runCandidateExitManagement(raw, options)
  payload.rows[0].costTiers[0].metrics.profitFactor = Infinity
  const record = createResearchRecordForExperiment(id, payload, options)
  const projected = projectResearchRunForPersistence({ records: [record], experimentResults: [{ experimentId: id, status: 'succeeded', nativeOutput: payload }] })
  const saved = parseResearchJson(stringifyResearchJson(projected))
  assert.equal(saved.experimentResults[0].nativeOutput, undefined)
  assert.equal(saved.records[0].nativePayload, undefined)
  assert.deepEqual(saved.records[0].metrics, record.metrics)
  assert.deepEqual(saved.records[0].parameters, record.parameters)
  assert.equal(saved.records[0].metrics[payload.rows[0].key].exitComparison.costTiers[0].metrics.profitFactor, Infinity)
})

test('effective configuration and offline replay preflight agree on frozen exit parameters', () => {
  const payload = runCandidateExitManagement(raw, options)
  const experimentResults = [{ experimentId: id, status: 'succeeded', nativeOutput: payload }]
  const saved = createEffectiveExperimentConfiguration(experimentResults)[id].configuration
  const current = resolveCurrentEffectiveExperimentConfiguration({ run: { runContext: { ...options, requestedExperiments: [id] }, experimentResults }, dataset: { rawSeriesBySymbol: raw } }).experiments[id]
  assert.deepEqual(saved, candidateExitConfiguration)
  assert.deepEqual(saved, current)
})

test('unavailable results have no fabricated metrics and missing legacy metadata remains readable', () => {
  const record = createResearchRecordForExperiment(id, { available: false }, options)
  assert.equal(record.status, 'unavailable')
  assert.deepEqual(record.metrics, {})
  assert.doesNotThrow(() => synthesizeResearch([{ ...record, methodologyVersion: null, parameters: {} }]))
})

test('active Shadow Forward static dependency fingerprint remains unchanged', async () => {
  assert.equal(await shadowSourceFingerprint(), '6241eacd477f3e6fb6138203f711296991cf6c8db2493c36d79648b504bcd26b')
})
