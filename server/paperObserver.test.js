import assert from 'node:assert/strict'
import { test } from 'node:test'
import { configFromEnvironment, createPaperObserver } from './paperObserverCore.js'
import { completedHourlyCandles, isRegularSession } from './marketSession.js'
import { preparePaperCandles } from './paperCandlePipeline.js'
import { scanSetups } from '../src/logic/scanner.js'

function candles() {
  const closes = [
    100.0,
    100.25,
    100.2,
    100.15,
    99.95,
    100.0,
    99.9,
    100.15,
    100.1,
    100.3,
    100.2,
    100.05,
    100.3,
    100.2,
    100.15,
    99.95,
    100.15,
    100.0,
    99.85,
    100.1,
    101.0,
    101.0,
    100.5,
    100.5,
    100.5,
    100.5,
    100.5,
    100.5,
    100.5,
    100.5,
  ]

  return closes.map((close, index) => ({
    symbol: 'SPY',
    timeframe: '1h',
    timestamp: new Date(
      Date.UTC(2026, 8, 21, 18 + index),
    ).toISOString(),
    open: index === 20 ? 100.5 : 100,
    high: Math.max(index === 20 ? 101.1 : close + 0.2, 100, close),
    low: Math.min(close - 0.2, 100, close),
    close,
    volume: index === 20 ? 1500 : 1000,
  }))
}

function qualifiedSignalHistory() {
  const rows = []
  let close = 100
  for (let index = 0; index < 42; index += 1) {
    if (index > 0) {
      if (index === 40) close -= 0.1
      else if (index === 41) close += 0.15
      else close += [0.1, -0.08, 0.1, -0.08][(index - 1) % 4]
    }
    const timestamp = new Date(Date.UTC(2026, 0, 1 + index, 15)).toISOString()
    const open = close - 0.01
    rows.push({ timestamp, open, high: close + 0.04, low: open - 0.04, close, volume: index === 41 ? 200 : 100 })
  }
  return rows
}

function store() {
  let state = { trades: [] }
  return { load: () => state, save: (next) => { state = next }, get: () => state }
}

test('only processes completed candles during the regular session', () => {
  const now = new Date('2026-09-22T14:30:00Z')
  assert.equal(isRegularSession(now), true)
  assert.equal(completedHourlyCandles([{ timestamp: '2026-09-22T13:00:00Z' }, { timestamp: '2026-09-22T14:00:00Z' }, { timestamp: '2026-09-22T14:30:00Z' }], now).length, 1)
  assert.equal(isRegularSession(new Date('2026-09-22T21:00:00Z')), false)
  assert.equal(isRegularSession(new Date('2026-09-20T14:30:00Z')), false)
})

test('scheduled processing creates once, persists checkpoint, and skips unchanged candles', async () => {
  const memory = store()
  let calls = 0
  const observer = await createPaperObserver({ store: memory, now: () => new Date('2026-09-22T16:00:00Z'), fetchBars: async () => { calls += 1; return { provider: 'ALPACA HISTORICAL', candles: candles(), candleCount: 30 } } })
  const first = await observer.processOnce()
  const second = await observer.processOnce()
  assert.equal(first.processed, 3)
  assert.equal(second.processed, 0)
  assert.equal(observer.getJournal().trades.length, 0, 'startup history establishes context but does not create old entries')
  assert.equal(Object.keys(memory.get().observer.processedCandles).length, 3)
  assert.equal(calls, 6)
})

test('retains warm-up context locally and fetches only an incremental tail after the first cycle', async () => {
  const starts = []
  const observer = await createPaperObserver({
    store: store(),
    now: () => new Date('2026-09-22T16:00:00Z'),
    fetchBars: async ({ start }) => {
      starts.push(start)
      return { candles: candles() }
    },
    onError: () => {},
  })

  await observer.processOnce()
  const firstProcessedCandle = observer.status().lastProcessedCandle
  await observer.processOnce()

  assert.equal(starts.length, 6)
  assert.notEqual(starts[0], firstProcessedCandle, 'the first cycle requests the full indicator warm-up range')
  assert.equal(starts[3], firstProcessedCandle, 'the next cycle requests from the cached completed candle instead of redownloading the warm-up range')
})

