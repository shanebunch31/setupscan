import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createPaperService } from './paperService.js'

const persistedState = {
  trades: [{
    id: 'SPY:2026-01-02T14:00:00.000Z',
    symbol: 'SPY',
    status: 'closed',
    signalTimestamp: '2026-01-02T14:00:00.000Z',
    entryPrice: 100,
    exitPrice: 102,
    rMultiple: 2,
    pnl: 200,
    holdingTime: 60,
  }],
  observer: {
    status: 'RUNNING',
    processedCandles: { SPY: '2026-01-02T15:00:00.000Z' },
    dataQualityBySymbol: { SPY: { acceptedCandleCount: 45 } },
  },
}

test('dashboard reads the PostgreSQL observer state when DATABASE_URL is configured', async () => {
  let postgresReads = 0
  let jsonFactoryCalls = 0
  const service = createPaperService({
    environment: { DATABASE_URL: 'configured-for-test' },
    createPostgresStore: () => ({ read: async () => { postgresReads += 1; return persistedState } }),
    createJsonStore: () => { jsonFactoryCalls += 1; throw new Error('JSON fallback must not be selected') },
    now: () => new Date('2026-01-02T16:00:00.000Z'),
  })

  const snapshot = await service.readSnapshot()

  assert.equal(postgresReads, 1)
  assert.equal(jsonFactoryCalls, 0)
  assert.equal(snapshot.storage, 'POSTGRES OBSERVER STATE')
  assert.deepEqual(snapshot.trades, persistedState.trades)
  assert.equal(snapshot.observer.status, 'RUNNING')
  assert.equal(snapshot.data.find((item) => item.symbol === 'SPY').status, 'AVAILABLE')
})

test('dashboard retains the JSON store only when PostgreSQL is not configured', async () => {
  let jsonReads = 0
  let postgresFactoryCalls = 0
  const service = createPaperService({
    environment: {},
    createJsonStore: () => ({ read: () => { jsonReads += 1; return { trades: [] } } }),
    createPostgresStore: () => { postgresFactoryCalls += 1; throw new Error('PostgreSQL must not be selected') },
  })

  const snapshot = await service.readSnapshot()

  assert.equal(jsonReads, 1)
  assert.equal(postgresFactoryCalls, 0)
  assert.equal(snapshot.storage, 'LOCAL JSON DEVELOPMENT FALLBACK')
  assert.deepEqual(snapshot.trades, [])
})

test('dashboard does not silently fall back to JSON when the PostgreSQL observer read fails', async () => {
  let jsonFactoryCalls = 0
  const service = createPaperService({
    environment: { DATABASE_URL: 'configured-for-test' },
    createPostgresStore: () => ({ read: async () => { throw new Error('observer storage unavailable') } }),
    createJsonStore: () => { jsonFactoryCalls += 1; return { read: () => ({ trades: [] }) } },
  })

  await assert.rejects(service.readSnapshot(), /observer storage unavailable/)
  assert.equal(jsonFactoryCalls, 0)
})

test('dashboard exposes persisted per-symbol freshness and failures instead of treating an old checkpoint as healthy', async () => {
  for (const dataStatus of ['EMPTY', 'STALE', 'INCOMPLETE', 'FETCH_ERROR', 'TIMEOUT', 'PROCESSING_ERROR']) {
    const observation = { dataStatus, checkedAt: '2026-01-02T17:00:00Z', lastFreshDataAt: '2026-01-02T16:00:00Z', error: 'fixture data unavailable' }
    const state = { ...persistedState, observer: { ...persistedState.observer, status: 'ERROR', cycleOutcome: 'PARTIAL', symbolResults: { SPY: observation } } }
    let writes = 0
    const service = createPaperService({ store: { read: () => state, save: () => { writes += 1 } } })
    const snapshot = await service.readSnapshot()
    const row = snapshot.data.find((item) => item.symbol === 'SPY')
    assert.equal(row.status, dataStatus)
    assert.equal(row.error, observation.error)
    assert.deepEqual(row.observation, observation)
    assert.equal(snapshot.observer.cycleOutcome, 'PARTIAL')
    assert.equal(writes, 0)
  }
})

test('dashboard distinguishes unchanged polling and market closure from failed data checks', async () => {
  for (const dataStatus of ['NO_NEW_DATA', 'MARKET_CLOSED']) {
    const state = { ...persistedState, observer: { ...persistedState.observer, symbolResults: { SPY: { dataStatus } } } }
    const snapshot = await createPaperService({ store: { read: () => state } }).readSnapshot()
    const row = snapshot.data.find((item) => item.symbol === 'SPY')
    assert.equal(row.status, 'AVAILABLE')
    assert.equal(row.dataStatus, dataStatus)
  }
})

