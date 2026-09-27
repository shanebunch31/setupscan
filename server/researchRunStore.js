import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { describeDatabaseUrl } from './postgresPaperStore.js'
import { parseResearchJson, stringifyResearchJson } from '../src/research/researchRunSerialization.js'
import { normalizeResearchInvestigationInput, normalizeResearchRunId } from '../src/research/researchInvestigation.js'

export const RESEARCH_PERSISTENCE_SCHEMA_VERSION = 2
export const RESEARCH_INVESTIGATION_PERSISTENCE_SCHEMA_VERSION = 1

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
  ema_contract_version text NOT NULL DEFAULT 'legacy-unknown',
  dataset_id text,
  provider text,
  fetch_issues jsonb NOT NULL,
  dataset_metadata jsonb,
  synthesis jsonb NOT NULL,
  persistence_schema_version integer NOT NULL
);
ALTER TABLE research_runs ADD COLUMN IF NOT EXISTS ema_contract_version text NOT NULL DEFAULT 'legacy-unknown';
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
CREATE TABLE IF NOT EXISTS research_investigations (
  investigation_id text PRIMARY KEY,
  question text NOT NULL,
  status text NOT NULL CHECK (status IN ('active')),
  requested_experiments text[] NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  persistence_schema_version integer NOT NULL
);
CREATE INDEX IF NOT EXISTS research_investigations_created_at_idx ON research_investigations (created_at DESC, investigation_id DESC);
CREATE TABLE IF NOT EXISTS research_investigation_runs (
  investigation_id text NOT NULL REFERENCES research_investigations(investigation_id) ON DELETE CASCADE,
  run_id text NOT NULL REFERENCES research_runs(run_id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position >= 0),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (investigation_id, run_id),
  UNIQUE (investigation_id, position)
);
CREATE INDEX IF NOT EXISTS research_investigation_runs_run_id_idx ON research_investigation_runs (run_id);
`

const RUN_COLUMNS = `run_id, requested_at, status, fetch_status, symbols, timeframe,
  requested_start, requested_end, requested_experiments, ema_contract_version, dataset_id, provider,
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

function investigationNotFound(investigationId) {
  const error = new Error(`Research investigation not found: ${investigationId}`)
  error.name = 'ResearchInvestigationNotFoundError'
  error.code = 'RESEARCH_INVESTIGATION_NOT_FOUND'
  error.statusCode = 404
  return error
}

function researchRunNotFound(runId) {
  const error = new Error(`Research run not found: ${runId}`)
  error.name = 'ResearchRunNotFoundError'
  error.code = 'RESEARCH_RUN_NOT_FOUND'
  error.statusCode = 404
  return error
}

function investigationRunExists(runId) {
  const error = new Error(`Research run is already attached to this investigation: ${runId}`)
  error.name = 'ResearchInvestigationRunExistsError'
  error.code = 'RESEARCH_INVESTIGATION_RUN_EXISTS'
  error.statusCode = 409
  return error
}

function dateString(value) {
  return value instanceof Date ? value.toISOString() : value
}

function investigationFromRows(row, runRows = []) {
  return {
    investigationId: row.investigation_id,
    question: row.question,
    status: row.status,
    createdAt: dateString(row.created_at),
    updatedAt: dateString(row.updated_at),
    requestedExperiments: row.requested_experiments,
    runIds: runRows.map((run) => run.run_id),
    persistenceSchemaVersion: row.persistence_schema_version,
  }
}

