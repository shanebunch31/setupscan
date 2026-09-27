import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runSignalQualityResearch } from '../src/backtest/signalQualityBacktest.js'
import { createResearchRecordForExperiment } from '../src/research/registry.js'
import { synthesizeResearch } from '../src/research/synthesis.js'
import { stringifyResearchJson } from '../src/research/researchRunSerialization.js'
import { createResearchRunStore, RESEARCH_PERSISTENCE_SCHEMA_VERSION } from './researchRunStore.js'

function cloneState(state) {
  return {
    runs: new Map(state.runs),
    experiments: new Map([...state.experiments].map(([key, rows]) => [key, [...rows]])),
    investigations: new Map([...state.investigations].map(([key, row]) => [key, { ...row }])),
    investigationRuns: state.investigationRuns.map((row) => ({ ...row })),
  }
}

function rowKey(runId, experimentId) {
  return `${runId}::${experimentId}`
}

class MemoryResearchPool {
  constructor() {
    this.state = { runs: new Map(), experiments: new Map(), investigations: new Map(), investigationRuns: [] }
    this.failExperimentId = null
    this.committedTransactions = 0
    this.rolledBackTransactions = 0
    this.releasedClients = 0
    this.schemaQueries = 0
    this.queries = []
  }

  async query(text, values = []) {
    return this.execute(text, values, this.state)
  }

  async connect() {
    let transactionState = null
    return {
      query: async (text, values = []) => {
        if (text === 'BEGIN') {
          transactionState = cloneState(this.state)
          return { rows: [] }
        }
        if (text === 'COMMIT') {
          this.state = transactionState
          transactionState = null
          this.committedTransactions += 1
          return { rows: [] }
        }
        if (text === 'ROLLBACK') {
          transactionState = null
          this.rolledBackTransactions += 1
          return { rows: [] }
        }
        return this.execute(text, values, transactionState ?? this.state)
      },
      release: () => { this.releasedClients += 1 },
    }
  }

