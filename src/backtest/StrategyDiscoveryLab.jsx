import React, { useMemo } from 'react'
import { HowToReadResults, MetricsGlossary, PlainEnglishTakeaway } from './MetricsGlossary.jsx'
import { runStrategyDiscoveryBatchA } from './strategyDiscovery/discoveryRunner.js'
import { runBreakoutContextResearch } from './strategyDiscovery/breakoutContextResearch.js'
import { runRegularSessionBreakoutResearch, compareToBatchA } from './strategyDiscovery/regularSessionBreakout.js'
import './robustness.css'

// Phase 1 of Strategy Discovery: a catalogue of candidate setup-family hypotheses. Batch A wires
// four of the eight families (below) to real, causal backtests once real Alpaca historical data is
// available; the remaining families have no implementation yet, so their quantitative fields stay
// explicitly labeled as not-yet-run rather than filled with invented numbers.
const NOT_YET_RUN = 'Not yet run'

const formatPercent = (value) => `${(value * 100).toFixed(1)}%`
const formatR = (value) => (value === Infinity ? '∞' : value === null || value === undefined ? '—' : `${value.toFixed(2)}R`)
const formatPf = (value) => (value === Infinity ? '∞' : value.toFixed(2))

const STRATEGY_FAMILIES = [
  {
    key: 'momentum-breakout',
    experimentId: 'momentum-breakout-v1',
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
    experimentId: 'mean-reversion-v1',
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
    experimentId: 'prior-day-high-reclaim-v1',
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
    experimentId: 'volatility-compression-expansion-v1',
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

function BreakdownRows({ rows }) {
  return (
    <div className="robustness-table-wrap">
      <table className="robustness-table">
        <thead><tr><th /><th>Occurrences</th><th>Win rate</th><th>Profit factor</th><th>Average R</th><th>Total R</th><th>Max DD</th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row.label}><td>{row.label}</td><td>{row.occurrenceCount}</td><td>{formatPercent(row.winRate)}</td><td>{formatPf(row.profitFactor)}</td><td>{formatR(row.averageR)}</td><td>{formatR(row.totalR)}</td><td>{formatR(row.maximumDrawdown)}</td></tr>)}</tbody>
      </table>
    </div>
  )
}

