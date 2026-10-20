import assert from 'node:assert/strict'
import test from 'node:test'
import { assertPaperSymbolCap, configuredSeedSymbols, normalizePaperSymbol, normalizePaperSymbols, resolvePaperSymbolCap } from './paperSymbols.js'

test('normalizes paper symbols, removes duplicates, and rejects malformed values', () => {
  assert.deepEqual(normalizePaperSymbols([' spy ', 'QQQ', 'spy', 'BRK.B']), ['SPY', 'QQQ', 'BRK.B'])
  assert.equal(normalizePaperSymbol(' iwM '), 'IWM')
  assert.throws(() => normalizePaperSymbol('SPY/QQQ'), { code: 'INVALID_PAPER_SYMBOL' })
  assert.throws(() => normalizePaperSymbol('SPY/QQQ'), { code: 'INVALID_PAPER_SYMBOL' })
})

test('uses legacy defaults only when PAPER_SYMBOLS is absent and enforces a safe cap', () => {
  assert.deepEqual(configuredSeedSymbols({}), ['SPY', 'QQQ', 'IWM'])
  assert.throws(() => configuredSeedSymbols({ PAPER_SYMBOLS: '' }), { code: 'INVALID_PAPER_SYMBOL' })
  assert.equal(resolvePaperSymbolCap(undefined), 10)
  assert.equal(resolvePaperSymbolCap('3'), 3)
  assert.equal(resolvePaperSymbolCap('0'), 10)
  assert.throws(() => assertPaperSymbolCap(['SPY', 'QQQ'], 1), { code: 'PAPER_SYMBOL_CAP_EXCEEDED' })
})

test('rejects explicit empty entries without confusing them with an intentional empty universe', () => {
  for (const values of ['SPY,,QQQ', '', ' ', ['SPY', ''], [' ', 'QQQ'], null, 123]) {
    assert.throws(() => normalizePaperSymbols(values), { code: 'INVALID_PAPER_SYMBOL' })
  }
  assert.deepEqual(normalizePaperSymbols([]), [])
  assert.deepEqual(configuredSeedSymbols({ PAPER_SYMBOLS: ' spy , qqq, SPY ' }), ['SPY', 'QQQ'])
})

test('invalid cap defaults to 10 while a valid restrictive cap stays restrictive', () => {
  for (const value of [undefined, null, '', 'bad', 0, -1, 0.5, Infinity, 101, true]) {
    assert.equal(resolvePaperSymbolCap(value), 10)
  }
  for (const value of [1, '1', ' 2 ', 10, 100]) {
    assert.equal(resolvePaperSymbolCap(value), Number(value))
  }
  const symbols = Array.from({ length: 11 }, (_, i) => 'S' + i)
  assert.throws(() => assertPaperSymbolCap(symbols, resolvePaperSymbolCap('bad')), { code: 'PAPER_SYMBOL_CAP_EXCEEDED' })
  assert.equal(symbols.length, 11, 'rejection must not truncate the requested list')
})