  execute(text, values, state) {
    this.queries.push({ text, values })
    if (text.includes('CREATE TABLE IF NOT EXISTS research_runs')) {
      this.schemaQueries += 1
      this.schemaSql = text
      return { rows: [] }
    }
    if (text.startsWith('INSERT INTO research_runs')) {
      const [runId, requestedAt, status, fetchStatus, symbols, timeframe, requestedStart, requestedEnd,
        requestedExperiments, emaContractVersion, adjustmentMode, datasetId, provider, fetchIssues, datasetMetadata, synthesis, schemaVersion] = values
      if (state.runs.has(runId)) {
        const error = new Error('duplicate run')
        error.code = '23505'
        error.constraint = 'research_runs_pkey'
        throw error
      }
      state.runs.set(runId, {
        run_id: runId,
        requested_at: requestedAt,
        status,
        fetch_status: fetchStatus,
        symbols,
        timeframe,
        requested_start: requestedStart,
        requested_end: requestedEnd,
        requested_experiments: requestedExperiments,
        ema_contract_version: emaContractVersion,
        adjustment_mode: adjustmentMode,
        dataset_id: datasetId,
        provider,
        fetch_issues: JSON.parse(fetchIssues),
        dataset_metadata: datasetMetadata === null ? null : JSON.parse(datasetMetadata),
        synthesis: JSON.parse(synthesis),
        persistence_schema_version: schemaVersion,
      })
      return { rows: [] }
    }
    if (text.startsWith('INSERT INTO research_investigations')) {
      const [investigationId, question, requestedExperiments, schemaVersion] = values
      if (state.investigations.has(investigationId)) {
        const error = new Error('duplicate investigation')
        error.code = '23505'
        error.constraint = 'research_investigations_pkey'
        throw error
      }
      const now = new Date().toISOString()
      const row = {
        investigation_id: investigationId,
        question,
        status: 'active',
        requested_experiments: requestedExperiments,
        created_at: now,
        updated_at: now,
        persistence_schema_version: schemaVersion,
      }
      state.investigations.set(investigationId, row)
      return { rows: [{ ...row }] }
    }
    if (text.startsWith('SELECT investigation_id FROM research_investigations')) {
      const row = state.investigations.get(values[0])
      return { rows: row ? [{ investigation_id: row.investigation_id }] : [] }
    }
    if (text.includes('FROM research_investigations WHERE investigation_id = $1') && text.includes('SELECT investigation_id, question')) {
      const row = state.investigations.get(values[0])
      return { rows: row ? [{ ...row }] : [] }
    }
    if (text.includes('FROM research_investigations ORDER BY created_at DESC')) {
      const [limit, offset] = values
      const rows = [...state.investigations.values()]
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || b.investigation_id.localeCompare(a.investigation_id))
      return { rows: rows.slice(offset, offset + limit).map((row) => ({ ...row })) }
    }
    if (text.startsWith('SELECT run_id FROM research_investigation_runs WHERE investigation_id = $1 AND run_id = $2')) {
      const row = state.investigationRuns.find((entry) => entry.investigation_id === values[0] && entry.run_id === values[1])
      return { rows: row ? [{ run_id: row.run_id }] : [] }
    }
    if (text.startsWith('SELECT COALESCE(MAX(position), -1) + 1 AS next_position')) {
      const positions = state.investigationRuns.filter((row) => row.investigation_id === values[0]).map((row) => row.position)
      return { rows: [{ next_position: positions.length ? Math.max(...positions) + 1 : 0 }] }
    }
    if (text.includes('FROM research_investigation_runs') && text.includes('WHERE investigation_id = $1 ORDER BY position')) {
      return {
        rows: state.investigationRuns
          .filter((row) => row.investigation_id === values[0])
          .sort((a, b) => a.position - b.position)
          .map(({ run_id }) => ({ run_id })),
      }
    }
    if (text.includes('FROM research_investigation_runs') && text.includes('WHERE investigation_id = ANY($1::text[])')) {
      const investigationIds = new Set(values[0])
      return {
        rows: state.investigationRuns
          .filter((row) => investigationIds.has(row.investigation_id))
          .sort((a, b) => a.investigation_id.localeCompare(b.investigation_id) || a.position - b.position)
          .map(({ investigation_id, run_id }) => ({ investigation_id, run_id })),
      }
    }
    if (text.startsWith('INSERT INTO research_investigation_runs')) {
      const [investigationId, runId, position] = values
      if (!state.investigations.has(investigationId) || !state.runs.has(runId)) throw new Error('foreign key violation')
      if (state.investigationRuns.some((row) => row.investigation_id === investigationId && (row.run_id === runId || row.position === position))) {
        const error = new Error('duplicate investigation run')
        error.code = '23505'
        error.constraint = 'research_investigation_runs_pkey'
        throw error
      }
      state.investigationRuns.push({ investigation_id: investigationId, run_id: runId, position, created_at: new Date().toISOString() })
      return { rows: [] }
    }
    if (text.startsWith('UPDATE research_investigations SET updated_at')) {
      const row = state.investigations.get(values[0])
      if (row) row.updated_at = new Date().toISOString()
      return { rows: [] }
    }
    if (text.startsWith('INSERT INTO research_run_experiments')) {
      const [runId, experimentId, executionOrder, executionStatus, error, record] = values
      if (experimentId === this.failExperimentId) throw new Error('injected experiment insert failure')
      if (!state.runs.has(runId)) throw new Error('foreign key violation')
      const rows = state.experiments.get(runId) ?? []
      if (rows.some((row) => row.experiment_id === experimentId || row.execution_order === executionOrder)) {
        const error = new Error('duplicate experiment row')
        error.code = '23505'
        error.constraint = 'research_run_experiments_pkey'
        throw error
      }
      rows.push({
        run_id: runId,
        experiment_id: experimentId,
        execution_order: executionOrder,
        execution_status: executionStatus,
        error: error === null ? null : JSON.parse(error),
        record: record === null ? null : JSON.parse(record),
      })
      state.experiments.set(runId, rows)
      return { rows: [] }
    }
    if (text.includes('FROM research_run_experiments WHERE run_id = $1')) {
      return { rows: [...(state.experiments.get(values[0]) ?? [])].sort((a, b) => a.execution_order - b.execution_order) }
    }
    if (text.startsWith('SELECT run_id, requested_at, dataset_id, ema_contract_version, adjustment_mode, synthesis FROM research_runs WHERE run_id = $1')) {
      const row = state.runs.get(values[0])
      return { rows: row ? [{
        run_id: row.run_id,
        requested_at: row.requested_at,
        dataset_id: row.dataset_id,
        ema_contract_version: row.ema_contract_version,
        adjustment_mode: row.adjustment_mode,
        synthesis: row.synthesis,
      }] : [] }
    }
    if (text.includes('FROM research_runs WHERE run_id = $1')) {
      const row = state.runs.get(values[0])
      return { rows: row ? [row] : [] }
    }
    if (text.includes('FROM research_runs') && text.includes('ORDER BY requested_at DESC')) {
      const whereIndex = text.indexOf('WHERE ')
      const where = whereIndex < 0 ? '' : text.slice(whereIndex + 6, text.indexOf('ORDER BY')).trim()
      const filterValues = values.slice(0, -2)
      let rows = [...state.runs.values()]
      if (where) {
        const filter = (pattern) => {
          const match = text.match(pattern)
          return match ? filterValues[Number(match[1]) - 1] : undefined
        }
        const status = filter(/status = \$(\d+)/)
        const datasetId = filter(/dataset_id = \$(\d+)/)
        const symbols = filter(/symbols && \$(\d+)::text\[\]/)
        const experimentId = filter(/e\.experiment_id = \$(\d+)/)
        if (status !== undefined) rows = rows.filter((row) => row.status === status)
        if (datasetId !== undefined) rows = rows.filter((row) => row.dataset_id === datasetId)
        if (symbols !== undefined) rows = rows.filter((row) => symbols.some((symbol) => row.symbols.includes(symbol)))
        if (experimentId !== undefined) {
          rows = rows.filter((row) => (state.experiments.get(row.run_id) ?? []).some((experiment) => experiment.experiment_id === experimentId))
        }
      }
      rows.sort((a, b) => String(b.requested_at).localeCompare(String(a.requested_at)) || b.run_id.localeCompare(a.run_id))
      const limit = values.at(-2)
      const offset = values.at(-1)
      return { rows: rows.slice(offset, offset + limit) }
    }
    throw new Error(`Unexpected SQL in test pool: ${text}`)
  }
}