test('dashboard snapshot reads do not fetch candles, create trades, or save state', async () => {
  let reads = 0
  let saves = 0
  const service = createPaperService({
    store: {
      read: async () => { reads += 1; return persistedState },
      save: () => { saves += 1 },
    },
  })

  const snapshot = await service.readSnapshot()

  assert.equal(reads, 1)
  assert.equal(saves, 0)
  assert.equal(snapshot.trades.length, 1)
})

test('dashboard assesses overdue persisted progress without claiming another process is active or changing stored health', async () => {
  let current = new Date('2026-09-22T16:20:00Z')
  const state = structuredClone(persistedState)
  Object.assign(state.observer, { cycleActive: true, cycleStartedAt: '2026-09-22T16:15:00Z',
    lastCycleCompletedAt: '2026-09-22T16:14:00Z', nextCycleOverdueAt: current.toISOString(), cycleOutcome: 'NO_NEW_DATA' })
  const before = structuredClone(state)
  const service = createPaperService({ store: { read: () => state }, now: () => current })
  let snapshot = await service.readSnapshot()
  assert.equal(snapshot.observer.cycleHealth.overdue, false)
  assert.equal(snapshot.observer.cycleHealth.active, null)
  assert.equal(snapshot.observer.cycleActive, null)
  assert.equal(snapshot.observer.cycleHealth.source, 'PERSISTED_SNAPSHOT')
  current = new Date(current.getTime() + 1)
  snapshot = await service.readSnapshot()
  assert.equal(snapshot.observer.cycleHealth.overdue, true)
  assert.equal(snapshot.observer.cycleHealth.lastCompletedAt, state.observer.lastCycleCompletedAt)
  assert.deepEqual(state, before)
})

test('legacy and market-closed dashboard snapshots report unknown overdue health instead of false alarms', async () => {
  for (const observer of [persistedState.observer, { ...persistedState.observer, cycleOutcome: 'MARKET_CLOSED', nextCycleOverdueAt: '2026-01-01T00:00:00Z' }]) {
    const snapshot = await createPaperService({ store: { read: () => ({ ...persistedState, observer }) } }).readSnapshot()
    assert.equal(snapshot.observer.cycleHealth.overdue, null)
    assert.equal(snapshot.observer.cycleHealth.active, null)
  }
})

test('dashboard summaries use the configured dynamic universe plus retained trade history', async () => {
  const service = createPaperService({
    store: {
      read: async () => ({
        trades: [{ ...persistedState.trades[0], symbol: 'QQQ' }],
        observer: { activeSymbols: ['AMZN'], processedCandles: { AMZN: '2026-01-02T15:00:00.000Z' } },
      }),
      readObserverSymbols: async () => ({ initialized: true, symbols: ['AMZN'] }),
    },
  })
  const snapshot = await service.readSnapshot()
  assert.deepEqual(Object.keys(snapshot.bySymbol), ['AMZN', 'QQQ'])
  assert.deepEqual(snapshot.symbolUniverse, { initialized: true, symbols: ['AMZN'] })
  assert.equal(snapshot.data.find((item) => item.symbol === 'AMZN').status, 'AVAILABLE')
  assert.equal(snapshot.data.find((item) => item.symbol === 'QQQ').status, 'HISTORICAL — NOT ENABLED')
})


test('dashboard marks a re-added symbol pending despite a historical checkpoint and preserves removed-position summaries', async () => {
  const service = createPaperService({ environment: {}, store: {
    read: async () => ({ trades: [{ ...persistedState.trades[0], symbol: 'OLD', status: 'open', rMultiple: null, pnl: null }], observer: {
      activeSymbols: ['XYZ'], baselinePendingSymbols: ['XYZ'], processedCandles: { XYZ: '2026-01-02T15:00:00Z' },
    } }),
    readObserverSymbols: async () => ({ initialized: true, symbols: ['XYZ', 'NEW'] }),
  } })
  const snapshot = await service.readSnapshot()
  assert.deepEqual(Object.keys(snapshot.bySymbol), ['NEW', 'OLD', 'XYZ'])
  assert.equal(snapshot.data.find(row => row.symbol === 'XYZ').status, 'PENDING BASELINE')
  assert.equal(snapshot.data.find(row => row.symbol === 'NEW').status, 'PENDING BASELINE')
  assert.equal(snapshot.data.find(row => row.symbol === 'OLD').status, 'REMOVED — OPEN POSITION MANAGEMENT ONLY')
})