test('does not rewrite durable observer state when no completed candle or status transition changed', async () => {
  let saved = { trades: [] }
  let saves = 0
  const observer = await createPaperObserver({
    store: {
      load: () => saved,
      save: (next) => { saves += 1; saved = structuredClone(next) },
    },
    now: () => new Date('2026-09-22T16:00:00Z'),
    fetchBars: async () => ({ candles: candles() }),
    onError: () => {},
  })

  await observer.processOnce()
  await observer.processOnce()

  assert.equal(saves, 1)
})

test('restart recovers persisted trades and checkpoints without duplicates', async () => {
  const memory = store()
  const options = { store: memory, now: () => new Date('2026-09-22T16:00:00Z'), fetchBars: async () => ({ provider: 'ALPACA HISTORICAL', candles: candles(), candleCount: 30 }) }
  const first = await createPaperObserver(options)
  await first.processOnce()
  const second = await createPaperObserver(options)
  await second.processOnce()
  assert.equal(second.getJournal().trades.length, 0)
})

test('observer applies the shared candle validation contract before processing', async () => {
  const input = [
    { timestamp: '2026-09-22T14:00:00.000Z', open: 100, high: 101, low: 99, close: 100, volume: 100 },
    { timestamp: '2026-09-22T13:00:00.000Z', open: 100, high: 101, low: 99, close: 100, volume: 100 },
    { timestamp: '2026-09-22T14:00:00.000Z', open: 100, high: 101, low: 99, close: 100, volume: 999 },
    { timestamp: '2026-09-22T15:00:00.000Z', open: Number.NaN, high: 101, low: 99, close: 100, volume: 100 },
  ]
  const observer = await createPaperObserver({
    store: store(),
    now: () => new Date('2026-09-22T16:00:00Z'),
    fetchBars: async () => ({ candles: input }),
    onError: () => {},
  })

  const result = await observer.processOnce()
  const quality = result.dataQualityBySymbol.SPY
  assert.equal(quality.outOfOrderCandleCount, 1)
  assert.equal(quality.duplicateCandleCount, 1)
  assert.equal(quality.rejectedCandleCount, 1)
  assert.equal(quality.incompleteCandleCount, 0)
  assert.equal(observer.getJournal().trades.length, 0)
})

test('observer uses only a completed close timestamped after signal detection', async () => {
  const memory = store()
  const history = qualifiedSignalHistory()
  let bars = history
  let current = new Date(Date.parse(history.at(-1).timestamp) + 60 * 60 * 1000)
  let fetchCalls = 0
  const observer = await createPaperObserver({
    store: memory,
    now: () => current,
    environment: { PAPER_SYMBOLS: 'SPY', PAPER_TIMEFRAME: '1Hour' },
    fetchBars: async () => { fetchCalls += 1; return { candles: bars } },
    onError: () => {},
  })

  await observer.processOnce() // Startup history is only a baseline.
  const signalTimestamp = history.at(-1).timestamp
  const candidateTimestamp = new Date(Date.parse(signalTimestamp) + 60 * 60 * 1000).toISOString()
  const candidateOpen = history.at(-1).close + 10
  bars = [...history, { timestamp: candidateTimestamp, open: candidateOpen, high: candidateOpen + 0.1, low: candidateOpen - 0.1, close: candidateOpen + 0.05, volume: 100 }]
  current = new Date(Date.parse(candidateTimestamp) + 60 * 60 * 1000)
  await observer.processOnce()
  assert.equal(observer.getJournal().trades.length, 0, 'the candidate bar closed by the time this process detected the signal')

  const nextTimestamp = new Date(Date.parse(candidateTimestamp) + 60 * 60 * 1000).toISOString()
  const laterClose = 98.75
  bars = [...bars, { timestamp: nextTimestamp, open: candidateOpen - 5, high: candidateOpen + 2, low: laterClose - 1, close: laterClose, volume: 100 }]
  current = new Date(Date.parse(nextTimestamp) + 60 * 60 * 1000)
  const callsBeforeEntry = fetchCalls
  await Promise.all([observer.processOnce(), observer.processOnce()])
  assert.equal(fetchCalls, callsBeforeEntry + 1, 'overlapping cycles share one fetch and one entry evaluation')
  const trade = observer.getJournal().trades[0]
  assert.equal(trade.entryPrice, laterClose)
  assert.equal(trade.entryTimestamp, new Date(Date.parse(nextTimestamp) + 60 * 60 * 1000).toISOString())
  assert.ok(Date.parse(trade.entryTimestamp) > Date.parse(trade.signalDetectedAt))
  assert.equal(trade.observedMarketTimestamp, trade.entryTimestamp)
  assert.equal(trade.fillModelVersion, 'paper-first-post-signal-close-v1')
})