function makeCandles(symbol, count = 220) {
  return Array.from({ length: count }, (_, index) => {
    const close = 100 + index * 0.01 + Math.sin(index / 7)
    return {
      symbol,
      timeframe: '1Hour',
      timestamp: new Date(Date.UTC(2022, 0, 3) + index * 60 * 60 * 1000).toISOString(),
      open: close - 0.1,
      high: close + 0.5,
      low: close - 0.5,
      close,
      volume: 1000 + index,
    }
  })
}

function makeRunResult({
  runId = 'run-store-test',
  requestedAt = '2026-09-26T12:00:00.000Z',
  status = 'completed',
  fetchStatus = 'complete',
  symbols = ['SPY'],
  requestedExperiments = ['robustness'],
  datasetId = 'dataset-store-test',
  experimentResults,
  records,
  fetchIssues = [],
  synthesis = { schemaVersion: 1, generatedAt: 'synthesis-time', coverage: { requested: requestedExperiments, evaluated: [] }, strategyGroups: [], provenance: { runId, datasetId } },
} = {}) {
  const nativeOutput = {
    thresholdResults: [{
      minimumScore: 75,
      candles: makeCandles('SPY', 3),
      metrics: { totalTrades: 0, winRate: 0, profitFactor: Infinity, expectancy: 0, maximumDrawdown: 0 },
    }],
    periodResults: [],
  }
  const experimentExecutionResults = experimentResults ?? [{
    experimentId: 'robustness', status: 'succeeded', nativeOutput, error: null,
  }]
  const normalizedRecords = records ?? (experimentExecutionResults[0]?.status === 'succeeded'
    ? [createResearchRecordForExperiment('robustness', experimentExecutionResults[0].nativeOutput, {
      symbols: ['SPY'], timeframe: '1Hour', provider: 'ALPACA HISTORICAL',
      requestedStart: '2022-01-01T00:00:00Z', requestedEnd: '2026-09-26T00:00:00Z',
      provenance: { runId, datasetId, requestedAt },
    })]
    : [])
  return {
    runContext: {
      runId, requestedAt, symbols, timeframe: '1Hour',
      requestedStart: '2022-01-01T00:00:00Z', requestedEnd: '2026-09-26T00:00:00Z', requestedExperiments,
      emaContractVersion: 'setupscan-ema-sma-seeded-recursive-v1',
      adjustmentMode: 'split',
    },
    status,
    fetchStatus,
    fetchIssues,
    dataset: datasetId ? {
      datasetId,
      provider: 'ALPACA HISTORICAL',
      adjustmentMode: 'split',
      timeframe: '1Hour',
      requestedStart: '2022-01-01T00:00:00Z',
      requestedEnd: '2026-09-26T00:00:00Z',
      fetchResultsBySymbol: Object.fromEntries(symbols.map((symbol) => [symbol, {
        provider: 'ALPACA HISTORICAL', symbol, timeframe: '1Hour',
        start: '2022-01-03T00:00:00.000Z', end: '2022-01-12T03:00:00.000Z',
        requestedStart: '2022-01-01T00:00:00Z', requestedEnd: '2026-09-26T00:00:00Z',
        candleCount: 220, complete: true, minimumExpectedCandles: 1000, candles: makeCandles(symbol),
      }])),
      rawSeriesBySymbol: Object.fromEntries(symbols.map((symbol) => [symbol, makeCandles(symbol)])),
    } : null,
    experimentResults: experimentExecutionResults,
    records: normalizedRecords,
    synthesis,
  }
}

