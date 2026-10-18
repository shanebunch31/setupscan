import React from 'react'
import { describeAmbiguousTrades, summarizeRequiredResearchData } from './labEvidence.js'

export function ResearchDataStatus({ datasets, requiredSymbols, allowPartial = false }) {
  const summary = summarizeRequiredResearchData(datasets, requiredSymbols)
  if (summary.state === 'ready') return null

  let message
  if (summary.state === 'loading') {
    message = allowPartial && summary.availableSymbols.length
      ? `Loading real historical data for ${summary.loadingSymbols.join(', ')}. Current results use available symbols only.`
      : `Loading real historical data for ${summary.loadingSymbols.join(', ')}. No result is shown until the required data request finishes.`
  } else if (summary.state === 'partial' && allowPartial) {
    message = `Partial historical data: available for ${summary.availableSymbols.join(', ')}; unavailable for ${summary.unavailableSymbols.join(', ')}. Results below use available symbols only.`
  } else if (summary.state === 'partial') {
    message = `Partial historical data: available for ${summary.availableSymbols.join(', ')}; unavailable for ${summary.unavailableSymbols.join(', ')}. This experiment requires all of its listed symbols and was not run.`
  } else {
    message = `Historical data is unavailable for ${summary.unavailableSymbols.join(', ')}. This experiment was not run, so no performance results are available.`
  }

  return <div className="robustness-error">{message} Demo data is not substituted.</div>
}

export function AmbiguousCandleDisclosure({ metrics, label }) {
  return <p className="robustness-muted">{label ? `${label}: ` : ''}{describeAmbiguousTrades(metrics)}</p>
}
