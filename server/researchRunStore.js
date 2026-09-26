import { Pool } from 'pg'
import { describeDatabaseUrl } from './postgresPaperStore.js'
import { parseResearchJson, stringifyResearchJson } from '../src/research/researchRunSerialization.js'

export const RESEARCH_PERSISTENCE_SCHEMA_VERSION = 1

const schema = `
CREATE TABLE IF NOT EXISTS research_runs (
  run_id text PRIMARY KEY,
  requested_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('completed', 'partial', 'unavailable', 'failed')),
  fetch_status text NOT NULL CHECK (fetch_status IN ('complete', 'partial', 'unavailable', 'not-requested')),
  symbols text[] NOT NULL,
  timeframe text NOT NULL,
  requested_start text,
  requested_end text,
  requested_experiments text[] NOT NULL,
  dataset_id text,
  provider text,
  fetch_issues jsonb NOT NULL,
  dataset_metadata jsonb,
  synthesis jsonb NOT NULL,
  persistence_schema_version integer NOT NULL
);
CREATE INDEX IF NOT EXISTS research_runs_requested_at_idx ON research_runs (requested_at DESC, run_id DESC);
CREATE INDEX IF NOT EXISTS research_runs_dataset_id_idx ON research_runs (dataset_id);
CREATE INDEX IF NOT EXISTS research_runs_symbols_idx ON research_runs USING GIN (symbols);
CREATE INDEX IF NOT EXISTS research_runs_requested_experiments_idx ON research_runs USING GIN (requested_experiments);
CREATE TABLE IF NOT EXISTS research_run_experiments (
  run_id text NOT NULL REFERENCES research_runs(run_id) ON DELETE CASCADE,
  experiment_id text NOT NULL,
  execution_order integer NOT NULL,
  execution_status text NOT NULL CHECK (execution_status IN ('succeeded', 'failed', 'unavailable', 'skipped', 'incomplete')),
  error jsonb,
  record jsonb,
  PRIMARY KEY (run_id, experiment_id),
  UNIQUE (run_id, execution_order)
);
CREATE INDEX IF NOT EXISTS research_run_experiments_experiment_id_idx ON research_run_experiments (experiment_id);
CREATE INDEX IF NOT EXISTS research_run_experiments_status_idx ON research_run_experiments (experiment_id, execution_status);
`

const RUN_COLUMNS = `run_id, requested_at, status, fetch_status, symbols, timeframe,
  requested_start, requested_end, requested_experiments, dataset_id, provider,
  fetch_issues, dataset_metadata, synthesis, persistence_schema_version`

function required(value, label) {
  if (value === null || value === undefined || value === '') {
    const error = new Error(`Research run is missing ${label}`)
    error.name = 'ResearchRunValidationError'
    error.code = 'RESEARCH_RUN_INVALID'
    throw error
  }
}

function jsonParameter(value) {
  return value == null ? null : stringifyResearchJson(value)
}

function metadataOnlyDataset(dataset) {
  if (!dataset) return null
  const fetchResultsBySymbol = Object.fromEntries(Object.entries(dataset.fetchResultsBySymbol ?? {}).map(([symbol, fetchResult]) => {
    const { candles: _candles, ...metadata } = fetchResult ?? {}
    return [symbol, metadata]
  }))
  return {
    datasetId: dataset.datasetId,
    provider: dataset.provider,
    timeframe: dataset.timeframe,
    requestedStart: dataset.requestedStart,
    requestedEnd: dataset.requestedEnd,
    fetchResultsBySymbol,
  }
}

