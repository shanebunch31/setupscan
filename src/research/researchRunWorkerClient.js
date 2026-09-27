function errorFromPayload(payload) {
  const message = typeof payload?.message === 'string' && payload.message
    ? payload.message
    : 'Research Worker failed without an error message.'
  const error = new Error(message)
  if (typeof payload?.name === 'string') error.name = payload.name
  return error
}

function executeInWorker(request, createWorker) {
  return new Promise((resolve, reject) => {
    let worker
    try {
      worker = createWorker()
    } catch (error) {
      reject(new Error(`Research Worker could not be started: ${error.message}`))
      return
    }

    let settled = false
    const cleanup = () => {
      worker.onmessage = null
      worker.onerror = null
      worker.onmessageerror = null
      worker.terminate()
    }
    const fail = (error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }

    worker.onmessage = (event) => {
      const message = event.data
      if (message?.type === 'result' && message.result && typeof message.result === 'object') {
        settled = true
        cleanup()
        resolve(message.result)
        return
      }
      if (message?.type === 'error') {
        fail(errorFromPayload(message.error))
        return
      }
      fail(new Error('Research Worker returned an invalid response.'))
    }
    worker.onerror = (event) => {
      event.preventDefault?.()
      const reason = event.message || event.error?.message
      fail(new Error(reason ? `Research Worker failed: ${reason}` : 'Research Worker stopped unexpectedly.'))
    }
    worker.onmessageerror = () => fail(new Error('Research Worker returned a message that could not be read.'))

    try {
      worker.postMessage({ type: 'run', request })
    } catch (error) {
      fail(new Error(`Research Worker could not receive the request: ${error.message}`))
    }
  })
}

export function createResearchRunWorkerExecutor(createWorker) {
  return (request) => executeInWorker(request, createWorker)
}

export function executeResearchRunInWorker(request) {
  return executeInWorker(request, () => new Worker(
    new URL('./researchRun.worker.js', import.meta.url),
    { type: 'module' },
  ))
}