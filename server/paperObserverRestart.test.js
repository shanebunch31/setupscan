import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { createPaperStore } from './paperStore.js'

const execute = promisify(execFile)
// Every call runs a new OS process with explicit local storage and synthetic
// data. It never imports the live CLI, loads .env, opens HTTP or uses PostgreSQL.
const child = `
  import { createPaperObserver } from ${JSON.stringify(new URL('./paperObserverCore.js', import.meta.url).href)};
  import { createPaperStore } from ${JSON.stringify(new URL('./paperStore.js', import.meta.url).href)};
  import { projectPaperOperationalStatus } from ${JSON.stringify(new URL('./paperObserverStatus.js', import.meta.url).href)};
  const options = JSON.parse(process.argv[1]);
  const store = createPaperStore(options.filePath);
  let fetches = 0;
  let observer;
  try {
    observer = await createPaperObserver({store, environment: { PAPER_SYMBOLS: 'invalid/seed', PAPER_SYMBOL_CAP: '10' },
      now: () => new Date(options.now), schedule: () => 1, cancelSchedule() {}, onError() {},
      fetchBars: async () => { fetches++; if(options.fail) throw Error('synthetic fetch failure'); return {candles: options.bars ?? []}; }
    });
    const beforeCycle = observer.status();
    observer.start();
    await observer.processOnce();
    const status = observer.status();
    const journal = {...observer.getJournal(), observer: store.read().observer, symbolUniverse: store.readObserverSymbols()};
    const operational = projectPaperOperationalStatus(journal, {available: true, verified: true, observer: status}, new Date(options.now));
    await observer.stop();
    process.stdout.write(JSON.stringify({pid: process.pid, beforeCycle, status, operational, fetches, journal}));
  } catch(error) {
    await observer?.stop();
    process.stdout.write(JSON.stringify({pid: process.pid, startupFailure: true, code: error.code ?? null, name: error.name, fetches}));
  }
`
async function restart(filePath, options) {
  const { stdout, stderr } = await execute(process.execPath, ['--input-type=module', '-e', child, JSON.stringify({ filePath, ...options })], { timeout: 15000 })
  assert.equal(stderr, '')
  return JSON.parse(stdout)
}
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'setupscan-process-restart-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const filePath = path.join(directory, 'paper-trades.json')
  return { filePath, store: createPaperStore(filePath) }
}
const bar = (timestamp, prices = {}) => ({ timestamp, symbol: 'SPY', timeframe: '1Hour', open: 100.2, high: 100.8, low: 100.1, close: 100.6, volume: 100, ...prices })

