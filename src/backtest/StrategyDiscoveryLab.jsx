import React, { useMemo, useRef } from 'react'
import { DISCOVERY_SECTIONS, DiscoverySectionNav, discoveryFamilyId, useDiscoveryNavigation } from './discoveryNavigation.js'
import { HowToReadResults, LearningDetails, MetricsGlossary, PlainEnglishTakeaway, ResearchFirstAnswer } from './MetricsGlossary.jsx'
import { runStrategyDiscoveryBatchA } from './strategyDiscovery/discoveryRunner.js'
import { runBreakoutContextResearch } from './strategyDiscovery/breakoutContextResearch.js'
import { runRegularSessionBreakoutResearch, compareToBatchA } from './strategyDiscovery/regularSessionBreakout.js'
import { ResearchDataStatus } from './LabEvidence.jsx'
import { createStrategyDiscoveryLiveSummary } from '../research/strategyDiscoveryLiveSummary.js'
import { DISCOVERY_METRIC_DEFINITIONS, DiscoveryLabelExplanation, DiscoveryMetricLabel, DiscoveryResearchJourney, DiscoveryReadoutLabel, discoveryReadoutPresentation } from './discoveryEducation.js'
import { InspectableBarChart, InspectableLineChart } from './LabsCharts.jsx'
import { DiscoveryEvidenceExplorer } from './DiscoveryEvidenceExplorer.jsx'
import { DiscoveryOverview } from './DiscoveryOverview.js'
import './robustness.css'

// Phase 1 of Strategy Discovery: a catalogue of candidate setup-family hypotheses. Batch A wires
// four of the eight families (below) to real, causal backtests once real Alpaca historical data is
// available; the remaining families have no implementation yet, so their quantitative fields stay
// explicitly labeled as not-yet-run rather than filled with invented numbers.
const NOT_YET_RUN = 'Not yet run'

const formatPercent = (value) =>
  value === null || value === undefined || !Number.isFinite(value)
    ? '—'
    : `${(value * 100).toFixed(1)}%`
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
  { term: 'Candidate hypothesis', description: 'An idea for a setup family with defined rules. Implemented families can have historical results; a defined hypothesis alone is not evidence that it works.' },
  ...DISCOVERY_METRIC_DEFINITIONS,
]

const STRATEGY_DISCOVERY_HOW_TO_READ = [
  'Strategy discovery defines and explores hypotheses. Historical testing, including out-of-sample checks, is part of that research process; completing these checks does not validate a strategy.',
  'Testing many different setup families increases the chance that at least one will look good purely by chance \u2014 this is sometimes called multiple-comparisons or data-dredging risk. A family looking interesting after many were tried needs a much higher bar of evidence than one tested in isolation.',
  'Out-of-sample testing checks a later historical slice outside development. It is more informative only when it did not influence rule selection; repeated exploration weakens its independence.',
  'Execution costs matter because a family that looks profitable before costs can look very different after spread, slippage, and commissions are applied \u2014 which is why the existing labs report before/low/moderate/high cost tiers rather than a single frictionless number.',
  'Historical frequency is not the same thing as a future probability: a 60% historical win rate describes what already happened in one sample: it is not a guaranteed 60% chance for the next trade.',
  'Look-ahead bias means using information that was not available at the signal time. Implemented tests use causal rules; unimplemented hypotheses still need testing. Neither establishes actual future execution performance.',
]


