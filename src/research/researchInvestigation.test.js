import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  appendInvestigationRunId,
  normalizeResearchInvestigationInput,
  normalizeResearchRunId,
} from './researchInvestigation.js'
import { listResearchExperiments } from './registry.js'

test('normalizes valid investigation creation data and trims the authored question', () => {
  assert.deepEqual(normalizeResearchInvestigationInput({
    question: '  Does the baseline persist across regimes?  ',
    requestedExperiments: ['walk-forward-regime', 'yearly-regime'],
  }), {
    question: 'Does the baseline persist across regimes?',
    requestedExperiments: ['walk-forward-regime', 'yearly-regime'],
  })
})

test('rejects empty, non-string, and overlong questions', () => {
  assert.throws(() => normalizeResearchInvestigationInput({ question: ' \n ' }), { code: 'RESEARCH_INVESTIGATION_INVALID' })
  assert.throws(() => normalizeResearchInvestigationInput({ question: 42 }), /question must be a string/)
  assert.throws(() => normalizeResearchInvestigationInput({ question: 'x'.repeat(1001) }), /at most 1000 characters/)
})

test('rejects unknown experiment IDs and deduplicates while preserving order', () => {
  assert.throws(() => normalizeResearchInvestigationInput({ question: 'Question', requestedExperiments: ['not-registered'] }), /unknown experiment id/)
  assert.deepEqual(normalizeResearchInvestigationInput({
    question: 'Question',
    requestedExperiments: ['robustness', 'relative-value', 'robustness'],
  }).requestedExperiments, ['robustness', 'relative-value'])
})

test('defaults omitted plan to registered experiments and accepts an explicit empty plan', () => {
  assert.deepEqual(
    normalizeResearchInvestigationInput({ question: 'Question' }).requestedExperiments,
    listResearchExperiments().map(({ id }) => id),
  )
  assert.deepEqual(normalizeResearchInvestigationInput({ question: 'Question', requestedExperiments: [] }).requestedExperiments, [])
})

test('validates and normalizes run IDs, and prevents duplicate association', () => {
  assert.equal(normalizeResearchRunId(' run-1 '), 'run-1')
  assert.throws(() => normalizeResearchRunId('  '), { code: 'RESEARCH_INVESTIGATION_INVALID' })
  assert.deepEqual(appendInvestigationRunId(['run-1'], 'run-2'), ['run-1', 'run-2'])
  assert.throws(() => appendInvestigationRunId(['run-1'], 'run-1'), { code: 'RESEARCH_INVESTIGATION_RUN_EXISTS' })
})