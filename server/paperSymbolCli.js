import { configuredSeedSymbols, normalizePaperSymbol, resolvePaperSymbolCap } from './paperSymbols.js'

export function paperSymbolUsage() {
  return 'Usage: node scripts/manage-paper-symbols.js list | add SYMBOL --confirm-target host:port/database | remove SYMBOL --confirm-target host:port/database'
}

export function paperSymbolErrorMessage(error) {
  const safeMessages = {
    INVALID_OPERATOR_COMMAND: paperSymbolUsage(),
    DATABASE_URL_REQUIRED: 'DATABASE_URL is required; configure it privately on the operator machine.',
    TARGET_CONFIRMATION_REQUIRED: 'Target confirmation is missing or incorrect. Use list to inspect the target, then confirm the exact host:port/database.',
    INVALID_PAPER_SYMBOL: 'Invalid symbol. Use 1–15 letters, digits, dots, or hyphens, beginning with a letter.',
    PAPER_SYMBOL_CAP_EXCEEDED: 'The requested universe exceeds PAPER_SYMBOL_CAP; no changes were committed.',
  }
  // Database/URL errors can include connection details. Never print raw errors.
  return safeMessages[error?.code] ?? 'Paper-symbol operation failed. Verify the private connection configuration and database access; no successful update is confirmed.'
}

export async function runPaperSymbolCommand({ args, environment, createStore, describeDatabase }) {
  const [operation, requestedSymbol, ...rest] = args
  const confirmationIndex = rest.indexOf('--confirm-target')
  const confirmation = confirmationIndex >= 0 ? rest[confirmationIndex + 1] : null
  if (!['list', 'add', 'remove'].includes(operation) || ((operation === 'add' || operation === 'remove') && !requestedSymbol)) {
    const error = new Error(paperSymbolUsage())
    error.code = 'INVALID_OPERATOR_COMMAND'
    throw error
  }
  if (!environment.DATABASE_URL) {
    const error = new Error('DATABASE_URL is required. This operator tool never uses a browser-held credential.')
    error.code = 'DATABASE_URL_REQUIRED'
    throw error
  }
  const symbol = operation === 'add' || operation === 'remove'
    ? normalizePaperSymbol(requestedSymbol)
    : null
  const identity = describeDatabase(environment.DATABASE_URL)
  const target = `${identity.host}:${identity.port}/${identity.database}`
  if (operation !== 'list' && confirmation !== target) {
    const error = new Error(`Refusing to change ${target}. Re-run with --confirm-target ${target} after verifying it is the intended non-production target.`)
    error.code = 'TARGET_CONFIRMATION_REQUIRED'
    throw error
  }
  const store = createStore()
  try {
    const options = { seedSymbols: () => configuredSeedSymbols(environment), cap: resolvePaperSymbolCap(environment.PAPER_SYMBOL_CAP) }
    const result = operation === 'list'
      ? await store.readObserverSymbols()
      : operation === 'add'
        ? { initialized: true, symbols: await store.addObserverSymbol(symbol, options) }
        : { initialized: true, symbols: await store.removeObserverSymbol(symbol, options) }
    return { target, operation, initialized: result.initialized, symbols: result.symbols }
  } finally {
    await store.close?.()
  }
}
