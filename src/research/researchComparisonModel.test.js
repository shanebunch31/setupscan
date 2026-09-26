import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createResearchComparisonActions, createResearchComparisonRequest } from './researchComparisonModel.js'

test('comparison request requires exactly two non-empty run IDs', () => {
  assert.throws(() => createResearchComparisonRequest(), /two research runs/)
  assert.throws(() => createResearchComparisonRequest('run-a'), /two research runs/)
  assert.throws(() => createResearchComparisonRequest('run-a', 'run-b', 'run-c'), /two research runs/)
  assert.throws(() => createResearchComparisonRequest('', 'run-b'), /two research runs/)
  assert.throws(() => createResearchComparisonRequest('run-a', '   '), /two research runs/)
})

test('comparison request rejects identical run IDs', () => {
  assert.throws(() => createResearchComparisonRequest('run-a', 'run-a'), /two different research runs/)
})

test('comparison request preserves the exact selected run IDs', () => {
  assert.deepEqual(createResearchComparisonRequest(' run/a ', 'run b'), { runIdA: ' run/a ', runIdB: 'run b' })
})

test('comparison action delegates exact IDs to compareResearchRuns', async () => {
  const calls = []
  const result = { comparisons: [], unmatched: [] }
  const actions = createResearchComparisonActions({
    compareRuns: async (...runIds) => {
      calls.push(runIds)
      return result
    },
  })
  assert.equal(await actions.compare('run/one', 'run two'), result)
  assert.deepEqual(calls, [['run/one', 'run two']])
})

test('comparison action propagates helper errors', async () => {
  const actions = createResearchComparisonActions({ compareRuns: async () => { throw new Error('Comparison unavailable') } })
  await assert.rejects(actions.compare('run-a', 'run-b'), /Comparison unavailable/)
})