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
