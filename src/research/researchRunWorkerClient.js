function errorFromPayload(payload) {
  const message =
    typeof payload?.message === 'string' && payload.message
      ? payload.message
      : 'Research Worker failed without an error message.'

  const error = new Error(message)

  if (typeof payload?.name === 'string') {
    error.name = payload.name
  }

  if (Array.isArray(payload?.blockers)) {
    error.blockers = payload.blockers
  }

  return error
}

function executeInWorker(message, createWorker) {
  return new Promise((resolve, reject) => {
    let worker

    try {
      worker = createWorker()
    } catch (error) {
      reject(
        new Error(
          `Research Worker could not be started: ${error.message}`,
        ),
      )
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
      const response = event.data

      if (
        response?.type === 'result' &&
        response.result &&
        typeof response.result === 'object'
      ) {
        settled = true
        cleanup()
        resolve(response.result)
        return
      }

      if (response?.type === 'error') {
        fail(errorFromPayload(response.error))
        return
      }

      fail(
        new Error(
          'Research Worker returned an invalid response.',
        ),
      )
    }

    worker.onerror = (event) => {
      event.preventDefault?.()

      const reason =
        event.message || event.error?.message

      fail(
        new Error(
          reason
            ? `Research Worker failed: ${reason}`
            : 'Research Worker stopped unexpectedly.',
        ),
      )
    }

    worker.onmessageerror = () =>
      fail(
        new Error(
          'Research Worker returned a message that could not be read.',
        ),
      )

    try {
      worker.postMessage(message)
    } catch (error) {
      fail(
        new Error(
          `Research Worker could not receive the request: ${error.message}`,
        ),
      )
    }
  })
}

function createDefaultWorker() {
  return new Worker(
    new URL('./researchRun.worker.js', import.meta.url),
    { type: 'module' },
  )
}

export function createResearchRunWorkerExecutor(createWorker) {
  return (request) =>
    executeInWorker(
      {
        type: 'run',
        request,
      },
      createWorker,
    )
}

export function executeResearchRunInWorker(request) {
  return executeInWorker(
    {
      type: 'run',
      request,
    },
    createDefaultWorker,
  )
}

export function createResearchReplayWorkerExecutor(createWorker) {
  return ({ run, canonicalDataset }) =>
    executeInWorker(
      {
        type: 'replay',
        run,
        canonicalDataset,
      },
      createWorker,
    )
}

export function executeResearchReplayInWorker({
  run,
  canonicalDataset,
}) {
  return executeInWorker(
    {
      type: 'replay',
      run,
      canonicalDataset,
    },
    createDefaultWorker,
  )
}