import { listResearchExperiments } from './registry.js'
import { normalizeResearchInvestigationInput } from './researchInvestigation.js'
import { executeResearchRunInWorker } from './researchRunWorkerClient.js'

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

  const selectedSymbols = new Set(symbols)
  const incompatible = requestedExperiments
    .map((id) => listResearchExperiments().find((experiment) => experiment.id === id))
    .filter((experiment) => experiment.requiredSymbols.some((symbol) => !selectedSymbols.has(symbol)))
  if (incompatible.length) {
    const details = incompatible.map((experiment) => {
      const missing = experiment.requiredSymbols.filter((symbol) => !selectedSymbols.has(symbol))
      return `${experiment.title} requires ${experiment.requiredSymbols.join(', ')} (missing ${missing.join(', ')})`
    })
    throw new Error(`Selected experiments do not match the selected symbols: ${details.join('; ')}. Add the required symbols or remove those experiments.`)
  }

  return { symbols, timeframe, requestedStart, requestedEnd, requestedExperiments }
}

export function executeWorkbenchRun(request, execute = executeResearchRunInWorker) {
  return execute(request)
}

export function setWorkbenchRunFailure(error, setFormError, setRunState) {
  setFormError(error.message)
  setRunState((current) => current === 'running' ? 'failed' : current)
}

export function createWorkbenchInvestigationRequest(question, requestedExperiments) {
  return normalizeResearchInvestigationInput({ question, requestedExperiments })
}

export function createInvestigationRunRequest(form, investigation) {
  if (!investigation || typeof investigation !== 'object') {
    throw new Error('Select an investigation before running its plan.')
  }
  const plan = normalizeResearchInvestigationInput({
    question: investigation.question,
    requestedExperiments: investigation.requestedExperiments,
  })
  return createWorkbenchRunRequest({ ...form, requestedExperiments: plan.requestedExperiments })
}
