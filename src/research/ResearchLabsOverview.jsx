import React from 'react'
import { getResearchExperiment } from './registry.js'
import {
  FlaskConical,
  Search,
  ShieldCheck,
  Scale,
} from 'lucide-react'

const PRIMARY_LABS = [
{
    id: 'quick-backtest',
    tone: 'cyan',
    icon: FlaskConical,
    eyebrow: 'FAST HISTORICAL CHECK',
    title: 'Quick Backtest',
    question: 'How did the current SetupScan rules perform historically?',
    description:
      'Run a fast historical test, review expectancy, drawdown, trade distribution, and sample stability.',
  },
   {
    id: 'strategy-discovery',
    tone: 'green',
    icon: Search,
    eyebrow: 'DISCOVERY',
    title: 'Strategy Discovery',
    question: 'Which tested strategies look most promising?',
    description:
      'Compare registered strategy ideas and surface the strongest historical candidates for deeper research.',
  },
   {
    id: 'robustness',
    tone: 'violet',
    icon: ShieldCheck,
    eyebrow: 'RESILIENCE',
    title: 'Strategy Resilience',
    question: 'Does the result hold up when conditions change?',
    description:
      'Stress-test strategies across thresholds, periods, symbols, market conditions, and other robustness checks.',
  },
  {
    id: 'relative-value',
    tone: 'amber',
    icon: Scale,
    eyebrow: 'COMPARISON',
    title: 'Relative Value',
    question: 'Where is the evidence strongest relative to something else?',
    description:
      'Compare symbols, strategies, and opportunity groups to see where relative performance differs.',
  },
]

const ADVANCED_LABS = [
  {
    id: 'signal-quality',
    tone: 'cyan',
    title: 'Signal Quality / Expected Value',
    description:
      'Tests whether stronger SetupScan signals actually correspond with better historical outcomes.',
  },
  {
    id: 'frozen-score-holdout',
    tone: 'green',
    title: 'Frozen Score Holdout',
    description:
      'Checks a frozen score definition against separate evidence without changing the rule after seeing results.',
  },
  {
    id: 'yearly-regime',
    tone: 'violet',
    title: 'Yearly / Regime Stability',
    description:
      'Examines whether results repeat across years and different historical market environments.',
  },
  {
    id: 'causal-regime',
    tone: 'amber',
    title: 'Causal Market-Regime Analysis',
    description:
      'Studies how strategy evidence lines up with defined market-regime context.',
  },
  {
    id: 'walk-forward-regime',
    tone: 'cyan-blue',
    title: 'Walk-Forward Regime Validation',
    description:
      'Tests sequential historical periods so later evidence follows earlier research decisions.',
  },
  {
    id: 'volatility-aware-variants',
    tone: 'magenta',
    title: 'Volatility-Aware Variants',
    description:
      'Compares strategy behavior under different volatility conditions and volatility-aware rule variants.',
  },
]

// Ownership follows the cards' onOpenLab IDs. Workbench-only studies keep a
// neutral tone even when they share an evidence family with a colored lab.
const LAB_PRESENTATIONS = new Map([...PRIMARY_LABS, ...ADVANCED_LABS].map(({ id, title, tone }) => [id, { title, tone }]))
// StrategyComparisonLab is rendered inside StrategyRobustnessLab.
LAB_PRESENTATIONS.set('strategy-comparison', { title: 'Strategy Comparison', tone: 'violet' })
export function labPresentationForExperiment(id) {
  return LAB_PRESENTATIONS.get(id) ?? { title: getResearchExperiment(id)?.title ?? 'Other research experiment', tone: 'neutral' }
}

const DISCOVERY_STRATEGIES = [
  'mean-reversion-v1',
  'momentum-breakout-v1',
  'prior-day-high-reclaim-v1',
  'volatility-compression-expansion-v1',
]

const STRATEGY_LABELS = {
  'mean-reversion-v1': 'Mean Reversion',
  'momentum-breakout-v1': 'Momentum Breakout',
  'prior-day-high-reclaim-v1': 'Prior-Day High Reclaim',
  'volatility-compression-expansion-v1':
    'Volatility Compression / Expansion',
}

