
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DAILY_DISCOVERY_EXPERIMENTS,
  DAILY_DISCOVERY_SYMBOLS,
  DAILY_DISCOVERY_TIMEFRAME,
  runDailyStrategyDiscovery,
} from './dailyStrategyDiscovery.js'

function makeResult(overrides = {}) {
  return {
    runContext: { runId: 'run_test_1' },
    status: 'completed',
    fetchStatus: 'complete',
    experimentResults: [
      { experimentId: 'strategy-discovery', status: 'succeeded' },
    ],
    ...overrides,
  }
}

test('runs Strategy Discovery for SPY, QQQ, and IWM over a 12-month window', async () => {
  const requests = []
  const store = {
    async saveResearchRun(result) {
      assert.equal(result.runContext.runId, 'run_test_1')
      return { runId: 'run_test_1' }
    },
  }

  const summary = await runDailyStrategyDiscovery({
    store,
    now: () => new Date('2026-10-12T20:00:00.000Z'),
    runResearchFn: async (request) => {
      requests.push(request)
      return makeResult()
    },
  })

  assert.deepEqual(requests[0].symbols, DAILY_DISCOVERY_SYMBOLS)
  assert.equal(requests[0].timeframe, DAILY_DISCOVERY_TIMEFRAME)
  assert.deepEqual(requests[0].requestedExperiments, DAILY_DISCOVERY_EXPERIMENTS)
  assert.equal(requests[0].requestedEnd, '2026-10-12T20:00:00.000Z')
  assert.equal(
    new Date(requests[0].requestedEnd).getTime() -
      new Date(requests[0].requestedStart).getTime(),
    365 * 24 * 60 * 60 * 1000,
  )
  assert.equal(summary.runId, 'run_test_1')
  assert.equal(summary.status, 'completed')
})

test('rejects a missing persistence store before starting research', async () => {
  let researchCalled = false

  await assert.rejects(
    runDailyStrategyDiscovery({
      runResearchFn: async () => {
        researchCalled = true
        return makeResult()
      },
    }),
    /requires a store/,
  )

  assert.equal(researchCalled, false)
})

test('rejects invalid research results without saving them', async () => {
  let saveCalled = false

  await assert.rejects(
    runDailyStrategyDiscovery({
      store: {
        async saveResearchRun() {
          saveCalled = true
        },
      },
      runResearchFn: async () => null,
    }),
    /invalid result/,
  )

  assert.equal(saveCalled, false)
})

test('preserves incomplete research status in its summary', async () => {
  const summary = await runDailyStrategyDiscovery({
    store: { async saveResearchRun() { return { runId: 'saved' } } },
    runResearchFn: async () =>
      makeResult({
        status: 'partial',
        fetchStatus: 'partial',
        experimentResults: [
          { experimentId: 'strategy-discovery', status: 'incomplete' },
        ],
      }),
  })

  assert.equal(summary.status, 'partial')
  assert.equal(summary.fetchStatus, 'partial')
  assert.equal(summary.experimentResults[0].status, 'incomplete')
})
