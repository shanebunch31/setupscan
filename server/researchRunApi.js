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
    throw error
  }
}

function listFilters(searchParams) {
  const symbols = searchParams.getAll('symbols').flatMap((value) => value.split(',')).map((value) => value.trim()).filter(Boolean)
  const limit = searchParams.has('limit') ? Number(searchParams.get('limit')) : undefined
  const offset = searchParams.has('offset') ? Number(searchParams.get('offset')) : undefined
  return {
    ...(limit !== undefined ? { limit } : {}),
    ...(offset !== undefined ? { offset } : {}),
    ...(symbols.length ? { symbols } : {}),
    ...(searchParams.has('datasetId') ? { datasetId: searchParams.get('datasetId') } : {}),
    ...(searchParams.has('experimentId') ? { experimentId: searchParams.get('experimentId') } : {}),
    ...(searchParams.has('status') ? { status: searchParams.get('status') } : {}),
  }
}

/** A small HTTP boundary isolated from the paper observer routes and store. */
export function createResearchRunApi({ store = null } = {}) {
  return async function handleResearchRunRequest(request, response, url) {
    if (!store) {
      sendJson(response, 503, { error: 'Research Run History storage is not configured' })
      return
    }

    try {
      if (url.pathname === '/api/research-runs' && request.method === 'POST') {
        const runResult = await readJsonBody(request)
        const saved = await store.saveResearchRun(runResult)
        sendJson(response, 201, saved)
        return
      }

      if (url.pathname === '/api/research-runs' && request.method === 'GET') {
        const runs = await store.listResearchRuns(listFilters(url.searchParams))
        sendJson(response, 200, { runs })
        return
      }

      if (url.pathname.startsWith('/api/research-runs/') && request.method === 'GET') {
        let runId
        try {
          runId = decodeURIComponent(url.pathname.slice('/api/research-runs/'.length))
        } catch {
          sendJson(response, 400, { error: 'Invalid runId encoding' })
          return
        }
        const runResult = await store.getResearchRun(runId)
        if (!runResult) {
          sendJson(response, 404, { error: `Research run not found: ${runId}` })
          return
        }
        sendJson(response, 200, runResult)
        return
      }

      sendJson(response, 405, { error: 'Method not allowed' })
    } catch (error) {
      const status = error.statusCode
        ?? (error.code === 'RESEARCH_RUN_EXISTS' ? 409 : error.code === 'RESEARCH_RUN_INVALID' ? 400 : 500)
      sendJson(response, status, {
        error: status === 500 ? 'Research Run History storage failed' : error.message,
        code: error.code ?? null,
      })
    }
  }
}