test('observer restart drops a pending entry instead of replaying a stale price', async () => {
  const memory = store()
  const history = qualifiedSignalHistory()
  let bars = history
  let current = new Date(Date.parse(history.at(-1).timestamp) + 60 * 60 * 1000)
  const options = {
    store: memory,
    now: () => current,
    environment: { PAPER_SYMBOLS: 'SPY', PAPER_TIMEFRAME: '1Hour' },
    fetchBars: async () => ({ candles: bars }),
    onError: () => {},
  }
  const first = await createPaperObserver(options)
  await first.processOnce()
  const candidateTimestamp = new Date(Date.parse(history.at(-1).timestamp) + 60 * 60 * 1000).toISOString()
  bars = [...history, { timestamp: candidateTimestamp, open: 100, high: 101, low: 99, close: 100.5, volume: 100 }]
  current = new Date(Date.parse(candidateTimestamp) + 60 * 60 * 1000)
  await first.processOnce()
  assert.equal(first.getJournal().trades.length, 0)

  const nextTimestamp = new Date(Date.parse(candidateTimestamp) + 60 * 60 * 1000).toISOString()
  bars = [...bars, { timestamp: nextTimestamp, open: 100.5, high: 101, low: 100, close: 100.75, volume: 100 }]
  current = new Date(Date.parse(nextTimestamp) + 60 * 60 * 1000)
  const restarted = await createPaperObserver(options)
  await restarted.processOnce()
  assert.equal(restarted.getJournal().trades.length, 0, 'a process restart does not resume an unfilled historical entry opportunity')
})

test('observer continues evaluating a persisted open trade after downtime from its saved candle cursor', async () => {
  const history = candles().slice(0, 22)
  const signalCandle = history[20]
  const lastEvaluated = history[21]
  const gapTimestamp = new Date(Date.parse(lastEvaluated.timestamp) + 60 * 60 * 1000).toISOString()
  const gapCandle = { timestamp: gapTimestamp, open: 99, high: 101.2, low: 98.8, close: 99, volume: 1000 }
  const trade = {
    id: `SPY:${signalCandle.timestamp}`, symbol: 'SPY', status: 'open',
    signalTimestamp: signalCandle.timestamp, entryTimestamp: lastEvaluated.timestamp,
    entryPrice: 100, stopPrice: 99.5, targetPrice: 102, highestPrice: 100,
    holdingTime: 60, holdingBars: 1, lastEvaluatedCandleTimestamp: lastEvaluated.timestamp,
  }
  let persisted = {
    trades: [trade],
    observer: { processedCandles: { SPY: lastEvaluated.timestamp, QQQ: lastEvaluated.timestamp, IWM: lastEvaluated.timestamp } },
  }
  const memory = { load: () => persisted, save: (next) => { persisted = structuredClone(next) } }
  const observer = await createPaperObserver({
    store: memory,
    now: () => new Date(Date.parse(gapTimestamp) + 60 * 60 * 1000),
    fetchBars: async () => ({ candles: [...history, gapCandle] }),
    onError: () => {},
  })

  await observer.processOnce()
  const resumed = observer.getJournal().trades[0]
  assert.equal(resumed.status, 'closed')
  assert.equal(resumed.exitReason, 'Stop')
  assert.equal(resumed.exitPrice, 99)
  assert.equal(resumed.exitTimestamp, gapTimestamp)
})

