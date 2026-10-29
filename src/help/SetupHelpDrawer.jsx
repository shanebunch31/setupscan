import React, { useEffect, useMemo, useState } from 'react'
import { CircleHelp, Search, X } from 'lucide-react'
import { SCANNER_TERM_EXPLANATIONS } from '../scannerFilters.js'
import './setupHelp.css'

const HELP_TERMS = [
  {
    term: 'VWAP',
    definition: SCANNER_TERM_EXPLANATIONS.vwap,
  },
  {
    term: 'EMA 9 / 21',
    definition: SCANNER_TERM_EXPLANATIONS.ema,
  },
  {
    term: 'RSI',
    definition: SCANNER_TERM_EXPLANATIONS.rsi,
  },
  {
    term: 'Relative Volume',
    definition: SCANNER_TERM_EXPLANATIONS.relativeVolume,
  },
  {
    term: 'Setup Score',
    definition: SCANNER_TERM_EXPLANATIONS.score,
  },
  {
    term: 'Qualified Setup',
    definition:
      'The scanner\'s required qualification conditions are currently met. This is a rule label, not a recommendation or probability of success.',
  },
  {
    term: 'Potential Setup',
    definition:
      'The symbol has a strong rule-based score, but one or more required confirmations are still missing.',
  },
  {
    term: 'No Setup',
    definition:
      'SetupScan is not labeling the symbol as a qualifying setup right now. It does not predict what the symbol will do next.',
  },
  {
    term: 'Breakout / Reclaim',
    definition:
      'A scanner confirmation that checks the configured breakout or reclaim condition. It is one rule check, not a prediction.',
  },
  {
    term: 'Trend Confirmation',
    definition:
      'A short-term directional confirmation used by the scanner. It contributes to the rule-based setup assessment but does not forecast future price.',
  },
  {
    term: 'Market Data Status',
    definition:
      'Shows whether requested provider data loaded successfully and whether any symbols or historical data were unavailable or incomplete.',
  },
  {
    term: '1H Candles',
    definition:
      'Each candle summarizes one completed one-hour bar. The still-forming hour is excluded from the selected-symbol chart.',
  },
  {
    term: 'Range vs. Interval',
    definition:
      '1D, 3D, 5D, and ALL choose how much loaded chart history you see. 1H is the candle interval, so each candle still represents one hour.',
  },
]

const PAGE_HELP = {
  home: {
    title: 'Home help',
    body:
      'Home is your quick operating view. Strongest Current Setups links into Scan, Recent Research shows saved research activity rather than validation, and Operational Check surfaces current scanner, paper-journal, or research-history warnings.',
  },
  scan: {
    title: 'Scan help',
    body:
      'Scan ranks the current rule-based scanner results. Expand a symbol to see which checks are contributing, its current reference levels, and completed one-hour price candles. Setup Score is a rule score—not an estimated win probability.',
  },
  paper: {
    title: 'Paper Trading help',
    body:
      'Paper Trading is for simulated positions and journal review. Paper results do not establish live-trading profitability.',
  },
  backtest: {
    title: 'Backtest help',
    body:
      'Backtest summarizes historical samples under the current research assumptions. Historical results are descriptive and do not predict future performance.',
  },
  research: {
    title: 'Research help',
    body:
      'Research stores experiments, evidence, comparisons, and forward-validation work. A completed run means the experiment executed; it does not by itself validate or promote a strategy.',
  },
  settings: {
    title: 'Settings help',
    body:
      'Settings will hold application preferences and provider-related controls as those features are added.',
  },
}

export function SetupHelpDrawer({ open, view, onClose }) {
  const [query, setQuery] = useState('')
  const pageHelp = PAGE_HELP[view] ?? PAGE_HELP.home

  useEffect(() => {
    if (!open) return undefined

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [open, onClose])

  useEffect(() => {
    if (!open) {
      setQuery('')
    }
  }, [open])

  const visibleTerms = useMemo(() => {
    const normalized = query.trim().toLowerCase()

    if (!normalized) return HELP_TERMS

    return HELP_TERMS.filter(({ term, definition }) =>
      `${term} ${definition}`.toLowerCase().includes(normalized),
    )
  }, [query])

  if (!open) return null

  return (
    <div
      className="setup-help-backdrop"
      onMouseDown={onClose}
    >
      <aside
        className="setup-help-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="setup-help-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="setup-help-header">
          <div>
            <span className="setup-help-eyebrow">
              SETUPSCAN GUIDE
            </span>
            <h2 id="setup-help-title">Need help?</h2>
            <p>Plain-English explanations for the screen you are using.</p>
          </div>

          <button
            type="button"
            className="setup-help-close"
            onClick={onClose}
            aria-label="Close SetupScan help"
          >
            <X size={18} />
          </button>
        </header>

        <section className="setup-help-context">
          <CircleHelp size={18} />
          <div>
            <strong>{pageHelp.title}</strong>
            <p>{pageHelp.body}</p>
          </div>
        </section>

        <label className="setup-help-search">
          <Search size={15} aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search terms..."
            aria-label="Search SetupScan help terms"
          />
        </label>

        <section className="setup-help-glossary" aria-label="SetupScan glossary">
          <div className="setup-help-section-heading">
            <strong>Quick glossary</strong>
            <span>{visibleTerms.length} terms</span>
          </div>

          <div className="setup-help-term-list">
            {visibleTerms.length ? (
              visibleTerms.map(({ term, definition }) => (
                <article key={term} className="setup-help-term">
                  <strong>{term}</strong>
                  <p>{definition}</p>
                </article>
              ))
            ) : (
              <p className="setup-help-empty">
                No glossary terms match that search.
              </p>
            )}
          </div>
        </section>

        <footer className="setup-help-disclaimer">
          <strong>Research signals, not probabilities</strong>
          <p>
            SetupScan scores and labels summarize rule-based research conditions. They are not probabilities of success or financial advice.
          </p>
        </footer>
      </aside>
    </div>
  )
}