test('saves and retrieves a completed run with record, nativePayload, synthesis, and status fidelity', async () => {
  const pool = new MemoryResearchPool()
  const store = createResearchRunStore({ pool })
  const run = makeRunResult()
  assert.deepEqual(await store.saveResearchRun(run), { runId: run.runContext.runId })
  const retrieved = await store.getResearchRun(run.runContext.runId)

  assert.equal(retrieved.status, 'completed')
  assert.equal(retrieved.fetchStatus, 'complete')
  assert.deepEqual(retrieved.runContext, run.runContext)
  assert.equal(retrieved.runContext.emaContractVersion, 'setupscan-ema-sma-seeded-recursive-v1')
  assert.equal(retrieved.runContext.adjustmentMode, 'split')
  assert.equal(retrieved.records.length, 1)
  assert.equal(retrieved.records[0].id, 'robustness')
  assert.equal(retrieved.records[0].nativePayload.thresholdResults[0].metrics.profitFactor, Infinity)
  assert.equal(retrieved.experimentResults[0].nativeOutput.thresholdResults[0].metrics.profitFactor, Infinity)
  assert.deepEqual(retrieved.synthesis, run.synthesis)
  assert.deepEqual(retrieved.fetchIssues, run.fetchIssues)
  assert.equal(retrieved.dataset.datasetId, run.dataset.datasetId)
  assert.equal(retrieved.dataset.adjustmentMode, 'split')
  assert.equal(retrieved.dataset.rawSeriesBySymbol, null)
})

test('saves partial, unavailable, failed, and no-experiment run headers and child rows', async () => {
  const pool = new MemoryResearchPool()
  const store = createResearchRunStore({ pool })
  const partial = makeRunResult({
    runId: 'run-partial', status: 'partial', fetchStatus: 'partial',
    fetchIssues: [{ symbol: 'QQQ', type: 'fetch-error', error: { message: 'offline' } }],
    experimentResults: [
      { experimentId: 'robustness', status: 'succeeded', nativeOutput: { metrics: {} }, error: null },
      { experimentId: 'relative-value', status: 'failed', nativeOutput: null, error: { name: 'Error', message: 'native failed' } },
      { experimentId: 'signal-quality', status: 'unavailable', nativeOutput: null, error: null },
      { experimentId: 'yearly-regime', status: 'incomplete', nativeOutput: { incomplete: true }, error: null },
      { experimentId: 'causal-regime', status: 'skipped', nativeOutput: null, error: { message: 'skipped' } },
    ],
    records: [
      createResearchRecordForExperiment('robustness', { metrics: {} }, { provenance: { runId: 'run-partial' } }),
      createResearchRecordForExperiment('signal-quality', { available: false }, { status: 'unavailable' }),
      createResearchRecordForExperiment('yearly-regime', { incomplete: true }, { status: 'incomplete' }),
    ],
  })
  const unavailable = makeRunResult({
    runId: 'run-unavailable', status: 'unavailable', fetchStatus: 'unavailable', datasetId: null,
    experimentResults: [{ experimentId: 'robustness', status: 'unavailable', nativeOutput: null, error: null }],
    records: [createResearchRecordForExperiment('robustness', null, { status: 'unavailable' })],
  })
  const failed = makeRunResult({ runId: 'run-failed', status: 'failed', fetchStatus: 'partial', datasetId: null, experimentResults: [], records: [] })
  const empty = makeRunResult({ runId: 'run-empty', status: 'completed', fetchStatus: 'not-requested', symbols: [], requestedExperiments: [], datasetId: null, experimentResults: [], records: [] })

  for (const run of [partial, unavailable, failed, empty]) await store.saveResearchRun(run)
  const loadedPartial = await store.getResearchRun('run-partial')
  assert.equal(loadedPartial.status, 'partial')
  assert.equal(loadedPartial.experimentResults.length, 5)
  assert.deepEqual(loadedPartial.fetchIssues, partial.fetchIssues)
  assert.deepEqual(loadedPartial.experimentResults[1].error, { name: 'Error', message: 'native failed' })
  assert.equal(loadedPartial.records.find((record) => record.id === 'yearly-regime').status, 'incomplete')
  assert.equal((await store.getResearchRun('run-unavailable')).status, 'unavailable')
  assert.equal((await store.getResearchRun('run-failed')).status, 'failed')
  assert.equal((await store.getResearchRun('run-empty')).fetchStatus, 'not-requested')
})

