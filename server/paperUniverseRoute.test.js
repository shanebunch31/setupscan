import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  createPaperUniverseRoute,
  isLocalPaperUniverseWrite,
} from './paperUniverseRoute.js'

function request({
  method = 'GET',
  body = null,
  remoteAddress = '127.0.0.1',
} = {}) {
  const chunks =
    body === null
      ? []
      : [
          Buffer.from(
            JSON.stringify(body),
          ),
        ]

  return {
    method,
    socket: {
      remoteAddress,
    },

    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        yield chunk
      }
    },
  }
}

function recorder() {
  const calls = []

  return {
    calls,
    sendJson: (
      _response,
      status,
      payload,
    ) => {
      calls.push({
        status,
        payload,
      })
    },
  }
}

test(
  'paper universe GET returns the current persisted universe',
  async () => {
    const handler =
      createPaperUniverseRoute({
        paperService: {
          readSymbolUniverse:
            async () => ({
              initialized: true,
              symbols: [
                'AMD',
                'SPY',
              ],
              cap: 10,
            }),
        },
      })

    const output = recorder()

    await handler({
      request: request(),
      response: {},
      sendJson: output.sendJson,
    })

    assert.deepEqual(
      output.calls,
      [
        {
          status: 200,
          payload: {
            initialized: true,
            symbols: [
              'AMD',
              'SPY',
            ],
            cap: 10,
          },
        },
      ],
    )
  },
)

test(
  'local paper universe POST can add a symbol',
  async () => {
    const handler =
      createPaperUniverseRoute({
        paperService: {
          addSymbol:
            async (symbol) => ({
              initialized: true,
              symbols: [
                'AMD',
                symbol,
              ].sort(),
              cap: 10,
            }),
        },
      })

    const output = recorder()

    await handler({
      request: request({
        method: 'POST',
        body: {
          action: 'add',
          symbol: 'SPY',
        },
      }),
      response: {},
      sendJson: output.sendJson,
    })

    assert.equal(
      output.calls[0].status,
      200,
    )

    assert.deepEqual(
      output.calls[0].payload.symbols,
      ['AMD', 'SPY'],
    )
  },
)

test(
  'remote clients cannot mutate the paper universe',
  async () => {
    let mutations = 0

    const handler =
      createPaperUniverseRoute({
        paperService: {
          addSymbol: async () => {
            mutations += 1
          },
        },
      })

    const output = recorder()

    await handler({
      request: request({
        method: 'POST',
        remoteAddress: '203.0.113.10',
        body: {
          action: 'add',
          symbol: 'AMD',
        },
      }),
      response: {},
      sendJson: output.sendJson,
    })

    assert.equal(mutations, 0)

    assert.equal(
      output.calls[0].status,
      403,
    )
  },
)

test(
  'loopback addresses are recognized for local writes',
  () => {
    assert.equal(
      isLocalPaperUniverseWrite({
        socket: {
          remoteAddress: '127.0.0.1',
        },
      }),
      true,
    )

    assert.equal(
      isLocalPaperUniverseWrite({
        socket: {
          remoteAddress: '::1',
        },
      }),
      true,
    )

    assert.equal(
      isLocalPaperUniverseWrite({
        socket: {
          remoteAddress:
            '::ffff:127.0.0.1',
        },
      }),
      true,
    )

    assert.equal(
      isLocalPaperUniverseWrite({
        socket: {
          remoteAddress:
            '203.0.113.10',
        },
      }),
      false,
    )
  },
)