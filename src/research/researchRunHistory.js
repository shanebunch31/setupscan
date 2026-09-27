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
      const contentType = response.headers?.get?.('content-type') ?? ''
      const mediaType = contentType.split(';', 1)[0].trim().toLowerCase()
      const isJson = mediaType === 'application/json' || mediaType.endsWith('+json')
      const description = isJson ? 'malformed JSON' : 'a non-JSON response'
      const status = Number.isInteger(response.status) ? `HTTP ${response.status}` : 'an unknown HTTP status'
      const mediaTypeLabel = mediaType ? `; Content-Type ${mediaType}` : ''
      throw new Error(`Research Run History returned ${description} (${status}${mediaTypeLabel})`)
    }
  }
  if (!response.ok) {
    const status = Number.isInteger(response.status) ? ` (HTTP ${response.status})` : ''
    throw new Error(payload?.error ?? `Research Run History request failed${status}`)
  }
  return payload
}

export function saveResearchRun(runResult) {
  const dataset = runResult.dataset
  const datasetMetadata = dataset
    ? {
      ...dataset,
      fetchResultsBySymbol: Object.fromEntries(Object.entries(dataset.fetchResultsBySymbol ?? {}).map(([symbol, fetchResult]) => {
        const { candles: _candles, ...metadata } = fetchResult ?? {}
        return [symbol, metadata]
      })),
      rawSeriesBySymbol: undefined,
    }
    : null
  const persistenceInput = {
    ...runResult,
    dataset: datasetMetadata,
    experimentResults: runResult.experimentResults.map(({ nativeOutput: _nativeOutput, ...execution }) => execution),
  }
  return requestJson('/api/research-runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: stringifyResearchJson(persistenceInput),
  })
}

export function getResearchRun(runId) {
  return requestJson(`/api/research-runs/${encodeURIComponent(runId)}`, { method: 'GET' })
}

export function compareResearchRuns(runIdA, runIdB) {
  const params = new URLSearchParams({ runIdA, runIdB })
  return requestJson(`/api/research-runs/compare?${params}`, { method: 'GET' })
}

export function listResearchRuns(filters = {}) {
  const params = new URLSearchParams()
  if (filters.limit !== undefined) params.set('limit', String(filters.limit))
  if (filters.offset !== undefined) params.set('offset', String(filters.offset))
  if (filters.datasetId) params.set('datasetId', filters.datasetId)
  if (filters.experimentId) params.set('experimentId', filters.experimentId)
  if (filters.status) params.set('status', filters.status)
  for (const symbol of filters.symbols ?? []) params.append('symbols', symbol)
  const query = params.toString()
  return requestJson(`/api/research-runs${query ? `?${query}` : ''}`, { method: 'GET' })
}