test('saves fetch issues and native payload without persisting raw dataset candles separately', async () => {
  const pool = new MemoryResearchPool()
  const store = createResearchRunStore({ pool })
  const run = makeRunResult({
    fetchIssues: [{ symbol: 'QQQ', type: 'incomplete', fetchResult: { symbol: 'QQQ', candles: [] } }],
  })
  await store.saveResearchRun(run)
  const header = pool.state.runs.get(run.runContext.runId)
  const experiment = pool.state.experiments.get(run.runContext.runId)[0]
  assert.deepEqual(header.fetch_issues, run.fetchIssues)
  assert.equal(header.dataset_metadata.fetchResultsBySymbol.SPY.candleCount, 220)
  assert.equal('candles' in header.dataset_metadata.fetchResultsBySymbol.SPY, false)
  assert.equal(experiment.record.nativePayload.thresholdResults[0].candles.length, 3)
  assert.equal('rawSeriesBySymbol' in header.dataset_metadata, false)
  assert.equal(pool.state.runs.has('research_datasets'), false)
})

test('stores experiment execution failures without inventing normalized records', async () => {
  const pool = new MemoryResearchPool()
  const store = createResearchRunStore({ pool })
  const run = makeRunResult({
    runId: 'run-error', status: 'partial',
    experimentResults: [{ experimentId: 'robustness', status: 'failed', nativeOutput: null, error: { code: 'E_NATIVE', message: 'failed' } }],
    records: [],
  })
  await store.saveResearchRun(run)
  const loaded = await store.getResearchRun('run-error')
  assert.deepEqual(loaded.records, [])
  assert.equal(loaded.experimentResults[0].status, 'failed')
  assert.deepEqual(loaded.experimentResults[0].error, run.experimentResults[0].error)
  assert.equal(loaded.experimentResults[0].nativeOutput, null)
})

test('duplicate run IDs are rejected without overwriting the original run', async () => {
  const store = createResearchRunStore({ pool: new MemoryResearchPool() })
  const run = makeRunResult()
  await store.saveResearchRun(run)
  await assert.rejects(store.saveResearchRun(run), { code: 'RESEARCH_RUN_EXISTS' })
  assert.equal((await store.getResearchRun(run.runContext.runId)).status, 'completed')
})

test('header and experiment inserts roll back atomically when a child insert fails', async () => {
  const pool = new MemoryResearchPool()
  pool.failExperimentId = 'relative-value'
  const store = createResearchRunStore({ pool })
  const run = makeRunResult({
    runId: 'run-rollback',
    experimentResults: [
      { experimentId: 'robustness', status: 'failed', nativeOutput: null, error: { message: 'x' } },
      { experimentId: 'relative-value', status: 'failed', nativeOutput: null, error: { message: 'y' } },
    ],
    records: [],
  })
  await assert.rejects(store.saveResearchRun(run), /injected experiment insert failure/)
  assert.equal(pool.state.runs.has('run-rollback'), false)
  assert.equal(pool.state.experiments.has('run-rollback'), false)
  assert.equal(pool.rolledBackTransactions, 1)
  assert.equal(pool.committedTransactions, 0)
  assert.equal(pool.releasedClients, 1)
})

test('retrieval returns null for an unknown run ID', async () => {
  const store = createResearchRunStore({ pool: new MemoryResearchPool() })
  assert.equal(await store.getResearchRun('missing'), null)
})

