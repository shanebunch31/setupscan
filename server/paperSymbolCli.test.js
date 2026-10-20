import assert from 'node:assert/strict'
import test from 'node:test'
import { paperSymbolErrorMessage, runPaperSymbolCommand } from './paperSymbolCli.js'

const environment = { DATABASE_URL: 'configured', PAPER_SYMBOLS: 'SPY,QQQ' }
const describeDatabase = () => ({ host: 'restore.local', port: '55432', database: 'setupscan_restore_test' })

test('operator CLI lists without mutating and refuses unconfirmed mutations', async () => {
  let calls = 0
  const store = { readObserverSymbols: async () => { calls += 1; return { initialized: true, symbols: ['SPY'] } }, close: async () => {} }
  const listed = await runPaperSymbolCommand({ args: ['list'], environment, createStore: () => store, describeDatabase })
  assert.deepEqual(listed, { target: 'restore.local:55432/setupscan_restore_test', operation: 'list', initialized: true, symbols: ['SPY'] })
  assert.equal(calls, 1)
  await assert.rejects(runPaperSymbolCommand({ args: ['add', 'AMZN'], environment, createStore: () => store, describeDatabase }), { code: 'TARGET_CONFIRMATION_REQUIRED' })
})

test('operator CLI forwards normalized seed settings only after target confirmation', async () => {
  let received
  const store = { addObserverSymbol: async (symbol, options) => { received = { symbol, options: { ...options, seedSymbols: options.seedSymbols() } }; return ['AMZN', 'QQQ', 'SPY'] }, close: async () => {} }
  const result = await runPaperSymbolCommand({ args: ['add', 'amzn', '--confirm-target', 'restore.local:55432/setupscan_restore_test'], environment, createStore: () => store, describeDatabase })
  assert.equal(result.operation, 'add')
  assert.deepEqual(received, { symbol: 'AMZN', options: { seedSymbols: ['SPY', 'QQQ'], cap: 10 } })
})

test('operator CLI remove requires the exact target and normalizes the symbol before opening the store', async () => {
  let received
  let storeCreated = 0
  const store = {
    removeObserverSymbol: async (symbol, options) => { received = { symbol, options: { ...options, seedSymbols: options.seedSymbols() } }; return ['QQQ'] },
    close: async () => {},
  }
  const createStore = () => { storeCreated += 1; return store }

  await assert.rejects(
    runPaperSymbolCommand({ args: ['remove', ' spy ', '--confirm-target', 'wrong-target'], environment, createStore, describeDatabase }),
    { code: 'TARGET_CONFIRMATION_REQUIRED' },
  )
  assert.equal(storeCreated, 0)

  const result = await runPaperSymbolCommand({
    args: ['remove', ' spy ', '--confirm-target', 'restore.local:55432/setupscan_restore_test'],
    environment,
    createStore,
    describeDatabase,
  })
  assert.equal(result.operation, 'remove')
  assert.deepEqual(result.symbols, ['QQQ'])
  assert.deepEqual(received, { symbol: 'SPY', options: { seedSymbols: ['SPY', 'QQQ'], cap: 10 } })
})

test('operator CLI surfaces storage failures and closes the store without falling back', async () => {
  let closed = false
  const store = {
    readObserverSymbols: async () => { throw new Error('database unavailable') },
    close: async () => { closed = true },
  }

  await assert.rejects(
    runPaperSymbolCommand({ args: ['list'], environment, createStore: () => store, describeDatabase }),
    /database unavailable/,
  )
  assert.equal(closed, true)
})

test('operator CLI refuses absent configuration and malformed symbols before opening a store', async () => {
  const createStore = () => { assert.fail('must not open a database connection') }
  await assert.rejects(runPaperSymbolCommand({ args: ['list'], environment: {}, createStore, describeDatabase }), { code: 'DATABASE_URL_REQUIRED' })
  await assert.rejects(runPaperSymbolCommand({ args: ['add', 'bad/symbol'], environment, createStore, describeDatabase }), { code: 'INVALID_PAPER_SYMBOL' })
})

test('operator CLI output never includes raw driver errors or credential-bearing URLs', () => {
  const secret = 'synthetic-private-token'
  for (const code of [undefined, 'ECONNREFUSED', 'INVALID_PAPER_SYMBOL', 'TARGET_CONFIRMATION_REQUIRED']) {
    const output = paperSymbolErrorMessage({ code, message: `postgres://user:${secret}@example.invalid/db` })
    assert.doesNotMatch(output, /synthetic-private-token|postgres:|example\.invalid/)
  }
})