test('real process restarts retain removed open positions and empty universe through closure/fetch failure, then exit once from saved trailing state', async (t) => {
  const { filePath, store } = fixture(t)
  const open = { id: 'persisted-open', symbol: 'SPY', status: 'open', signalTimestamp: '2026-07-01T14:00:00Z', entryTimestamp: '2026-07-01T16:00:00Z',
    entryPrice: 100, stopPrice: 100.6 * .997, targetPrice: 101, highestPrice: 100.6, trailingStopActive: true, holdingBars: 3, holdingTime: 180,
    lastEvaluatedCandleTimestamp: '2026-09-18T18:00:00Z' }
  const history = { id: 'historical', symbol: 'QQQ', status: 'closed', signalTimestamp: '2026-07-01T15:00:00Z', exitTimestamp: '2026-07-01T18:00:00Z', rMultiple: 1, pnl: 100, holdingTime: 60 }
  const initial = { trades: [open, history], observer: { status: 'RUNNING', activeSymbols: ['SPY'], processedCandles: { SPY: open.lastEvaluatedCandleTimestamp } } }
  store.save(initial)
  store.setObserverSymbols([])
  const universe = fs.readFileSync(filePath + '.symbols.json')
  const closed = await restart(filePath, { now: '2026-09-20T17:00:00Z' })
  assert.equal(closed.status.cycleOutcome, 'MARKET_CLOSED')
  assert.equal(closed.fetches, 0)
  assert.equal(closed.beforeCycle.runtimeCycleCompleted, false)
  assert.deepEqual(store.load().trades, initial.trades)
  const failed = await restart(filePath, { now: '2026-09-21T16:30:00Z', fail: true })
  assert.equal(failed.operational.state, 'PROVIDER_FAILED')
  assert.equal(failed.operational.healthy, false)
  assert.deepEqual(store.load().trades, initial.trades)
  assert.deepEqual(store.load().observer.processedCandles, initial.observer.processedCandles)
  const options = { now: '2026-09-22T16:30:00Z', bars: [bar('2026-09-22T15:00:00Z')] }
  const resumed = await restart(filePath, options)
  assert.equal(resumed.status.status, 'RUNNING')
  const recovered = store.load()
  assert.equal(recovered.trades.length, 2)
  assert.equal(recovered.trades[0].id, open.id)
  assert.equal(recovered.trades[0].exitReason, 'Trailing Stop')
  assert.equal(recovered.trades[0].exitPrice, 100.2)
  assert.equal(recovered.trades[0].holdingBars, 4)
  assert.equal(recovered.trades[0].highestPrice, open.highestPrice)
  assert.deepEqual(recovered.trades[1], history)
  const repeated = await restart(filePath, options)
  assert.deepEqual(store.load().trades, recovered.trades)
  assert.deepEqual(repeated.status.activeSymbols, [])
  assert.deepEqual(store.readObserverSymbols(), { initialized: true, symbols: [] })
  assert.deepEqual(fs.readFileSync(filePath + '.symbols.json'), universe)
})

test('pending baselines and existing checkpoints survive real restarts with closed/failed data; only a usable bar completes the baseline', async (t) => {
  const { filePath, store } = fixture(t)
  store.save({ trades: [], observer: { status: 'RUNNING', activeSymbols: ['SPY'], baselinePendingSymbols: ['SPY'], processedCandles: { SPY: '2026-09-18T18:00:00Z' } } })
  store.setObserverSymbols(['SPY'])
  const checkpoint = store.load().observer.processedCandles
  for (const options of [{ now: '2026-09-20T17:00:00Z' }, { now: '2026-09-21T16:30:00Z', fail: true }]) {
    const result = await restart(filePath, options)
    assert.equal(result.operational.healthy, false)
    assert.deepEqual(result.operational.baselinePendingSymbols, ['SPY'])
    assert.deepEqual(store.load().observer.processedCandles, checkpoint)
    assert.deepEqual(store.load().trades, [])
    assert.equal(result.operational.state, options.fail ? 'PROVIDER_FAILED' : 'BASELINE_PENDING')
  }
  const result = await restart(filePath, { now: '2026-09-22T16:30:00Z', bars: [bar('2026-09-22T15:00:00Z')] })
  assert.deepEqual(result.operational.baselinePendingSymbols, [])
  assert.equal(result.operational.healthy, true)
  assert.equal(store.load().observer.processedCandles.SPY, '2026-09-22T15:00:00Z')
  assert.deepEqual(store.load().trades, [], 'baseline completion never replays an entry')
})

test('missing journal follows explicit development first-use behavior; corrupt journals cannot start a recovered observer', async (t) => {
  const { filePath, store } = fixture(t)
  store.setObserverSymbols([])
  const empty = await restart(filePath, { now: '2026-09-20T17:00:00Z' })
  assert.equal(empty.startupFailure, undefined)
  assert.deepEqual(store.load().trades, [])
  assert.deepEqual(store.readObserverSymbols(), { initialized: true, symbols: [] })
  for (const bytes of ['{"trades":[', '{"observer":{}}']) {
    fs.writeFileSync(filePath, bytes)
    const result = await restart(filePath, { now: '2026-09-22T16:30:00Z' })
    assert.equal(result.startupFailure, true)
    assert.equal(result.fetches, 0)
    assert.equal(result.status, undefined)
    assert.equal(fs.readFileSync(filePath, 'utf8'), bytes)
  }
})