test('comparison snapshot query reads only run metadata and synthesis', async () => {
  const pool = new MemoryResearchPool()
  const store = createResearchRunStore({ pool })
  const run = makeRunResult()
  await store.saveResearchRun(run)
  pool.queries.length = 0
  const snapshot = await store.getResearchRunComparisonSnapshot(run.runContext.runId)
  assert.deepEqual(snapshot, {
    runId: run.runContext.runId,
    requestedAt: run.runContext.requestedAt,
    datasetId: run.dataset.datasetId,
    emaContractVersion: 'setupscan-ema-sma-seeded-recursive-v1',
    adjustmentMode: 'split',
    synthesis: run.synthesis,
  })
  assert.equal(pool.queries.length, 1)
  assert.match(pool.queries[0].text, /SELECT run_id, requested_at, dataset_id, ema_contract_version, adjustment_mode, synthesis FROM research_runs/)
  assert.doesNotMatch(pool.queries[0].text, /research_run_experiments|record|native_payload/)
})

test('lists recent runs with status, dataset, symbol, experiment, and pagination filters', async () => {
  const store = createResearchRunStore({ pool: new MemoryResearchPool() })
  const runs = [
    makeRunResult({ runId: 'run-a', requestedAt: '2026-09-24T00:00:00Z', symbols: ['SPY'], datasetId: 'dataset-a', requestedExperiments: ['robustness'], status: 'completed' }),
    makeRunResult({ runId: 'run-b', requestedAt: '2026-09-25T00:00:00Z', symbols: ['QQQ'], datasetId: 'dataset-b', requestedExperiments: ['relative-value'], status: 'partial' }),
    makeRunResult({
      runId: 'run-c', requestedAt: '2026-09-26T00:00:00Z', symbols: ['SPY', 'IWM'],
      datasetId: 'dataset-a', requestedExperiments: ['robustness', 'signal-quality'], status: 'completed',
      experimentResults: [
        { experimentId: 'robustness', status: 'succeeded', nativeOutput: { metrics: {} }, error: null },
        { experimentId: 'signal-quality', status: 'unavailable', nativeOutput: null, error: null },
      ],
      records: [createResearchRecordForExperiment('robustness', { metrics: {} }), createResearchRecordForExperiment('signal-quality', null, { status: 'unavailable' })],
    }),
    makeRunResult({ runId: 'run-d', requestedAt: '2026-09-23T00:00:00Z', symbols: ['SPY'], datasetId: null, requestedExperiments: ['signal-quality'], status: 'failed', experimentResults: [], records: [] }),
  ]
  for (const run of runs) await store.saveResearchRun(run)

  assert.deepEqual((await store.listResearchRuns({ limit: 2 })).map((entry) => entry.runId), ['run-c', 'run-b'])
  assert.deepEqual((await store.listResearchRuns({ status: 'partial' })).map((entry) => entry.runId), ['run-b'])
  assert.deepEqual((await store.listResearchRuns({ datasetId: 'dataset-a' })).map((entry) => entry.runId), ['run-c', 'run-a'])
  assert.deepEqual((await store.listResearchRuns({ symbols: ['IWM'] })).map((entry) => entry.runId), ['run-c'])
  assert.deepEqual((await store.listResearchRuns({ experimentId: 'signal-quality' })).map((entry) => entry.runId), ['run-c'])
  assert.deepEqual((await store.listResearchRuns({ limit: 1, offset: 1 })).map((entry) => entry.runId), ['run-b'])
})

test('validates listing limit and offset', async () => {
  const store = createResearchRunStore({ pool: new MemoryResearchPool() })
  await assert.rejects(store.listResearchRuns({ limit: 101 }), { code: 'RESEARCH_RUN_INVALID' })
  await assert.rejects(store.listResearchRuns({ offset: -1 }), { code: 'RESEARCH_RUN_INVALID' })
})

test('persists the storage schema version and uses current synthesis schema metadata', async () => {
  const pool = new MemoryResearchPool()
  const store = createResearchRunStore({ pool })
  const run = makeRunResult()
  await store.saveResearchRun(run)
  const header = pool.state.runs.get(run.runContext.runId)
  assert.equal(header.persistence_schema_version, RESEARCH_PERSISTENCE_SCHEMA_VERSION)
  assert.equal(header.synthesis.schemaVersion, 1)
  assert.equal(header.persistence_schema_version, 3)
})