function investigationListBounds(filters = {}) {
  const limit = filters.limit ?? 20
  const offset = filters.offset ?? 0
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    const error = new Error('limit must be an integer between 1 and 100')
    error.name = 'ResearchInvestigationValidationError'
    error.code = 'RESEARCH_INVESTIGATION_INVALID'
    throw error
  }
  if (!Number.isInteger(offset) || offset < 0) {
    const error = new Error('offset must be a non-negative integer')
    error.name = 'ResearchInvestigationValidationError'
    error.code = 'RESEARCH_INVESTIGATION_INVALID'
    throw error
  }
  return { limit, offset }
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
  required(result?.runContext?.emaContractVersion, 'runContext.emaContractVersion')
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
    emaContractVersion: row.ema_contract_version ?? 'legacy-unknown',
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
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
          $13::jsonb, $14::jsonb, $15::jsonb, $16
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
          context.emaContractVersion,
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

  async function getResearchRunComparisonSnapshot(runId) {
    await init()
    const result = await clientPool.query(
      'SELECT run_id, requested_at, dataset_id, ema_contract_version, synthesis FROM research_runs WHERE run_id = $1',
      [runId],
    )
    const row = result.rows[0]
    if (!row) return null
    return {
      runId: row.run_id,
      requestedAt: row.requested_at instanceof Date ? row.requested_at.toISOString() : row.requested_at,
      datasetId: row.dataset_id,
      emaContractVersion: row.ema_contract_version ?? 'legacy-unknown',
      synthesis: parseResearchJson(row.synthesis),
    }
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
        emaContractVersion: row.ema_contract_version ?? 'legacy-unknown',
        datasetId: row.dataset_id,
        provider: row.provider,
        datasetMetadata: dataset,
        persistenceSchemaVersion: row.persistence_schema_version,
      }
    })
  }

  async function createResearchInvestigation(input) {
    const normalized = normalizeResearchInvestigationInput(input)
    await init()
    const investigationId = `investigation_${randomUUID()}`
    const result = await clientPool.query(
      `INSERT INTO research_investigations
        (investigation_id, question, status, requested_experiments, created_at, updated_at, persistence_schema_version)
       VALUES ($1, $2, 'active', $3, now(), now(), $4)
       RETURNING investigation_id, question, status, requested_experiments, created_at, updated_at, persistence_schema_version`,
      [investigationId, normalized.question, normalized.requestedExperiments, RESEARCH_INVESTIGATION_PERSISTENCE_SCHEMA_VERSION],
    )
    return investigationFromRows(result.rows[0])
  }

  async function getResearchInvestigation(investigationId) {
    await init()
    const result = await clientPool.query(
      `SELECT investigation_id, question, status, requested_experiments, created_at, updated_at, persistence_schema_version
       FROM research_investigations WHERE investigation_id = $1`,
      [investigationId],
    )
    const row = result.rows[0]
    if (!row) return null
    const runs = await clientPool.query(
      `SELECT run_id FROM research_investigation_runs
       WHERE investigation_id = $1 ORDER BY position`,
      [investigationId],
    )
    return investigationFromRows(row, runs.rows)
  }

  async function listResearchInvestigations(filters = {}) {
    await init()
    const { limit, offset } = investigationListBounds(filters)
    const result = await clientPool.query(
      `SELECT investigation_id, question, status, requested_experiments, created_at, updated_at, persistence_schema_version
       FROM research_investigations ORDER BY created_at DESC, investigation_id DESC LIMIT $1 OFFSET $2`,
      [limit, offset],
    )
    if (!result.rows.length) return []
    const investigationIds = result.rows.map((row) => row.investigation_id)
    const runResult = await clientPool.query(
      `SELECT investigation_id, run_id FROM research_investigation_runs
       WHERE investigation_id = ANY($1::text[]) ORDER BY investigation_id, position`,
      [investigationIds],
    )
    const runsByInvestigation = new Map(investigationIds.map((id) => [id, []]))
    runResult.rows.forEach((run) => runsByInvestigation.get(run.investigation_id)?.push(run))
    return result.rows.map((row) => investigationFromRows(row, runsByInvestigation.get(row.investigation_id)))
  }

  async function attachResearchRunToInvestigation(investigationId, runId) {
    const normalizedRunId = normalizeResearchRunId(runId)
    await init()
    const client = await clientPool.connect()
    try {
      await client.query('BEGIN')
      const investigation = await client.query(
        'SELECT investigation_id FROM research_investigations WHERE investigation_id = $1 FOR UPDATE',
        [investigationId],
      )
      if (!investigation.rows[0]) throw investigationNotFound(investigationId)

      const run = await client.query('SELECT run_id FROM research_runs WHERE run_id = $1', [normalizedRunId])
      if (!run.rows[0]) throw researchRunNotFound(normalizedRunId)

      const existing = await client.query(
        'SELECT run_id FROM research_investigation_runs WHERE investigation_id = $1 AND run_id = $2',
        [investigationId, normalizedRunId],
      )
      if (existing.rows[0]) throw investigationRunExists(normalizedRunId)

      const positionResult = await client.query(
        'SELECT COALESCE(MAX(position), -1) + 1 AS next_position FROM research_investigation_runs WHERE investigation_id = $1',
        [investigationId],
      )
      const position = Number(positionResult.rows[0]?.next_position ?? 0)
      await client.query(
        `INSERT INTO research_investigation_runs (investigation_id, run_id, position, created_at)
         VALUES ($1, $2, $3, now())`,
        [investigationId, normalizedRunId, position],
      )
      await client.query('UPDATE research_investigations SET updated_at = now() WHERE investigation_id = $1', [investigationId])
      await client.query('COMMIT')
    } catch (error) {
      try {
        await client.query('ROLLBACK')
      } catch (rollbackError) {
        error.rollbackError = rollbackError
      }
      if (error.code === '23505' && error.constraint?.includes('research_investigation_runs')) {
        throw investigationRunExists(normalizedRunId)
      }
      throw error
    } finally {
      client.release()
    }
    return getResearchInvestigation(investigationId)
  }

  return {
    init,
    saveResearchRun,
    getResearchRun,
    getResearchRunComparisonSnapshot,
    listResearchRuns,
    createResearchInvestigation,
    getResearchInvestigation,
    listResearchInvestigations,
    attachResearchRunToInvestigation,
    pool: clientPool,
  }
}