function FamilyResult({ result }) {
  const { summary, secondaryOutcomes } = result
  return (
    <>
      <p className="robustness-muted">Batch A result (real Alpaca historical data, causal signal generation, next-candle entry):</p>
      <div className="robustness-table-wrap">
        <table className="robustness-table">
          <thead><tr><th>Sample size</th><th>Win rate</th><th>Profit factor</th><th>Expectancy</th><th>Average R</th><th>Median R</th><th>Max drawdown</th><th>Avg hold (bars)</th><th>Avg MFE</th><th>Avg MAE</th></tr></thead>
          <tbody>
            <tr>
              <td>{summary.overall.occurrenceCount}</td>
              <td>{formatPercent(summary.overall.winRate)}</td>
              <td>{formatPf(summary.overall.profitFactor)}</td>
              <td>{formatR(summary.overall.expectancy)}</td>
              <td>{formatR(summary.overall.averageR)}</td>
              <td>{formatR(summary.overall.medianR)}</td>
              <td>{formatR(summary.overall.maximumDrawdown)}</td>
              <td>{summary.overall.averageHoldingBars.toFixed(1)}</td>
              <td>{formatR(summary.overall.averageMfeR)}</td>
              <td>{formatR(summary.overall.averageMaeR)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="robustness-muted">
        Secondary outcomes — +1R before -1R within 5 candles: {secondaryOutcomes.plus1RBefore1RWithin5.occurrenceCount} occurrences,{' '}
        {formatPercent(secondaryOutcomes.plus1RBefore1RWithin5.winRate)} win rate. +2R before -1R within 10 candles:{' '}
        {secondaryOutcomes.plus2RBefore1RWithin10.occurrenceCount} occurrences, {formatPercent(secondaryOutcomes.plus2RBefore1RWithin10.winRate)} win rate.
      </p>
      <p className="robustness-muted">Performance by year</p>
      <BreakdownRows rows={summary.byYear} />
      <p className="robustness-muted">Performance by symbol</p>
      <BreakdownRows rows={summary.bySymbol} />
      <p className="robustness-muted">In-sample (Development) vs. out-of-sample (2025) vs. current holdout (2026 YTD)</p>
      <BreakdownRows rows={summary.byPeriod} />
      <p className="robustness-muted">Cost sensitivity (research-assumption basis-point tiers)</p>
      <div className="robustness-table-wrap">
        <table className="robustness-table">
          <thead><tr><th>Cost tier</th><th>Occurrences</th><th>Win rate</th><th>Profit factor</th><th>Average R</th></tr></thead>
          <tbody>{summary.costTiers.map((tier) => <tr key={tier.label}><td>{tier.label}</td><td>{tier.metrics.occurrenceCount}</td><td>{formatPercent(tier.metrics.winRate)}</td><td>{formatPf(tier.metrics.profitFactor)}</td><td>{formatR(tier.metrics.averageR)}</td></tr>)}</tbody>
        </table>
      </div>
      <p className="robustness-muted">
        Excluded from the statistics above (documented, not guessed): {summary.excluded.ambiguousCount} occurrence(s) where stop and
        target both fell within the same candle (intrabar order undeterminable), {summary.excluded.insufficientDataCount} with
        insufficient forward data, {summary.excluded.outsideResearchWindowCount} outside the defined research windows.
      </p>
    </>
  )
}

function FamilyCard({ family, result, dataUnavailableReason }) {
  return (
    <div className="robustness-section">
      <div className="panel-heading compact">
        <div>
          <p className="eyebrow">CANDIDATE FAMILY</p>
          <h3>{family.label}</h3>
        </div>
        <span className="coming-soon">{family.experimentId ? 'BATCH A · IMPLEMENTED' : 'HYPOTHESIS ONLY · NOT YET TESTED'}</span>
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
      {result ? (
        <FamilyResult result={result} />
      ) : (
        <>
          <p className="robustness-muted">
            {family.experimentId
              ? `Quantitative results (${dataUnavailableReason ?? 'not yet run for this family'}):`
              : 'Quantitative results (not yet run for this family):'}
          </p>
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
        </>
      )}
    </div>
  )
}

function ReproducibilityInfo({ batch, label = 'Batch A' }) {
  return (
    <div className="robustness-section">
      <h3>Reproducibility &amp; data provenance ({label})</h3>
      <div className="robustness-table-wrap">
        <table className="robustness-table">
          <thead><tr><th>Symbol</th><th>Provider</th><th>Candles</th><th>Date range</th><th>Duplicates removed</th></tr></thead>
          <tbody>{batch.datasetInfo.map((dataset) => <tr key={dataset.symbol}><td>{dataset.symbol}</td><td>{dataset.provider}</td><td>{dataset.candleCount}</td><td>{dataset.start?.slice(0, 10)} – {dataset.end?.slice(0, 10)}</td><td>{dataset.duplicatesRemoved}</td></tr>)}</tbody>
        </table>
      </div>
      <p className="robustness-muted">
        Timeframe: {batch.timeframe} · Universe: {batch.universe.join(', ')} · Generated at: {batch.generatedAt} · Git commit: {batch.gitCommit}
      </p>
    </div>
  )
}

const BATCH_B_DEFINITIONS = [
  { term: 'Frozen baseline', description: 'Batch B reuses the exact, unmodified Batch A Momentum Breakout signal, entry, stop, and outcome rules. Nothing about which signals qualify is changed here \u2014 only how the already-qualifying signals are grouped for reporting.' },
  { term: 'Context dimension', description: 'One way of grouping the frozen breakout signals by a condition that was true at (or before) the signal candle \u2014 e.g. what time of day it fired, or whether the broader market was trending up.' },
  { term: 'Time of Day', description: 'Which part of the U.S. trading session (Eastern time) the signal candle fell in.' },
  { term: 'Market Trend Regime', description: 'A causal, predefined classification (reused unchanged from Research Experiment #5) of whether the broader market looked like an uptrend, downtrend, or mixed at the time of the signal.' },
  { term: 'Volatility Regime', description: 'A causal, predefined classification (reused unchanged from Research Experiment #5) of whether recent market volatility was low, medium, or high at the time of the signal.' },
  { term: 'Relative Strength', description: 'A causal, predefined check (reused unchanged from Research Experiment #1) of whether the symbol was outperforming its peers over a fixed trailing lookback at the time of the signal.' },
  { term: 'VWAP Context', description: 'Whether the signal candle closed above or at/below that day\u2019s running session VWAP.' },
  { term: 'Opening-Range Context', description: 'Whether the signal candle\u2019s high cleared the high of that trading day\u2019s first observed candle (a simple, non-optimized opening-range definition given the 1-hour candle data available).' },
  { term: 'Prior-Day Context', description: 'Whether the signal candle\u2019s high also cleared the previous completed trading day\u2019s high.' },
  { term: 'Volume Strength', description: 'A simple, predefined split of how far above the required 1.2x volume threshold the signal\u2019s actual volume was.' },
  { term: 'Low-evidence bucket', description: 'A context bucket with fewer than 100 occurrences \u2014 per the Strategy Discovery Protocol, treated as exploratory only, not a basis for any conclusion.' },
]

const BATCH_B_HOW_TO_READ = [
  'Every table below slices the same frozen Batch A breakout signals by one context condition at a time \u2014 no signal definition, entry rule, stop, or outcome window is changed anywhere in Batch B.',
  'These are descriptive historical associations: a bucket showing a different win rate or expectancy in this sample describes what already happened when that condition was present, not a probability or guarantee for the next signal.',
  'Eight independent context dimensions are tested here. Looking at many slices increases the chance that at least one will look interesting purely by chance \u2014 treat any single standout bucket with the same caution as any other multiple-comparisons result.',
  'Buckets flagged as low evidence (fewer than 100 occurrences) are shown for completeness but should not be used to draw conclusions on their own.',
  'No context bucket is ranked, selected, or called better, best, validated, profitable, or \u201cthe edge\u201d \u2014 including in the takeaway below.',
]

function DimensionSection({ dimension }) {
  return (
    <div className="robustness-section">
      <h3>{dimension.label}</h3>
      <div className="robustness-table-wrap">
        <table className="robustness-table">
          <thead><tr><th>Bucket</th><th>Occurrences</th><th>Evidence</th><th>Win rate</th><th>PF</th><th>Expectancy</th><th>Median R</th><th>Total R</th><th>Max DD</th><th>Avg hold</th><th>Avg MFE</th><th>Avg MAE</th></tr></thead>
          <tbody>{dimension.buckets.map((bucket) => (
            <tr key={bucket.label}>
              <td>{bucket.label}</td>
              <td>{bucket.summary.overall.occurrenceCount}</td>
              <td>{bucket.lowEvidence ? 'Low evidence (<100)' : 'OK'}</td>
              <td>{formatPercent(bucket.summary.overall.winRate)}</td>
              <td>{formatPf(bucket.summary.overall.profitFactor)}</td>
              <td>{formatR(bucket.summary.overall.expectancy)}</td>
              <td>{formatR(bucket.summary.overall.medianR)}</td>
              <td>{formatR(bucket.summary.overall.totalR)}</td>
              <td>{formatR(bucket.summary.overall.maximumDrawdown)}</td>
              <td>{bucket.summary.overall.averageHoldingBars.toFixed(1)}</td>
              <td>{formatR(bucket.summary.overall.averageMfeR)}</td>
              <td>{formatR(bucket.summary.overall.averageMaeR)}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {dimension.buckets.map((bucket) => (
        <details key={bucket.label} className="robustness-section">
          <summary>{bucket.label} — Development/OOS/Holdout, by symbol, cost sensitivity</summary>
          <p className="robustness-muted">By research period</p>
          <BreakdownRows rows={bucket.summary.byPeriod} />
          <p className="robustness-muted">By symbol</p>
          <BreakdownRows rows={bucket.summary.bySymbol} />
          <p className="robustness-muted">Cost sensitivity (research-assumption basis-point tiers)</p>
          <div className="robustness-table-wrap">
            <table className="robustness-table">
              <thead><tr><th>Cost tier</th><th>Occurrences</th><th>Win rate</th><th>Profit factor</th><th>Average R</th></tr></thead>
              <tbody>{bucket.summary.costTiers.map((tier) => <tr key={tier.label}><td>{tier.label}</td><td>{tier.metrics.occurrenceCount}</td><td>{formatPercent(tier.metrics.winRate)}</td><td>{formatPf(tier.metrics.profitFactor)}</td><td>{formatR(tier.metrics.averageR)}</td></tr>)}</tbody>
            </table>
          </div>
          <p className="robustness-muted">
            Excluded from this bucket\u2019s statistics (documented, not guessed): {bucket.summary.excluded.ambiguousCount} ambiguous
            stop/target bar(s), {bucket.summary.excluded.insufficientDataCount} with insufficient forward data,{' '}
            {bucket.summary.excluded.outsideResearchWindowCount} outside the defined research windows.
          </p>
        </details>
      ))}
    </div>
  )
}

function BreakoutContextResearchSection({ datasets }) {
  const batchB = useMemo(() => runBreakoutContextResearch(datasets), [datasets])

  const takeawayText = useMemo(() => {
    if (!batchB.available) {
      return `Batch B has not run yet because real Alpaca historical data for ${batchB.missingSymbols?.join(', ') ?? 'SPY, QQQ, IWM'} is not currently available. No results are shown, and none have been invented.`
    }
    const spreads = batchB.dimensions
      .map((dimension) => {
        const withOccurrences = dimension.buckets.filter((bucket) => bucket.summary.overall.occurrenceCount > 0)
        if (withOccurrences.length < 2) return null
        const expectancies = withOccurrences.map((bucket) => bucket.summary.overall.expectancy)
        return Math.max(...expectancies) - Math.min(...expectancies)
      })
      .filter((spread) => spread !== null)
    const meaningfulSpreadCount = spreads.filter((spread) => spread >= 0.1).length
    const lowEvidenceDimensions = batchB.dimensions.filter((dimension) => dimension.buckets.some((bucket) => bucket.lowEvidence)).map((dimension) => dimension.label)
    return `Across ${batchB.totalQualifyingSignals} qualifying frozen Momentum Breakout signals, ${meaningfulSpreadCount} of the ${spreads.length} context dimensions with at least two populated buckets showed an expectancy spread of 0.10R or more between buckets in this sample.${lowEvidenceDimensions.length ? ` ${lowEvidenceDimensions.join(', ')} include at least one bucket below the protocol\u2019s 100-occurrence low-evidence threshold.` : ''} These are descriptive historical associations between context and the frozen baseline\u2019s past outcomes only \u2014 they are not probabilities or guarantees, and no context bucket is identified here as better, best, validated, profitable, or \u201cthe edge\u201d.`
  }, [batchB])

  return (
    <section className="robustness-lab panel">
      <div className="panel-heading compact">
        <div><p className="eyebrow">RESEARCH · STRATEGY DISCOVERY · BATCH B</p><h2>Batch B — Breakout Context Research</h2></div>
        <span className="coming-soon">DESCRIPTIVE ONLY · FROZEN BASELINE</span>
      </div>
      <p className="robustness-disclaimer">
        Investigates which market/context conditions are historically associated with different behavior of the frozen Batch A
        Momentum Breakout signal. The breakout definition itself \u2014 signal detection, entry, stop, and outcome windows \u2014 is
        reused completely unmodified; only the grouping of already-qualifying signals changes across this page. No threshold is
        optimized, no context bucket is selected or declared a winner, and nothing here changes the production scanner, paper
        trading, the Render worker, or the API.
      </p>
      <div className="robustness-section">
        <MetricsGlossary title="What does this mean?" intro="Plain-English explanations for the terms used in Batch B context research." definitions={BATCH_B_DEFINITIONS} />
      </div>
      <div className="robustness-section">
        <HowToReadResults title="How to read this" items={BATCH_B_HOW_TO_READ} />
      </div>
      {!batchB.available ? (
        <div className="robustness-error">
          Batch B is waiting on real Alpaca historical data for {batchB.missingSymbols?.join(', ') ?? 'SPY, QQQ, IWM'}. This lab
          never substitutes demo data.
        </div>
      ) : (
        <>
          <div className="robustness-section">
            <h3>Frozen Batch A Momentum Breakout definition (reused unchanged)</h3>
            <div className="robustness-table-wrap">
              <table className="robustness-table">
                <tbody>
                  <tr><td>Hypothesis</td><td>{batchB.frozenBreakoutDefinition.hypothesis}</td></tr>
                  <tr><td>Lookback / volume multiple</td><td>{batchB.frozenBreakoutDefinition.parameters.lookbackBars} candles / {batchB.frozenBreakoutDefinition.parameters.volumeMultiple}x</td></tr>
                  <tr><td>Risk definition</td><td>{batchB.frozenBreakoutDefinition.parameters.riskDefinition}</td></tr>
                  <tr><td>Primary / secondary outcome</td><td>{batchB.frozenBreakoutDefinition.parameters.primaryOutcome} / {batchB.frozenBreakoutDefinition.parameters.secondaryOutcome}</td></tr>
                  <tr><td>Total qualifying signals in this sample</td><td>{batchB.totalQualifyingSignals}</td></tr>
                </tbody>
              </table>
            </div>
          </div>
          <div className="robustness-section"><ReproducibilityInfo batch={batchB} label="Batch B" /></div>
          {batchB.dimensions.map((dimension) => <DimensionSection key={dimension.key} dimension={dimension} />)}
          <div className="robustness-section"><PlainEnglishTakeaway>{takeawayText}</PlainEnglishTakeaway></div>
        </>
      )}
      <p className="research-note">
        Descriptive, exploratory research only. This module does not change the production scanner, its scoring, paper trading, the
        Render worker, or the API, and it does not implement automatic strategy optimization.
      </p>
    </section>
  )
}

const BATCH_C_DEFINITIONS = [
  { term: 'Frozen baseline', description: 'Batch C reuses the exact, unmodified Batch A Momentum Breakout signal, entry, stop, and outcome rules. Only the data universe changes.' },
  { term: 'Regular session', description: 'The core U.S. equity trading hours, 09:30\u201316:00 Eastern time.' },
  { term: 'Regular-session-only bars', description: 'Since 1-hour bars are aligned to the top of each hour rather than to 09:30, only bars whose Eastern start hour is 10:00\u201315:00 are fully inside the regular session. The 09:00 ET bar (spans 09:00\u201310:00) partially overlaps the open, and the 16:00 ET bar (spans 16:00\u201317:00) is entirely postmarket \u2014 both are excluded, along with all other extended-hours bars.' },
  { term: 'Batch A (full-session)', description: 'The original, unmodified Momentum Breakout experiment, run on whatever regular- and extended-hours bars Alpaca/IEX returns \u2014 preserved exactly as-is.' },
  { term: 'Batch C (regular-session-only)', description: 'The identical frozen signal, entry, stop, and outcome rules, run only on the stricter regular-session-only bar series described above.' },
  { term: 'Diff (Batch C \u2212 Batch A)', description: 'Batch C\u2019s value minus Batch A\u2019s value for the same metric. A positive diff means Batch C\u2019s number was higher in this sample \u2014 it is not a claim that either version is better.' },
]

const BATCH_C_HOW_TO_READ = [
  'Batch C changes only which bars are included in the data universe \u2014 the breakout signal condition, entry rule, stop, and outcome windows are identical, frozen, and unmodified from Batch A.',
  'The regular-session-only series is built first, and the frozen 20-bar lookback, ATR, and volume average all run on that filtered series \u2014 excluded extended-hours bars can never influence a signal, and entry can never land on an excluded bar.',
  'This is a controlled comparison of two research data universes, not a competition. Neither version is labeled better, best, superior, validated, or profitable anywhere on this page.',
  'Sample sizes differ between Batch A and Batch C because fewer bars qualify under the stricter universe \u2014 check the occurrence counts and low-evidence flags before reading into any difference.',
  'This is historical, descriptive research only. It does not change production scoring, paper trading, the Render worker, or the API.',
]

function ComparisonTable({ title, rows }) {
  return (
    <div className="robustness-section">
      <h3>{title}</h3>
      <div className="robustness-table-wrap">
        <table className="robustness-table">
          <thead><tr><th>Bucket</th><th>Batch A occ.</th><th>Batch A expectancy</th><th>Batch A win rate</th><th>Batch C occ.</th><th>Batch C expectancy</th><th>Batch C win rate</th></tr></thead>
          <tbody>{rows.map((row) => (
            <tr key={row.label}>
              <td>{row.label}</td>
              <td>{row.batchA?.occurrenceCount ?? '\u2014'}</td>
              <td>{row.batchA ? formatR(row.batchA.expectancy) : '\u2014'}</td>
              <td>{row.batchA ? formatPercent(row.batchA.winRate) : '\u2014'}</td>
              <td>{row.batchC?.occurrenceCount ?? '\u2014'}</td>
              <td>{row.batchC ? formatR(row.batchC.expectancy) : '\u2014'}</td>
              <td>{row.batchC ? formatPercent(row.batchC.winRate) : '\u2014'}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  )
}

function RegularSessionBreakoutSection({ datasets }) {
  const batchA = useMemo(() => runStrategyDiscoveryBatchA(datasets), [datasets])
  const batchC = useMemo(() => runRegularSessionBreakoutResearch(datasets), [datasets])
  const batchAMomentum = batchA.experiments?.find((experiment) => experiment.experimentId === 'momentum-breakout-v1')
  const comparison = useMemo(
    () => (batchAMomentum && batchC.available ? compareToBatchA(batchAMomentum.summary, batchC.summary) : null),
    [batchAMomentum, batchC],
  )

  const takeawayText = useMemo(() => {
    if (!batchC.available) {
      return `Batch C has not run yet because real Alpaca historical data for ${batchC.missingSymbols?.join(', ') ?? 'SPY, QQQ, IWM'} is not currently available. No results are shown, and none have been invented.`
    }
    if (!comparison) return 'Batch A results were not available for comparison in this session.'
    const occDiff = comparison.overall.occurrenceCount.diff
    const expectancyDiff = comparison.overall.expectancy.diff
    const direction = expectancyDiff === null ? 'could not be compared' : expectancyDiff > 0 ? 'was higher' : expectancyDiff < 0 ? 'was lower' : 'was effectively the same'
    return `Restricting to regular-session-only bars changed the qualifying occurrence count by ${occDiff >= 0 ? '+' : ''}${occDiff} (Batch A: ${comparison.overall.occurrenceCount.batchA}, Batch C: ${comparison.overall.occurrenceCount.batchC}), and expectancy ${direction} in Batch C than in Batch A for this sample (${formatR(comparison.overall.expectancy.batchA)} vs. ${formatR(comparison.overall.expectancy.batchC)}). This is a controlled comparison of two data universes using the identical frozen signal, entry, stop, and outcome rules \u2014 it does not identify either universe as better, best, superior, validated, or profitable, and Batch A remains the original full-session experiment, unchanged.`
  }, [batchC, comparison])

  return (
    <section className="robustness-lab panel">
      <div className="panel-heading compact">
        <div><p className="eyebrow">RESEARCH \u00b7 STRATEGY DISCOVERY \u00b7 BATCH C</p><h2>Batch C \u2014 Regular Session Breakout</h2></div>
        <span className="coming-soon">DESCRIPTIVE ONLY \u00b7 FROZEN BASELINE</span>
      </div>
      <p className="robustness-disclaimer">
        This is the same frozen Momentum Breakout tested on a stricter 1H research universe containing only fully regular-session
        bars. The breakout definition itself \u2014 signal detection, entry, stop, and outcome windows \u2014 is reused completely
        unmodified from Batch A; only the underlying bar universe changes. Batch A remains the original full-session experiment and
        is not altered by this page. No threshold is optimized, no session rule is searched for better results, and nothing here
        changes the production scanner, paper trading, the Render worker, or the API.
      </p>
      <div className="robustness-section">
        <MetricsGlossary title="What does this mean?" intro="Plain-English explanations for the terms used in Batch C." definitions={BATCH_C_DEFINITIONS} />
      </div>
      <div className="robustness-section">
        <HowToReadResults title="How to read this" items={BATCH_C_HOW_TO_READ} />
      </div>
      {!batchC.available ? (
        <div className="robustness-error">
          Batch C is waiting on real Alpaca historical data for {batchC.missingSymbols?.join(', ') ?? 'SPY, QQQ, IWM'}. This lab
          never substitutes demo data.
        </div>
      ) : (
        <>
          <div className="robustness-section">
            <h3>Session convention</h3>
            <div className="robustness-table-wrap">
              <table className="robustness-table">
                <tbody>
                  <tr><td>Regular-session Eastern start hours kept</td><td>{batchC.regularSessionEasternHours.join(':00, ')}:00</td></tr>
                  <tr><td>Excluded</td><td>09:00 ET (boundary-overlap), 16:00 ET (postmarket), and all other extended-hours bars</td></tr>
                  <tr><td>Total qualifying Batch C signals</td><td>{batchC.totalQualifyingSignals}</td></tr>
                </tbody>
              </table>
            </div>
            <div className="robustness-table-wrap">
              <table className="robustness-table">
                <thead><tr><th>Symbol</th><th>Raw candles</th><th>Regular-session candles</th><th>Date range</th></tr></thead>
                <tbody>{batchC.datasetInfo.map((dataset) => <tr key={dataset.symbol}><td>{dataset.symbol}</td><td>{dataset.rawCandleCount}</td><td>{dataset.regularSessionCandleCount}</td><td>{dataset.start?.slice(0, 10)} \u2013 {dataset.end?.slice(0, 10)}</td></tr>)}</tbody>
              </table>
            </div>
          </div>

          <div className="robustness-section">
            <h3>Batch C standard metrics (regular-session-only)</h3>
            <div className="robustness-table-wrap">
              <table className="robustness-table">
                <thead><tr><th>Sample size</th><th>Win rate</th><th>Profit factor</th><th>Expectancy</th><th>Median R</th><th>Total R</th><th>Max DD</th><th>Avg hold</th><th>Avg MFE</th><th>Avg MAE</th></tr></thead>
                <tbody>
                  <tr>
                    <td>{batchC.summary.overall.occurrenceCount}</td>
                    <td>{formatPercent(batchC.summary.overall.winRate)}</td>
                    <td>{formatPf(batchC.summary.overall.profitFactor)}</td>
                    <td>{formatR(batchC.summary.overall.expectancy)}</td>
                    <td>{formatR(batchC.summary.overall.medianR)}</td>
                    <td>{formatR(batchC.summary.overall.totalR)}</td>
                    <td>{formatR(batchC.summary.overall.maximumDrawdown)}</td>
                    <td>{batchC.summary.overall.averageHoldingBars.toFixed(1)}</td>
                    <td>{formatR(batchC.summary.overall.averageMfeR)}</td>
                    <td>{formatR(batchC.summary.overall.averageMaeR)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="robustness-muted">
              {batchC.summary.overall.occurrenceCount < 100 ? 'Flagged as a low-evidence sample (fewer than 100 occurrences).' : 'Sample size at or above the protocol\u2019s 100-occurrence exploratory threshold.'}
              {' '}Excluded: {batchC.summary.excluded.ambiguousCount} ambiguous, {batchC.summary.excluded.insufficientDataCount} insufficient forward data,{' '}
              {batchC.summary.excluded.outsideResearchWindowCount} outside the research windows.
            </p>
            <p className="robustness-muted">Cost sensitivity (research-assumption basis-point tiers)</p>
            <div className="robustness-table-wrap">
              <table className="robustness-table">
                <thead><tr><th>Cost tier</th><th>Occurrences</th><th>Win rate</th><th>Profit factor</th><th>Average R</th></tr></thead>
                <tbody>{batchC.summary.costTiers.map((tier) => <tr key={tier.label}><td>{tier.label}</td><td>{tier.metrics.occurrenceCount}</td><td>{formatPercent(tier.metrics.winRate)}</td><td>{formatPf(tier.metrics.profitFactor)}</td><td>{formatR(tier.metrics.averageR)}</td></tr>)}</tbody>
              </table>
            </div>
          </div>

          {comparison && (
            <>
              <div className="robustness-section">
                <h3>Batch A (full-session) vs. Batch C (regular-session-only) \u2014 overall</h3>
                <div className="robustness-table-wrap">
                  <table className="robustness-table">
                    <thead><tr><th>Metric</th><th>Batch A</th><th>Batch C</th><th>Diff (C \u2212 A)</th></tr></thead>
                    <tbody>
                      <tr><td>Occurrence count</td><td>{comparison.overall.occurrenceCount.batchA}</td><td>{comparison.overall.occurrenceCount.batchC}</td><td>{comparison.overall.occurrenceCount.diff}</td></tr>
                      <tr><td>Win rate</td><td>{formatPercent(comparison.overall.winRate.batchA)}</td><td>{formatPercent(comparison.overall.winRate.batchC)}</td><td>{(comparison.overall.winRate.diff * 100).toFixed(1)}%</td></tr>
                      <tr><td>Profit factor</td><td>{formatPf(comparison.overall.profitFactor.batchA)}</td><td>{formatPf(comparison.overall.profitFactor.batchC)}</td><td>{comparison.overall.profitFactor.diff === null ? '\u2014' : comparison.overall.profitFactor.diff.toFixed(2)}</td></tr>
                      <tr><td>Expectancy</td><td>{formatR(comparison.overall.expectancy.batchA)}</td><td>{formatR(comparison.overall.expectancy.batchC)}</td><td>{formatR(comparison.overall.expectancy.diff)}</td></tr>
                      <tr><td>Median R</td><td>{formatR(comparison.overall.medianR.batchA)}</td><td>{formatR(comparison.overall.medianR.batchC)}</td><td>{formatR(comparison.overall.medianR.diff)}</td></tr>
                      <tr><td>Total R</td><td>{formatR(comparison.overall.totalR.batchA)}</td><td>{formatR(comparison.overall.totalR.batchC)}</td><td>{formatR(comparison.overall.totalR.diff)}</td></tr>
                      <tr><td>Max drawdown</td><td>{formatR(comparison.overall.maximumDrawdown.batchA)}</td><td>{formatR(comparison.overall.maximumDrawdown.batchC)}</td><td>{formatR(comparison.overall.maximumDrawdown.diff)}</td></tr>
                      <tr><td>Avg hold (bars)</td><td>{comparison.overall.averageHoldingBars.batchA.toFixed(1)}</td><td>{comparison.overall.averageHoldingBars.batchC.toFixed(1)}</td><td>{comparison.overall.averageHoldingBars.diff.toFixed(1)}</td></tr>
                      <tr><td>Avg MFE</td><td>{formatR(comparison.overall.averageMfeR.batchA)}</td><td>{formatR(comparison.overall.averageMfeR.batchC)}</td><td>{formatR(comparison.overall.averageMfeR.diff)}</td></tr>
                      <tr><td>Avg MAE</td><td>{formatR(comparison.overall.averageMaeR.batchA)}</td><td>{formatR(comparison.overall.averageMaeR.batchC)}</td><td>{formatR(comparison.overall.averageMaeR.diff)}</td></tr>
                    </tbody>
                  </table>
                </div>
              </div>
              <ComparisonTable title="Batch A vs. Batch C \u2014 by research period" rows={comparison.byPeriod} />
              <ComparisonTable title="Batch A vs. Batch C \u2014 by symbol" rows={comparison.bySymbol} />
              <ComparisonTable
                title="Batch A vs. Batch C \u2014 cost sensitivity"
                rows={comparison.costTiers.map((tier) => ({ label: tier.label, batchA: tier.batchA, batchC: tier.batchC }))}
              />
            </>
          )}

          <div className="robustness-section"><PlainEnglishTakeaway>{takeawayText}</PlainEnglishTakeaway></div>
        </>
      )}
      <p className="research-note">
        Descriptive, exploratory research only. Batch A remains the original full-session experiment, preserved unchanged. This
        module does not change the production scanner, its scoring, paper trading, the Render worker, or the API.
      </p>
    </section>
  )
}

export function StrategyDiscoveryLab({ datasets = [] }) {
  const batch = useMemo(() => runStrategyDiscoveryBatchA(datasets), [datasets])
  const resultsByExperimentId = useMemo(
    () => Object.fromEntries((batch.experiments ?? []).map((experiment) => [experiment.experimentId, experiment])),
    [batch],
  )
  const dataUnavailableReason = batch.available
    ? null
    : `waiting for real Alpaca historical data for ${batch.missingSymbols?.join(', ') ?? 'SPY, QQQ, IWM'}`

  const takeawayText = useMemo(() => {
    if (!batch.available) {
      return 'Batch A has not run yet in this session because real Alpaca historical data for SPY, QQQ, and IWM is not currently available. No results are shown, and none have been invented.'
    }
    const implemented = batch.experiments
    const withOccurrences = implemented.filter((experiment) => experiment.summary.overall.occurrenceCount > 0)
    if (!withOccurrences.length) {
      return 'None of the four implemented Batch A families produced any occurrences on the currently available historical data. This is itself a legitimate, documented research outcome, not a fabricated one.'
    }
    const positive = withOccurrences.filter((experiment) => experiment.summary.overall.expectancy > 0).length
    const negative = withOccurrences.filter((experiment) => experiment.summary.overall.expectancy < 0).length
    const mixedNote = positive > 0 && negative > 0
      ? 'Results were mixed across the four families \u2014 some showed positive average R in this sample and others negative.'
      : positive > 0
        ? 'Every implemented family with occurrences showed positive average R in this sample.'
        : 'No implemented family showed positive average R in this sample.'
    const lowEvidence = withOccurrences.filter((experiment) => experiment.summary.overall.occurrenceCount < 100).map((experiment) => experiment.label)
    return `Across the four implemented Batch A families, occurrence counts ranged from ${Math.min(...withOccurrences.map((e) => e.summary.overall.occurrenceCount))} to ${Math.max(...withOccurrences.map((e) => e.summary.overall.occurrenceCount))} on the currently available historical data. ${mixedNote}${lowEvidence.length ? ` ${lowEvidence.join(', ')} had fewer than 100 occurrences, which the Strategy Discovery Protocol treats as a low-evidence result.` : ''} This describes what happened historically under each family\u2019s frozen first-pass rules; it is not a probability statement, not a ranking of the four families, and does not identify any family as profitable, validated, or superior.`
  }, [batch])

  return (
    <>
    <section className="robustness-lab panel">
      <div className="panel-heading compact">
        <div><p className="eyebrow">RESEARCH · STRATEGY DISCOVERY</p><h2>Strategy Discovery Lab</h2></div>
        <span className="coming-soon">EXPLORATORY RESEARCH · BATCH A</span>
      </div>
      <p className="robustness-disclaimer">
        This is a framework for systematically cataloguing and, over time, testing genuinely different trading setup families —
        rather than continuing to only optimize the existing VWAP/EMA/RSI/RVOL score. Candidate discovery is exploratory research.
        Batch A wires four of the eight families below to real, causal backtests on real Alpaca historical data (SPY/QQQ/IWM,
        1-hour candles); the remaining four families have no implementation yet and stay explicitly labeled as not yet run. Nothing
        here modifies the existing scanner, its scoring, paper trading, the Render worker, or the API. No family is claimed to be
        profitable, validated, predictive, or superior to the existing scanner, and no family is ranked against another.
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
          Eight candidate setup families are catalogued below. Four (Momentum/Breakout, Mean Reversion, Market Structure, Volatility
          Expansion/Contraction) are implemented in Batch A and show real results once real Alpaca historical data is available; the
          rest are hypotheses only. None has been optimized, none is ranked against another, and no automatic strategy optimization
          is implemented here.
        </p>
      </div>
      {!batch.available && (
        <div className="robustness-error">
          Batch A experiments are waiting on real Alpaca historical data for {batch.missingSymbols?.join(', ') ?? 'SPY, QQQ, IWM'}.
          This lab never substitutes demo data.
        </div>
      )}
      {STRATEGY_FAMILIES.map((family) => (
        <FamilyCard
          key={family.key}
          family={family}
          result={family.experimentId ? resultsByExperimentId[family.experimentId] : undefined}
          dataUnavailableReason={dataUnavailableReason}
        />
      ))}
      {batch.available && <ReproducibilityInfo batch={batch} />}

      <div className="robustness-section">
        <PlainEnglishTakeaway>{takeawayText}</PlainEnglishTakeaway>
      </div>

      <p className="research-note">
        Exploratory research only. This module does not change the production scanner, its scoring, paper trading, the Render
        worker, or the API, and it does not implement automatic strategy optimization.
      </p>
    </section>
    <BreakoutContextResearchSection datasets={datasets} />
    <RegularSessionBreakoutSection datasets={datasets} />
    </>
  )
}
