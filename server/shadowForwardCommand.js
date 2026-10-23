import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { shadowCandidate } from '../src/research/shadowForward.js'
import { createShadowStore, validateShadowConnection } from './shadowForwardStore.js'
export { validateShadowConnection } from './shadowForwardStore.js'
import { createShadowObserver } from './shadowForwardObserver.js'
import { fetchAlpacaHistoricalBars } from './alpacaProxy.js'

const root = fileURLToPath(new URL('../', import.meta.url))
// Hash the complete local static dependency graph. Future helper edits cannot silently
// change the meaning of an active tracker, even if someone forgets a version bump.
export async function shadowSourceFingerprint() {
  const sources = new Map()
  async function visit(relative) {
    if (sources.has(relative)) return
    const text = await readFile(path.join(root, relative), 'utf8')
    sources.set(relative, text.replace(/\r\n/g, '\n'))
    for (const match of text.matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g)) {
      await visit(path.posix.normalize(path.posix.join(path.posix.dirname(relative), match[1])))
    }
  }
  for (const entry of ['src/research/shadowForward.js', 'server/shadowForwardObserver.js', 'server/alpacaProxy.js']) await visit(entry)
  return createHash('sha256').update(JSON.stringify([...sources].sort(([a], [b]) => a.localeCompare(b)))).digest('hex')
}
export function shadowConfiguration(environment, now, sourceFingerprint) {
  const symbols = [...new Set(String(environment.SHADOW_SYMBOLS ?? '').split(',').map((s) => s.trim().toUpperCase()))].sort()
  if (!symbols.length || symbols.length > 10 || symbols.some((s) => !/^[A-Z][A-Z0-9.-]{0,14}$/.test(s))) throw new Error('SHADOW_SYMBOLS requires 1–10 valid symbols')
  const started = Date.parse(environment.SHADOW_START_AT)
  const history = Date.parse(environment.SHADOW_HISTORY_START)
  if (!Number.isFinite(started) || started < now.getTime() || !Number.isFinite(history) || history >= started) throw new Error('Choose a future tracking start and an explicit earlier context-history start')
  if (!/^[a-z0-9-]{1,80}$/.test(environment.SHADOW_TRACKING_ID ?? '')) throw new Error('SHADOW_TRACKING_ID requires a stable lowercase identifier')
  return { id: environment.SHADOW_TRACKING_ID, candidate: shadowCandidate, symbols, startedAt: new Date(started).toISOString(), frozenAt: now.toISOString(),
    historyStart: new Date(history).toISOString(), sourceFingerprint, provider: 'ALPACA HISTORICAL', adjustmentMode: 'split',
    contextHistoryPolicy: 'Fixed start, shared timestamps, expanding causal history; never rolling warm-up',
  }
}
export async function runShadowCommand(args, { environment = process.env, now = () => new Date(), fingerprint = shadowSourceFingerprint, storeFactory = createShadowStore, fetchBars = fetchAlpacaHistoricalBars, log = console.log } = {}) {
  if (args.length !== 1 || !['init', 'run'].includes(args[0])) throw new Error('Usage: node --env-file=.env scripts/shadow-forward.js init|run')
  validateShadowConnection(environment.SHADOW_DATABASE_URL)
  const sourceFingerprint = await fingerprint()
  const definition = args[0] === 'init' ? shadowConfiguration(environment, now(), sourceFingerprint) : null
  if (args[0] === 'init' && environment.SHADOW_CONFIRM_INITIALIZE !== 'create-separate-shadow-tables') throw new Error('Explicit schema-creation confirmation required')
  if (!/^[a-z0-9-]{1,80}$/.test(environment.SHADOW_TRACKING_ID ?? '')) throw new Error('SHADOW_TRACKING_ID required')
  const store = storeFactory({ connectionString: environment.SHADOW_DATABASE_URL })
  try {
    if (definition) {
      await store.initialize(definition)
      log('Shadow definition frozen. No observations collected; worker has not started.')
      await store.close()
      return null
    }
    const snapshot = await store.read(environment.SHADOW_TRACKING_ID)
    if (snapshot.tracking.sourceFingerprint !== sourceFingerprint) throw new Error('Frozen source differs; review before starting')
    // Existing provider helper returns only after exhausting all pages or throwing.
    const boundedFetch = async (request) => ({ ...await fetchBars({ ...request, signal: AbortSignal.timeout(120_000) }), paginationComplete: true })
    const observer = createShadowObserver({ store, trackingId: snapshot.tracking.id, sourceFingerprint, fetchBars: boundedFetch, now, onStatus: (s) => log(`Shadow observer: ${s.status}${s.consecutiveFailures ? `; failures=${s.consecutiveFailures}` : ''}`) })
    observer.start()
    return { close: async () => { await observer.stop(); await store.close() } }
  } catch (error) { await store.close(); throw error }
}