function validateResearchRunResult(result) {
  required(result?.runContext?.runId, 'runContext.runId')
  required(result?.runContext?.requestedAt, 'runContext.requestedAt')
  required(result?.runContext?.symbols, 'runContext.symbols')
  required(result?.runContext?.timeframe, 'runContext.timeframe')
  required(result?.runContext?.requestedExperiments, 'runContext.requestedExperiments')
  required(result?.status, 'status')
  required(result?.fetchStatus, 'fetchStatus')
  if (!Array.isArray(result.runContext.symbols) || !Array.isArray(result.runContext.requestedExperiments)
    || !Array.isArray(result.fetchIssues) || !Array.isArray(result.experimentResults) || !Array.isArray(result.records)) {
    const error = new Error('Research run must include fetchIssues, experimentResults, and records arrays')
    error.name = 'ResearchRunValidationError'
    error.code = 'RESEARCH_RUN_INVALID'
    throw error
  }
  if (!result.synthesis || typeof result.synthesis !== 'object') {
    const error = new Error('Research run is missing synthesis')
    error.name = 'ResearchRunValidationError'
    error.code = 'RESEARCH_RUN_INVALID'
    throw error
  }
  if (!['completed', 'partial', 'unavailable', 'failed'].includes(result.status)) {
    const error = new Error(`Unknown research run status: ${result.status}`)
    error.name = 'ResearchRunValidationError'
    error.code = 'RESEARCH_RUN_INVALID'
    throw error
  }
  if (!['complete', 'partial', 'unavailable', 'not-requested'].includes(result.fetchStatus)) {
    const error = new Error(`Unknown research fetch status: ${result.fetchStatus}`)
    error.name = 'ResearchRunValidationError'
    error.code = 'RESEARCH_RUN_INVALID'
    throw error
  }

  const recordsByExperiment = new Map()
  result.records.forEach((record) => {
    required(record?.id, 'records[].id')
    if (recordsByExperiment.has(record.id)) {
      const error = new Error(`Research run contains duplicate record id: ${record.id}`)
      error.name = 'ResearchRunValidationError'
      error.code = 'RESEARCH_RUN_INVALID'
      throw error
    }
    recordsByExperiment.set(record.id, record)
  })
  const experimentIds = new Set()
  result.experimentResults.forEach((execution) => {
    required(execution?.experimentId, 'experimentResults[].experimentId')
    if (experimentIds.has(execution.experimentId)) {
      const error = new Error(`Research run contains duplicate execution id: ${execution.experimentId}`)
      error.name = 'ResearchRunValidationError'
      error.code = 'RESEARCH_RUN_INVALID'
      throw error
    }
    experimentIds.add(execution.experimentId)
    if (!['succeeded', 'failed', 'unavailable', 'skipped', 'incomplete'].includes(execution.status)) {
      const error = new Error(`Unknown experiment execution status: ${execution.status}`)
      error.name = 'ResearchRunValidationError'
      error.code = 'RESEARCH_RUN_INVALID'
      throw error
    }
    const hasRecord = recordsByExperiment.has(execution.experimentId)
    if ((execution.status === 'failed' || execution.status === 'skipped') && hasRecord) {
      const error = new Error(`Failed/skipped experiment must not have a normalized record: ${execution.experimentId}`)
      error.name = 'ResearchRunValidationError'
      error.code = 'RESEARCH_RUN_INVALID'
      throw error
    }
    if (!['failed', 'skipped'].includes(execution.status) && !hasRecord) {
      const error = new Error(`Experiment result is missing its normalized record: ${execution.experimentId}`)
      error.name = 'ResearchRunValidationError'
      error.code = 'RESEARCH_RUN_INVALID'
      throw error
    }
  })
  for (const recordId of recordsByExperiment.keys()) {
    if (!experimentIds.has(recordId)) {
      const error = new Error(`Research record has no matching experiment execution: ${recordId}`)
      error.name = 'ResearchRunValidationError'
      error.code = 'RESEARCH_RUN_INVALID'
      throw error
    }
  }
}

function runFromRow(row, experimentRows) {
  const requestedAt = row.requested_at instanceof Date ? row.requested_at.toISOString() : row.requested_at
  const runContext = {
    runId: row.run_id,
    requestedAt,
    symbols: row.symbols,
    timeframe: row.timeframe,
    requestedStart: row.requested_start,
    requestedEnd: row.requested_end,
    requestedExperiments: row.requested_experiments,
  }
  const storedDataset = parseResearchJson(row.dataset_metadata)
  const dataset = storedDataset
    ? { ...storedDataset, rawSeriesBySymbol: null }
    : null
  const records = experimentRows.map((experiment) => parseResearchJson(experiment.record)).filter(Boolean)
  const experimentResults = experimentRows.map((experiment) => {
    const record = parseResearchJson(experiment.record)
    return {
      experimentId: experiment.experiment_id,
      status: experiment.execution_status,
      nativeOutput: record?.nativePayload ?? null,
      error: parseResearchJson(experiment.error),
    }
  })

  return {
    runContext,
    status: row.status,
    fetchStatus: row.fetch_status,
    fetchIssues: parseResearchJson(row.fetch_issues),
    dataset,
    experimentResults,
    records,
    synthesis: parseResearchJson(row.synthesis),
  }
}

