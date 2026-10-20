export const DEFAULT_PAPER_SYMBOLS = Object.freeze(['SPY', 'QQQ', 'IWM'])
export const DEFAULT_PAPER_SYMBOL_CAP = 10
const MAX_PAPER_SYMBOL_CAP = 100
const SYMBOL_PATTERN = /^[A-Z][A-Z0-9.-]{0,14}$/

function symbolError(message, code = 'INVALID_PAPER_SYMBOL') {
  const error = new Error(message)
  error.code = code
  return error
}

export function normalizePaperSymbol(value) {
  if (typeof value !== 'string') throw symbolError('Paper symbols must be text.')
  const symbol = value.trim().toUpperCase()
  if (!SYMBOL_PATTERN.test(symbol)) {
    throw symbolError(`Unsupported paper symbol "${value}". Use 1–15 letters, digits, dots, or hyphens, beginning with a letter.`)
  }
  return symbol
}

export function normalizePaperSymbols(values = []) {
  if (!Array.isArray(values) && typeof values !== 'string') throw symbolError('Paper symbols must be a list or comma-separated text.')
  const source = Array.isArray(values) ? values : values.split(',')
  const seen = new Set()
  const symbols = []
  for (const value of source) {
    const symbol = normalizePaperSymbol(value)
    if (!seen.has(symbol)) {
      seen.add(symbol)
      symbols.push(symbol)
    }
  }
  return symbols
}

export function configuredSeedSymbols(environment = process.env) {
  // An absent seed uses legacy defaults; an explicitly empty string is malformed.
  const requested = Object.prototype.hasOwnProperty.call(environment, 'PAPER_SYMBOLS')
    ? environment.PAPER_SYMBOLS
    : DEFAULT_PAPER_SYMBOLS
  return normalizePaperSymbols(requested)
}

export function resolvePaperSymbolCap(value = process.env.PAPER_SYMBOL_CAP) {
  if (value === undefined || value === null || value === '') return DEFAULT_PAPER_SYMBOL_CAP
  const cap = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN
  if (!Number.isInteger(cap) || cap < 1 || cap > MAX_PAPER_SYMBOL_CAP) {
    return DEFAULT_PAPER_SYMBOL_CAP
  }
  return cap
}

export function assertPaperSymbolCap(symbols, cap) {
  if (symbols.length > cap) {
    throw symbolError(`The paper observer symbol cap is ${cap}; requested ${symbols.length} symbols.`, 'PAPER_SYMBOL_CAP_EXCEEDED')
  }
  return symbols
}