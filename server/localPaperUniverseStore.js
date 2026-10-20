import fs from 'node:fs'
import path from 'node:path'
import { assertPaperSymbolCap, normalizePaperSymbol, normalizePaperSymbols, resolvePaperSymbolCap } from './paperSymbols.js'

// Separate sidecar: universe operations never read or rewrite the trade journal.
// Synchronous read/modify/rename is serialized within the single local observer process.
// Concurrent operator processes must use PostgreSQL instead.
export function createLocalPaperUniverseStore(filePath) {
  function readObserverSymbols() {
    let state
    try { state = JSON.parse(fs.readFileSync(filePath, 'utf8')) } catch (error) {
      if (error.code === 'ENOENT') return { initialized: false, symbols: [] }
      throw error
    }
    if (state?.initialized !== true || !Array.isArray(state.symbols)) {
      throw new Error('Invalid local observer universe; refusing to replace it with defaults.')
    }
    return { initialized: true, symbols: normalizePaperSymbols(state.symbols).sort() }
  }
  function write(symbols) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    const temporaryPath = filePath + '.tmp'
    fs.writeFileSync(temporaryPath, JSON.stringify({ initialized: true, symbols }, null, 2), { flag: 'wx' })
    fs.renameSync(temporaryPath, filePath)
    return symbols
  }
  function seed(seedSymbols, cap) {
    const value = typeof seedSymbols === 'function' ? seedSymbols() : seedSymbols
    return assertPaperSymbolCap(normalizePaperSymbols(value), resolvePaperSymbolCap(cap)).sort()
  }
  function ensureObserverSymbols(seedSymbols, cap) {
    const current = readObserverSymbols()
    return current.initialized ? current.symbols : write(seed(seedSymbols, cap))
  }
  function setObserverSymbols(symbols, { cap } = {}) {
    const normalized = seed(symbols, cap)
    // Surface corrupt existing state instead of silently overwriting it.
    readObserverSymbols()
    return write(normalized)
  }
  function addObserverSymbol(symbol, { seedSymbols = [], cap } = {}) {
    const normalized = normalizePaperSymbol(symbol)
    const current = readObserverSymbols()
    const symbols = current.initialized ? current.symbols : seed(seedSymbols, cap)
    const next = [...new Set([...symbols, normalized])].sort()
    assertPaperSymbolCap(next, resolvePaperSymbolCap(cap))
    return current.initialized && symbols.includes(normalized) ? symbols : write(next)
  }
  function removeObserverSymbol(symbol, { seedSymbols = [], cap } = {}) {
    const normalized = normalizePaperSymbol(symbol)
    const current = readObserverSymbols()
    const symbols = current.initialized ? current.symbols : seed(seedSymbols, cap)
    return write(symbols.filter((item) => item !== normalized))
  }
  return { readObserverSymbols, ensureObserverSymbols, setObserverSymbols, addObserverSymbol, removeObserverSymbol }
}
