import { parseResearchJson, stringifyResearchJson } from '../src/research/researchRunSerialization.js'

function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(stringifyResearchJson(body))
}

async function readJsonBody(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const text = Buffer.concat(chunks).toString('utf8')
  try {
    return parseResearchJson(text)
  } catch {
    const error = new Error('Request body must contain valid JSON')
    error.statusCode = 400
    error.code = 'RESEARCH_INVESTIGATION_INVALID'
    throw error
  }
}

function investigationIdFromPath(pathname) {
  const encodedId = pathname.slice('/api/research-investigations/'.length)
  try {
    return decodeURIComponent(encodedId)
  } catch {
    const error = new Error('Invalid investigationId encoding')
    error.statusCode = 400
    error.code = 'RESEARCH_INVESTIGATION_INVALID'
    throw error
  }
}

function statusFor(error) {
  if (error.statusCode) return error.statusCode
  if (error.code === 'RESEARCH_INVESTIGATION_INVALID') return 400
  if (error.code === 'RESEARCH_INVESTIGATION_NOT_FOUND' || error.code === 'RESEARCH_RUN_NOT_FOUND') return 404
  if (error.code === 'RESEARCH_INVESTIGATION_RUN_EXISTS') return 409
  return 500
}

export function createResearchInvestigationApi({ store = null } = {}) {
  return async function handleResearchInvestigationRequest(request, response, url) {
    if (!store) {
      sendJson(response, 503, { error: 'Research Investigation storage is not configured' })
      return
    }

    try {
      if (url.pathname === '/api/research-investigations' && request.method === 'POST') {
        const investigation = await store.createResearchInvestigation(await readJsonBody(request))
        sendJson(response, 201, investigation)
        return
      }

      if (url.pathname === '/api/research-investigations' && request.method === 'GET') {
        const limit = url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : undefined
        const offset = url.searchParams.has('offset') ? Number(url.searchParams.get('offset')) : undefined
        const investigations = await store.listResearchInvestigations({
          ...(limit !== undefined ? { limit } : {}),
          ...(offset !== undefined ? { offset } : {}),
        })
        sendJson(response, 200, { investigations })
        return
      }

      if (url.pathname.startsWith('/api/research-investigations/')) {
        const suffix = url.pathname.slice('/api/research-investigations/'.length)
        if (request.method === 'POST' && suffix.endsWith('/runs')) {
          const investigationId = investigationIdFromPath(url.pathname.slice(0, -'/runs'.length))
          const body = await readJsonBody(request)
          if (!body || typeof body !== 'object' || Array.isArray(body)) {
            const error = new Error('Request body must be an object containing runId')
            error.code = 'RESEARCH_INVESTIGATION_INVALID'
            throw error
          }
          const investigation = await store.attachResearchRunToInvestigation(investigationId, body.runId)
          sendJson(response, 200, investigation)
          return
        }

        if (request.method === 'GET' && !suffix.includes('/')) {
          const investigationId = investigationIdFromPath(url.pathname)
          const investigation = await store.getResearchInvestigation(investigationId)
          if (!investigation) {
            const error = new Error(`Research investigation not found: ${investigationId}`)
            error.code = 'RESEARCH_INVESTIGATION_NOT_FOUND'
            error.statusCode = 404
            throw error
          }
          sendJson(response, 200, investigation)
          return
        }
      }

      sendJson(response, 405, { error: 'Method not allowed' })
    } catch (error) {
      const status = statusFor(error)
      sendJson(response, status, {
        error: status === 500 ? 'Research Investigation storage failed' : error.message,
        code: error.code ?? null,
      })
    }
  }
}