function truncatedRecoveryState() {
  return {
    trades: [{
      id: 'recovery-fixture', symbol: 'SPY', status: 'open',
      signalTimestamp: '2026-07-01T14:00:00Z', entryTimestamp: '2026-07-01T16:00:00Z',
      entryPrice: 100, stopPrice: 100.6 * 0.997, targetPrice: 101,
      highestPrice: 100.6, trailingStopActive: true, holdingBars: 3, holdingTime: 180,
      lastEvaluatedCandleTimestamp: '2026-09-22T14:00:00Z',
    }],
    observer: { activeSymbols: ['SPY'], processedCandles: { SPY: '2026-09-22T15:00:00Z' } },
  }
}

test('observer recovers a truncated-history removed position behind its symbol checkpoint, filters incomplete bars, and resumes after restart', async () => {
  let persisted = truncatedRecoveryState()
  let current = new Date('2026-09-22T16:30:00Z')
  let bars = [
    { timestamp: '2026-09-22T14:00:00Z', open: 100, high: 110, low: 90, close: 100, volume: 100 },
    { timestamp: '2026-09-22T15:00:00Z', open: 100.7, high: 100.9, low: 100.6, close: 100.8, volume: 100 },
    { timestamp: '2026-09-22T16:00:00Z', open: 90, high: 91, low: 89, close: 90, volume: 100 },
  ]
  const options = {
    store: { load: () => structuredClone(persisted), save: (state) => { persisted = structuredClone(state) } },
    environment: {}, symbolUniverse: { getSymbols: async () => [] }, now: () => current,
    fetchBars: async () => ({ candles: bars }), onError: () => {},
  }
  const observer = await createPaperObserver(options)
  assert.equal((await observer.processOnce()).status, 'RUNNING')
  assert.equal(persisted.trades.length, 1)
  assert.equal(persisted.trades[0].status, 'open', 'the incomplete candle and already evaluated bar cannot close the position')
  assert.equal(persisted.trades[0].holdingBars, 4)
  assert.equal(persisted.trades[0].highestPrice, 100.9)
  assert.equal(persisted.trades[0].stopPrice, 100.9 * 0.997)
  assert.equal(persisted.trades[0].lastEvaluatedCandleTimestamp, bars[1].timestamp)
  const recovered = structuredClone(persisted.trades)
  assert.equal((await observer.processOnce()).processed, 0)
  assert.deepEqual(persisted.trades, recovered)
  current = new Date('2026-09-22T17:05:00Z')
  bars = [{ timestamp: '2026-09-22T16:00:00Z', open: 100.4, high: 100.8, low: 100.3, close: 100.6, volume: 100 }]
  const restarted = await createPaperObserver(options)
  assert.equal((await restarted.processOnce()).status, 'RUNNING')
  assert.equal(persisted.trades.length, 1, 'recovery does not create a replacement entry')
  assert.equal(persisted.trades[0].exitReason, 'Trailing Stop')
  assert.equal(persisted.trades[0].exitPrice, 100.4)
  assert.equal(persisted.trades[0].holdingBars, 5)
  assert.equal(persisted.trades[0].holdingTime, 300)
})

test('observer explicitly reports invalid truncated-history recovery without advancing its position or checkpoint', async () => {
  for (const field of ['highestPrice', 'lastEvaluatedCandleTimestamp']) {
    let persisted = truncatedRecoveryState()
    delete persisted.trades[0][field]
    const before = structuredClone(persisted)
    const errors = []
    const observer = await createPaperObserver({
      store: { load: () => structuredClone(persisted), save: (state) => { persisted = structuredClone(state) } },
      environment: {}, symbolUniverse: { getSymbols: async () => ['SPY'] },
      now: () => new Date('2026-09-22T17:00:00Z'),
      fetchBars: async () => ({ candles: [{ timestamp: '2026-09-22T16:00:00Z', open: 100.7, high: 100.9, low: 100.6, close: 100.8, volume: 100 }] }),
      onError: (error) => errors.push(error),
    })
    const result = await observer.processOnce()
    assert.equal(result.status, 'ERROR')
    assert.match(result.currentError, /persisted recovery state is missing or inconsistent/)
    assert.equal(errors[0].code, 'PAPER_TRADE_RECOVERY_INVALID')
    assert.deepEqual(persisted.trades, before.trades)
    assert.deepEqual(persisted.observer.processedCandles, before.observer.processedCandles)
  }
})

