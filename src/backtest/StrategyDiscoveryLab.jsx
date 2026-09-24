import React from 'react'
import { HowToReadResults, MetricsGlossary, PlainEnglishTakeaway } from './MetricsGlossary.jsx'
import './robustness.css'

// Phase 1 of Strategy Discovery: a catalogue of candidate setup-family hypotheses to be tested
// systematically over time. No backtest has been implemented for any family yet, so every
// quantitative field is explicitly labeled as not-yet-run rather than filled with invented numbers.
const NOT_YET_RUN = 'Not yet run'

const STRATEGY_FAMILIES = [
  {
    key: 'momentum-breakout',
    label: 'Momentum / Breakout',
    whatItTests: 'Whether entering after price breaks and holds above a recent range, with expanding participation, leads to a measurably different outcome than the existing VWAP/EMA/RSI/RVOL score.',
    candidateConditions: [
      'Price closes above the prior N-bar high with above-average volume',
      'Consecutive higher highs / higher lows over a short lookback',
      'A pullback-and-reclaim of a broken level rather than a first-touch breakout',
    ],
    entryConcept: 'Enter on confirmation of the breakout (e.g. the close of the breakout bar or the next bar open), not on the first tick through the level.',
    exitConcept: 'A percent-based or ATR-based stop below the breakout level, with a fixed R-multiple target or a trailing exit — mirroring the existing baseline\u2019s trade-construction conventions for comparability.',
    historicalOutcomeMeasured: 'Whether breakout entries, as a family, show a different distribution of R-multiple outcomes than the existing baseline over the same historical symbols and period.',
  },
  {
    key: 'mean-reversion',
    label: 'Mean Reversion',
    whatItTests: 'Whether price extremes relative to a short-term average tend to revert, and whether that reversion is tradable after costs.',
    candidateConditions: [
      'RSI below a low threshold after an extended decline, inside a longer-term uptrend',
      'Price stretched a defined number of standard deviations below a moving average',
      'A reversal candle pattern following a sharp, high-volume down move',
    ],
    entryConcept: 'Enter on the first sign of stabilization after the extreme reading (e.g. a higher low or a close back above a short average), not at the extreme itself.',
    exitConcept: 'Target a return to the moving average or a fixed R-multiple, with a stop below the recent extreme.',
    historicalOutcomeMeasured: 'Whether mean-reversion entries show a different reversion rate and R-multiple distribution than a random or baseline comparison sample.',
  },
  {
    key: 'market-structure',
    label: 'Market Structure',
    whatItTests: 'Whether trading around defined structural levels (prior swing highs/lows, consolidation ranges, support/resistance) behaves differently than the existing indicator-based score.',
    candidateConditions: [
      'Price reclaiming a prior swing high after a retest',
      'A tightening range (lower highs and higher lows) resolving in one direction',
      'A failed breakdown below a well-tested support level',
    ],
    entryConcept: 'Enter on confirmation that the structural level held or was reclaimed, using the same next-candle entry convention as the existing baseline.',
    exitConcept: 'Stop beyond the structural level being tested; target the opposite boundary of the range or a fixed R-multiple.',
    historicalOutcomeMeasured: 'Whether structure-based entries show a measurably different outcome distribution than the existing baseline over the same historical data.',
  },
  {
    key: 'opening-range-time-of-day',
    label: 'Opening Range / Time-of-Day',
    whatItTests: 'Whether specific times of the trading session (e.g. the opening range, midday, or the final hour) show systematically different setup behavior.',
    candidateConditions: [
      'Breakout of the first N-minute opening range',
      'Reversal of an early move by a defined time of day',
      'Setups restricted to specific session windows to see whether time-of-day changes outcomes',
    ],
    entryConcept: 'Enter on confirmed breakout or reversal of the defined intraday window, using the same trade-construction conventions as the existing baseline.',
    exitConcept: 'A percent- or ATR-based stop with a fixed R-multiple target, or an end-of-session exit if the position is still open.',
    historicalOutcomeMeasured: 'Whether restricting entries to specific times of day changes the historical outcome distribution compared to the existing baseline, which is not time-of-day aware.',
  },
  {
    key: 'relative-strength',
    label: 'Relative Strength',
    whatItTests: 'Whether a symbol\u2019s strength or weakness relative to its peers (already explored descriptively in Research Experiment #1) can be turned into its own standalone setup family rather than only a confirmation filter.',
    candidateConditions: [
      'A symbol outperforming its peer group over a defined lookback, independent of the existing score',
      'A symbol underperforming its peer group sharply, as a mean-reversion-style relative setup',
      'Divergence between a symbol and a broad-market proxy',
    ],
    entryConcept: 'Enter when relative-strength or relative-weakness conditions are met on their own, without requiring the existing VWAP/EMA/RSI/RVOL score to also qualify.',
    exitConcept: 'Same stop/target conventions as the existing baseline, so results are comparable on a like-for-like basis.',
    historicalOutcomeMeasured: 'Whether relative-strength-only entries behave differently, as a standalone family, than the Experiment #1 relative-value confirmation already tested as an add-on filter.',
  },
  {
    key: 'volatility-expansion-contraction',
    label: 'Volatility Expansion / Contraction',
    whatItTests: 'Whether periods of unusually low volatility that then expand (or unusually high volatility that then contracts) carry information about subsequent outcomes.',
    candidateConditions: [
      'A volatility contraction (e.g. narrowing ATR or realized volatility) followed by an expansion move',
      'Entries specifically excluded from, or restricted to, the volatility regimes already classified in Research Experiments #5-#7',
      'A volatility-percentile threshold used as the setup trigger itself, rather than only as a filter on existing signals',
    ],
    entryConcept: 'Enter on confirmed expansion out of a contraction (or contraction after an expansion), using the same next-candle entry convention as the existing baseline.',
    exitConcept: 'Volatility-scaled stop and target distances, sized relative to the measured contraction or expansion rather than a fixed percentage.',
    historicalOutcomeMeasured: 'Whether volatility-expansion/contraction entries, as a standalone family, show a different outcome distribution than the existing baseline and than the volatility-regime classifications already studied.',
  },
  {
    key: 'market-context-regime',
    label: 'Market Context / Regime',
    whatItTests: 'Whether a setup family built directly around the causal trend/volatility/breadth regime classifications from Research Experiment #5 behaves differently as a primary signal, rather than only as a post-hoc breakdown of the existing baseline.',
    candidateConditions: [
      'Entries gated entirely on regime classification (e.g. only in an Uptrend + Low-volatility regime), with no VWAP/EMA/RSI/RVOL requirement',
      'Entries that require a regime transition (e.g. Downtrend to Uptrend) rather than a static regime reading',
    ],
    entryConcept: 'Enter purely on regime classification and transition, using the same next-candle entry convention as the existing baseline for comparability.',
    exitConcept: 'Same stop/target conventions as the existing baseline, or an exit tied to the regime classification changing.',
    historicalOutcomeMeasured: 'Whether regime-only entries behave differently than the existing baseline filtered by regime after the fact (already studied in Experiment #5).',
  },
  {
    key: 'event-context',
    label: 'Event Context — scheduled events only',
    whatItTests: 'Whether trading around known, scheduled calendar events (e.g. earnings dates, index rebalance dates, scheduled economic releases) shows different setup behavior. Limited for now to scheduled events only — no news-sentiment or unscheduled-event analysis.',
    candidateConditions: [
      'Entries taken only in a defined window before/after a scheduled event',
      'Entries specifically excluded from a window around a scheduled event, to see whether avoiding the event changes results',
    ],
    entryConcept: 'Enter using the same trade-construction conventions as the existing baseline, gated by proximity to a scheduled event date.',
    exitConcept: 'Same stop/target conventions as the existing baseline, or an exit forced before the next scheduled event.',
    historicalOutcomeMeasured: 'Whether proximity to a scheduled event changes the historical outcome distribution compared to the existing baseline, which does not currently account for scheduled events at all.',
  },
]