function buildListQuery(filters = {}) {
  const clauses = []
  const values = []
  const add = (clause, value) => {
    values.push(value)
    clauses.push(clause.replace('?', `$${values.length}`))
  }

  if (filters.status) add('status = ?', filters.status)
  if (filters.datasetId) add('dataset_id = ?', filters.datasetId)
  if (Array.isArray(filters.symbols) && filters.symbols.length) add('symbols && ?::text[]', filters.symbols)
  if (filters.experimentId) {
    add(
      'EXISTS (SELECT 1 FROM research_run_experiments e WHERE e.run_id = research_runs.run_id AND e.experiment_id = ?)',
      filters.experimentId,
    )
  }

  const limit = filters.limit ?? 20
  const offset = filters.offset ?? 0
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    const error = new Error('limit must be an integer between 1 and 100')
    error.name = 'ResearchRunValidationError'
    error.code = 'RESEARCH_RUN_INVALID'
    throw error
  }
  if (!Number.isInteger(offset) || offset < 0) {
    const error = new Error('offset must be a non-negative integer')
    error.name = 'ResearchRunValidationError'
    error.code = 'RESEARCH_RUN_INVALID'
    throw error
  }
  values.push(limit)
  const limitParameter = `$${values.length}`
  values.push(offset)
  const offsetParameter = `$${values.length}`
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  return {
    text: `SELECT ${RUN_COLUMNS} FROM research_runs ${where} ORDER BY requested_at DESC, run_id DESC LIMIT ${limitParameter} OFFSET ${offsetParameter}`,
    values,
  }
}

export function createResearchRunStore({ connectionString = process.env.DATABASE_URL, pool, environment = process.env } = {}) {
  if (!pool) describeDatabaseUrl(connectionString)
  const clientPool = pool ?? new Pool({
    connectionString,
    ssl: environment.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
  })
  let ready

  async function init() {
    if (!ready) ready = clientPool.query(schema)
    await ready
  }

  async function saveResearchRun(result) {
    validateResearchRunResult(result)
    await init()
    const context = result.runContext
    const dataset = metadataOnlyDataset(result.dataset)
    const recordsByExperiment = new Map(result.records.map((record) => [record.id, record]))
    const client = await clientPool.connect()
    try {
      await client.query('BEGIN')
      await client.query(
        `INSERT INTO research_runs (${RUN_COLUMNS}) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
          $12::jsonb, $13::jsonb, $14::jsonb, $15
        )`,
        [
          context.runId,
          context.requestedAt,
          result.status,
          result.fetchStatus,
          context.symbols,
          context.timeframe,
          context.requestedStart,
          context.requestedEnd,
          context.requestedExperiments,
          result.dataset?.datasetId ?? null,
          result.dataset?.provider ?? null,
          stringifyResearchJson(result.fetchIssues),
          jsonParameter(dataset),
          stringifyResearchJson(result.synthesis),
          RESEARCH_PERSISTENCE_SCHEMA_VERSION,
        ],
      )

      for (let executionOrder = 0; executionOrder < result.experimentResults.length; executionOrder += 1) {
        const execution = result.experimentResults[executionOrder]
        const record = recordsByExperiment.get(execution.experimentId) ?? null
        await client.query(
          `INSERT INTO research_run_experiments
            (run_id, experiment_id, execution_order, execution_status, error, record)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)`,
          [
            context.runId,
            execution.experimentId,
            executionOrder,
            execution.status,
            jsonParameter(execution.error),
            jsonParameter(record),
          ],
        )
      }
      await client.query('COMMIT')
    } catch (error) {
      try {
        await client.query('ROLLBACK')
      } catch (rollbackError) {
        error.rollbackError = rollbackError
      }
      if (error.code === '23505' && error.constraint?.includes('research_runs')) {
        const duplicateError = new Error(`Research run already exists: ${context.runId}`)
        duplicateError.name = 'ResearchRunAlreadyExistsError'
        duplicateError.code = 'RESEARCH_RUN_EXISTS'
        duplicateError.cause = error
        throw duplicateError
      }
      throw error
    } finally {
      client.release()
    }
    return { runId: context.runId }
  }

  async function getResearchRun(runId) {
    await init()
    const runResult = await clientPool.query(`SELECT ${RUN_COLUMNS} FROM research_runs WHERE run_id = $1`, [runId])
    const row = runResult.rows[0]
    if (!row) return null
    const experiments = await clientPool.query(
      `SELECT experiment_id, execution_status, error, record
       FROM research_run_experiments WHERE run_id = $1 ORDER BY execution_order`,
      [runId],
    )
    return runFromRow(row, experiments.rows)
  }

  async function listResearchRuns(filters = {}) {
    await init()
    const query = buildListQuery(filters)
    const result = await clientPool.query(query.text, query.values)
    return result.rows.map((row) => {
      const dataset = parseResearchJson(row.dataset_metadata)
      return {
        runId: row.run_id,
        requestedAt: row.requested_at instanceof Date ? row.requested_at.toISOString() : row.requested_at,
        status: row.status,
        fetchStatus: row.fetch_status,
        symbols: row.symbols,
        timeframe: row.timeframe,
        requestedStart: row.requested_start,
        requestedEnd: row.requested_end,
        requestedExperiments: row.requested_experiments,
        datasetId: row.dataset_id,
        provider: row.provider,
        datasetMetadata: dataset,
        persistenceSchemaVersion: row.persistence_schema_version,
      }
    })
  }

  return { init, saveResearchRun, getResearchRun, listResearchRuns, pool: clientPool }
}