test('records an error and recovers on the next successful cycle', async () => {
  const memory = store()
  let fail = true
  const observer = await createPaperObserver({ store: memory, now: () => new Date('2026-09-22T16:00:00Z'), fetchBars: async () => { if (fail) throw new Error('temporary Alpaca failure'); return { provider: 'ALPACA HISTORICAL', candles: candles(), candleCount: 30 } }, onError: () => {} })
  const failed = await observer.processOnce()
  assert.equal(failed.status, 'ERROR')
  fail = false
  const recovered = await observer.processOnce()
  assert.equal(recovered.status, 'RUNNING')
  assert.equal(observer.getJournal().trades.length, 0)
})

test('polling reports a failed cycle and schedules the next cycle after the retry interval', async () => {
  let persisted = { trades: [] }
  let saveCalls = 0
  const memory = {
    load: () => persisted,
    save: async (next) => {
      saveCalls += 1
      if (saveCalls === 1) throw new Error('temporary persistence failure')
      persisted = next
    },
  }
  const scheduled = []
  const errors = []
  let fail = true
  const observer = await createPaperObserver({
    store: memory,
    now: () => new Date('2026-09-22T16:00:00Z'),
    fetchBars: async () => { if (fail) throw new Error('transient fetch failure'); return { candles: candles() } },
    onError: (error) => errors.push(error),
    schedule: (callback, delay) => { scheduled.push({ callback, delay }); return scheduled.length },
    cancelSchedule: () => {},
    environment: { PAPER_POLL_INTERVAL_MS: '1' },
  })

  observer.start()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(observer.status().status, 'ERROR')
  assert.equal(errors.length, 1)
  assert.match(errors[0].message, /transient fetch failure/)
  assert.match(errors[0].message, /temporary persistence failure/)
  assert.equal(scheduled.length, 1)
  assert.ok(scheduled[0].delay >= 1000)

  fail = false
  const retry = scheduled.shift()
  retry.callback()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(observer.status().status, 'RUNNING')
  assert.equal(scheduled.length, 1)
  observer.stop()
})

test('repeated observer failures use bounded exponential retry delays', async () => {
  const scheduled = []
  const observer = await createPaperObserver({
    store: store(),
    now: () => new Date('2026-09-22T16:00:00Z'),
    fetchBars: async () => { throw new Error('temporary connection failure') },
    onError: () => {},
    schedule: (callback, delay) => { scheduled.push({ callback, delay }); return scheduled.length },
    cancelSchedule: () => {},
    environment: { PAPER_POLL_INTERVAL_MS: '1000', PAPER_RETRY_MAX_MS: '2500' },
  })

  observer.start()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(scheduled[0].delay, 1000)
  assert.equal(observer.status().consecutiveFailures, 1)

  scheduled.shift().callback()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(scheduled[0].delay, 2000)
  assert.equal(observer.status().consecutiveFailures, 2)

  scheduled.shift().callback()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(scheduled[0].delay, 2500)
  assert.equal(observer.status().consecutiveFailures, 3)
  observer.stop()
})

test('observer resumes after a temporary persistence failure while reporting it', async () => {
  let saveCalls = 0
  let state = { trades: [] }
  const errors = []
  const memory = {
    load: () => state,
    save: async (next) => {
      saveCalls += 1
      if (saveCalls === 1) throw new Error('temporary storage failure')
      state = next
    },
  }
  const observer = await createPaperObserver({
    store: memory,
    now: () => new Date('2026-09-22T16:00:00Z'),
    fetchBars: async () => ({ candles: candles() }),
    onError: (error) => errors.push(error),
  })

  const failed = await observer.processOnce()
  assert.equal(failed.status, 'ERROR')
  assert.match(errors[0].message, /temporary storage failure/)
  const recovered = await observer.processOnce()
  assert.equal(recovered.status, 'RUNNING')
  assert.ok(saveCalls >= 3)
})

