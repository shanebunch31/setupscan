import { summarizeShadow } from '../src/research/shadowForward.js'
import { stringifyResearchJson } from '../src/research/researchRunSerialization.js'

export function createShadowForwardRoute({ store, trackingId, now = () => new Date() } = {}) {
  return async (request, response) => {
    const send = (status, body) => { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(stringifyResearchJson(body)) }
    if (request.method !== 'GET') { response.setHeader('Allow', 'GET'); send(405, { error: 'Read-only endpoint' }); return }
    if (!store || !trackingId) { send(503, { error: 'Shadow reporting is not enabled. No tracker was started.' }); return }
    try {
      const { raw: _raw, ...snapshot } = await store.read(trackingId)
      const last = snapshot.checkpoint.lastSuccessfulCycle
      send(200, { ...snapshot, summaries: summarizeShadow(snapshot.tracking, snapshot.occurrences),
        freshness: !last ? 'No successful cycle' : now().getTime() - Date.parse(last) > 180_000 ? 'Stale snapshot — worker activity unverified' : 'Recent successful snapshot — not a live worker health check' })
    } catch { send(503, { error: 'Shadow evidence unavailable. Storage was not initialized or changed by this request.' }) }
  }
}