const STRATEGY_DISCOVERY_DEFINITIONS = [
  { term: 'Candidate hypothesis', description: 'An idea for a setup family that has been described and defined, but has not yet been backtested. Nothing here is a claim about how it would perform.' },
  { term: 'Sample size', description: 'How many historical trades a family\u2019s backtest would need to produce before its other statistics are meaningful. Not yet available for any family below.' },
  { term: 'Win rate', description: 'The share of trades that would close as winners, once a family is actually backtested. On its own it doesn\u2019t say how big the wins or losses were.' },
  { term: 'Profit factor', description: 'Total profit from winners divided by total loss from losers, once measured. Above 1 would mean winners outweighed losers over that sample.' },
  { term: 'Expectancy / Average R', description: 'The average result per trade, in R-multiples, once measured \u2014 before real-world costs and slippage.' },
  { term: 'Maximum drawdown', description: 'The worst peak-to-trough decline in cumulative R across a family\u2019s trade sequence, once measured.' },
  { term: 'In-sample vs. out-of-sample', description: 'In-sample means the data used to originally describe the hypothesis. Out-of-sample means a separate, later slice of data checked afterward. Every family below currently has neither, since no backtest has been run.' },
  { term: 'Cost sensitivity', description: 'How much a family\u2019s results would change once realistic execution costs (spread, slippage, commissions) are applied \u2014 the same before/low/moderate/high cost-tier approach used in the existing research labs.' },
]

const STRATEGY_DISCOVERY_HOW_TO_READ = [
  'Strategy discovery is different from strategy validation: discovery is about defining and cataloguing genuinely different hypotheses to test, while validation is the later, separate step of actually running each one on historical data, including an out-of-sample check.',
  'Testing many different setup families increases the chance that at least one will look good purely by chance \u2014 this is sometimes called multiple-comparisons or data-dredging risk. A family looking interesting after many were tried needs a much higher bar of evidence than one tested in isolation.',
  'Out-of-sample testing matters because a rule that was shaped (even implicitly, by which candidate conditions were chosen) around one stretch of data will tend to look better on that same stretch than on new data \u2014 the out-of-sample period is a more honest check.',
  'Execution costs matter because a family that looks profitable before costs can look very different after spread, slippage, and commissions are applied \u2014 which is why the existing labs report before/low/moderate/high cost tiers rather than a single frictionless number.',
  'Historical frequency is not the same thing as a future probability: a 60% historical win rate describes what already happened in one sample: it is not a guaranteed 60% chance for the next trade.',
  'Look-ahead bias \u2014 accidentally using information that would not have been available at the time of the signal \u2014 can make a backtest look far better than a strategy could have actually performed live. Every family here is defined so any future backtest would need to use only information available at or before the signal.',
]