test('overlapping calls share one cycle, repeated failures retry at a bounded cadence, and stop prevents polling', async () => {
  const scheduled = []
  let fetchCalls = 0
  let releaseFirstFetch
  const firstFetch = new Promise((resolve) => { releaseFirstFetch = resolve })
  const observer = await createPaperObserver({
    store: store(),
    now: () => new Date('2026-09-22T16:00:00Z'),
    fetchBars: async () => {
      fetchCalls += 1
      if (fetchCalls === 1) { await firstFetch; throw new Error('repeated failure') }
      throw new Error('repeated failure')
    },
    onError: () => {},
    schedule: (callback, delay) => { scheduled.push({ callback, delay }); return scheduled.length },
    cancelSchedule: () => {},
    environment: { PAPER_POLL_INTERVAL_MS: '0' },
  })
  observer.start()
  const overlappingOne = observer.processOnce()
  const overlappingTwo = observer.processOnce()
  assert.equal(overlappingOne, overlappingTwo)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(fetchCalls, 1)
  releaseFirstFetch()
  await new Promise((resolve) => setImmediate(resolve))
  await overlappingOne
  assert.equal(scheduled.length, 1)
  assert.ok(scheduled[0].delay >= 1000)

  const retry = scheduled.shift()
  retry.callback()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(scheduled.length, 1)
  const pending = scheduled[0]
  observer.stop()
  assert.equal(scheduled.length, 1)
  pending.callback()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(scheduled.length, 1, 'the fake queue retains the cancelled callback')
  assert.equal(fetchCalls, 2, 'a cancelled callback does not begin another cycle')
})

test('observer establishes a fresh baseline for a newly enabled symbol and reads the universe every cycle', async () => {
  let symbols = []
  const calls = []
  const observer = await createPaperObserver({
    store: store(),
    symbolUniverse: { getSymbols: async () => symbols },
    now: () => new Date('2026-09-22T16:00:00Z'),
    fetchBars: async ({ symbol }) => { calls.push(symbol); return { candles: qualifiedSignalHistory() } },
    onError: () => {},
  })
  await observer.processOnce()
  assert.deepEqual(calls, [])
  symbols = ['AMZN']
  await observer.processOnce()
  assert.deepEqual(calls, ['AMZN'])
  assert.equal(observer.getJournal().trades.length, 0, 'a newly enabled symbol only establishes its baseline')
  assert.deepEqual(observer.status().activeSymbols, ['AMZN'])
})

test('a removed symbol manages an existing open position but cannot create a new entry', async () => {
  const history = candles().slice(0, 22)
  const signal = history[20]
  const entry = history[21]
  const openTrade = {
    id: `SPY:${signal.timestamp}`, symbol: 'SPY', status: 'open', signalTimestamp: signal.timestamp,
    entryTimestamp: entry.timestamp, entryPrice: 100, stopPrice: 99.5, targetPrice: 102,
    highestPrice: 100, trailingStopActive: false, holdingTime: 0, holdingBars: 0,
    lastEvaluatedCandleTimestamp: entry.timestamp,
  }
  const stopCandleTimestamp = new Date(Date.parse(entry.timestamp) + 60 * 60 * 1000).toISOString()
  const calls = []
  const observer = await createPaperObserver({
    store: { load: () => ({ trades: [openTrade], observer: { activeSymbols: ['SPY'], processedCandles: { SPY: entry.timestamp } } }), save: () => {} },
    symbolUniverse: { getSymbols: async () => [] },
    now: () => new Date('2026-09-22T17:30:00Z'),
    fetchBars: async ({ symbol }) => { calls.push(symbol); return { candles: [...history, { timestamp: stopCandleTimestamp, open: 99, high: 100, low: 98, close: 99, volume: 1000 }] } },
    onError: () => {},
  })
  await observer.processOnce()
  assert.deepEqual(calls, ['SPY'])
  assert.deepEqual(observer.status().activeSymbols, [])
  assert.equal(observer.getJournal().trades.length, 1)
  assert.equal(observer.getJournal().trades[0].exitReason, 'Stop')
})


