import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createPaperService } from './paperService.js'

function candle(timestamp, { high = 101, low = 99.5, close = 100 } = {}) {
  return { timestamp, open: 100, high, low, close, volume: 1000 }
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