test('representative multi-symbol Signal Quality persistence reports serialized payload size', async () => {
  const symbols = ['SPY', 'QQQ', 'IWM']
  const rawSeriesBySymbol = Object.fromEntries(symbols.map((symbol) => [symbol, makeCandles(symbol)]))
  const nativeOutput = runSignalQualityResearch(rawSeriesBySymbol)
  const record = createResearchRecordForExperiment('signal-quality', nativeOutput, {
    symbols,
    timeframe: '1Hour',
    provider: 'ALPACA HISTORICAL',
    requestedStart: '2022-01-01T00:00:00Z',
    requestedEnd: '2026-09-26T00:00:00Z',
    provenance: { runId: 'run-size', datasetId: 'dataset-size', requestedAt: '2026-09-26T12:00:00Z' },
  })
  const synthesis = synthesizeResearch([record], {
    runId: 'run-size', datasetId: 'dataset-size', requestedExperiments: ['signal-quality'],
  })
  const representativeStoredRows = {
    run: {
      runId: 'run-size',
      requestedAt: '2026-09-26T12:00:00Z',
      status: 'completed',
      fetchStatus: 'complete',
      symbols,
      timeframe: '1Hour',
      requestedStart: '2022-01-01T00:00:00Z',
      requestedEnd: '2026-09-26T00:00:00Z',
      requestedExperiments: ['signal-quality'],
      datasetId: 'dataset-size',
      provider: 'ALPACA HISTORICAL',
      fetchIssues: [],
      datasetMetadata: {
        fetchResultsBySymbol: Object.fromEntries(symbols.map((symbol) => [symbol, {
          symbol,
          provider: 'ALPACA HISTORICAL',
          timeframe: '1Hour',
          start: rawSeriesBySymbol[symbol][0].timestamp,
          end: rawSeriesBySymbol[symbol].at(-1).timestamp,
          candleCount: rawSeriesBySymbol[symbol].length,
          complete: true,
        }])),
      },
      synthesis,
      persistenceSchemaVersion: RESEARCH_PERSISTENCE_SCHEMA_VERSION,
    },
    experiments: [{ experimentId: 'signal-quality', executionStatus: 'succeeded', error: null, record }],
  }
  const bytes = Buffer.byteLength(stringifyResearchJson(representativeStoredRows))
  console.log(`Representative 220-candle x 3-symbol Signal Quality persisted projection: ${bytes} bytes`)
  assert.ok(bytes > 0)
})

test('schema creates only research-specific tables and contains no raw candle dataset table', async () => {
  const pool = new MemoryResearchPool()
  const store = createResearchRunStore({ pool })
  await store.init()
  assert.equal(pool.schemaQueries, 1)
  assert.ok(!pool.schemaSql.includes('paper_observer_state'))
  assert.ok(!pool.schemaSql.includes('CREATE TABLE IF NOT EXISTS research_datasets'))
  assert.ok(!pool.schemaSql.includes('native_output'))
  assert.match(pool.schemaSql, /CREATE TABLE IF NOT EXISTS research_runs/)
  assert.match(pool.schemaSql, /CREATE TABLE IF NOT EXISTS research_run_experiments/)
  assert.match(pool.schemaSql, /CREATE TABLE IF NOT EXISTS research_investigations/)
  assert.match(pool.schemaSql, /CREATE TABLE IF NOT EXISTS research_investigation_runs/)
})

test('creates, retrieves, and lists investigation metadata with ordered run references only', async () => {
  const pool = new MemoryResearchPool()
  const store = createResearchRunStore({ pool })
  const run = makeRunResult({ runId: 'run-for-investigation' })
  await store.saveResearchRun(run)
  const created = await store.createResearchInvestigation({
    question: '  Does the baseline persist across regimes? ',
    requestedExperiments: ['walk-forward-regime', 'yearly-regime'],
  })
  assert.match(created.investigationId, /^investigation_[0-9a-f-]{36}$/)
  assert.equal(created.question, 'Does the baseline persist across regimes?')
  assert.equal(created.status, 'active')
  assert.deepEqual(created.requestedExperiments, ['walk-forward-regime', 'yearly-regime'])
  assert.deepEqual(created.runIds, [])
  assert.ok(created.createdAt)
  assert.ok(created.updatedAt)

  await store.attachResearchRunToInvestigation(created.investigationId, run.runContext.runId)
  const retrieved = await store.getResearchInvestigation(created.investigationId)
  const reloaded = await createResearchRunStore({ pool }).getResearchInvestigation(created.investigationId)
  assert.deepEqual(retrieved.runIds, ['run-for-investigation'])
  assert.deepEqual(reloaded, retrieved)
  assert.deepEqual(await store.listResearchInvestigations(), [retrieved])
  assert.equal('records' in retrieved, false)
  assert.equal('synthesis' in retrieved, false)
  assert.equal('nativePayload' in retrieved, false)
  assert.deepEqual(pool.state.investigationRuns, [{
    investigation_id: created.investigationId,
    run_id: 'run-for-investigation',
    position: 0,
    created_at: pool.state.investigationRuns[0].created_at,
  }])
  assert.equal(pool.state.runs.get('run-for-investigation').synthesis.schemaVersion, 1)
  assert.equal(await store.getResearchInvestigation('missing-investigation'), null)
})

