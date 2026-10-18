import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createPaperService } from './paperService.js'

function candle(timestamp, { high = 101, low = 99.5, close = 100 } = {}) {
  return { timestamp, open: 100, high, low, close, volume: 1000 }
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

test('dashboard paper refresh does not use an incomplete hourly candle to close a trade', async () => {
  const signalTimestamp = '2026-09-25T14:00:00.000Z'
  const initialTrade = {
    id: `SPY:${signalTimestamp}`,
    symbol: 'SPY',
    status: 'open',
    signalTimestamp,
    entryPrice: 100,
    stopPrice: 99,
    targetPrice: 102,
  }
  let savedState
  const store = {
    load: () => ({ trades: [initialTrade] }),
    save: (state) => { savedState = state },
  }
  const service = createPaperService({
    store,
    now: () => new Date('2026-09-25T15:30:00.000Z'),
    fetchBars: async ({ symbol }) => ({
      provider: 'TEST',
      candleCount: 2,
      candles: [
        candle(signalTimestamp),
        candle('2026-09-25T15:00:00.000Z', { low: 98 }),
      ],
    }),
  })

  await service.refresh()

  assert.equal(savedState.trades.find((trade) => trade.id === initialTrade.id).status, 'open')
})

test('paper service waits for a post-detection completed close and skips duplicate entries', async () => {
  let savedState = { trades: [] }
  let current = new Date('2026-02-11T16:00:00.000Z')
  const history = qualifiedSignalHistory()
  let bars = history
  const service = createPaperService({
    store: { load: () => savedState, save: (next) => { savedState = structuredClone(next) } },
    now: () => current,
    fetchBars: async () => ({ provider: 'TEST', candleCount: bars.length, candles: bars }),
  })

  const first = await service.refresh()

  assert.equal(first.trades.length, 0)
  assert.match(first.data[0].entryPolicy, /first refresh establishes a baseline/)
  const entryTimestamp = new Date(Date.parse(history.at(-1).timestamp) + 60 * 60 * 1000).toISOString()
  const firstCandidateOpen = history.at(-1).close + 10
  bars = [...history, { timestamp: entryTimestamp, open: firstCandidateOpen, high: firstCandidateOpen + 0.04, low: firstCandidateOpen - 0.04, close: firstCandidateOpen + 0.01, volume: 100 }]
  current = new Date(Date.parse(entryTimestamp) + 60 * 60 * 1000)
  const second = await service.refresh()
  assert.equal(second.trades.length, 0, 'the newly fetched bar closed before its signal was detected')
  const postDetectionTimestamp = new Date(Date.parse(entryTimestamp) + 60 * 60 * 1000).toISOString()
  const postDetectionClose = 99.25
  bars = [...bars, { timestamp: postDetectionTimestamp, open: firstCandidateOpen - 5, high: firstCandidateOpen + 2, low: postDetectionClose - 0.5, close: postDetectionClose, volume: 100 }]
  current = new Date(Date.parse(postDetectionTimestamp) + 60 * 60 * 1000)
  const third = await service.refresh()
  const fourth = await service.refresh()

  assert.equal(third.trades.length, 3)
  assert.equal(fourth.trades.length, 3, 'reprocessing the same completed candle cannot duplicate entries')
  assert.equal(third.trades[0].entryPrice, postDetectionClose)
  assert.equal(third.trades[0].entryTimestamp, new Date(Date.parse(postDetectionTimestamp) + 60 * 60 * 1000).toISOString())
  assert.equal(third.trades[0].fillModelVersion, 'paper-first-post-signal-close-v1')
  assert.equal(third.trades[0].status, 'open')
})

test('paper service validates, deduplicates, sorts, and excludes incomplete bars before enrichment', async () => {
  const input = [
    candle('2026-09-25T13:00:00.000Z'),
    candle('2026-09-25T12:00:00.000Z'),
    { ...candle('2026-09-25T13:00:00.000Z'), volume: 9999 },
    { ...candle('2026-09-25T14:00:00.000Z'), open: Number.NaN },
    { ...candle('2026-09-25T14:15:00.000Z'), high: 98, low: 99 },
    { ...candle('2026-09-25T14:30:00.000Z'), timestamp: undefined },
    { ...candle('2026-09-25T14:45:00.000Z'), volume: undefined },
    candle('2026-09-25T15:00:00.000Z'),
  ]
  let savedState = { trades: [] }
  const service = createPaperService({
    store: { load: () => savedState, save: (next) => { savedState = structuredClone(next) } },
    now: () => new Date('2026-09-25T15:30:00.000Z'),
    fetchBars: async () => ({ provider: 'TEST', candleCount: input.length, candles: input }),
  })

  const result = await service.refresh()
  const quality = result.data[0].dataQuality
  assert.equal(quality.outOfOrderCandleCount, 1)
  assert.equal(quality.duplicateCandleCount, 1)
  assert.equal(quality.rejectedCandleCount, 4)
  assert.equal(quality.incompleteCandleCount, 1)
  assert.equal(quality.acceptedCandleCount, 3)
  assert.equal(savedState.trades.length, 0)
  assert.equal(result.data[0].status, 'AVAILABLE')
})

test('paper service skips entry opportunities missed during downtime', async () => {
  let state = { trades: [] }
  const signalHistory = qualifiedSignalHistory()
  let current = new Date(Date.parse(signalHistory.at(-1).timestamp) + 60 * 60 * 1000)
  let allBars = signalHistory
  const service = createPaperService({
    store: { load: () => state, save: (next) => { state = structuredClone(next) } },
    now: () => current,
    fetchBars: async () => ({ candles: allBars }),
  })
  await service.refresh() // Initialize the cursor at the qualified historical signal.

  const firstMissedTimestamp = new Date(current.getTime()).toISOString()
  const secondMissedTimestamp = new Date(current.getTime() + 60 * 60 * 1000).toISOString()
  const price = signalHistory.at(-1).close
  const missedBars = [firstMissedTimestamp, secondMissedTimestamp].map((timestamp) => ({
    timestamp, open: price, high: price + 0.04, low: price - 0.04, close: price + 0.01, volume: 100,
  }))
  allBars = [...signalHistory, ...missedBars]
  current = new Date(Date.parse(secondMissedTimestamp) + 60 * 60 * 1000)

  const result = await service.refresh()
  assert.equal(result.trades.length, 0)
})
