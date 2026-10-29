import React, { useEffect, useMemo, useRef, useState } from 'react'
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
    term: 'Relative Volume / RVOL',
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

const HOME_TERMS = [
  { term: 'Top Setups', definition: 'The strongest current Qualified or Potential Setups, ranked by the existing scanner rule score. Select one to inspect it in Scan.' },
  { term: 'Recent Research', definition: 'Saved experiment runs. Completed means the run finished, not that its strategy is validated.' },
  { term: 'Market / Data Status', definition: 'Market status describes the trading session. Data status describes whether requested provider data is available and complete.' },
  { term: 'Operational Check', definition: 'Combines current scanner-data, paper-journal, and research-history warnings. Checking means requests are still pending; healthy means these checks report no warnings.' },
  { term: 'Paper Trading Shortcut', definition: 'Opens the simulated-trading journal. It does not place a live trade.' },
]

HELP_TERMS.push({ term: 'Bullish / Bearish Trend', definition: 'The current direction of the fast and slow price references. Bearish is a direction label, not a short-selling recommendation.' })

const PAGE_HELP = {
  home: {
    title: 'Home help',
    body:
      'Home is your quick operating view. Strongest Current Setups links into Scan, Recent Research shows saved research activity rather than validation, and Operational Check surfaces current scanner, paper-journal, or research-history warnings.',
  },
  scan: {
    title: 'Scan help',
    body:
      'Scan ranks the current rule-based scanner results. Select a symbol to see which checks are contributing, its current reference levels, and completed one-hour price candles. Setup Score is a rule score—not an estimated win probability.',
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
  const dialogRef = useRef(null)
  const pageHelp = PAGE_HELP[view] ?? PAGE_HELP.home

  useEffect(() => {
    if (!open || !dialogRef.current) return undefined
    const dialog = dialogRef.current
    const trigger = document.activeElement
    const previousOverflow = document.body.style.overflow
    dialog.showModal()
    dialog.querySelector('button')?.focus()
    document.body.style.overflow = 'hidden'
    return () => {
      dialog.close()
      document.body.style.overflow = previousOverflow
      if (trigger?.isConnected) trigger.focus()
    }
  }, [open])

  useEffect(() => {
    if (!open) {
      setQuery('')
    }
  }, [open])

  const visibleTerms = useMemo(() => {
    const normalized = query.trim().toLowerCase()

    const terms = view === 'home' ? HOME_TERMS : HELP_TERMS
    if (!normalized) return terms

    return terms.filter(({ term, definition }) =>
      `${term} ${definition}`.toLowerCase().includes(normalized),
    )
  }, [query, view])

  if (!open) return null

  return (
    <dialog
      ref={dialogRef}
      className="setup-help-backdrop"
      aria-labelledby="setup-help-title"
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return
        const controls = [...dialogRef.current.querySelectorAll('button, input')]
        const first = controls[0]
        const last = controls.at(-1)
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }}
      onCancel={(event) => { event.preventDefault(); onClose() }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose() }}
    >
      <aside
        className="setup-help-drawer"
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
            <X size={18} /> Close
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
            Setup Scores are rule-based research signals, not probabilities of profit or financial advice.
          </p>
        </footer>
      </aside>
    </dialog>
  )
}