function formatSignedR(value) {
  if (!Number.isFinite(value)) return '—'

  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}R`
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return '—'

  return `${(value * 100).toFixed(1)}%`
}

function formatRatio(value) {
  if (value === Infinity) return '∞'
  if (!Number.isFinite(value)) return '—'

  return value.toFixed(2)
}

function buildDiscoveryRanking(summary) {
  const groups = summary?.synthesis?.strategyGroups ?? []

  return DISCOVERY_STRATEGIES
    .map((strategyId) => {
      const group = groups.find(
        (item) => item.strategyId === strategyId,
      )

      const evidence = (group?.evidence ?? []).find(
        (item) =>
          Number.isFinite(item?.metrics?.expectancy),
      )

      if (!evidence) return null

      const metrics = evidence.metrics ?? {}

      const sampleSize = Number.isFinite(
        metrics.occurrenceCount,
      )
        ? metrics.occurrenceCount
        : Number.isFinite(metrics.tradeCount)
          ? metrics.tradeCount
          : null

      return {
        strategyId,
        label:
          STRATEGY_LABELS[strategyId] ?? strategyId,
        expectancy: metrics.expectancy,
        averageR: metrics.averageR,
        profitFactor: metrics.profitFactor,
        winRate: metrics.winRate,
        totalR: metrics.totalR,
        maxDrawdown: metrics.maximumDrawdown,
        sampleSize,
      }
    })
    .filter(Boolean)
    .sort(
      (a, b) =>
        b.expectancy - a.expectancy,
    )
}

export function ResearchLabsOverview({
  onOpenLab = () => {},
  onOpenHistory = () => {},
  runs = [],
  loading = false,
  error = null,
  latestSummary = null,
  discoverySummary = null,
  evidenceLoading = false,
  evidenceError = null,
}) {
      const strategyRanking =
    buildDiscoveryRanking(discoverySummary)

  const topStrategy =
    strategyRanking[0] ?? null

  const positiveStrategyCount =
    strategyRanking.filter(
      (strategy) => strategy.expectancy > 0,
    ).length

  const largestExpectancyMagnitude =
    Math.max(
      ...strategyRanking.map((strategy) =>
        Math.abs(strategy.expectancy),
      ),
      0.01,
    )

  const coverage =
    latestSummary?.synthesis?.coverage ?? {}

  const requestedCount =
    coverage.requested?.length ?? 0

  const evaluatedCount =
    coverage.evaluated?.length ?? 0

  const incompleteCount =
    coverage.incomplete?.length ?? 0

  const unavailableCount =
    coverage.unavailable?.length ?? 0

  const conflictCount =
    latestSummary?.synthesis?.conflicts?.length ?? 0

  const unresolvedCount =
    latestSummary?.synthesis
      ?.unresolvedQuestions?.length ?? 0

  const latestResearchClean =
    requestedCount > 0 &&
    evaluatedCount === requestedCount &&
    incompleteCount === 0 &&
    unavailableCount === 0 &&
    conflictCount === 0 &&
    unresolvedCount === 0
  return (
    <section className="research-labs-overview">
      <header className="labs-overview-hero">
        <div>
          <p className="eyebrow">RESEARCH LABS</p>
          <h1>Explore the evidence before trusting the result.</h1>
          <p className="labs-overview-intro">
            Each lab answers a different research question. Start with a
            historical check, then use deeper experiments to test consistency,
            resilience, and where an apparent edge may break down.
          </p>
        </div>

        <aside className="labs-overview-guide">
          <strong>What are Research Labs?</strong>
          <p>
            Historical research tools for testing ideas, comparing evidence,
            and finding what deserves deeper investigation.
          </p>
        </aside>
      </header>

      <div className="labs-overview-section-heading">
        <div>
          <p className="eyebrow">CORE LABS</p>
          <h2>Choose the question you want to answer</h2>
        </div>
      </div>

      <div className="labs-overview-primary-grid">
        {PRIMARY_LABS.map((lab) => (
          <article
            key={lab.id}
            className={`labs-overview-card is-${lab.tone}`}
          >
            <div className="labs-overview-card-top">
              <span className="labs-overview-card-mark" aria-hidden="true">
           <lab.icon size={18} strokeWidth={2} />
           </span>

              <span className="labs-overview-card-eyebrow">
                {lab.eyebrow}
              </span>
            </div>

            <h3>{lab.title}</h3>

            <strong className="labs-overview-question">
              {lab.question}
            </strong>

            <p>{lab.description}</p>

            <button
              type="button"
              className="labs-overview-open"
              onClick={() => onOpenLab(lab.id)}
            >
              Open Lab →
            </button>
          </article>
        ))}
      </div>

      <section className="labs-overview-results">
  <div className="labs-overview-results-heading">
    <div>
      <p className="eyebrow">SAVED RESEARCH</p>
      <h2>Recent Lab Results</h2>
      <p>Your latest saved research runs across SetupScan Labs.</p>
    </div>

    <button
      type="button"
      className="labs-overview-view-all"
      onClick={() => onOpenHistory(null)}
    >
      View All Runs →
    </button>
  </div>

  {loading ? (
    <p className="labs-overview-results-state">
      Loading recent research…
    </p>
  ) : null}

  {error ? (
    <p
      className="labs-overview-results-state is-error"
      role="alert"
    >
      {error}
    </p>
  ) : null}

  {!loading && !error && runs.length === 0 ? (
    <p className="labs-overview-results-state">
      No saved research runs yet.
    </p>
  ) : null}

  {!loading && !error && runs.length > 0 ? (
    <div className="labs-overview-table-wrap">
      <table className="labs-overview-table">
        <thead>
          <tr>
            <th>Date / Time</th>
            <th>Lab / Experiment</th>
            <th>Symbol(s)</th>
            <th>Timeframe</th>
            <th>Status</th>
            <th aria-label="Details" />
          </tr>
        </thead>

        <tbody>
          {runs.map((run) => {
            const experiments = Array.isArray(
              run.requestedExperiments,
            )
              ? run.requestedExperiments
              : []

            const firstExperiment =
              experiments[0] ?? 'research-run'

            const presentation = labPresentationForExperiment(firstExperiment)

            const requestedAt = run.requestedAt
              ? new Date(run.requestedAt)
              : null

            const validDate =
              requestedAt &&
              !Number.isNaN(requestedAt.getTime())

            return (
              <tr key={run.runId}>
                <td>
                  {validDate ? (
                    <>
                      <strong>
                        {requestedAt.toLocaleDateString()}
                      </strong>
                      <small>
                        {requestedAt.toLocaleTimeString([], {
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </small>
                    </>
                  ) : (
                    '—'
                  )}
                </td>

                <td>
                  <span
                    className={`labs-overview-lab-chip is-${
                      presentation.tone
                    }`}
                  >
                    {presentation.title}
                  </span>

                  {experiments.length > 1 ? (
                    <small>
                      +{experiments.length - 1} more experiment
                      {experiments.length > 2 ? 's' : ''}
                    </small>
                  ) : null}
                </td>

                <td>
                  {(run.symbols ?? []).join(', ') || '—'}
                </td>

                <td>{run.timeframe ?? '—'}</td>

                <td>
                  <span
                    className={`labs-overview-status is-${
                      run.status ?? 'unknown'
                    }`}
                  >
                    {run.status ?? 'Unknown'}
                  </span>
                </td>

                <td>
                  <button
                    type="button"
                    className="labs-overview-row-view"
                    onClick={() => onOpenHistory(run.runId)}
                  >
                    View →
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  ) : null}
</section>

<section className="labs-overview-insights-grid">
  <article className="labs-overview-ranking-panel">
    <header className="labs-overview-insight-heading">
      <div>
        <p className="eyebrow">STRATEGY DISCOVERY</p>
        <h2>Best Performing Strategies</h2>
        <p>
          Comparable Strategy Discovery candidates ranked
          by historical expectancy.
        </p>
      </div>

      <button
        type="button"
        onClick={() => onOpenLab('strategy-discovery')}
      >
        Open Discovery →
      </button>
    </header>

    {evidenceLoading ? (
      <p className="labs-overview-insight-state">
        Loading strategy evidence…
      </p>
    ) : null}

    {evidenceError ? (
      <p className="labs-overview-insight-state is-error">
        {evidenceError}
      </p>
    ) : null}

    {!evidenceLoading &&
    !evidenceError &&
    !strategyRanking.length ? (
      <p className="labs-overview-insight-state">
        No comparable Strategy Discovery evidence
        is available yet.
      </p>
    ) : null}

    {!evidenceLoading &&
    !evidenceError &&
    strategyRanking.length ? (
      <div className="labs-overview-ranking-list">
        {strategyRanking.map((strategy, index) => {
  const position =
    Math.max(
      -48,
      Math.min(
        48,
        (strategy.expectancy /
          largestExpectancyMagnitude) *
          48,
      ),
    )

  const distanceFromZero =
    Math.abs(position)

  const tone =
    strategy.expectancy > 0
      ? 'positive'
      : strategy.expectancy < 0
        ? 'negative'
        : 'neutral'

  return (
    <div
      key={strategy.strategyId}
      className={`labs-strategy-row is-${tone}`}
    >
      <div className="labs-strategy-rank">
        {index + 1}
      </div>

      <div className="labs-strategy-main">
        <div className="labs-strategy-title-row">
          <strong>{strategy.label}</strong>

          {index === 0 ? (
            <span className="labs-strategy-leader">
              LEADER
            </span>
          ) : null}
        </div>

        <div
          className="labs-strategy-lollipop"
          aria-label={`${strategy.label}: ${formatSignedR(
            strategy.expectancy,
          )} expectancy`}
        >
          <span
            className="labs-strategy-lollipop-zero"
            aria-hidden="true"
          />

          {tone !== 'neutral' ? (
            <span
              className={`labs-strategy-lollipop-stem is-${tone}`}
              style={
                tone === 'positive'
                  ? {
                      left: '50%',
                      width: `${distanceFromZero}%`,
                    }
                  : {
                      right: '50%',
                      width: `${distanceFromZero}%`,
                    }
              }
              aria-hidden="true"
            />
          ) : null}

          <span
            className={`labs-strategy-lollipop-dot is-${tone}`}
            style={{
              left: `${50 + position}%`,
            }}
            aria-hidden="true"
          />
        </div>

        <div className="labs-strategy-lollipop-labels">
          <span>NEGATIVE</span>
          <span>0R</span>
          <span>POSITIVE</span>
        </div>
      </div>

      <div className="labs-strategy-metrics">
        <div>
          <span>Expectancy</span>
          <strong>
            {formatSignedR(strategy.expectancy)}
          </strong>
        </div>

        <div>
          <span>Profit Factor</span>
          <strong>
            {formatRatio(strategy.profitFactor)}
          </strong>
        </div>

        <div>
          <span>Win Rate</span>
          <strong>
            {formatPercent(strategy.winRate)}
          </strong>
        </div>

        <div>
          <span>Sample</span>
          <strong>
            {strategy.sampleSize ?? '—'}
          </strong>
        </div>
      </div>
    </div>
  )
})}
      </div>
    ) : null}
  </article>

  <article className="labs-overview-takeaways-panel">
    <header className="labs-overview-insight-heading">
      <div>
        <p className="eyebrow">RESEARCH READOUT</p>
        <h2>Key Takeaways</h2>
        <p>
          Plain-English highlights from the latest saved
          evidence.
        </p>
      </div>
    </header>

    <div className="labs-takeaway-list">
      <div
        className={`labs-takeaway ${
          topStrategy?.expectancy > 0
            ? 'is-positive'
            : 'is-caution'
        }`}
      >
        <span className="labs-takeaway-number">01</span>

        <div>
          <strong>Leading discovery candidate</strong>

          <p>
            {topStrategy
              ? `${topStrategy.label} currently leads the comparable candidates with ${formatSignedR(topStrategy.expectancy)} historical expectancy.`
              : 'No comparable discovery candidate is available yet.'}
          </p>
        </div>
      </div>

      <div
        className={`labs-takeaway ${
          positiveStrategyCount > 1
            ? 'is-positive'
            : 'is-caution'
        }`}
      >
        <span className="labs-takeaway-number">02</span>

        <div>
          <strong>Positive-edge breadth</strong>

          <p>
            {strategyRanking.length
              ? `${positiveStrategyCount} of ${strategyRanking.length} directly comparable Strategy Discovery candidates currently have positive expectancy.`
              : 'Strategy breadth cannot be evaluated yet.'}
          </p>
        </div>
      </div>

      <div
        className={`labs-takeaway ${
          latestResearchClean
            ? 'is-positive'
            : 'is-caution'
        }`}
      >
        <span className="labs-takeaway-number">03</span>

        <div>
          <strong>Latest research health</strong>

          <p>
            {latestResearchClean
              ? `The latest saved research completed cleanly: ${evaluatedCount}/${requestedCount} requested experiments evaluated, with no conflicts or unresolved questions.`
              : `Latest research shows ${incompleteCount} incomplete, ${unavailableCount} unavailable, ${conflictCount} conflicts, and ${unresolvedCount} unresolved questions.`}
          </p>
        </div>
      </div>

      <div className="labs-takeaway is-info">
        <span className="labs-takeaway-number">04</span>

        <div>
          <strong>Comparison guardrail</strong>

          <p>
            This ranking includes only the four directly
            comparable Strategy Discovery candidates.
            Relative-value, baseline, volatility, and other
            experiment families are not mixed into the
            leaderboard.
          </p>
        </div>
      </div>
    </div>
  </article>
</section>

      <section className="labs-overview-advanced">
        <div className="labs-overview-section-heading">
          <div>
            <p className="eyebrow">ADVANCED EXPERIMENTS</p>
            <h2>Specialized validation tools</h2>
          </div>

          <p>
            Use these after you know the specific research question you
            want to investigate.
          </p>
        </div>

        <div className="labs-overview-advanced-grid">
          {ADVANCED_LABS.map((lab) => (
            <article key={lab.id} className={`labs-overview-advanced-card is-${lab.tone}`}>
              <h3>{lab.title}</h3>
              <p>{lab.description}</p>

              <button
                type="button"
                onClick={() => onOpenLab(lab.id)}
              >
                Open experiment →
              </button>
            </article>
          ))}
        </div>
      </section>
    </section>
  )
}