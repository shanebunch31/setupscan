import { runResearch } from './runResearch.js'

function errorPayload(error) {
  if (error instanceof Error) return { name: error.name, message: error.message }
  return { name: 'NonErrorThrown', message: String(error) }
}

self.onmessage = async ({ data }) => {
  if (data?.type !== 'run') {
    self.postMessage({ type: 'error', error: { name: 'ResearchWorkerProtocolError', message: 'Unsupported Research Worker message.' } })
    return
  }

  try {
    const result = await runResearch(data.request)
    self.postMessage({ type: 'result', result })
  } catch (error) {
    self.postMessage({ type: 'error', error: errorPayload(error) })
  }
}