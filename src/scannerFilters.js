import React from 'react'
import { ChevronDown, SlidersHorizontal } from 'lucide-react'

const h = React.createElement

export const SCANNER_TERM_EXPLANATIONS = Object.freeze({
  score: 'Points from six rule checks. Not a probability of success.',
  qualified: 'Meets the selected score cutoff; not a recommendation.',
  minimumScore: 'Rows below this score are hidden.',
  trend: 'Fast/slow price direction.',
  status: 'Score-based setup categories. Bearish does not mean SetupScan recommends a short.',
  vwap: "SetupScan's current running price reference; not a standard volume-weighted session VWAP.",
  ema: 'Two smoothed price references; their alignment adds points to the score.',
  rsi: 'Recent upward vs. downward price movement, on a 0–100 scale.',
  relativeVolume: "Current volume compared with SetupScan's historical average.",
  setupType: 'Names the pattern the rules detected.',
  signal: 'Summarizes the rule checks for this symbol.',
})

export function filterScannerResults(results, threshold) {
  if (!Array.isArray(results)) return []
  return results.filter((result) => Number.isFinite(result?.score) && result.score >= threshold)
}

export function ScannerFiltersButton({ open, onToggle = () => {} }) {
  return h('button', {
    className: 'filter-button',
    type: 'button',
    'aria-expanded': open,
    'aria-controls': 'scanner-threshold-filter',
    onClick: onToggle,
  }, h(SlidersHorizontal, { size: 15, 'aria-hidden': true }), ' Filters ', h(ChevronDown, { size: 14, 'aria-hidden': true }))
}

export function ScannerThresholdFilter({ open, threshold, onChange = () => {} }) {
  if (!open) return null
  return h('fieldset', { className: 'scanner-filter-controls', id: 'scanner-threshold-filter' },
    h('legend', null, 'Scanner filters'),
    h('label', { htmlFor: 'scanner-minimum-score' }, 'Minimum setup score'),
    h('input', {
      id: 'scanner-minimum-score',
      type: 'range',
      min: 40,
      max: 90,
      value: threshold,
      'aria-valuetext': `Minimum score ${threshold}`,
      onChange: (event) => onChange(Number(event.target.value)),
    }),
    h('output', { htmlFor: 'scanner-minimum-score' }, `Score ≥ ${threshold}`),
    h('p', { className: 'scanner-filter-help' }, `${SCANNER_TERM_EXPLANATIONS.minimumScore} ${SCANNER_TERM_EXPLANATIONS.score}`),
  )
}