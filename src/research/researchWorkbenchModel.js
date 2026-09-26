import { listResearchExperiments } from './registry.js'
import { runResearch } from './runResearch.js'

const experimentIds = new Set(listResearchExperiments().map(({ id }) => id))

export function createWorkbenchRunRequest(form) {
  const symbols = [...new Set(String(form.symbols ?? '').split(',').map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))]
  if (!symbols.length) throw new Error('Enter at least one symbol.')

  const timeframe = form.timeframe
  if (typeof timeframe !== 'string' || !timeframe.trim()) throw new Error('Choose a timeframe.')

  const requestedStart = form.requestedStart || null
  const requestedEnd = form.requestedEnd || null
  const startTime = requestedStart === null ? null : new Date(requestedStart).getTime()
  const endTime = requestedEnd === null ? null : new Date(requestedEnd).getTime()
  if (requestedStart !== null && !Number.isFinite(startTime)) throw new Error('Start date must be valid.')
  if (requestedEnd !== null && !Number.isFinite(endTime)) throw new Error('End date must be valid.')
  if (startTime !== null && endTime !== null && startTime >= endTime) throw new Error('Start date must be before end date.')

  const experimentSelection = form.requestedExperiments ?? []
  if (!Array.isArray(experimentSelection)) throw new Error('Requested experiments must be a list.')
  const requestedExperiments = [...new Set(experimentSelection)]
  const unknownExperiment = requestedExperiments.find((id) => !experimentIds.has(id))
  if (unknownExperiment) throw new Error(`Unknown research experiment: ${unknownExperiment}`)

  return { symbols, timeframe, requestedStart, requestedEnd, requestedExperiments }
}

export function executeWorkbenchRun(request, execute = runResearch) {
  return execute(request)
}