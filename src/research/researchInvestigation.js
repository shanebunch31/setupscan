import { getResearchExperiment, listResearchExperiments } from './registry.js'

export const RESEARCH_INVESTIGATION_STATUSES = Object.freeze(['active'])
export const RESEARCH_INVESTIGATION_MAX_QUESTION_LENGTH = 1000

function invalid(message) {
  const error = new Error(message)
  error.name = 'ResearchInvestigationValidationError'
  error.code = 'RESEARCH_INVESTIGATION_INVALID'
  return error
}

export function normalizeResearchQuestion(question) {
  if (typeof question !== 'string') throw invalid('question must be a string')
  const normalized = question.trim()
  if (!normalized) throw invalid('question must not be empty')
  if (normalized.length > RESEARCH_INVESTIGATION_MAX_QUESTION_LENGTH) {
    throw invalid(`question must be at most ${RESEARCH_INVESTIGATION_MAX_QUESTION_LENGTH} characters`)
  }
  return normalized
}

export function normalizeInvestigationExperiments(requestedExperiments) {
  if (requestedExperiments === undefined) return listResearchExperiments().map(({ id }) => id)
  if (!Array.isArray(requestedExperiments)) throw invalid('requestedExperiments must be an array of registry experiment ids')

  const normalized = []
  const seen = new Set()
  requestedExperiments.forEach((experimentId) => {
    if (typeof experimentId !== 'string' || !getResearchExperiment(experimentId)) {
      throw invalid(`unknown experiment id "${experimentId}"`)
    }
    if (!seen.has(experimentId)) {
      seen.add(experimentId)
      normalized.push(experimentId)
    }
  })
  return normalized
}

export function normalizeResearchInvestigationInput(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw invalid('investigation input must be an object')
  }
  return {
    question: normalizeResearchQuestion(input.question),
    requestedExperiments: normalizeInvestigationExperiments(input.requestedExperiments),
  }
}

export function normalizeResearchRunId(runId) {
  if (typeof runId !== 'string' || !runId.trim()) throw invalid('runId must be a non-empty string')
  return runId.trim()
}

export function appendInvestigationRunId(runIds, runId) {
  const normalizedRunId = normalizeResearchRunId(runId)
  if (!Array.isArray(runIds)) throw invalid('runIds must be an array')
  if (runIds.includes(normalizedRunId)) {
    const error = new Error(`Research run is already attached to this investigation: ${normalizedRunId}`)
    error.name = 'ResearchInvestigationRunExistsError'
    error.code = 'RESEARCH_INVESTIGATION_RUN_EXISTS'
    throw error
  }
  return [...runIds, normalizedRunId]
}