function BreakdownRows({ rows }) {
  return (
    <div className="robustness-table-wrap">
      <table className="robustness-table">
        <thead>
          <tr>
            <th />
            <th><DiscoveryMetricLabel label="Occurrences" /></th>
            <th><DiscoveryMetricLabel label="Win rate" /></th>
            <th><DiscoveryMetricLabel label="Profit factor" /></th>
            <th><DiscoveryMetricLabel label="Average R" /></th>
            <th><DiscoveryMetricLabel label="Total R" /></th>
            <th><DiscoveryMetricLabel label="Max DD" /></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const hasResolvedObservations = row.occurrenceCount > 0

            return (
              <tr key={row.label}>
                <td>{row.label}</td>
                <td>{row.occurrenceCount}</td>
                <td>{hasResolvedObservations ? formatPercent(row.winRate) : '—'}</td>
                <td>{hasResolvedObservations ? formatPf(row.profitFactor) : '—'}</td>
                <td>{hasResolvedObservations ? formatR(row.averageR) : '—'}</td>
                <td>{hasResolvedObservations ? formatR(row.totalR) : '—'}</td>
                <td>{hasResolvedObservations ? formatR(row.maximumDrawdown) : '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function AmbiguitySummary({ summary }) {
  const excluded = summary?.excluded ?? {}
  const ambiguousCount = excluded.ambiguousInResearchWindowCount
  const classifiableCount = excluded.classifiableInResearchWindowCount
  const ambiguousRate = excluded.ambiguousInResearchWindowRate
  if (!Number.isFinite(ambiguousCount) || !Number.isFinite(classifiableCount)) {
    return <p className="robustness-muted">The ambiguity count and percentage are unavailable because this result does not contain the required outcome counts.</p>
  }
  const otherAmbiguousCount = Number.isFinite(excluded.ambiguousCount) && excluded.ambiguousCount >= ambiguousCount
    ? excluded.ambiguousCount - ambiguousCount
    : null
  return (
    <p className="robustness-muted">
      Same-candle ambiguity in the research windows: {ambiguousCount} of {classifiableCount} outcomes with enough forward data
      {!Number.isFinite(ambiguousRate) ? ' (percentage unavailable)' : ` (${formatPercent(ambiguousRate)})`} were excluded because the candle’s high and low touched both barriers but do not show which happened first.
      This is uncertainty in historical candle data, not a statement about actual trade execution. Other ambiguous outcomes outside these windows: {otherAmbiguousCount ?? 'unavailable'}.
    </p>
  )
}

function FamilyResult({ result, interpretation }) {
  const { summary, secondaryOutcomes } = result
  const hasResolvedObservations = summary.overall.occurrenceCount > 0
  const hasPlus1Observations = secondaryOutcomes.plus1RBefore1RWithin5.occurrenceCount > 0
  const hasPlus2Observations = secondaryOutcomes.plus2RBefore1RWithin10.occurrenceCount > 0
const periodObservations = summary.byPeriod.map((row) => ({
  label: String(row.label),
  series: [
    {
      label: 'Average R',
      value: Number.isFinite(row.averageR) ? row.averageR : null,
      tradeCount: row.occurrenceCount,
    },
  ],
}))

const costObservations = summary.costTiers.map((tier) => ({
  label: String(tier.label),
  series: [
    {
      label: 'Average R',
      value: Number.isFinite(tier.metrics.averageR)
        ? tier.metrics.averageR
        : null,
      tradeCount: tier.metrics.occurrenceCount,
    },
  ],
}))

  return (
    <>
      <p className="robustness-muted">Batch A result (real Alpaca historical data, causal signal generation, next-candle entry):</p>
      <div className="discovery-historical-summary">
  <div className="discovery-historical-summary-heading">
    <div>
      <p className="eyebrow">HISTORICAL RESULT</p>
      <strong>Batch A performance summary</strong>
    </div>

    <span>
      Real Alpaca data · causal signals · next-candle entry
    </span>
  </div>

  <div className="discovery-historical-metrics">
    <div>
      <span><DiscoveryMetricLabel label="Signals" /></span>
      <strong>{summary.overall.occurrenceCount}</strong>
    </div>

    <div>
      <span><DiscoveryMetricLabel label="Win rate" /></span>
      <strong>
        {hasResolvedObservations
          ? formatPercent(summary.overall.winRate)
          : '—'}
      </strong>
    </div>

    <div>
      <span><DiscoveryMetricLabel label="Profit factor" /></span>
      <strong>
        {hasResolvedObservations
          ? formatPf(summary.overall.profitFactor)
          : '—'}
      </strong>
    </div>

    <div>
      <span><DiscoveryMetricLabel label="Average R" /></span>
      <strong>
        {hasResolvedObservations
          ? formatR(summary.overall.averageR)
          : '—'}
      </strong>
    </div>

    <div>
      <span><DiscoveryMetricLabel label="Median R" /></span>
      <strong>
        {hasResolvedObservations
          ? formatR(summary.overall.medianR)
          : '—'}
      </strong>
    </div>

    <div>
      <span><DiscoveryMetricLabel label="Max drawdown" /></span>
      <strong>
        {hasResolvedObservations
          ? formatR(summary.overall.maximumDrawdown)
          : '—'}
      </strong>
    </div>

    <div>
      <span><DiscoveryMetricLabel label="Avg hold" /></span>
      <strong>
        {hasResolvedObservations &&
        summary.overall.averageHoldingBars != null
          ? `${summary.overall.averageHoldingBars.toFixed(1)} bars`
          : '—'}
      </strong>
    </div>

    <div>
      <span>Best move</span>
      <strong>
        {hasResolvedObservations
          ? formatR(summary.overall.averageMfeR)
          : '—'}
      </strong>
    </div>

    <div>
      <span>Worst move</span>
      <strong>
        {hasResolvedObservations
          ? formatR(summary.overall.averageMaeR)
          : '—'}
      </strong>
    </div>
  </div>

  <p className="discovery-historical-expectancy">
    Average result:{' '}
    <strong>
      {hasResolvedObservations
        ? formatR(summary.overall.expectancy)
        : '—'}
    </strong>
  </p>
</div>
      {!hasResolvedObservations && (
       <p className="robustness-muted">
          No resolved observations are available for this result. Performance metrics are
           unavailable, not zero. Check the exclusion counts and available historical data.
      </p>
     )}
      <p className="robustness-muted">
        Secondary outcomes — +1R before -1R within 5 candles:{' '}
        {secondaryOutcomes.plus1RBefore1RWithin5.occurrenceCount} occurrences,{' '}
        {hasPlus1Observations
        ? formatPercent(secondaryOutcomes.plus1RBefore1RWithin5.winRate)
        : '—'} win rate. +2R before -1R within 10 candles:{' '}
        {secondaryOutcomes.plus2RBefore1RWithin10.occurrenceCount} occurrences,{' '}
        {hasPlus2Observations
        ? formatPercent(secondaryOutcomes.plus2RBefore1RWithin10.winRate)
        : '—'} win rate.
      </p>
      <p className="robustness-muted">
        Outcomes excluded because their evaluation candle crossed a research-period boundary: primary {summary.excluded.periodBoundaryCount ?? 'unavailable'},
        {' '}+1R/5 {secondaryOutcomes.plus1RBefore1RWithin5.periodBoundaryExcludedCount ?? 'unavailable'},
        {' '}+2R/10 {secondaryOutcomes.plus2RBefore1RWithin10.periodBoundaryExcludedCount ?? 'unavailable'}.
        {' '}Excursion windows crossing a boundary: {summary.excluded.excursionPeriodBoundaryCount ?? 'unavailable'}.
      </p>
      <DiscoveryEvidenceExplorer id={`strategy-discovery-year-${result.experimentId}`} dimension="year"
        rows={summary.byYear} interpretation={interpretation?.stability.find(item => item.dimension === 'year')} />
      <DiscoveryEvidenceExplorer id={`strategy-discovery-symbol-${result.experimentId}`} dimension="symbol"
        rows={summary.bySymbol} interpretation={interpretation?.stability.find(item => item.dimension === 'symbol')} />
      <p className="robustness-muted discovery-period-help"><DiscoveryMetricLabel label="Development" /> · <DiscoveryMetricLabel label="Out-of-Sample" /> · <DiscoveryMetricLabel label="Holdout" /></p>
      <BreakdownRows rows={summary.byPeriod} /><section className="research-primary-visual">
  <InspectableBarChart
    id={`strategy-discovery-period-${result.experimentId}`}
    title="Average R across research periods"
    question="Compares historical average R across the development, out-of-sample, and current holdout research periods. These periods help show whether the observed direction remained consistent outside the development sample, but repeated historical exploration means they are not untouched future evidence."
    observations={periodObservations}
    series={[
      {
        key: 'average-r',
        label: 'Average R',
        metricLabel: 'Average R',
      },
    ]}
    sampleUnit="occurrences"
    xAxisLabel="Research period"
    formatValue={(value) =>
      `${value >= 0 ? '+' : ''}${value.toFixed(2)}R`
    }
    layout="grouped"
  />
</section>
      <p className="robustness-muted">Cost sensitivity (research-assumption basis-point tiers)</p>
      <div className="robustness-table-wrap">
        <table className="robustness-table">
          <thead><tr><th><DiscoveryMetricLabel label="Cost tier" /></th><th><DiscoveryMetricLabel label="Occurrences" /></th><th><DiscoveryMetricLabel label="Win rate" /></th><th><DiscoveryMetricLabel label="Profit factor" /></th><th><DiscoveryMetricLabel label="Average R" /></th></tr></thead>
      <tbody>{summary.costTiers.map((tier) => {
        const hasResolvedObservations = tier.metrics.occurrenceCount > 0
        return <tr key={tier.label}><td>{tier.label}</td><td>{tier.metrics.occurrenceCount}</td><td>{hasResolvedObservations ? formatPercent(tier.metrics.winRate) : '—'}</td><td>{hasResolvedObservations ? formatPf(tier.metrics.profitFactor) : '—'}</td><td>{hasResolvedObservations ? formatR(tier.metrics.averageR) : '—'}</td></tr>
      })}</tbody>
        </table>
      </div>
      <section className="research-primary-visual">
  <InspectableLineChart
    id={`strategy-discovery-cost-${result.experimentId}`}
    title="Average R under modeled trading costs"
    question="Shows how the same historical setup sample changed as progressively larger research-assumption trading costs were applied. These tiers model friction; they are not measured live execution costs."
    observations={costObservations}
    series={[
      {
        key: 'average-r',
        label: 'Average R',
        metricLabel: 'Average R',
      },
    ]}
    sampleUnit="occurrences"
    xAxisLabel="Modeled trading-cost tier"
    formatValue={(value) =>
      `${value >= 0 ? '+' : ''}${value.toFixed(2)}R`
    }
  />
</section>
      <AmbiguitySummary summary={summary} />
      <p className="robustness-muted">
        Other exclusions from the statistics above: {summary.excluded.insufficientDataCount} with
        insufficient forward data, {summary.excluded.outsideResearchWindowCount} outside the defined research windows.
      </p>
    </>
  )
}

function FamilyCard({
  family,
  result,
  dataUnavailableReason,
  interpretation,
}) {
  return (
    <div className="robustness-section">
      <div className="panel-heading compact">
        <div>
          <p className="eyebrow">SETUP IDEA</p>
          <h3>{family.label}</h3>
        </div>
        <span className="coming-soon">{family.experimentId ? 'BATCH A · IMPLEMENTED' : 'HYPOTHESIS ONLY · NOT YET TESTED'}</span>
      </div>
      <p className="robustness-muted">{family.whatItTests}</p>
      {family.experimentId && <DiscoveryResearchJourney result={result} interpretation={interpretation} />}
      {result && interpretation && (
  <div className="discovery-family-readout">
    <div className="discovery-family-readout-heading">
      <div>
        <p className="eyebrow">INTERPRETATION LAYER</p>
        <strong>Evidence Readout</strong>
      </div>
    </div>

    <div className="discovery-family-readout-grid">
      {interpretation.stability.map((observation) => (
        <div
          className="discovery-family-readout-item"
          key={observation.dimension}
        >
          <span>
            {observation.dimension === 'year'
              ? 'By year'
              : observation.dimension === 'symbol'
                ? 'By symbol'
                : 'Research periods'}
          </span>

          <strong>
            {observation.status === 'mixed'
              ? 'MIXED'
              : observation.status === 'insufficient-evidence'
                ? 'INSUFFICIENT'
                : observation.status === 'same-direction'
                  ? 'SAME DIRECTION'
                  : observation.status.toUpperCase()}
          </strong>

          <p>{observation.text}</p>
          <DiscoveryLabelExplanation observation={observation} />
        </div>
      ))}

      {interpretation.cost && (
        <div className="discovery-family-readout-item">
          <span>Modeled costs</span>

          <strong>
            {interpretation.cost.status === 'cost-sensitive'
              ? 'COST SENSITIVE'
              : interpretation.cost.status === 'insufficient-evidence'
                ? 'INSUFFICIENT'
                : interpretation.cost.status
                    .replaceAll('-', ' ')
                    .toUpperCase()}
          </strong>

          <p>{interpretation.cost.text}</p>
          <DiscoveryLabelExplanation observation={interpretation.cost} />
        </div>
      )}
    </div>
  </div>
)}
      <div className="discovery-setup-grid">
  <div className="discovery-setup-item">
    <span>Setup conditions</span>
    <p>{family.candidateConditions.join(' • ')}</p>
  </div>

  <div className="discovery-setup-item">
    <span>Entry</span>
    <p>{family.entryConcept}</p>
  </div>

  <div className="discovery-setup-item">
    <span>Exit</span>
    <p>{family.exitConcept}</p>
  </div>

  <div className="discovery-setup-item">
    <span>What we’re measuring</span>
    <p>{family.historicalOutcomeMeasured}</p>
  </div>
</div>
      {result ? (
        <FamilyResult result={result} interpretation={interpretation} />
      ) : (
        <>
          <p className="robustness-muted">
            {family.experimentId
              ? `Quantitative results (${dataUnavailableReason ?? 'not yet run for this family'}):`
              : 'Quantitative results (not yet run for this family):'}
          </p>
          <div className="robustness-table-wrap">
            <table className="robustness-table">
              <thead><tr><th><DiscoveryMetricLabel label="Signals tested" /></th><th><DiscoveryMetricLabel label="Win rate" /></th><th><DiscoveryMetricLabel label="Profit factor" /></th><th><DiscoveryMetricLabel label="Average result" /></th><th><DiscoveryMetricLabel label="Average R" /></th><th><DiscoveryMetricLabel label="Max drawdown" /></th><th>By year</th><th>By symbol</th><th>Cost sensitivity</th><th>In-sample / out-of-sample</th></tr></thead>
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

function ReproducibilityInfo({
  batch,
  label = 'Batch A',
  title = null,
}) {
  return (
    <div className="robustness-section">
     <h3>{title ?? `Reproducibility & data provenance (${label})`}</h3>
{title && (
  <p className="robustness-muted">
    Technical reproducibility and data-provenance details for {label}.
  </p>
)}
      <div className="robustness-table-wrap">
        <table className="robustness-table">
          <thead><tr><th>Symbol</th><th>Provider</th><th>Candles</th><th>Date range</th><th>Duplicates removed</th></tr></thead>
          <tbody>{batch.datasetInfo.map((dataset) => <tr key={dataset.symbol}><td>{dataset.symbol}</td><td>{dataset.provider}</td><td>{dataset.candleCount}</td><td>{dataset.start?.slice(0, 10)} – {dataset.end?.slice(0, 10)}</td><td>{dataset.duplicatesRemoved}</td></tr>)}</tbody>
        </table>
      </div>
      <p className="robustness-muted">
        Timeframe: {batch.timeframe} · Universe: {batch.universe.join(', ')} · Generated at: {batch.generatedAt} · Code version: {batch.gitCommit?.slice(0, 7) ?? 'unknown'}
      </p>
    </div>
  )
}



const BATCH_B_HOW_TO_READ = [
  'Every table below slices the same frozen Batch A breakout signals by one context condition at a time \u2014 no signal definition, entry rule, stop, or outcome window is changed anywhere in Batch B.',
  'These are descriptive historical associations: a bucket showing a different win rate or expectancy in this sample describes what already happened when that condition was present, not a probability or guarantee for the next signal.',
  'Eight context dimensions slice the same observations here; they are not independent confirmations. Looking at many slices increases the chance that at least one will look interesting purely by chance \u2014 treat any single standout bucket with the same caution as any other multiple-comparisons result.',
  'Groups with fewer than 100 occurrences are flagged as low evidence for caution. The 100-observation mark is a SetupScan research threshold, not proof that a result is reliable or will repeat.',
  'No context bucket is ranked, selected, or called better, best, validated, profitable, or \u201cthe edge\u201d \u2014 including in the takeaway below.',
]

const batchBDisplayBucketLabel = (label) =>
  ({
    'Morning (09:30–11:00 ET)': 'Morning (9:30–11:00 AM ET)',
    'Midday (11:00–14:00 ET)': 'Midday (11:00 AM–2:00 PM ET)',
    'Afternoon (14:00–16:00 ET)': 'Afternoon (2:00–4:00 PM ET)',
    'Insufficient History': 'Not enough prior history',
  })[label] ?? label

function batchBExplorerRows(dimension) {
  return dimension.buckets.map((bucket) => {
    const overall = bucket.summary.overall

    return {
      label: batchBDisplayBucketLabel(bucket.label),
      occurrenceCount: overall.occurrenceCount,
      winRate: overall.winRate,
      profitFactor: overall.profitFactor,
      averageR: overall.expectancy,
      totalR: overall.totalR,
      maximumDrawdown: overall.maximumDrawdown,
    }
  })
}

const batchBSnapshotFriendlyLabel = (label) =>
  ({
    'Market Trend Regime': 'Market Trend',
    'Volatility Regime': 'Volatility',
    'VWAP Context': 'VWAP',
    'Opening-Range Context': 'Opening Range',
    'First-Observed Daily Range Context': 'Opening Range',
    'Prior-Day Context': 'Prior-Day High',
  })[label] ?? label

function batchBEvidenceSnapshotRows(batchB) {
  if (!batchB?.available) return []

  return batchB.dimensions.map((dimension) => {
    const comparableBuckets = dimension.buckets
      .map((bucket) => ({
        label: batchBDisplayBucketLabel(bucket.label),
        occurrenceCount: bucket.summary.overall.occurrenceCount,
        expectancy: bucket.summary.overall.expectancy,
      }))
      .filter(
        (bucket) =>
          bucket.occurrenceCount > 0 &&
          Number.isFinite(bucket.expectancy),
      )

    const highest =
      comparableBuckets.length > 0
        ? comparableBuckets.reduce((best, bucket) =>
            bucket.expectancy > best.expectancy ? bucket : best,
          )
        : null

    const lowest =
      comparableBuckets.length > 0
        ? comparableBuckets.reduce((worst, bucket) =>
            bucket.expectancy < worst.expectancy ? bucket : worst,
          )
        : null

    const spread =
      highest && lowest && comparableBuckets.length >= 2
        ? Number((highest.expectancy - lowest.expectancy).toFixed(2))
        : null

    const status =
      spread === null
        ? 'LIMITED DATA'
        : spread >= 0.1
          ? 'CONTEXT VARIATION'
          : 'LIMITED VARIATION'

    return {
      key: dimension.key,
      label: batchBSnapshotFriendlyLabel(dimension.label),
      bucketCount: comparableBuckets.length,
      spread,
      status,
      highest,
      lowest,
    }
  })
}

function batchBExplorerInterpretation(rows, parentResolvedCount) {
  const populatedRows = rows.filter(
    (row) => Number.isInteger(row.occurrenceCount) && row.occurrenceCount > 0,
  )

  const finiteRows = populatedRows.filter((row) =>
    Number.isFinite(row.averageR),
  )

  const hasUnavailableEvidence = finiteRows.length !== populatedRows.length

  const directions = new Set(
    finiteRows.map((row) =>
      row.averageR > 0
        ? 'positive'
        : row.averageR < 0
          ? 'negative'
          : 'zero',
    ),
  )

  const validParentCount =
    Number.isInteger(parentResolvedCount) && parentResolvedCount >= 0
      ? parentResolvedCount
      : null

  const status =
    validParentCount !== null &&
    validParentCount < 100
      ? 'insufficient-evidence'
      : hasUnavailableEvidence
        ? 'incomplete'
        : directions.size > 1
          ? 'mixed'
          : 'same-direction'

  return {
    status,
    parentResolvedCount: validParentCount,

    observations: rows.map((row) => ({
      label: row.label,

      resolvedCount:
        Number.isInteger(row.occurrenceCount) && row.occurrenceCount >= 0
          ? row.occurrenceCount
          : null,

      expectancy:
        Number.isInteger(row.occurrenceCount) &&
        row.occurrenceCount === 0
          ? null
          : Number.isFinite(row.averageR)
            ? row.averageR
            : null,
    })),
  }
}

function DimensionSection({
  dimension,
  label = dimension.label,
  parentResolvedCount,
  open = false,
  onOpenChange,
}) {
  const explorerRows = batchBExplorerRows(dimension)

  const interpretation = batchBExplorerInterpretation(
    explorerRows,
    parentResolvedCount,
  )

  const question =
    `Compare the same frozen Momentum Breakout signals across ${label.toLowerCase()} buckets. ` +
    'The signal, entry, stop, and outcome rules remain unchanged; only the surrounding context grouping changes.'

  const lowEvidenceCount = dimension.buckets.filter(
    (bucket) => bucket.lowEvidence,
  ).length

  return (
    <details
  id={`discovery-context-${dimension.key}`}
  className="discovery-followup-details discovery-context-dimension"
  open={open}
  onToggle={(event) => onOpenChange?.(event.currentTarget.open)}
>
      <summary className="discovery-followup-summary discovery-context-dimension-summary">
        <div>
          <span>CONTEXT EVIDENCE</span>

          <strong>{label}</strong>

          <p>
            {dimension.buckets.length} historical buckets
            {lowEvidenceCount
              ? ` · ${lowEvidenceCount} below the 100-occurrence guideline`
              : ''}
          </p>
        </div>

        <span>VIEW EVIDENCE</span>
      </summary>

      <div className="robustness-section">
        <DiscoveryEvidenceExplorer
          id={`strategy-discovery-context-${dimension.key}`}
          dimension="context"
          dimensionLabel={label}
          noun={`${label.toLowerCase()} buckets`}
          sectionTitle={`${label} evidence`}
          chartTitle={`Average R by ${label}`}
          question={question}
          rows={explorerRows}
          interpretation={interpretation}
          chartType="bar"
          comparisonChartOnly
        />

        <LearningDetails label="Advanced statistics">
          <div className="robustness-table-wrap">
            <table className="robustness-table">
              <thead>
                <tr>
                  <th>Historical group</th>
                  <th>Sample size</th>
                  <th>
                    <DiscoveryMetricLabel label="Median R" />
                  </th>
                  <th>
                    <DiscoveryMetricLabel label="Avg hold" />
                  </th>
                  <th>Best move</th>
                  <th>Worst move</th>
                </tr>
              </thead>

              <tbody>
                {dimension.buckets.map((bucket) => {
                  const overall = bucket.summary.overall
                  const hasTrades = overall.occurrenceCount > 0

                  return (
                    <tr key={bucket.label}>
                      <td>{batchBDisplayBucketLabel(bucket.label)}</td>

                      <td>
                        {bucket.lowEvidence
                          ? 'Small sample'
                          : 'Enough for exploration'}
                      </td>

                      <td>
                        {hasTrades
                          ? formatR(overall.medianR)
                          : '—'}
                      </td>

                      <td>
                        {hasTrades &&
                        overall.averageHoldingBars != null
                          ? overall.averageHoldingBars.toFixed(1)
                          : '—'}
                      </td>

                      <td>
                        {hasTrades
                          ? formatR(overall.averageMfeR)
                          : '—'}
                      </td>

                      <td>
                        {hasTrades
                          ? formatR(overall.averageMaeR)
                          : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </LearningDetails>

        {dimension.buckets.map((bucket) => (
          <details
            key={bucket.label}
            className="robustness-section"
          >
            <summary>
              Inspect {batchBDisplayBucketLabel(bucket.label)} deeper evidence
            </summary>

            <p className="robustness-muted">
  By research period
</p>
<p className="robustness-muted">
  These rows show whether the historical result stayed similar when
  SetupScan split the data into different testing periods. Development,
  Out-of-Sample, and Holdout are different historical slices, not
  separate predictions of future performance.
</p>

            <BreakdownRows rows={bucket.summary.byPeriod} />

            <p className="robustness-muted">
              By symbol
            </p>

            <BreakdownRows rows={bucket.summary.bySymbol} />

            <p className="robustness-muted">
  What happens after estimated trading costs?
</p>
<p className="robustness-muted">
  SetupScan applies increasingly conservative estimates for spread,
  slippage, and fees to see whether the historical result still holds up.
</p>
<p className="robustness-muted">
  <strong>Trading friction</strong> means costs that can reduce a trade&apos;s
  result, including bid/ask spread, slippage, and fees.{' '}
  <strong>1 basis point (bp) = 0.01% of price.</strong> The two bp values
  shown in each tier are the research cost assumptions used by this test.
</p>

            <div className="robustness-table-wrap">
              <table className="robustness-table">
                <thead>
                  <tr>
                    <th>
                      <DiscoveryMetricLabel label="Estimated trading cost" />
                    </th>
                    <th>
                      <DiscoveryMetricLabel label="Observations" />
                    </th>
                    <th>
                      <DiscoveryMetricLabel label="Win rate" />
                    </th>
                    <th>
                      <DiscoveryMetricLabel label="Profit factor" />
                    </th>
                    <th>
                      <DiscoveryMetricLabel label="Average R" />
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {bucket.summary.costTiers.map((tier) => {
                    const hasTrades =
                      tier.metrics.occurrenceCount > 0

                    return (
                      <tr key={tier.label}>
                        <td>
  {({
    'Before execution costs': 'Before estimated trading costs',
    'Low friction (1bp / 1bp)':
      'Low estimated trading costs (1 bp / 1 bp)',
    'Moderate friction (3bp / 3bp)':
      'Moderate estimated trading costs (3 bp / 3 bp)',
    'High friction (8bp / 8bp)':
      'High estimated trading costs (8 bp / 8 bp)',
  })[tier.label] ?? tier.label}
</td>

                        <td>
                          {tier.metrics.occurrenceCount}
                        </td>

                        <td>
                          {hasTrades
                            ? formatPercent(tier.metrics.winRate)
                            : '—'}
                        </td>

                        <td>
                          {hasTrades
                            ? formatPf(tier.metrics.profitFactor)
                            : '—'}
                        </td>

                        <td>
                          {hasTrades
                            ? formatR(tier.metrics.averageR)
                            : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <p className="robustness-muted">
              Excluded from this bucket's statistics
              (documented, not guessed):{' '}
              {bucket.summary.excluded.ambiguousCount ?? 'unavailable'} ambiguous
              stop/target bar(s),{' '}
              {bucket.summary.excluded.insufficientDataCount ?? 'unavailable'} with
              insufficient forward data,{' '}
              {bucket.summary.excluded.outsideResearchWindowCount ?? 'unavailable'} outside
              the defined research windows, and{' '}
              {bucket.summary.excluded.periodBoundaryCount ?? 'unavailable'} outcomes
              crossing a research-period boundary.
            </p>
          </details>
        ))}
      </div>
    </details>
  )
}
 function BreakoutContextResearchSection({ datasets }) {
  const batchB = useMemo(
    () => runBreakoutContextResearch(datasets),
    [datasets],
  )

  const friendlyDimensionLabel = (label) => ({
    'Market Trend Regime': 'Market Trend',
    'Volatility Regime': 'Volatility',
    'VWAP Context': 'VWAP',
    'Opening-Range Context': 'Opening Range',
    'First-Observed Daily Range Context': 'Opening Range',
    'Prior-Day Context': 'Prior-Day High',
  }[label] ?? label)

  const [expandedDimensions, setExpandedDimensions] =
    React.useState(() => new Set())

  const batchBContextOverview = useMemo(() => {
    if (!batchB.available) return []

    return batchB.dimensions.map((dimension) => {
      const populatedBuckets = dimension.buckets.filter(
        (bucket) => bucket.summary.overall.occurrenceCount > 0,
      )

      const comparableBuckets = populatedBuckets.filter(
        (bucket) => Number.isFinite(bucket.summary.overall.expectancy),
      )

      const expectancies = comparableBuckets.map(
        (bucket) => bucket.summary.overall.expectancy,
      )

      const rawSpread =
        expectancies.length >= 2
          ? Math.max(...expectancies) - Math.min(...expectancies)
          : null

      const spread =
        rawSpread === null ? null : Number(rawSpread.toFixed(2))

      const lowEvidenceCount = dimension.buckets.filter(
        (bucket) => bucket.lowEvidence,
      ).length

      return {
        key: dimension.key,
        label: friendlyDimensionLabel(dimension.label),
        bucketCount: dimension.buckets.length,
        lowEvidenceCount,
        spread,
        status:
          spread === null
            ? 'LIMITED DATA'
            : spread >= 0.1
              ? 'CONTEXT VARIATION'
              : 'LIMITED VARIATION',
      }
    })
  }, [batchB])
    const batchBReadout = useMemo(() => {
    if (!batchB.available) return null

    const variationDimensions = batchBContextOverview.filter(
      (item) => item.status === 'CONTEXT VARIATION',
    )

    const lowEvidenceDimensions = batchBContextOverview.filter(
      (item) => item.lowEvidenceCount > 0,
    )

    const variationLabels = variationDimensions.map(
      (item) => item.label,
    )

    const badge = variationDimensions.length
      ? 'CONTEXT VARIATION'
      : 'LIMITED CONTEXT VARIATION'

    const why = variationDimensions.length
      ? `SetupScan grouped the same historical Momentum Breakout signals by market conditions and found noticeable differences in ${variationDimensions.length} context area${variationDimensions.length === 1 ? '' : 's'}: ${variationLabels.join(', ')}. This only describes what happened in the historical sample. It does not prove those conditions will cause better or worse results next time.`
      : 'SetupScan grouped the same historical Momentum Breakout signals by market conditions but did not find a large difference between the comparable groups. That does not prove market conditions are unimportant.'

    const summary = variationDimensions.length
      ? `We tested whether market conditions mattered. SetupScan took the same ${batchB.totalQualifyingSignals} Momentum Breakout signals and grouped them by things like time of day, market trend, volatility, VWAP, relative strength, opening range, prior-day high, and volume strength. ${variationDimensions.length} of those context areas showed noticeably different historical results between their groups. That means those conditions may be worth studying more closely, but it does not tell us which condition will work better in the future.`
      : `We tested whether market conditions mattered by grouping the same ${batchB.totalQualifyingSignals} Momentum Breakout signals by the conditions present when each signal happened. The comparable groups did not show a large enough historical difference to stand out under the current research rule.`

    const limitations = [
      'This only tells us what happened in past data. It does not predict the next trade.',
      'The trading setup itself never changed. We only sorted the same signals into different market-condition groups.',
      lowEvidenceDimensions.length
  ? `${lowEvidenceDimensions.map((item) => item.label).join(', ')} include at least one small group with fewer than 100 observations. SetupScan uses 100 observations as a research caution threshold; reaching 100 does not guarantee that a pattern is reliable or will repeat.`
  : 'No context group falls below SetupScan’s 100-observation research caution threshold. Reaching that threshold still does not prove that a result is reliable or will repeat.',
    ]

    const next = variationDimensions.length
      ? `The next step is to check whether the differences seen in ${variationLabels.join(', ')} still show up when we break them down by research period, symbol, and modeled trading costs. If a difference disappears when we look deeper, it is probably not strong enough to act on.`
      : 'The next step is to look deeper by research period, symbol, and modeled trading costs to see whether any useful pattern appears inside the broader groups.'

    const question = variationDimensions.length
      ? 'Do these same differences keep showing up when we look at different time periods, symbols, and trading-cost assumptions?'
      : 'Is there a smaller, repeatable pattern hidden inside these broader context groups?'

    return {
      badge,
      why,
      summary,
      limitations,
      next,
      question,
    }
  }, [batchB, batchBContextOverview])

  const expandedCount = batchBContextOverview.filter(
    (item) => expandedDimensions.has(item.key),
  ).length

  const allDimensionsExpanded =
    batchBContextOverview.length > 0 &&
    expandedCount === batchBContextOverview.length

  const setDimensionOpen = (key, isOpen) => {
    setExpandedDimensions((current) => {
      const next = new Set(current)

      if (isOpen) {
        next.add(key)
      } else {
        next.delete(key)
      }

      return next
    })
  }

  const expandAllDimensions = () => {
    setExpandedDimensions(
      new Set(batchBContextOverview.map((item) => item.key)),
    )
  }

  const collapseAllDimensions = () => {
    setExpandedDimensions(new Set())
  }

  return (
    <section className="robustness-lab panel discovery-batch-b">

<div className="panel-heading compact">
  <div>
    <p className="eyebrow">
      RESEARCH · STRATEGY DISCOVERY · BATCH B
    </p>
    <h2>
      <svg
        className="discovery-batch-heading-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <circle cx="8" cy="7" r="3" />
        <path d="M8 1v2M1 7h2M3 2l1.5 1.5M13 2l-1.5 1.5" />
        <path d="M7 20h11a4 4 0 0 0 0-8 5.5 5.5 0 0 0-10.2 1.2A3.5 3.5 0 0 0 7 20Z" />
      </svg>
      Batch B — Market Conditions
    </h2>
  </div>
  <span className="coming-soon">
    CONTEXT RESEARCH · SAME SIGNALS
  </span>
</div>

      <p className="robustness-disclaimer">
       Batch B takes the same Momentum Breakout signals from Batch A and looks at the market conditions around those signals.
       It checks whether things like trend, volatility, time of day, VWAP, relative strength, and volume were associated with different historical results.
       The trading rules stay exactly the same; only the surrounding conditions are compared.
      </p>
          <div className="batch-scope">
  <h3>8 market conditions</h3>
  <p>
    These are the conditions we're checking around the same breakout signals:
  </p>

  <div className="batch-scope-grid">
    <div>
      <strong>1. Time of Day</strong>
      <span>When the signal happened during the trading day.</span>
    </div>

    <div>
      <strong>2. Market Trend</strong>
      <span>Whether the broader market was trending up, down, or mixed.</span>
    </div>

    <div>
      <strong>3. Volatility</strong>
      <span>Whether the market was relatively calm or volatile.</span>
    </div>

    <div>
      <strong>4. Relative Strength</strong>
      <span>Whether the stock was stronger or weaker than its peers.</span>
    </div>

    <div>
      <strong>5. VWAP</strong>
      <span>Whether the signal happened above or below VWAP.</span>
    </div>

    <div>
      <strong>6. Opening Range</strong>
      <span>Whether price had broken above the day's early range.</span>
    </div>

    <div>
      <strong>7. Prior-Day High</strong>
      <span>Whether price had also cleared the previous day's high.</span>
    </div>

    <div>
      <strong>8. Volume Strength</strong>
      <span>
        How strong the signal's volume was compared with the minimum requirement.
      </span>
    </div>
  </div>
</div>
      {!batchB.available ? (
        <ResearchDataStatus datasets={datasets} requiredSymbols={['SPY', 'QQQ', 'IWM']} />
      ) : (
  <>
    <section className="discovery-evidence-snapshot">
      <div className="discovery-evidence-heading">
        <div>
          <p className="eyebrow">BATCH B EVIDENCE</p>
          <h3>Batch B evidence snapshot</h3>
          <p>
  A compact view of where the same frozen Momentum Breakout signals
  behaved differently across historical market conditions.
  These are descriptive comparisons, not rankings or predictions.
</p>
<p>
  <strong>Quick definition:</strong> R measures a trade result relative
  to the amount risked. +1R means gaining the amount originally risked;
  -1R means losing that amount.
</p>
        </div>
      </div>

      <div className="discovery-evidence-grid">
        {batchBEvidenceSnapshotRows(batchB).map((item) => (
          <div
            className="discovery-evidence-card"
            key={item.key}
          >
            <div className="discovery-evidence-card-heading">
              <strong>{item.label}</strong>

              <span className="discovery-evidence-badge" data-context-status={item.status}>
                {item.status}
              </span>
            </div>

            <div className="discovery-evidence-metrics">
  <div>
    <span>Difference between groups</span>
    <strong>
      {item.spread !== null
        ? `${item.spread.toFixed(2)}R`
        : '—'}
    </strong>
  </div>

  <div>
    <span>Groups compared</span>
    <strong>{item.bucketCount}</strong>
  </div>

  {item.bucketCount >= 2 ? (
    <>
      <div>
        <span>Highest historical result</span>
        <strong>
          {item.highest
            ? `${
                item.highest.label === 'Insufficient History'
                  ? 'Not enough prior history'
                  : item.highest.label
              } · ${formatR(item.highest.expectancy)}`
            : '—'}
        </strong>
      </div>

      <div>
        <span>Lowest historical result</span>
        <strong>
          {item.lowest
            ? `${
                item.lowest.label === 'Insufficient History'
                  ? 'Not enough prior history'
                  : item.lowest.label
              } · ${formatR(item.lowest.expectancy)}`
            : '—'}
        </strong>
      </div>
    </>
  ) : (
    <>
      <div>
        <span>Comparison</span>
        <strong>Unavailable</strong>
      </div>

      <div>
        <span>Why</span>
        <strong>
          {item.bucketCount === 1
            ? 'Only one usable historical group'
            : 'No usable historical groups'}
        </strong>
      </div>
    </>
  )}
</div>
          </div>
        ))}
      </div>

      <p className="discovery-evidence-note">
  When at least two groups have usable historical results, SetupScan
  compares their highest and lowest average R values. A larger
  difference means the groups behaved more differently in this
  historical sample. It does not mean a condition is better,
  predictive, validated, or ready for live use.
</p>
    </section>

    <section
      className="discovery-research-journey"
      aria-label="Batch B research journey"
    >
            <h4>Research Journey</h4>
            <p>
              Research progress, not strategy quality. A completed check does not
              mean the context is validated or predictive.
            </p>

            <ol>
              <li>
                <strong>Hypothesis Defined</strong>
                <span>
                  Defined — reuse the frozen Batch A Momentum Breakout setup and
                  compare only the market conditions around those same signals.
                </span>
              </li>

              <li>
                <strong>Historical Sample</strong>
                <span>
                  Run completed — {batchB.totalQualifyingSignals} qualifying frozen
                  breakout signals available for context research.
                </span>
              </li>

              <li>
  <strong>Context Comparison</strong>
  <span>
    Checked — {batchBContextOverview.length} market conditions
    compared.{' '}
    {
      batchBContextOverview.filter(
        (item) => item.status === 'CONTEXT VARIATION',
      ).length
    }{' '}
    showed a historical difference of at least 0.10R between their
    groups.
  </span>
</li>

              <li>
                <strong>Forward Observation</strong>
                <span>
                  Not started here — Batch B is descriptive historical context
                  research and does not provide prospective evidence that these
                  differences will repeat.
                </span>
              </li>
            </ol>
          </section>

          <div className="discovery-family-readout">
            <div className="discovery-family-readout-heading">
              <div>
                <p className="eyebrow">INTERPRETATION LAYER</p>
                <strong>Evidence Readout</strong>
              </div>
            </div>

            <div className="discovery-family-readout-grid">
              {batchBContextOverview.map((item) => (
                <div
                  className="discovery-family-readout-item"
                  key={item.key}
                >
                  <span>{item.label}</span>

                  <strong>{item.status}</strong>

                  <p>
  {item.spread !== null
    ? `${item.bucketCount} historical group${item.bucketCount === 1 ? '' : 's'} · ${item.spread.toFixed(
        2,
      )}R difference between highest and lowest results`
    : `${item.bucketCount} historical group${item.bucketCount === 1 ? '' : 's'} · comparison unavailable`}
                  </p>

                  <details className="discovery-label-explanation">
                    <summary>Why this label?</summary>

                    {item.spread === null ? (
  <p>
    SetupScan could not find at least two historical groups with
    usable average results, so this market condition is labeled
    Limited Data rather than forcing a comparison.
  </p>
) : item.status === 'CONTEXT VARIATION' ? (
  <p>
    The highest and lowest historical groups differed by{' '}
    {item.spread.toFixed(2)}R. That meets SetupScan&apos;s current
    exploratory 0.10R difference rule. It describes a historical
    difference only; it does not prove that one condition is better,
    validated, or predictive.
  </p>
) : (
  <p>
    The highest and lowest historical groups differed by{' '}
    {item.spread.toFixed(2)}R, which is below SetupScan&apos;s current
    exploratory 0.10R difference rule. That does not prove this
    market condition is unimportant.
  </p>
)}

                    {item.lowEvidenceCount > 0 && (
  <p>
    {item.lowEvidenceCount} group
    {item.lowEvidenceCount === 1 ? '' : 's'} in this market
    condition contain fewer than 100 observations. SetupScan uses
    100 observations as a research caution threshold; reaching 100
    does not guarantee that a pattern is reliable or will repeat.
  </p>
)}
                    <p>
                      These buckets reuse the same frozen historical breakout
                      signals. They are descriptive slices of the same evidence,
                      not independent confirmations.
                    </p>
                  </details>
                </div>
              ))}
            </div>
          </div>

          {batchBReadout && (
            <section
              className="discovery-research-readout"
              id="discovery-batch-b-readout"
              tabIndex={-1}
            >
              <div className="discovery-readout-heading">
                <div>
                  <p className="eyebrow">INTERPRETATION LAYER</p>
                  <h3>Research Readout</h3>
                </div>

                <DiscoveryReadoutLabel
                  badge={batchBReadout.badge}
                  why={batchBReadout.why}
                  ariaLabel="Why this label? Overall Batch B context evidence"
                />
              </div>

              <div className="discovery-readout-content">
                <div className="discovery-readout-section is-conclusion">
                  <h4>What the evidence says</h4>
                  <p>Batch B groups the same frozen Batch A Momentum Breakout signals by surrounding market conditions. It does not change which signals qualify.</p>
                  <p>{batchBReadout.summary}</p>
                </div>

                <div className="discovery-readout-section is-limitations">
                  <h4>What this does not prove</h4>
                  {batchBReadout.limitations.map((text) => (
                    <p key={text}>{text}</p>
                  ))}
                </div>

                <div className="discovery-readout-section is-next">
                  <h4>What should SetupScan investigate next?</h4>
                  <p>{batchBReadout.next}</p>
                  <p className="discovery-next-question">
                    {batchBReadout.question}
                  </p>
                </div>
              </div>
            </section>
)}
<LearningDetails label="More details">
            <div
            className="discovery-context-controls"
            role="group"
            aria-label="Batch B context evidence sections"
          >
            <button
              type="button"
              onClick={expandAllDimensions}
              disabled={allDimensionsExpanded}
            >
              Expand All
            </button>

            <button
              type="button"
              onClick={collapseAllDimensions}
              disabled={expandedCount === 0}
            >
              Collapse All
            </button>

            <span>
              {expandedCount} of {batchBContextOverview.length} sections expanded
            </span>
          </div>
          <div className="robustness-section">
            <h3>The trading setup Batch B reused</h3>
<p className="robustness-muted">
  Batch B does not change this setup. It uses the same Momentum Breakout
  signals from Batch A and compares only the market conditions around them.
</p>
                        <div className="discovery-setup-grid">
              <div className="discovery-setup-item">
                <span>Hypothesis</span>
                <p>{batchB.frozenBreakoutDefinition.hypothesis}</p>
              </div>

              <div className="discovery-setup-item">
  <span>Breakout lookback</span>
  <p>
    Previous {batchB.frozenBreakoutDefinition.parameters.lookbackBars} candles
  </p>
</div>

<div className="discovery-setup-item">
  <span>Volume requirement</span>
  <p>
    At least {batchB.frozenBreakoutDefinition.parameters.volumeMultiple}×
    normal volume
  </p>
</div>

              <div className="discovery-setup-item">
  <span>Risk distance</span>
  <p>
    {batchB.frozenBreakoutDefinition.parameters.riskDefinition} — ATR
    measures the market&apos;s typical price movement, so this sets risk
    relative to recent volatility.
  </p>
</div>

              <div className="discovery-setup-item">
  <span>Outcome tests</span>
  <p>
    Main test: {batchB.frozenBreakoutDefinition.parameters.primaryOutcome}
  </p>
  <p>
    Secondary test: {batchB.frozenBreakoutDefinition.parameters.secondaryOutcome}
  </p>
</div>

              <div className="discovery-setup-item">
                <span>Signals included in this research</span>
                <p>{batchB.totalQualifyingSignals}</p>
              </div>
            </div>
          </div>
          <div className="robustness-section"><ReproducibilityInfo
  batch={batchB}
  label="Batch B"
  title="Data used for this research"
/></div>
          {batchB.dimensions.map((dimension) => (
  <DimensionSection
    key={dimension.key}
    dimension={dimension}
    label={friendlyDimensionLabel(dimension.label)}
    parentResolvedCount={batchB.totalQualifyingSignals}
    open={expandedDimensions.has(dimension.key)}
    onOpenChange={(isOpen) =>
      setDimensionOpen(dimension.key, isOpen)
    }
  />
))}
          </LearningDetails>
        </>
      )}
      <p className="research-note">Find context and comparison definitions in Need help.</p>
      <LearningDetails label="How was this tested?">
        <HowToReadResults title="Batch B method" items={BATCH_B_HOW_TO_READ} />
      </LearningDetails>
      <p className="research-note">
        Descriptive, exploratory research only. This module does not change the production scanner, its scoring, paper trading, the
        Render worker, or the API, and it does not implement automatic strategy optimization.
      </p>
    </section>
  )
}



const BATCH_C_HOW_TO_READ = [
  'Batch C changes only which bars are included in the data universe \u2014 the breakout signal condition, entry rule, stop, and outcome windows are identical, frozen, and unmodified from Batch A.',
  'The regular-session-only series is built first, and the frozen 20-bar lookback, ATR, and volume average all run on that filtered series \u2014 excluded extended-hours bars can never influence a signal, and entry can never land on an excluded bar.',
  'This is a controlled comparison of two research data universes, not a competition. Neither version is labeled better, best, superior, validated, or profitable anywhere on this page.',
  'Sample sizes differ between Batch A and Batch C because fewer bars qualify under the stricter universe \u2014 check the occurrence counts and low-evidence flags before reading into any difference.',
  'This is historical, descriptive research only. It does not change production scoring, paper trading, the Render worker, or the API.',
]

function ComparisonTable({ title, rows, gateEmptyObservations = false }) {
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
              <td>{row.batchA && (!gateEmptyObservations || row.batchA.occurrenceCount > 0) ? formatR(row.batchA.expectancy) : '\u2014'}</td>
              <td>{row.batchA && (!gateEmptyObservations || row.batchA.occurrenceCount > 0) ? formatPercent(row.batchA.winRate) : '\u2014'}</td>
              <td>{row.batchC?.occurrenceCount ?? '\u2014'}</td>
              <td>{row.batchC && (!gateEmptyObservations || row.batchC.occurrenceCount > 0) ? formatR(row.batchC.expectancy) : '\u2014'}</td>
              <td>{row.batchC && (!gateEmptyObservations || row.batchC.occurrenceCount > 0) ? formatPercent(row.batchC.winRate) : '\u2014'}</td>
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
  const batchCHasResolvedObservations = batchC.summary?.overall?.occurrenceCount > 0
    const batchCComparisonSeries = [
    {
      key: 'batch-a',
      label: 'Batch A',
      metricLabel: 'Average result',
    },
    {
      key: 'batch-c',
      label: 'Batch C',
      metricLabel: 'Average result',
    },
  ]

  const batchCPeriodObservations =
    comparison?.byPeriod.map((row) => ({
      label: String(row.label),
      series: [
        {
          label: 'Batch A',
          value: Number.isFinite(row.batchA?.expectancy)
            ? row.batchA.expectancy
            : null,
          tradeCount: row.batchA?.occurrenceCount ?? 0,
        },
        {
          label: 'Batch C',
          value: Number.isFinite(row.batchC?.expectancy)
            ? row.batchC.expectancy
            : null,
          tradeCount: row.batchC?.occurrenceCount ?? 0,
        },
      ],
    })) ?? []

  const batchCSymbolObservations =
    comparison?.bySymbol.map((row) => ({
      label: String(row.label),
      series: [
        {
          label: 'Batch A',
          value: Number.isFinite(row.batchA?.expectancy)
            ? row.batchA.expectancy
            : null,
          tradeCount: row.batchA?.occurrenceCount ?? 0,
        },
        {
          label: 'Batch C',
          value: Number.isFinite(row.batchC?.expectancy)
            ? row.batchC.expectancy
            : null,
          tradeCount: row.batchC?.occurrenceCount ?? 0,
        },
      ],
    })) ?? []

  const batchCCostObservations =
    comparison?.costTiers.map((tier) => ({
      label: String(tier.label),
      series: [
        {
          label: 'Batch A',
          value: Number.isFinite(tier.batchA?.expectancy)
            ? tier.batchA.expectancy
            : null,
          tradeCount: tier.batchA?.occurrenceCount ?? 0,
        },
        {
          label: 'Batch C',
          value: Number.isFinite(tier.batchC?.expectancy)
            ? tier.batchC.expectancy
            : null,
          tradeCount: tier.batchC?.occurrenceCount ?? 0,
        },
      ],
    })) ?? []

  const takeawayText = useMemo(() => {
    if (!batchC.available) {
      return `Batch C has not run yet because real Alpaca historical data for ${batchC.missingSymbols?.join(', ') ?? 'SPY, QQQ, IWM'} is not currently available. No results are shown, and none have been invented.`
    }
    if (!comparison) return 'Batch A results were not available for comparison in this session.'
    if (comparison.overall.occurrenceCount.batchA === 0 || comparison.overall.occurrenceCount.batchC === 0) return 'One or both datasets have no resolved observations, so the performance comparison is unavailable. Occurrence counts remain visible below.'
    const occDiff = comparison.overall.occurrenceCount.diff
    const expectancyDiff = comparison.overall.expectancy.diff
    const direction = expectancyDiff === null ? 'could not be compared' : expectancyDiff > 0 ? 'was higher' : expectancyDiff < 0 ? 'was lower' : 'was effectively the same'
    return `Restricting to regular-session-only bars changed the resolved observation count by ${occDiff >= 0 ? '+' : ''}${occDiff} (Batch A: ${comparison.overall.occurrenceCount.batchA}, Batch C: ${comparison.overall.occurrenceCount.batchC}), and expectancy ${direction} in Batch C than in Batch A for this sample (${formatR(comparison.overall.expectancy.batchA)} vs. ${formatR(comparison.overall.expectancy.batchC)}). This is a controlled comparison of two data universes using the identical frozen signal, entry, stop, and outcome rules \u2014 it does not identify either universe as better, best, superior, validated, or profitable, and Batch A remains the original full-session experiment, unchanged.`
  }, [batchC, comparison])
  const batchCReadout = useMemo(() => {
    if (!batchC.available || !comparison) return null

    const batchAOccurrences = comparison.overall.occurrenceCount.batchA
    const batchCOccurrences = comparison.overall.occurrenceCount.batchC
    const occurrenceDiff = comparison.overall.occurrenceCount.diff

    const expectancyDiff =
      Number.isFinite(comparison.overall.expectancy.diff)
        ? Number(comparison.overall.expectancy.diff.toFixed(2))
        : null

    const comparableCount = (rows = []) =>
      rows.filter(
        (row) =>
          (row.batchA?.occurrenceCount ?? 0) > 0 &&
          (row.batchC?.occurrenceCount ?? 0) > 0,
      ).length

    const periodComparableCount = comparableCount(comparison.byPeriod)
    const symbolComparableCount = comparableCount(comparison.bySymbol)
    const costComparableCount = comparableCount(comparison.costTiers)

    const dataUniverseChanged =
      occurrenceDiff !== 0 ||
      (expectancyDiff !== null && expectancyDiff !== 0)

    return {
      badge: !batchCHasResolvedObservations
        ? 'LIMITED DATA'
        : dataUniverseChanged
          ? 'DATA UNIVERSE EFFECT'
          : 'LIMITED DIFFERENCE',

      why: !batchCHasResolvedObservations
        ? 'Batch C does not have resolved observations, so the historical performance comparison is limited.'
        : dataUniverseChanged
          ? 'Using regular-session-only bars changed the qualifying sample and/or the displayed average historical result while the trading rules stayed frozen. That is a historical data-universe effect in this sample, not evidence that one universe is superior.'
          : 'The displayed overall sample and average historical result did not change at the current reporting precision. That does not prove the two data universes are equivalent.',

      summary: takeawayText,

      cards: [
        {
          label: 'Resolved observations',
          status: occurrenceDiff === 0 ? 'SAME SAMPLE' : 'SAMPLE CHANGED',
          summary: `Batch A: ${batchAOccurrences} · Batch C: ${batchCOccurrences} · Diff: ${occurrenceDiff >= 0 ? '+' : ''}${occurrenceDiff}`,
                    why: 'Batch C keeps the trading rules frozen but removes bars outside the stricter regular-session convention. A different resolved-observation count therefore describes a different historical data universe, not a better or worse strategy.',
        },
        {
          label: 'Average result',
          status:
            expectancyDiff === null
              ? 'UNAVAILABLE'
              : expectancyDiff === 0
                ? 'NO VISIBLE CHANGE'
                : 'RESULT CHANGED',
          summary: `Batch A: ${formatR(comparison.overall.expectancy.batchA)} · Batch C: ${formatR(comparison.overall.expectancy.batchC)} · Diff: ${expectancyDiff === null ? '—' : formatR(expectancyDiff)}`,
          why: 'This compares the historical average result produced by the same frozen rules on two different bar universes. A higher or lower historical value does not establish future superiority.',
        },
        {
          label: 'Research periods',
          status:
            periodComparableCount > 0
              ? 'COMPARISON AVAILABLE'
              : 'LIMITED DATA',
          summary: `${periodComparableCount} research-period comparison${periodComparableCount === 1 ? '' : 's'} with observations in both batches`,
          why: 'Research-period rows show whether the Batch A versus Batch C difference looks similar or different across historical periods. These rows still come from the same underlying history and are not independent confirmation.',
        },
        {
          label: 'Symbols',
          status:
            symbolComparableCount > 0
              ? 'COMPARISON AVAILABLE'
              : 'LIMITED DATA',
          summary: `${symbolComparableCount} symbol comparison${symbolComparableCount === 1 ? '' : 's'} with observations in both batches`,
          why: 'Symbol comparisons show whether changing the session convention affected SPY, QQQ, and IWM similarly or differently in this historical sample. They do not identify a preferred symbol.',
        },
        {
          label: 'Modeled costs',
          status:
            costComparableCount > 0
              ? 'COMPARISON AVAILABLE'
              : 'LIMITED DATA',
          summary: `${costComparableCount} modeled cost-tier comparison${costComparableCount === 1 ? '' : 's'} with observations in both batches`,
          why: 'These cost tiers are research assumptions applied to historical outcomes. They are useful for sensitivity analysis but are not measured historical fills.',
        },
      ],

      limitations: [
        'This is a historical comparison of two data universes. It does not predict which session convention will perform better on the next trade.',
        'Batch A and Batch C reuse the same frozen trading rules but do not contain identical observations because Batch C excludes extended-hours and boundary-overlap bars.',
        'Research-period, symbol, and cost views reuse the same underlying historical evidence and should not be treated as independent confirmations.',
        'Modeled trading costs are assumptions rather than actual historical executions.',
      ],

      next:
        'The next step is to inspect whether the Batch A versus Batch C differences remain directionally similar across research periods, symbols, and modeled trading costs, or whether the overall difference disappears when the evidence is broken apart.',

      question:
        'Does the regular-session-only effect persist across periods, symbols, and cost assumptions, or is it mostly an overall-sample artifact?',
    }
  }, [
    batchC,
    batchCHasResolvedObservations,
    comparison,
    takeawayText,
  ])
  return (

<section className="robustness-lab panel discovery-batch-c">
  <div className="panel-heading compact">
    <div>
      <p className="eyebrow">
        RESEARCH · STRATEGY DISCOVERY · BATCH C
      </p>
      <h2>
        <svg
          className="discovery-batch-heading-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
        Batch C — Regular-Hours Test
      </h2>
    </div>
    <span className="coming-soon">
      CONTROLLED COMPARISON · FROZEN RULES
    </span>
  </div>


       <p className="robustness-disclaimer">
         Batch C runs the same Momentum Breakout rules as Batch A, but uses only bars that fall fully inside regular U.S. market hours.
         This tests whether the choice of trading-session data changes the historical results without changing the trading rules themselves.
       </p>

      {!batchC.available ? (
        <ResearchDataStatus datasets={datasets} requiredSymbols={['SPY', 'QQQ', 'IWM']} />
      ) : (
        <>
                    <section
            className="discovery-research-journey"
            aria-label="Batch C research journey"
          >
            <h4>Research Journey</h4>
            <p>
              Research progress, not strategy quality. A completed comparison does
              not mean either data universe is better.
            </p>

            <ol>
              <li>
                <strong>Hypothesis Defined</strong>
                <span>
                  Defined — keep the Batch A Momentum Breakout rules frozen and
                  change only which trading-session bars are included.
                </span>
              </li>

              <li>
                <strong>Historical Sample</strong>
                <span>
                  Run completed — {batchC.totalQualifyingSignals} qualifying Batch C
                  signals · {batchC.summary.overall.occurrenceCount} resolved
                  observations.
                </span>
              </li>

              <li>
                <strong>Controlled Comparison</strong>
                <span>
                  Checked — Batch A versus Batch C overall, by research period, by
                  symbol, and under modeled trading-cost tiers.
                </span>
              </li>

              <li>
                <strong>Forward Observation</strong>
                <span>
                  Not started here — this is a historical data-universe comparison,
                  not prospective evidence that either session convention will
                  perform better next.
                </span>
              </li>
            </ol>
          </section>

          {batchCReadout && (
            <div className="discovery-family-readout">
              <div className="discovery-family-readout-heading">
                <div>
                  <p className="eyebrow">INTERPRETATION LAYER</p>
                  <strong>Evidence Readout</strong>
                </div>
              </div>

              <div className="discovery-family-readout-grid">
                {batchCReadout.cards.map((card) => (
                  <div
                    className="discovery-family-readout-item"
                    key={card.label}
                  >
                    <span>{card.label}</span>

                    <strong>{card.status}</strong>

                    <p>{card.summary}</p>

                    <details className="discovery-label-explanation">
                      <summary>Why this label?</summary>
                      <p>{card.why}</p>
                    </details>
                  </div>
                ))}
              </div>
            </div>
          )}

          {batchCReadout && (
            <section
              className="discovery-research-readout"
              id="discovery-batch-c-readout"
              tabIndex={-1}
            >
              <div className="discovery-readout-heading">
                <div>
                  <p className="eyebrow">INTERPRETATION LAYER</p>
                  <h3>Research Readout</h3>
                </div>

                <DiscoveryReadoutLabel
                  badge={batchCReadout.badge}
                  why={batchCReadout.why}
                  ariaLabel="Why this label? Overall Batch C session comparison"
                />
              </div>

              <div className="discovery-readout-content">
                <div className="discovery-readout-section is-conclusion">
                  <h4>What the evidence says</h4>
                  <p>Batch C reruns the frozen Momentum Breakout rules using only fully regular-session hourly bars. This checks sensitivity to the data universe, not which version is better.</p>
                  <p>{batchCReadout.summary}</p>
                </div>

                <div className="discovery-readout-section is-limitations">
                  <h4>What this does not prove</h4>

                  {batchCReadout.limitations.map((text) => (
                    <p key={text}>{text}</p>
                  ))}
                </div>

                <div className="discovery-readout-section is-next">
                  <h4>What should SetupScan investigate next?</h4>
                  <p>{batchCReadout.next}</p>

                  <p className="discovery-next-question">
                    {batchCReadout.question}
                  </p>
                </div>
              </div>
            </section>
          )}
          <LearningDetails label="More details">
          <div className="robustness-section">
            <h3>Session convention</h3>
            <div className="discovery-setup-grid">
              <div className="discovery-setup-item">
                <span>Regular-session Eastern start hours kept</span>
                <p>{batchC.regularSessionEasternHours.join(':00, ')}:00</p>
              </div>

              <div className="discovery-setup-item">
                <span>Excluded</span>
                <p>
                  09:00 ET (boundary-overlap), 16:00 ET (postmarket),
                  and all other extended-hours bars
                </p>
              </div>

              <div className="discovery-setup-item">
                <span>Total qualifying Batch C signals</span>
                <p>{batchC.totalQualifyingSignals}</p>
              </div>
            </div>
            <div className="robustness-table-wrap">
              <table className="robustness-table">
                <thead><tr><th>Symbol</th><th>Raw candles</th><th>Regular-session candles</th><th>Date range</th></tr></thead>
                <tbody>{batchC.datasetInfo.map((dataset) => <tr key={dataset.symbol}><td>{dataset.symbol}</td><td>{dataset.rawCandleCount}</td><td>{dataset.regularSessionCandleCount}</td><td>{dataset.start?.slice(0, 10)} {' – '} {dataset.end?.slice(0, 10)}</td></tr>)}</tbody>
              </table>
            </div>
          </div>

          <div className="robustness-section">
            <h3>Batch C standard metrics (regular-session-only)</h3>
            <div className="robustness-table-wrap">
              <table className="robustness-table">
                <thead><tr><th><DiscoveryMetricLabel label="Occurrences" /></th><th><DiscoveryMetricLabel label="Win rate" /></th><th><DiscoveryMetricLabel label="Profit factor" /></th><th><DiscoveryMetricLabel label="Average result" /></th><th><DiscoveryMetricLabel label="Median R" /></th><th><DiscoveryMetricLabel label="Total R" /></th><th><DiscoveryMetricLabel label="Max DD" /></th><th><DiscoveryMetricLabel label="Avg hold" /></th><th>Best move</th><th>Worst move</th></tr></thead>
                <tbody>
                  <tr>
                    <td>{batchC.summary.overall.occurrenceCount}</td>
                    <td>{batchCHasResolvedObservations ? formatPercent(batchC.summary.overall.winRate) : '—'}</td>
                    <td>{batchCHasResolvedObservations ? formatPf(batchC.summary.overall.profitFactor) : '—'}</td>
                    <td>{batchCHasResolvedObservations ? formatR(batchC.summary.overall.expectancy) : '—'}</td>
                    <td>{batchCHasResolvedObservations ? formatR(batchC.summary.overall.medianR) : '—'}</td>
                    <td>{batchCHasResolvedObservations ? formatR(batchC.summary.overall.totalR) : '—'}</td>
                    <td>{batchCHasResolvedObservations ? formatR(batchC.summary.overall.maximumDrawdown) : '—'}</td>
                    <td>{batchCHasResolvedObservations && batchC.summary.overall.averageHoldingBars != null ? batchC.summary.overall.averageHoldingBars.toFixed(1) : '—'}</td>
                    <td>{batchCHasResolvedObservations ? formatR(batchC.summary.overall.averageMfeR) : '—'}</td>
                    <td>{batchCHasResolvedObservations ? formatR(batchC.summary.overall.averageMaeR) : '—'}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            {!batchCHasResolvedObservations && (
              <p className="robustness-muted">
                No resolved observations are available for this result, so performance metrics are unavailable. The occurrence count and exclusion totals below show what was observed and why outcomes could not be resolved.
              </p>
            )}
            <p className="robustness-muted">
              {batchC.summary.overall.occurrenceCount < 100 ? 'Flagged as a low-evidence sample (fewer than 100 occurrences).' : 'Sample size at or above the protocol\u2019s 100-occurrence exploratory threshold.'}
              {' '}Other exclusions: {batchC.summary.excluded.insufficientDataCount} insufficient forward data,{' '}
              {batchC.summary.excluded.outsideResearchWindowCount} outside the research windows,{' '}
              {batchC.summary.excluded.periodBoundaryCount ?? 'unavailable'} outcomes crossing a research-period boundary.
            </p>
            <AmbiguitySummary summary={batchC.summary} />
            <p className="robustness-muted">Cost sensitivity (research-assumption basis-point tiers)</p>
            <div className="robustness-table-wrap">
              <table className="robustness-table">
                <thead><tr><th><DiscoveryMetricLabel label="Cost tier" /></th><th><DiscoveryMetricLabel label="Occurrences" /></th><th><DiscoveryMetricLabel label="Win rate" /></th><th><DiscoveryMetricLabel label="Profit factor" /></th><th><DiscoveryMetricLabel label="Average R" /></th></tr></thead>
                <tbody>{batchC.summary.costTiers.map((tier) => {
                  const hasResolvedObservations = tier.metrics.occurrenceCount > 0
                  return <tr key={tier.label}><td>{tier.label}</td><td>{tier.metrics.occurrenceCount}</td><td>{hasResolvedObservations ? formatPercent(tier.metrics.winRate) : '—'}</td><td>{hasResolvedObservations ? formatPf(tier.metrics.profitFactor) : '—'}</td><td>{hasResolvedObservations ? formatR(tier.metrics.averageR) : '—'}</td></tr>
                })}</tbody>
              </table>
            </div>
          </div>

          {comparison && (
            <>
              <div className="robustness-section">
                <h3>Batch A (full-session) vs. Batch C (regular-session-only) — overall</h3>
                <div className="robustness-table-wrap">
                  <table className="robustness-table">
                    <thead><tr><th>Metric</th><th>Batch A</th><th>Batch C</th><th>Diff (C − A)</th></tr></thead>
                    <tbody>
                      <tr><td>Resolved observations</td><td>{comparison.overall.occurrenceCount.batchA}</td><td>{comparison.overall.occurrenceCount.batchC}</td><td>{comparison.overall.occurrenceCount.diff}</td></tr>
                      <tr><td>Win rate</td><td>{comparison.overall.occurrenceCount.batchA ? formatPercent(comparison.overall.winRate.batchA) : '—'}</td><td>{comparison.overall.occurrenceCount.batchC ? formatPercent(comparison.overall.winRate.batchC) : '—'}</td><td>{comparison.overall.occurrenceCount.batchA && comparison.overall.occurrenceCount.batchC && comparison.overall.winRate.diff !== null ? `${(comparison.overall.winRate.diff * 100).toFixed(1)}%` : '—'}</td></tr>
                      <tr><td>Profit factor</td><td>{comparison.overall.occurrenceCount.batchA ? formatPf(comparison.overall.profitFactor.batchA) : '—'}</td><td>{comparison.overall.occurrenceCount.batchC ? formatPf(comparison.overall.profitFactor.batchC) : '—'}</td><td>{comparison.overall.occurrenceCount.batchA && comparison.overall.occurrenceCount.batchC && comparison.overall.profitFactor.diff !== null ? comparison.overall.profitFactor.diff.toFixed(2) : '—'}</td></tr>
                      <tr><td>Average result</td><td>{comparison.overall.occurrenceCount.batchA ? formatR(comparison.overall.expectancy.batchA) : '—'}</td><td>{comparison.overall.occurrenceCount.batchC ? formatR(comparison.overall.expectancy.batchC) : '—'}</td><td>{comparison.overall.occurrenceCount.batchA && comparison.overall.occurrenceCount.batchC ? formatR(comparison.overall.expectancy.diff) : '—'}</td></tr>
                      <tr><td>Median R</td><td>{comparison.overall.occurrenceCount.batchA ? formatR(comparison.overall.medianR.batchA) : '—'}</td><td>{comparison.overall.occurrenceCount.batchC ? formatR(comparison.overall.medianR.batchC) : '—'}</td><td>{comparison.overall.occurrenceCount.batchA && comparison.overall.occurrenceCount.batchC ? formatR(comparison.overall.medianR.diff) : '—'}</td></tr>
                      <tr><td>Total R</td><td>{comparison.overall.occurrenceCount.batchA ? formatR(comparison.overall.totalR.batchA) : '—'}</td><td>{comparison.overall.occurrenceCount.batchC ? formatR(comparison.overall.totalR.batchC) : '—'}</td><td>{comparison.overall.occurrenceCount.batchA && comparison.overall.occurrenceCount.batchC ? formatR(comparison.overall.totalR.diff) : '—'}</td></tr>
                      <tr><td>Max drawdown</td><td>{comparison.overall.occurrenceCount.batchA ? formatR(comparison.overall.maximumDrawdown.batchA) : '—'}</td><td>{comparison.overall.occurrenceCount.batchC ? formatR(comparison.overall.maximumDrawdown.batchC) : '—'}</td><td>{comparison.overall.occurrenceCount.batchA && comparison.overall.occurrenceCount.batchC ? formatR(comparison.overall.maximumDrawdown.diff) : '—'}</td></tr>
                      <tr><td>Avg hold</td><td>{comparison.overall.occurrenceCount.batchA && comparison.overall.averageHoldingBars.batchA != null ? comparison.overall.averageHoldingBars.batchA.toFixed(1) : '—'}</td><td>{comparison.overall.occurrenceCount.batchC && comparison.overall.averageHoldingBars.batchC != null ? comparison.overall.averageHoldingBars.batchC.toFixed(1) : '—'}</td><td>{comparison.overall.occurrenceCount.batchA && comparison.overall.occurrenceCount.batchC && comparison.overall.averageHoldingBars.diff != null ? comparison.overall.averageHoldingBars.diff.toFixed(1) : '—'}</td></tr>
                      <tr><td>Best move</td><td>{comparison.overall.occurrenceCount.batchA ? formatR(comparison.overall.averageMfeR.batchA) : '—'}</td><td>{comparison.overall.occurrenceCount.batchC ? formatR(comparison.overall.averageMfeR.batchC) : '—'}</td><td>{comparison.overall.occurrenceCount.batchA && comparison.overall.occurrenceCount.batchC ? formatR(comparison.overall.averageMfeR.diff) : '—'}</td></tr>
                      <tr><td>Worst move</td><td>{comparison.overall.occurrenceCount.batchA ? formatR(comparison.overall.averageMaeR.batchA) : '—'}</td><td>{comparison.overall.occurrenceCount.batchC ? formatR(comparison.overall.averageMaeR.batchC) : '—'}</td><td>{comparison.overall.occurrenceCount.batchA && comparison.overall.occurrenceCount.batchC ? formatR(comparison.overall.averageMaeR.diff) : '—'}</td></tr>
                    </tbody>
                  </table>
                </div>
              </div>
              <p className="robustness-muted">Batch A and C period results group signals by signal date. An outcome can complete after its signal period, so these are signal-period cohorts, not outcomes fully contained within the named period.</p>
                            <section className="research-primary-visual discovery-batch-c-chart">
                <InspectableBarChart
                  id="strategy-discovery-batch-c-period"
                  title="Batch A vs. Batch C across research periods"
                  question="Compares the historical average result of the same frozen Momentum Breakout rules across development, out-of-sample, and holdout periods. Batch A uses the original full-session data universe; Batch C uses regular-session-only bars. Differences are descriptive historical evidence, not proof that either universe is superior."
                  observations={batchCPeriodObservations}
                  series={batchCComparisonSeries}
                  sampleUnit="occurrences"
                  sampleThreshold={100}
                  xAxisLabel="Research period"
                  formatValue={(value) =>
                    `${value >= 0 ? '+' : ''}${value.toFixed(2)}R`
                  }
                  layout="grouped"
                />
              </section>

              <ComparisonTable
                title="Batch A vs. Batch C — by research period"
                rows={comparison.byPeriod}
                gateEmptyObservations
              />

              <section className="research-primary-visual discovery-batch-c-chart">
                    <InspectableBarChart
                  id="strategy-discovery-batch-c-symbol"
                  title="Batch A vs. Batch C by symbol"
                  question="Compares the historical average result for SPY, QQQ, and IWM under the original Batch A data universe and the stricter Batch C regular-session-only universe. A difference for one symbol does not establish that the session convention caused the result."
                  observations={batchCSymbolObservations}
                  series={batchCComparisonSeries}
                  sampleUnit="occurrences"
                  sampleThreshold={100}
                  xAxisLabel="Symbol"
                  formatValue={(value) =>
                    `${value >= 0 ? '+' : ''}${value.toFixed(2)}R`
                  }
                  layout="grouped"
                />
              </section>

              <ComparisonTable
                title="Batch A vs. Batch C — by symbol"
                rows={comparison.bySymbol}
                gateEmptyObservations
              />

              <section className="research-primary-visual discovery-batch-c-chart">
              <InspectableLineChart
                  id="strategy-discovery-batch-c-cost"
                  title="Batch A vs. Batch C under modeled trading costs"
                  question="Shows how the historical average result for Batch A and Batch C changes as progressively larger research-assumption trading costs are applied. These tiers model friction and are not measured live execution costs."
                  observations={batchCCostObservations}
                  series={batchCComparisonSeries}
                  sampleUnit="occurrences"
                  sampleThreshold={100}
                  xAxisLabel="Modeled trading-cost tier"
                  formatValue={(value) =>
                    `${value >= 0 ? '+' : ''}${value.toFixed(2)}R`
                  }
                />
              </section>

              <ComparisonTable
                title="Batch A vs. Batch C — cost sensitivity"
                rows={comparison.costTiers.map((tier) => ({
                  label: tier.label,
                  batchA: tier.batchA,
                  batchC: tier.batchC,
                }))}
                gateEmptyObservations
              />
            </>
          )}

          </LearningDetails>
        </>
      )}
      <p className="research-note">Find context and comparison definitions in Need help.</p>
      <LearningDetails label="How was this tested?">
        <HowToReadResults title="Batch C method" items={BATCH_C_HOW_TO_READ} />
      </LearningDetails>
      <p className="research-note">
        Descriptive, exploratory research only. Batch A remains the original full-session experiment, preserved unchanged. This
        module does not change the production scanner, its scoring, paper trading, the Render worker, or the API.
      </p>
    </section>
  )
}

export function StrategyDiscoveryLab({
  datasets = [],
  onResearchNavigate,
}) {
  const batch = useMemo(() => runStrategyDiscoveryBatchA(datasets), [datasets])
  const discoveryInterpretation = useMemo(
    () => createStrategyDiscoveryLiveSummary(batch, datasets)?.interpretation ?? null,
    [batch, datasets],
  )
  const readout = useMemo(() => discoveryReadoutPresentation(discoveryInterpretation, STRATEGY_FAMILIES), [discoveryInterpretation])
  const resultsByExperimentId = useMemo(
    () => Object.fromEntries((batch.experiments ?? []).map((experiment) => [experiment.experimentId, experiment])),
    [batch],
  )
  const dataUnavailableReason = batch.available
    ? null
    : `waiting for real Alpaca historical data for ${batch.missingSymbols?.join(', ') ?? 'SPY, QQQ, IWM'}`
  const batchASampleCounts = (batch.experiments ?? []).map((experiment) => experiment.summary.overall.occurrenceCount).filter((count) => count > 0)
  const batchASample = !batch.available
    ? 'No Batch A sample is available until real historical data loads.'
    : batchASampleCounts.length
      ? `${batch.experiments.length} implemented families; per-family occurrences range from ${Math.min(...batchASampleCounts)} to ${Math.max(...batchASampleCounts)}.`
      : 'Four implemented families; no qualifying occurrences in this sample.'

  const batchBOverview = useMemo(
    () => runBreakoutContextResearch(datasets),
    [datasets],
  )

  const batchCOverview = useMemo(
    () => runRegularSessionBreakoutResearch(datasets),
    [datasets],
  )

  const batchAMomentumOverview = batch.experiments?.find(
    (experiment) => experiment.experimentId === 'momentum-breakout-v1',
  )

  const batchCComparisonOverview = useMemo(
    () =>
      batchAMomentumOverview && batchCOverview.available
        ? compareToBatchA(
            batchAMomentumOverview.summary,
            batchCOverview.summary,
          )
        : null,
    [batchAMomentumOverview, batchCOverview],
  )

  const overviewBatchARows = (batch.experiments ?? []).map(
    (experiment) => {
      const overall = experiment.summary.overall

      const populatedPeriods = (experiment.summary.byPeriod ?? []).filter(
        (row) =>
          row.occurrenceCount > 0 &&
          Number.isFinite(row.averageR),
      )

      const hasPositivePeriod = populatedPeriods.some(
        (row) => row.averageR > 0,
      )

      const hasNegativePeriod = populatedPeriods.some(
        (row) => row.averageR < 0,
      )

      const periodStatus =
        populatedPeriods.length < 2
          ? 'LIMITED DATA'
          : hasPositivePeriod && hasNegativePeriod
            ? 'MIXED'
            : 'SAME SIGN'

      const costRows = experiment.summary.costTiers ?? []

      const beforeCost = costRows[0]?.metrics?.averageR
      const highCost =
        costRows[costRows.length - 1]?.metrics?.averageR

      const hasComparableCosts =
        Number.isFinite(beforeCost) &&
        Number.isFinite(highCost)

      const crossesZero =
        hasComparableCosts &&
        beforeCost !== 0 &&
        highCost !== 0 &&
        Math.sign(beforeCost) !== Math.sign(highCost)

      const costStatus =
  overall.occurrenceCount < 100 || !hasComparableCosts
    ? 'LIMITED DATA'
    : beforeCost > 0 && highCost > 0
      ? 'STAYS POSITIVE'
      : beforeCost < 0 && highCost < 0
        ? 'STAYS NEGATIVE'
        : beforeCost === 0 || highCost === 0
          ? 'FLAT / ZERO'
          : 'CROSSES ZERO'

      return {
        key: experiment.experimentId,
        label: experiment.label,
        sample: overall.occurrenceCount,
        evidence:
          overall.occurrenceCount >= 100
            ? 'Exploratory'
            : 'Insufficient',
        averageR:
          overall.occurrenceCount > 0 &&
          Number.isFinite(overall.averageR)
            ? formatR(overall.averageR)
            : '—',
        periodStatus,
        periodTone:
          periodStatus === 'MIXED'
            ? 'is-caution'
            : periodStatus === 'LIMITED DATA'
              ? 'is-muted'
              : 'is-neutral',
        costStatus,
        costTone:
         costStatus === 'CROSSES ZERO' ||
         costStatus === 'STAYS NEGATIVE'
          ? 'is-caution'
          : costStatus === 'LIMITED DATA'
          ? 'is-muted'
          : 'is-neutral',
      }
    },
  )

  const overviewBatchBRows = useMemo(() => {
    if (!batchBOverview.available) return []

    const friendlyLabel = (label) =>
      ({
        'Market Trend Regime': 'Market Trend',
        'Volatility Regime': 'Volatility',
        'VWAP Context': 'VWAP',
        'Opening-Range Context': 'Opening Range',
        'First-Observed Daily Range Context': 'Opening Range',
        'Prior-Day Context': 'Prior-Day High',
      })[label] ?? label

    return batchBOverview.dimensions.map((dimension) => {
      const comparableExpectancies = dimension.buckets
        .filter(
          (bucket) =>
            bucket.summary.overall.occurrenceCount > 0 &&
            Number.isFinite(bucket.summary.overall.expectancy),
        )
        .map((bucket) => bucket.summary.overall.expectancy)

      const spread =
        comparableExpectancies.length >= 2
          ? Number(
              (
                Math.max(...comparableExpectancies) -
                Math.min(...comparableExpectancies)
              ).toFixed(2),
            )
          : null

      const status =
        spread === null
          ? 'LIMITED DATA'
          : spread >= 0.1
            ? 'CONTEXT VARIATION'
            : 'LIMITED VARIATION'

      return {
        key: dimension.key,
        label: friendlyLabel(dimension.label),
        bucketCount: dimension.buckets.length,
        spread,
        status,
        tone:
  spread === null
    ? 'is-unavailable'
    : spread >= 0.5
      ? 'is-strong'
      : spread >= 0.1
        ? 'is-moderate'
        : 'is-low',
      }
    })
  }, [batchBOverview])

  const overviewBatchCComparison = batchCComparisonOverview
    ? {
        batchA: {
          resolved:
            batchCComparisonOverview.overall.occurrenceCount.batchA,
          averageR: formatR(
            batchCComparisonOverview.overall.occurrenceCount.batchA > 0 ? batchCComparisonOverview.overall.expectancy.batchA : null,
          ),
          winRate: formatPercent(
            batchCComparisonOverview.overall.occurrenceCount.batchA > 0 ? batchCComparisonOverview.overall.winRate.batchA : null,
          ),
          profitFactor: formatPf(
            batchCComparisonOverview.overall.profitFactor.batchA,
          ),
        },

        batchC: {
          resolved:
            batchCComparisonOverview.overall.occurrenceCount.batchC,
          averageR: formatR(
            batchCComparisonOverview.overall.occurrenceCount.batchC > 0 ? batchCComparisonOverview.overall.expectancy.batchC : null,
          ),
          winRate: formatPercent(
            batchCComparisonOverview.overall.occurrenceCount.batchC > 0 ? batchCComparisonOverview.overall.winRate.batchC : null,
          ),
          profitFactor: formatPf(
            batchCComparisonOverview.overall.profitFactor.batchC,
          ),
        },

        expectancyDiff: formatR(
          batchCComparisonOverview.overall.expectancy.diff,
        ),
      }
    : null

  const pageRef = useRef(null)
  const sections = DISCOVERY_SECTIONS
  const navigation = useDiscoveryNavigation(pageRef, sections)
  return (
    <div className="discovery-page" ref={pageRef}>
    <DiscoverySectionNav sections={sections} {...navigation} />
    <section className="robustness-lab panel" id="discovery-overview" tabIndex={-1}>
      <DiscoveryOverview datasets={datasets} batch={batch} batchB={batchBOverview}
        rowsA={overviewBatchARows} rowsB={overviewBatchBRows} comparison={batchCComparisonOverview}
        readout={readout} navigate={navigation.navigate} />
      <details className="discovery-overview-technical">
        <summary>Detailed overview evidence</summary>
        <section className="discovery-overview-dashboard">
      <div className="discovery-overview-dashboard-heading">
        <div>
          <p className="eyebrow">RESEARCH MAP</p>
          <h3>Three batches, three different questions</h3>
        </div>

        <p>
          These are compact historical research summaries. They are not
          rankings, predictions, or instructions to change the live scanner.
        </p>
      </div>

      <div className="discovery-overview-dashboard-grid">

<article className="discovery-overview-panel discovery-batch-a-summary">
          <div className="discovery-overview-panel-heading">
            <div>
              <span>BATCH A</span>
              <h4>Setup Ideas</h4>
            </div>

            <strong>What did we find?</strong>
          </div>

          <p className="discovery-overview-panel-copy">
            Compares the evidence behind each implemented setup family.
            Performance direction and evidence strength are shown separately.
          </p>

          <div className="discovery-overview-matrix">
            <div className="discovery-overview-matrix-head">
              <span>Setup</span>
              <span>Sample</span>
              <span>Avg R</span>
              <span>Periods</span>
              <span>Costs</span>
            </div>

            {overviewBatchARows.map((row) => (
              <div
                className="discovery-overview-matrix-row"
                key={row.key}
              >
                <strong>{row.label}</strong>

                <span>
                  {row.sample}
                  <small>{row.evidence}</small>
                </span>

                <span>{row.averageR}</span>

                <span>
                  <small className={`overview-status ${row.periodTone}`}>
                    {row.periodStatus}
                  </small>
                </span>

                <span>
                  <small className={`overview-status ${row.costTone}`}>
                    {row.costStatus}
                  </small>
                </span>
              </div>
            ))}
          </div>

          <p className="discovery-overview-panel-note">
            A larger historical result does not make a setup validated.
            Sample size, period behavior, and modeled costs still matter.
          </p>
          <a
  className="discovery-overview-open-link"
  href="#discovery-batch-a"
  onClick={(event) => navigation.navigate(event, 'discovery-batch-a')}
>
  Open Batch A →
</a>
        </article>

        <article className="discovery-overview-panel discovery-batch-b-summary">
          <div className="discovery-overview-panel-heading">
            <div>
              <span>BATCH B</span>
              <h4>Market Conditions</h4>
            </div>

            <strong>Where did context vary?</strong>
          </div>

          <p className="discovery-overview-panel-copy">
            Each tile shows how far apart the highest and lowest populated
            historical expectancy buckets were inside one context dimension.
          </p>

          <div className="discovery-overview-heatmap">
            {overviewBatchBRows.map((row) => (
              <div
                className={`discovery-overview-heat-tile ${row.tone}`}
                key={row.key}
              >
                <span>{row.label}</span>

                <strong>
                  {row.spread === null
                    ? '—'
                    : `${row.spread.toFixed(2)}R`}
                </strong>

                <small>{row.status}</small>

                <p>
                  {row.bucketCount} historical bucket
                  {row.bucketCount === 1 ? '' : 's'}
                </p>
              </div>
            ))}
          </div>

          <p className="discovery-overview-panel-note">
            Stronger shading means more historical variation between buckets,
            not a better condition and not a prediction.
          </p>
          <a
  className="discovery-overview-open-link"
  href="#discovery-batch-b"
  onClick={(event) => navigation.navigate(event, 'discovery-batch-b')}
>
  Open Batch B →
</a>
        </article>

        <article className="discovery-overview-panel discovery-batch-c-summary">
          <div className="discovery-overview-panel-heading">
            <div>
              <span>BATCH C</span>
              <h4>Regular-Hours Test</h4>
            </div>

            <strong>What changed?</strong>
          </div>

          <p className="discovery-overview-panel-copy">
            Same frozen Momentum Breakout rules. Only the historical bar
            universe changes.
          </p>

          {overviewBatchCComparison ? (
            <>
              <div className="discovery-overview-versus">
                <div>
                  <span>Batch A</span>
                  <strong>Full session</strong>

                  <dl>
                    <div>
                      <dt>Resolved</dt>
                      <dd>{overviewBatchCComparison.batchA.resolved}</dd>
                    </div>

                    <div>
                      <dt>Average R</dt>
                      <dd>{overviewBatchCComparison.batchA.averageR}</dd>
                    </div>

                    <div>
                      <dt>Win rate</dt>
                      <dd>{overviewBatchCComparison.batchA.winRate}</dd>
                    </div>

                    <div>
                      <dt>Profit factor</dt>
                      <dd>{overviewBatchCComparison.batchA.profitFactor}</dd>
                    </div>
                  </dl>
                </div>

                <div className="discovery-overview-versus-divider">
                  VS
                </div>

                <div>
                  <span>Batch C</span>
                  <strong>Regular hours</strong>

                  <dl>
                    <div>
                      <dt>Resolved</dt>
                      <dd>{overviewBatchCComparison.batchC.resolved}</dd>
                    </div>

                    <div>
                      <dt>Average R</dt>
                      <dd>{overviewBatchCComparison.batchC.averageR}</dd>
                    </div>

                    <div>
                      <dt>Win rate</dt>
                      <dd>{overviewBatchCComparison.batchC.winRate}</dd>
                    </div>

                    <div>
                      <dt>Profit factor</dt>
                      <dd>{overviewBatchCComparison.batchC.profitFactor}</dd>
                    </div>
                  </dl>
                </div>
              </div>

              <div className="discovery-overview-delta">
                <span>Historical Average R change</span>
                <strong>{overviewBatchCComparison.expectancyDiff}</strong>
              </div>
            </>
          ) : (
            <p className="discovery-overview-unavailable">
              Batch C comparison unavailable until the required historical
              data is loaded.
            </p>

          )}

          <p className="discovery-overview-panel-note">
            This controlled historical comparison does not establish that
            either session convention is superior.
          </p>

          <a
  className="discovery-overview-open-link"
  href="#discovery-batch-c"
  onClick={(event) => navigation.navigate(event, 'discovery-batch-c')}
>
  Open Batch C →
</a>
        </article>
      </div>
    </section>
      </details>
    <div id="discovery-batch-a" tabIndex={-1}>
      {batch.available && (
  <section className="discovery-evidence-snapshot">
    <div className="discovery-evidence-heading">
      <div>
        <p className="eyebrow">BATCH A EVIDENCE</p>

<h3 className="discovery-batch-a-title">
  <svg
    className="discovery-batch-heading-icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path d="M9 18h6M10 22h4M9 14a6 6 0 1 1 6 0c-.7.5-1 1.2-1 2v1h-4v-1c0-.8-.3-1.5-1-2Z" />
  </svg>
  Batch A — Setup Ideas
</h3>

        <p>
          A compact view of what happened in the historical sample.
          Evidence strength and performance direction are separate questions. {batchASample}
        </p>
      </div>
    </div>

    <div className="discovery-evidence-grid">
      {batch.experiments.map((experiment) => {
        const family = STRATEGY_FAMILIES.find(item => item.experimentId === experiment.experimentId)
        const destination = discoveryFamilyId(family.key)
        const metrics = experiment.summary.overall
        const hasEvidence = metrics.occurrenceCount > 0
        const evidenceStrength =
          metrics.occurrenceCount >= 100
            ? 'EXPLORATORY'
            : 'INSUFFICIENT'

        return (
          <a
            href={`#${destination}`}
            onClick={event => navigation.navigate(event, destination)}
            aria-label={`Inspect ${experiment.label} detailed evidence`}
            className="discovery-evidence-card"
            key={experiment.experimentId}
          >
            <div className="discovery-evidence-card-heading">
              <strong>{experiment.label}</strong>

              <span
                className={`discovery-evidence-badge is-${evidenceStrength.toLowerCase()}`}
              >
                {evidenceStrength}
              </span>
            </div>

            <div className="discovery-evidence-metrics">
              <div>
                <span>Sample</span>
                <strong>{metrics.occurrenceCount}</strong>
              </div>

              <div>
                <span>Average R</span>
                <strong>
                  {hasEvidence ? formatR(metrics.averageR) : '—'}
                </strong>
              </div>

              <div>
                <span>Profit Factor</span>
                <strong>
                  {hasEvidence ? formatPf(metrics.profitFactor) : '—'}
                </strong>
              </div>

              <div>
                <span>Win Rate</span>
                <strong>
                  {hasEvidence ? formatPercent(metrics.winRate) : '—'}
                </strong>
              </div>
            </div>
            <span className="discovery-card-action">Inspect detailed evidence →</span>
          </a>
        )
      })}
    </div>

    <p className="discovery-evidence-note">
      Exploratory means the sample reached the current 100-occurrence
      research threshold. Insufficient means it did not. Neither label
      means a strategy is validated or ready for live use.
    </p>
  </section>
)}

{discoveryInterpretation && (
  <section className="discovery-research-readout" id="discovery-readout" tabIndex={-1}>
    <div className="discovery-readout-heading">
      <div>
        <p className="eyebrow">INTERPRETATION LAYER</p>
        <h3>Research Readout</h3>
      </div>

      <DiscoveryReadoutLabel badge={readout.badge} why={readout.why} />
    </div>

    <div className="discovery-readout-content">
      <div className="discovery-readout-section is-conclusion">
        <h4>What the evidence says</h4>
        <p>{readout.summary}</p>
      </div>
      <div className="discovery-readout-section is-limitations">
        <h4>What this does not prove</h4>
        {readout.limitations.map(text => <p key={text}>{text}</p>)}
      </div>
      <div className="discovery-readout-section is-next">
        <h4>What should SetupScan investigate next?</h4>
        <p>{readout.next}</p>
        <p className="discovery-next-question">{readout.question}</p>
      </div>
    </div>
  </section>
)}
      {!batch.available && <ResearchDataStatus datasets={datasets} requiredSymbols={['SPY', 'QQQ', 'IWM']} />}
      <section id="discovery-ideas" tabIndex={-1} className="discovery-strategy-sections">
        <div className="robustness-section">
         <h3>Setup ideas</h3>
<p className="robustness-muted">Open a family to inspect its full evidence. Each section can be expanded independently.</p>
          <div className="discovery-expansion-controls" aria-label="Strategy detail controls">
            <button type="button" disabled={navigation.expanded.open === navigation.expanded.total} onClick={() => navigation.expandAll(true)}>Expand All</button>
            <button type="button" disabled={navigation.expanded.open === 0} onClick={() => navigation.expandAll(false)}>Collapse All</button>
            <span role="status">{navigation.expanded.open} of {navigation.expanded.total} sections expanded</span>
          </div>
        </div>
        {STRATEGY_FAMILIES.map((family) => {
  const result = family.experimentId
    ? resultsByExperimentId[family.experimentId]
    : undefined

  return (
    <details
      id={discoveryFamilyId(family.key)}
      className="discovery-family-details"
      key={family.key}
    >
      <summary className="discovery-family-summary">
        <span>{family.label}</span>

        <strong>
          {result ? 'IMPLEMENTED' : 'NOT YET RUN'}
        </strong>
      </summary>

      <FamilyCard
  family={family}
  result={result}
  dataUnavailableReason={dataUnavailableReason}
  interpretation={{
    candidate: discoveryInterpretation?.discoveryCandidates.find(
      candidate => candidate.reference.strategyId === family.experimentId,
    ) ?? null,
    stability:
      discoveryInterpretation?.stabilityObservations.filter(
        (observation) =>
          observation.reference.strategyId === family.experimentId,
      ) ?? [],
    cost:
      discoveryInterpretation?.costSensitivityObservations.find(
        (observation) =>
          observation.reference.strategyId === family.experimentId,
      ) ?? null,
  }}
/>
    </details>
  )
})}
      </section>
      <section id="discovery-provenance" tabIndex={-1}>
        {batch.available ? <ReproducibilityInfo batch={batch} /> : <p className="robustness-muted">Historical research provenance is unavailable until the required datasets load.</p>}
      </section>

      <LearningDetails label="What does this mean?">
        <MetricsGlossary title="Strategy Discovery terms" intro="Plain-English explanations for discovery and validation." definitions={STRATEGY_DISCOVERY_DEFINITIONS} />
      </LearningDetails>
      <LearningDetails label="How was this tested?">
        <HowToReadResults title="Strategy discovery vs. strategy validation" items={STRATEGY_DISCOVERY_HOW_TO_READ} />
      </LearningDetails>

      <p className="research-note">
        Exploratory research only. This module does not change the production scanner, its scoring, paper trading, the Render
        worker, or the API, and it does not implement automatic strategy optimization.
      </p>
    </div>
    </section>
    <details id="discovery-batch-b" className="discovery-followup-details">
  <summary className="discovery-followup-summary">
    <div>
      <span>FOLLOW-UP RESEARCH · BATCH B</span>
      <strong>Momentum Breakout — Market Context</strong>
      <p>
        See how the same frozen breakout setup behaved under different
        market conditions.
      </p>
    </div>

    <span>VIEW RESEARCH</span>
  </summary>

  <BreakoutContextResearchSection datasets={datasets} />
</details>
    <details id="discovery-batch-c" className="discovery-followup-details">
  <summary className="discovery-followup-summary">
    <div>
      <span>FOLLOW-UP RESEARCH · BATCH C</span>
      <strong>Momentum Breakout — Regular Session Only</strong>
      <p>
        Compare the frozen breakout setup using only fully regular-session
        bars against the original Batch A data universe.
      </p>
    </div>

    <span>VIEW RESEARCH</span>
  </summary>

  <RegularSessionBreakoutSection datasets={datasets} />
</details>
<section className="discovery-continue-research">
  <div className="discovery-continue-heading">
    <div>
      <p className="eyebrow">CONTINUE RESEARCH</p>
      <strong>Take the evidence further</strong>
      <p>
        Review research runs, continue an investigation, or compare saved
        results without changing the live scanner.
      </p>
    </div>
  </div>

  <div className="discovery-continue-actions">
    <button
      type="button"
      onClick={() => onResearchNavigate?.('workbench')}
    >
      <strong>Research Workbench</strong>
      <span>Continue or organize an investigation</span>
    </button>

    <button
      type="button"
      onClick={() => onResearchNavigate?.('history')}
    >
      <strong>Run History</strong>
      <span>Review previous research runs</span>
    </button>

    <button
      type="button"
      onClick={() => onResearchNavigate?.('comparison')}
    >
      <strong>Compare Runs</strong>
      <span>Compare saved research evidence</span>
    </button>
  </div>
</section>
    </div>
  )
}
