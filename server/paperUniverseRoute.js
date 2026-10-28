function isLoopbackAddress(address = '') {
  return [
    '127.0.0.1',
    '::1',
    '::ffff:127.0.0.1',
  ].includes(address)
}

export function isLocalPaperUniverseWrite(request) {
  return isLoopbackAddress(
    request?.socket?.remoteAddress,
  )
}

async function readJsonBody(request) {
  const chunks = []

  for await (const chunk of request) {
    chunks.push(chunk)
  }

  const text = Buffer.concat(chunks)
    .toString('utf8')
    .trim()

  if (!text) return {}

  try {
    return JSON.parse(text)
  } catch {
    const error = new Error(
      'Request body must be valid JSON.',
    )
    error.code = 'INVALID_REQUEST_BODY'
    throw error
  }
}

function safeError(error) {
  if (error?.code === 'INVALID_PAPER_SYMBOL') {
    return {
      status: 400,
      body: {
        error:
          'Invalid symbol. Use a normal market ticker symbol.',
        code: error.code,
      },
    }
  }

  if (
    error?.code ===
    'PAPER_SYMBOL_CAP_EXCEEDED'
  ) {
    return {
      status: 409,
      body: {
        error:
          'The Paper Observer symbol limit has been reached.',
        code: error.code,
      },
    }
  }

  if (
    error?.code ===
    'INVALID_REQUEST_BODY' ||
    error?.code ===
    'INVALID_PAPER_UNIVERSE_ACTION'
  ) {
    return {
      status: 400,
      body: {
        error: error.message,
        code: error.code,
      },
    }
  }

  return {
    status: 503,
    body: {
      error:
        'Paper Observer symbol universe is currently unavailable.',
      code:
        error?.code ??
        'PAPER_SYMBOL_UNIVERSE_UNAVAILABLE',
    },
  }
}

export function createPaperUniverseRoute({
  paperService,
  allowWrite = isLocalPaperUniverseWrite,
}) {
  return async function handlePaperUniverseRequest({
    request,
    response,
    sendJson,
  }) {
    if (request.method === 'GET') {
      try {
        const universe =
          await paperService.readSymbolUniverse()

        sendJson(response, 200, universe)
      } catch (error) {
        const result = safeError(error)

        sendJson(
          response,
          result.status,
          result.body,
        )
      }

      return
    }

    if (request.method !== 'POST') {
      sendJson(response, 405, {
        error: 'Method not allowed.',
        code: 'METHOD_NOT_ALLOWED',
      })

      return
    }

    if (!allowWrite(request)) {
      sendJson(response, 403, {
        error:
          'Paper Observer symbol changes are local-only in the current personal-use version.',
        code:
          'PAPER_UNIVERSE_WRITE_LOCAL_ONLY',
      })

      return
    }

    try {
      const body = await readJsonBody(request)

      if (
        body.action !== 'add' &&
        body.action !== 'remove'
      ) {
        const error = new Error(
          'Action must be add or remove.',
        )
        error.code =
          'INVALID_PAPER_UNIVERSE_ACTION'
        throw error
      }

      const universe =
        body.action === 'add'
          ? await paperService.addSymbol(
              body.symbol,
            )
          : await paperService.removeSymbol(
              body.symbol,
            )

      sendJson(response, 200, universe)
    } catch (error) {
      const result = safeError(error)

      sendJson(
        response,
        result.status,
        result.body,
      )
    }
  }
}