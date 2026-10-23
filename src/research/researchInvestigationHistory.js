import { apiUrl } from '../config/apiBase.js'
import { parseResearchJson, stringifyResearchJson } from './researchRunSerialization.js'

async function requestJson(path, options) {
  const response = await fetch(apiUrl(path), options)
  const text = await response.text()
  let payload = null
  if (text) {
    try {
      payload = parseResearchJson(text)
    } catch {
      throw new Error('Research Investigation History returned invalid JSON')
    }
  }
  if (!response.ok) {
    const code = typeof payload?.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(payload.code) ? payload.code : null
    const error = new Error(`${payload?.error ?? 'Research Investigation History request failed'} (HTTP ${response.status}${code ? `; code: ${code}` : ''})`)
    error.code = code
    error.status = response.status
    throw error
  }
  return payload
}

export function createResearchInvestigation(input) {
  return requestJson('/api/research-investigations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: stringifyResearchJson(input),
  })
}

export function getResearchInvestigation(investigationId) {
  return requestJson(`/api/research-investigations/${encodeURIComponent(investigationId)}`, { method: 'GET' })
}

export function listResearchInvestigations({ limit, offset } = {}) {
  const params = new URLSearchParams()
  if (limit !== undefined) params.set('limit', String(limit))
  if (offset !== undefined) params.set('offset', String(offset))
  const query = params.toString()
  return requestJson(`/api/research-investigations${query ? `?${query}` : ''}`, { method: 'GET' })
}

export function attachResearchRunToInvestigation(investigationId, runId) {
  return requestJson(`/api/research-investigations/${encodeURIComponent(investigationId)}/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: stringifyResearchJson({ runId }),
  })
}