test('re-added symbols retain their baseline requirement through market closure, failure and restart', async () => {
  const history = qualifiedSignalHistory()
  const last = history.at(-1)
  const next = { ...last, timestamp: new Date(Date.parse(last.timestamp) + 3600000).toISOString(), open: last.close + 10, high: last.close + 10.2, low: last.close + 9.9, close: last.close + 10.1, volume: 100 }
  const later = { ...next, timestamp: new Date(Date.parse(next.timestamp) + 3600000).toISOString() }
  let persisted = { trades: [], observer: { activeSymbols: [], processedCandles: { XYZ: last.timestamp } } }
  let current = new Date(Date.parse(last.timestamp) - 2 * 3600000) // Before the regular-session open.
  let fail = false
  let bars = [...history, next]
  const options = {
    store: { load: () => structuredClone(persisted), save: (state) => { persisted = structuredClone(state) } },
    symbolUniverse: { getSymbols: async () => ['XYZ'] }, environment: {}, now: () => current,
    fetchBars: async () => { if (fail) throw Error('provider unavailable'); return { candles: bars } }, onError: () => {},
  }
  const first = await createPaperObserver(options)
  assert.equal((await first.processOnce()).skipped, 'MARKET_CLOSED')
  assert.deepEqual(persisted.observer.baselinePendingSymbols, ['XYZ'])
  current = new Date(Date.parse(next.timestamp) + 3600000)
  fail = true
  assert.equal((await first.processOnce()).status, 'ERROR')
  assert.deepEqual(persisted.observer.baselinePendingSymbols, ['XYZ'])
  fail = false
  const restarted = await createPaperObserver(options)
  await restarted.processOnce()
  assert.deepEqual(persisted.observer.baselinePendingSymbols, [])
  assert.equal(persisted.observer.processedCandles.XYZ, next.timestamp)
  bars = [...bars, later]
  current = new Date(Date.parse(later.timestamp) + 3600000)
  await restarted.processOnce()
  assert.equal(restarted.getJournal().trades.length, 0, 'the pre-baseline qualified signal cannot become a deferred historical entry')
  assert.deepEqual(Object.keys(restarted.getJournal().bySymbol), ['XYZ'])
})

test('empty, invalid or incomplete provider data cannot complete a new symbol baseline or open a trade', async () => {
  const memory = store()
  let bars = []
  const observer = await createPaperObserver({
    store: memory, symbolUniverse: { getSymbols: async () => ['XYZ'] }, environment: {},
    now: () => new Date('2026-09-22T16:30:00Z'), fetchBars: async () => ({ candles: bars }), onError: () => {},
  })
  for (const input of [[], [{ timestamp: '2026-09-22T15:00:00Z', open: NaN, high: 101, low: 99, close: 100, volume: 100 }], [{ timestamp: '2026-09-22T16:00:00Z', open: 100, high: 101, low: 99, close: 100, volume: 100 }]]) {
    bars = input
    await observer.processOnce()
    assert.deepEqual(observer.status().baselinePendingSymbols, ['XYZ'])
    assert.equal(observer.status().processedCandles.XYZ, undefined)
    assert.equal(observer.getJournal().trades.length, 0)
  }
})

test('restart manages a removed symbol with persisted trailing stop and cursor without reseeding entries', async () => {
  const history = candles().slice(0, 22)
  const last = history.at(-1)
  const next = { ...last, timestamp: new Date(Date.parse(last.timestamp) + 3600000).toISOString(), open: 100.2, high: 100.4, low: 100.1, close: 100.2 }
  let persisted = { trades: [{
    id: 'fixture', symbol: 'XYZ', status: 'open', signalTimestamp: history[20].timestamp,
    entryTimestamp: last.timestamp, entryPrice: 100, stopPrice: 100.3, targetPrice: 102,
    trailingStopActive: true, highestPrice: 100.6, holdingBars: 1, holdingTime: 60,
    lastEvaluatedCandleTimestamp: last.timestamp,
  }], observer: { activeSymbols: ['XYZ'], processedCandles: { XYZ: last.timestamp } } }
  const options = {
    store: { load: () => structuredClone(persisted), save: (state) => { persisted = structuredClone(state) }, ensureObserverSymbols: async () => [] },
    environment: { PAPER_SYMBOLS: 'malformed/seed' }, now: () => new Date(Date.parse(next.timestamp) + 3600000),
    fetchBars: async () => ({ candles: [...history, next] }), onError: () => {},
  }
  await (await createPaperObserver(options)).processOnce()
  assert.equal(persisted.trades.length, 1)
  assert.equal(persisted.trades[0].exitReason, 'Trailing Stop')
  assert.equal(persisted.trades[0].exitPrice, 100.2)
  assert.equal(persisted.trades[0].trailingStopActive, true)
  assert.equal(persisted.trades[0].highestPrice, 100.6)
  const closed = structuredClone(persisted.trades)
  await (await createPaperObserver(options)).processOnce()
  assert.deepEqual(persisted.trades, closed)
})

