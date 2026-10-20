import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { createPaperStore } from './paperStore.js'
import { configuredSeedSymbols } from './paperSymbols.js'
import { createPaperService } from './paperService.js'

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'setupscan-universe-'))
  const journalPath = path.join(directory, 'paper-trades.json')
  return { journalPath, store: createPaperStore(journalPath) }
}

test('local universe read creates nothing; first seed survives restart independently of journal history', () => {
  const { journalPath, store } = fixture()
  const journal = JSON.stringify({ trades: [{ symbol: 'XYZ', status: 'closed', pnl: 12 }], observer: { activeSymbols: ['XYZ'] } })
  fs.writeFileSync(journalPath, journal)
  assert.deepEqual(store.readObserverSymbols(), { initialized: false, symbols: [] })
  assert.equal(fs.existsSync(journalPath + '.symbols.json'), false)
  assert.deepEqual(store.ensureObserverSymbols(() => configuredSeedSymbols({ PAPER_SYMBOLS: ' qqq, spy, QQQ ' })), ['QQQ', 'SPY'])
  const restarted = createPaperStore(journalPath)
  assert.deepEqual(restarted.ensureObserverSymbols(() => { throw Error('seed must not be read again') }), ['QQQ', 'SPY'])
  assert.equal(fs.readFileSync(journalPath, 'utf8'), journal)
  assert.deepEqual(restarted.read(), JSON.parse(journal))
})

test('local defaults seed only once and initialized empty remains empty across restart', () => {
  const { journalPath, store } = fixture()
  assert.deepEqual(store.ensureObserverSymbols(() => configuredSeedSymbols({})), ['IWM', 'QQQ', 'SPY'])
  assert.deepEqual(store.setObserverSymbols([]), [])
  const restarted = createPaperStore(journalPath)
  assert.deepEqual(restarted.readObserverSymbols(), { initialized: true, symbols: [] })
  assert.deepEqual(restarted.ensureObserverSymbols(['SPY']), [])
  assert.equal(fs.existsSync(journalPath), false, 'universe operations do not create a trade journal')
})

test('local set/add/remove validate and reject over-cap requests atomically', () => {
  const { journalPath, store } = fixture()
  assert.throws(() => store.addObserverSymbol('QQQ', { seedSymbols: ['SPY'], cap: 1 }), { code: 'PAPER_SYMBOL_CAP_EXCEEDED' })
  assert.deepEqual(store.readObserverSymbols(), { initialized: false, symbols: [] })
  assert.equal(fs.existsSync(journalPath + '.symbols.json'), false)
  assert.deepEqual(store.setObserverSymbols([' xyz ', 'XYZ', 'ABC'], { cap: 2 }), ['ABC', 'XYZ'])
  const before = fs.readFileSync(journalPath + '.symbols.json', 'utf8')
  assert.throws(() => store.addObserverSymbol('DEF', { cap: 2 }), { code: 'PAPER_SYMBOL_CAP_EXCEEDED' })
  assert.throws(() => store.setObserverSymbols(['ABC', '']), { code: 'INVALID_PAPER_SYMBOL' })
  assert.equal(fs.readFileSync(journalPath + '.symbols.json', 'utf8'), before)
  assert.deepEqual(store.removeObserverSymbol(' abc '), ['XYZ'])
  assert.deepEqual(store.removeObserverSymbol('xyz'), [])
  assert.deepEqual(store.addObserverSymbol(' brk.b '), ['BRK.B'])
})

test('local corrupt state is reported without reseeding or touching its bytes', () => {
  const { journalPath, store } = fixture()
  fs.writeFileSync(journalPath + '.symbols.json', '{broken')
  assert.throws(() => store.ensureObserverSymbols(['SPY']), SyntaxError)
  assert.throws(() => store.setObserverSymbols([]), SyntaxError)
  assert.equal(fs.readFileSync(journalPath + '.symbols.json', 'utf8'), '{broken')
})

test('real JSON adapter serves a read-only dashboard with an authoritative empty universe', async () => {
  const { journalPath, store } = fixture()
  store.setObserverSymbols([])
  const before = fs.readFileSync(journalPath + '.symbols.json', 'utf8')
  const service = createPaperService({ environment: { PAPER_SYMBOLS: 'SPY' }, createJsonStore: () => store })
  const snapshot = await service.readSnapshot()
  assert.deepEqual(snapshot.symbolUniverse, { initialized: true, symbols: [] })
  assert.deepEqual(snapshot.bySymbol, {})
  assert.equal(fs.existsSync(journalPath), false)
  assert.equal(fs.readFileSync(journalPath + '.symbols.json', 'utf8'), before)
})

test('local failed atomic write leaves the committed universe and journal untouched', () => {
  const { journalPath, store } = fixture()
  store.setObserverSymbols(['XYZ'])
  fs.writeFileSync(journalPath + '.symbols.json.tmp', 'interrupted write')
  assert.throws(() => store.setObserverSymbols([]), { code: 'EEXIST' })
  assert.deepEqual(store.readObserverSymbols(), { initialized: true, symbols: ['XYZ'] })
  assert.equal(fs.existsSync(journalPath), false)
})


test('browser source does not reference paper server authorization secrets or universe mutation APIs', () => {
  const root = new URL('../src/', import.meta.url)
  const files = fs.readdirSync(root, { recursive: true }).filter(name => /\.(js|jsx|ts|tsx)$/.test(name) && !name.includes('.test.'))
  for (const file of files) {
    const source = fs.readFileSync(new URL(file.replaceAll('\\', '/'), root), 'utf8')
    assert.doesNotMatch(source, /PAPER_ORDER_API_SECRET|PAPER_TRADING_API_SECRET|setObserverSymbols|addObserverSymbol|removeObserverSymbol/, file)
  }
})