test('investigation attachment requires an existing run, preserves order, and rejects duplicates', async () => {
  const store = createResearchRunStore({ pool: new MemoryResearchPool() })
  const firstRun = makeRunResult({ runId: 'run-first' })
  const secondRun = makeRunResult({ runId: 'run-second' })
  await store.saveResearchRun(firstRun)
  await store.saveResearchRun(secondRun)
  const secondRunBeforeAttachment = await store.getResearchRun(secondRun.runContext.runId)
  const investigation = await store.createResearchInvestigation({ question: 'Compare two saved runs' })

  await assert.rejects(store.attachResearchRunToInvestigation(investigation.investigationId, 'run-missing'), { code: 'RESEARCH_RUN_NOT_FOUND' })
  await store.attachResearchRunToInvestigation(investigation.investigationId, 'run-second')
  await store.attachResearchRunToInvestigation(investigation.investigationId, 'run-first')
  await assert.rejects(store.attachResearchRunToInvestigation(investigation.investigationId, 'run-second'), { code: 'RESEARCH_INVESTIGATION_RUN_EXISTS' })
  await assert.rejects(store.attachResearchRunToInvestigation('missing-investigation', 'run-first'), { code: 'RESEARCH_INVESTIGATION_NOT_FOUND' })
  assert.deepEqual(await store.getResearchRun(secondRun.runContext.runId), secondRunBeforeAttachment)
  assert.deepEqual((await store.getResearchInvestigation(investigation.investigationId)).runIds, ['run-second', 'run-first'])
})

test('investigation list validates pagination and persists only registered plan metadata', async () => {
  const store = createResearchRunStore({ pool: new MemoryResearchPool() })
  await assert.rejects(store.createResearchInvestigation({ question: ' ', requestedExperiments: [] }), { code: 'RESEARCH_INVESTIGATION_INVALID' })
  await assert.rejects(store.createResearchInvestigation({ question: 'Question', requestedExperiments: ['unknown'] }), { code: 'RESEARCH_INVESTIGATION_INVALID' })
  await assert.rejects(store.listResearchInvestigations({ limit: 101 }), { code: 'RESEARCH_INVESTIGATION_INVALID' })
  await assert.rejects(store.listResearchInvestigations({ offset: -1 }), { code: 'RESEARCH_INVESTIGATION_INVALID' })
  const emptyPlan = await store.createResearchInvestigation({ question: 'Question', requestedExperiments: [] })
  assert.deepEqual(emptyPlan.requestedExperiments, [])
  const row = store.pool.state.investigations.get(emptyPlan.investigationId)
  assert.deepEqual(row.requested_experiments, [])
})

test('historical rows without adjustment provenance hydrate as legacy-unknown without rewriting synthesis', async () => {
  const pool = new MemoryResearchPool()
  const store = createResearchRunStore({ pool })
  const run = makeRunResult({ runId: 'run-legacy-adjustment' })
  delete run.runContext.adjustmentMode
  delete run.dataset.adjustmentMode
  run.synthesis.provenance.adjustmentMode = undefined
  await store.saveResearchRun(run)
  const row = pool.state.runs.get(run.runContext.runId)
  delete row.adjustment_mode

  const retrieved = await store.getResearchRun(run.runContext.runId)
  assert.equal(retrieved.runContext.adjustmentMode, 'legacy-unknown')
  assert.equal(retrieved.dataset.adjustmentMode, 'legacy-unknown')
  assert.equal(retrieved.synthesis.provenance.adjustmentMode, undefined)
})