test('a dynamically added symbol uses MAIN qualification and only a future post-detection close for entry', async () => {
  let symbols = []
  let bars = qualifiedSignalHistory()
  const last = bars.at(-1)
  let current = new Date(Date.parse(last.timestamp) + 3600000)
  const memory = store()
  const observer = await createPaperObserver({
    store: memory, symbolUniverse: { getSymbols: async () => symbols }, environment: {},
    now: () => current, fetchBars: async () => ({ candles: bars }), onError: () => {},
  })
  const evaluated = scanSetups(preparePaperCandles(bars, '1Hour', current).candles)
  assert.equal(evaluated.find(signal => signal.timestamp === last.timestamp).qualifiedSetup, true, 'fixture must qualify under the unchanged MAIN scanner')
  await observer.processOnce()
  symbols = ['XYZ']
  await observer.processOnce()
  assert.equal(observer.getJournal().trades.length, 0)
  for (let index = 1; index <= 2; index += 1) {
    const timestamp = new Date(Date.parse(last.timestamp) + index * 3600000).toISOString()
    bars = [...bars, { timestamp, open: 110, high: 111, low: 109, close: 110.25, volume: 100 }]
    current = new Date(Date.parse(timestamp) + 3600000)
    await observer.processOnce()
    assert.equal(observer.getJournal().trades.length, index === 1 ? 0 : 1)
  }
  const trade = observer.getJournal().trades[0]
  assert.equal(trade.symbol, 'XYZ')
  assert.equal(trade.entryPrice, 110.25)
  assert.ok(Date.parse(trade.entryTimestamp) > Date.parse(trade.signalDetectedAt))
  assert.deepEqual(Object.keys(observer.getJournal().bySymbol), ['XYZ'])
})

test('removal at a cycle boundary cancels a pending observer entry before re-addition', async () => {
  let symbols = ['XYZ']
  let bars = qualifiedSignalHistory()
  const last = bars.at(-1)
  let current = new Date(Date.parse(last.timestamp) + 3600000)
  const observer = await createPaperObserver({
    store: store(), symbolUniverse: { getSymbols: async () => symbols }, environment: {},
    now: () => current, fetchBars: async () => ({ candles: bars }), onError: () => {},
  })
  await observer.processOnce()
  const nextTimestamp = new Date(Date.parse(last.timestamp) + 3600000).toISOString()
  bars = [...bars, { timestamp: nextTimestamp, open: 110, high: 111, low: 109, close: 110, volume: 100 }]
  current = new Date(Date.parse(nextTimestamp) + 3600000)
  await observer.processOnce()
  symbols = []
  assert.equal((await observer.processOnce()).processed, 0, 'removal applies without another candle')
  assert.deepEqual(observer.status().activeSymbols, [])
  symbols = ['XYZ']
  const laterTimestamp = new Date(Date.parse(nextTimestamp) + 3600000).toISOString()
  bars = [...bars, { ...bars.at(-1), timestamp: laterTimestamp }]
  current = new Date(Date.parse(laterTimestamp) + 3600000)
  await observer.processOnce()
  assert.equal(observer.getJournal().trades.length, 0)
  assert.deepEqual(observer.status().baselinePendingSymbols, [])
})
