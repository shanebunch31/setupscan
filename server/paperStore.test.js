import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { createPaperStore } from './paperStore.js'
import { createPaperObserver } from './paperObserverCore.js'

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'setupscan-journal-recovery-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const filePath = path.join(directory, 'paper-trades.json')
  return { filePath, store: createPaperStore(filePath) }
}

test('missing local journal reads as a fresh development journal without creating files', (t) => {
  const { filePath, store } = fixture(t)
  assert.deepEqual(store.load(), { trades: [] })
  assert.deepEqual(store.read(), { trades: [] })
  assert.equal(fs.existsSync(filePath), false)
  assert.equal(fs.existsSync(filePath + '.symbols.json'), false)
})

test('restart recovers local positions, trailing state, history, checkpoints and empty universe without fetching or duplicate entries', async (t) => {
  const { filePath, store } = fixture(t)
  const trades = [
    { id: 'open', symbol: 'SPY', status: 'open', signalTimestamp: '2026-10-30T14:00:00.000Z', entryPrice: 100, stopPrice: 100.5, highestPrice: 102, trailingStopActive: true, holdingBars: 2, lastEvaluatedCandleTimestamp: '2026-10-30T16:00:00.000Z' },
    { id: 'closed', symbol: 'QQQ', status: 'closed', signalTimestamp: '2026-10-29T14:00:00.000Z', rMultiple: 2, pnl: 200 },
  ]
  const checkpoint = { SPY: '2026-10-30T16:00:00.000Z' }
  store.save({ trades, observer: { activeSymbols: ['SPY'], processedCandles: checkpoint, baselinePendingSymbols: ['SPY'] } })
  store.setObserverSymbols([])
  const universeBytes = fs.readFileSync(filePath + '.symbols.json')
  for (let restart = 0; restart < 2; restart++) {
    const restarted = createPaperStore(filePath)
    const observer = await createPaperObserver({
      store: restarted, environment: { PAPER_SYMBOLS: 'IWM' }, now: () => new Date('2026-11-01T17:00:00.000Z'),
      fetchBars: async () => { assert.fail('closed-market recovery must not fetch candles') }, onError: (error) => { throw error },
    })
    await observer.processOnce()
    assert.deepEqual(restarted.load().trades, trades)
    assert.deepEqual(restarted.load().observer.processedCandles, checkpoint)
    assert.deepEqual(restarted.readObserverSymbols(), { initialized: true, symbols: [] })
    assert.deepEqual(restarted.load().observer.activeSymbols, [])
    assert.deepEqual(fs.readFileSync(filePath + '.symbols.json'), universeBytes)
  }
})

test('partial unrenamed journal is ignored; committed state remains authoritative after restart', (t) => {
  const { filePath, store } = fixture(t)
  const state = { trades: [{ id: 'retained', symbol: 'SPY', status: 'closed' }], observer: { processedCandles: { SPY: '2026-10-30T16:00:00Z' } } }
  store.save(state)
  const bytes = fs.readFileSync(filePath)
  fs.writeFileSync(filePath + '.tmp', '{"trades":[')
  assert.deepEqual(createPaperStore(filePath).load(), state)
  assert.deepEqual(fs.readFileSync(filePath), bytes)
  // A later successful write can replace an abandoned journal temp file.
  store.save(state)
  assert.deepEqual(createPaperStore(filePath).load(), state)
  assert.equal(fs.existsSync(filePath + '.tmp'), false)
})

test('malformed and structurally invalid local journals fail closed and retain their bytes', (t) => {
  const { filePath, store } = fixture(t)
  for (const bytes of ['{"trades":[', 'null', '[]', '{}', '{"trades":null}', '{"trades":{}}']) {
    fs.writeFileSync(filePath, bytes)
    assert.throws(() => store.load(), bytes.startsWith('{"trades":[') ? SyntaxError : { code: 'PAPER_STATE_INVALID' })
    assert.equal(fs.readFileSync(filePath, 'utf8'), bytes)
  }
  assert.throws(() => store.save({ observer: {} }), { code: 'PAPER_STATE_INVALID' })
  assert.equal(fs.readFileSync(filePath, 'utf8'), '{"trades":{}}')
})