function FamilyCard({ family }) {
  return (
    <div className="robustness-section">
      <div className="panel-heading compact">
        <div>
          <p className="eyebrow">CANDIDATE FAMILY</p>
          <h3>{family.label}</h3>
        </div>
        <span className="coming-soon">HYPOTHESIS ONLY · NOT YET TESTED</span>
      </div>
      <p className="robustness-muted">{family.whatItTests}</p>
      <div className="robustness-table-wrap">
        <table className="robustness-table">
          <tbody>
            <tr><td>Candidate setup conditions</td><td>{family.candidateConditions.join(' · ')}</td></tr>
            <tr><td>Entry concept</td><td>{family.entryConcept}</td></tr>
            <tr><td>Exit concept</td><td>{family.exitConcept}</td></tr>
            <tr><td>Historical outcome being measured</td><td>{family.historicalOutcomeMeasured}</td></tr>
          </tbody>
        </table>
      </div>
      <p className="robustness-muted">Quantitative results (not yet run for this family):</p>
      <div className="robustness-table-wrap">
        <table className="robustness-table">
          <thead><tr><th>Sample size</th><th>Win rate</th><th>Profit factor</th><th>Expectancy</th><th>Average R</th><th>Max drawdown</th><th>By year</th><th>By symbol</th><th>Cost sensitivity</th><th>In-sample / out-of-sample</th></tr></thead>
          <tbody>
            <tr>
              <td>{NOT_YET_RUN}</td><td>{NOT_YET_RUN}</td><td>{NOT_YET_RUN}</td><td>{NOT_YET_RUN}</td><td>{NOT_YET_RUN}</td>
              <td>{NOT_YET_RUN}</td><td>{NOT_YET_RUN}</td><td>{NOT_YET_RUN}</td><td>{NOT_YET_RUN}</td><td>{NOT_YET_RUN}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function StrategyDiscoveryLab() {
  return (
    <section className="robustness-lab panel">
      <div className="panel-heading compact">
        <div><p className="eyebrow">RESEARCH · STRATEGY DISCOVERY</p><h2>Strategy Discovery Lab</h2></div>
        <span className="coming-soon">EXPLORATORY RESEARCH · NO RESULTS YET</span>
      </div>
      <p className="robustness-disclaimer">
        This is a framework for systematically cataloguing and, over time, testing genuinely different trading setup families —
        rather than continuing to only optimize the existing VWAP/EMA/RSI/RVOL score. Candidate discovery is exploratory research.
        No backtest has been implemented for any family below yet, so no historical outcome, sample size, or performance figure is
        shown for any of them — every quantitative field is explicitly labeled as not yet run. Nothing here modifies the existing
        scanner, its scoring, paper trading, the Render worker, or the API. No family is claimed to be profitable, validated,
        predictive, or superior to the existing scanner.
      </p>
      <div className="robustness-section">
        <MetricsGlossary
          title="What does this mean?"
          intro="Plain-English explanations for the terms used in strategy discovery, ahead of any family actually being backtested."
          definitions={STRATEGY_DISCOVERY_DEFINITIONS}
        />
      </div>
      <div className="robustness-section">
        <HowToReadResults title="Strategy discovery vs. strategy validation" items={STRATEGY_DISCOVERY_HOW_TO_READ} />
      </div>

      <div className="robustness-section">
        <h3>Candidate strategy families</h3>
        <p className="robustness-muted">
          Eight candidate setup families are catalogued below. Each is a hypothesis to be defined precisely and, in a future phase,
          backtested with the same rigor (in-sample/out-of-sample split, execution-cost tiers, per-year and per-symbol breakdowns) as
          the existing research labs. None has been run yet, and no automatic strategy optimization is implemented here.
        </p>
      </div>
      {STRATEGY_FAMILIES.map((family) => <FamilyCard key={family.key} family={family} />)}

      <div className="robustness-section">
        <PlainEnglishTakeaway>
          This dashboard currently lists eight candidate strategy-family hypotheses only. No backtest has been run for any of them,
          so there is no historical outcome, win rate, expectancy, or drawdown to summarize yet, and nothing here should be read as
          evidence that any family works. As each family is actually backtested in a future phase, results will be reported the same
          way as the existing research labs — with sample sizes, cost sensitivity, and an explicit in-sample/out-of-sample split —
          before any conclusion is drawn.
        </PlainEnglishTakeaway>
      </div>

      <p className="research-note">
        Exploratory research only. This module does not change the production scanner, its scoring, paper trading, the Render
        worker, or the API, and it does not implement automatic strategy optimization.
      </p>
    </section>
  )
}
