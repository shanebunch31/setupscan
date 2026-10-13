
const MIN_EXPLORATORY_OCCURRENCES = 100;
const MIN_DEEP_COMPARISON_OCCURRENCES = 200;

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : null;
}

function findPeriod(summary, label) {
  const periods = summary?.byPeriod;

  if (!Array.isArray(periods)) return null;

  return periods.find(
    (period) => period.label === label
  ) ?? null;
}

/**
 * Evaluates a strategy-discovery result without changing it.
 *
 * This is a research qualification, not a trading signal
 * or authorization to paper-trade or live-trade.
 */
export function qualifyStrategyDiscovery(payload) {
  if (!payload || payload.available !== true) {
    return {
      status: 'Unavailable',
      eligibleForExploratoryConsideration: false,
      eligibleForDeeperComparison: false,
      reasons: [
        'Strategy-discovery results are unavailable.'
      ],
      candidates: [],
    };
  }

  const experiments = Array.isArray(payload.experiments)
    ? payload.experiments
    : [];

  if (experiments.length === 0) {
    return {
      status: 'Insufficient Evidence',
      eligibleForExploratoryConsideration: false,
      eligibleForDeeperComparison: false,
      reasons: [
        'No strategy experiments were returned.'
      ],
      candidates: [],
    };
  }

  const candidates = experiments.map((experiment) => {
    const summary = experiment.summary ?? {};
    const overall = summary.overall ?? {};
    const occurrenceCount = finiteNumber(
      overall.occurrenceCount
    ) ?? 0;

    const development = findPeriod(
      summary,
      'Development'
    );
    const outOfSample = findPeriod(
      summary,
      'Out-of-Sample'
    );
    const holdout = findPeriod(
      summary,
      'Holdout (2026 YTD)'
    );

    const reasons = [];

    if (occurrenceCount < MIN_EXPLORATORY_OCCURRENCES) {
      reasons.push(
        `Only ${occurrenceCount} resolved occurrences; ` +
        'at least 100 are needed for exploratory consideration.'
      );
    } else {
      reasons.push(
        `${occurrenceCount} resolved occurrences meet the ` +
        'minimum evidence guideline for exploratory consideration.'
      );
    }

    if (occurrenceCount >= MIN_DEEP_COMPARISON_OCCURRENCES) {
      reasons.push(
        'Occurrence count meets the 200-event guideline ' +
        'for deeper comparison.'
      );
    } else {
      reasons.push(
        'The 200-occurrence guideline for deeper comparison ' +
        'has not been met.'
      );
    }

    if (!development) {
      reasons.push('Development-period results are missing.');
    }

    if (!outOfSample) {
      reasons.push(
        'Out-of-sample results are missing; generalization ' +
        'beyond development has not been assessed.'
      );
    }

    if (!holdout) {
      reasons.push(
        'Holdout results are missing; frozen-holdout evidence ' +
        'has not been assessed.'
      );
    }

    if (!Array.isArray(summary.costTiers) ||
        summary.costTiers.length === 0) {
      reasons.push(
        'Cost-tier results are missing; performance after ' +
        'estimated trading costs has not been assessed.'
      );
    }

    const expectancy = finiteNumber(overall.expectancy);

    const periodExpectancies = [
      { label: 'Development', period: development },
      { label: 'Out-of-Sample', period: outOfSample },
      { label: 'Holdout (2026 YTD)', period: holdout },
    ];

    const periodResultsValid = periodExpectancies.every(
      ({ period }) =>
        period !== null &&
        finiteNumber(period.expectancy) !== null &&
        period.expectancy > 0
    );

    const costTiers = Array.isArray(summary.costTiers)
      ? summary.costTiers
      : [];

    const costTierResultsValid =
      costTiers.length > 0 &&
      costTiers.every(
        (tier) =>
          finiteNumber(tier.metrics?.expectancy) !== null
      );

    if (expectancy === null) {
      reasons.push('Overall expectancy is missing or invalid.');
    } else if (expectancy <= 0) {
      reasons.push(
        'Overall expectancy is not positive after the costs represented by this summary.'
      );
    } else {
      reasons.push(
        'Overall expectancy is positive, but this alone does not establish a reliable strategy.'
      );
    }

    for (const { label, period } of periodExpectancies) {
      const periodExpectancy = finiteNumber(period?.expectancy);

      if (!period) {
        reasons.push(`${label} results are missing.`);
      } else if (periodExpectancy === null) {
        reasons.push(`${label} expectancy is missing or invalid.`);
      } else if (periodExpectancy <= 0) {
        reasons.push(
          `${label} expectancy is not positive; more investigation is needed.`
        );
      } else {
        reasons.push(`${label} expectancy is positive.`);
      }
    }

    if (costTiers.length === 0) {
      reasons.push('Cost-tier results are missing.');
    } else if (!costTierResultsValid) {
      reasons.push(
        'One or more cost tiers have missing or invalid expectancy metrics.'
      );
    } else {
      reasons.push(
        'Cost-tier expectancy metrics are present; their values should be reviewed before further qualification.'
      );
    }

    const eligibleForExploratoryConsideration =
      occurrenceCount >= MIN_EXPLORATORY_OCCURRENCES;

    const eligibleForDeeperComparison =
      occurrenceCount >= MIN_DEEP_COMPARISON_OCCURRENCES;

    let status = 'Insufficient Evidence';

    if (eligibleForExploratoryConsideration) {
      status = 'Needs More Testing';
    }

    if (
      eligibleForExploratoryConsideration &&
      periodResultsValid &&
      costTierResultsValid &&
      expectancy !== null &&
      expectancy > 0
    ) {
      status = 'Promising Candidate';
      reasons.push(
        'Initial evidence checks passed. Stability, cost-resilience, and further independent review are still required.'
      );
    }

    return {
      experimentId: experiment.experimentId ?? null,
      label: experiment.label ?? experiment.experimentId ?? 'Unnamed strategy',
      status,
      occurrenceCount,
      expectancy,
      eligibleForExploratoryConsideration,
      eligibleForDeeperComparison,
      costTiers: Array.isArray(summary.costTiers)
  ? summary.costTiers.map((tier) => ({
      label: tier.label,
      expectancy: Number.isFinite(tier.metrics?.expectancy)
        ? tier.metrics.expectancy
        : null,
    }))

  : [],
      periodMetrics: Array.isArray(summary.byPeriod)
        ? summary.byPeriod.map((period) => ({
            label: period.label,
            occurrenceCount: period.occurrenceCount,
            winRate: Number.isFinite(period.winRate)
              ? period.winRate
              : null,
            expectancy: Number.isFinite(period.expectancy)
              ? period.expectancy
              : null,
            profitFactor: Number.isFinite(period.profitFactor)
              ? period.profitFactor
              : null,
            maximumDrawdown: Number.isFinite(period.maximumDrawdown)
              ? period.maximumDrawdown
              : null,
          }))
        : [],
      evidence: {

        developmentAvailable: Boolean(development),
        outOfSampleAvailable: Boolean(outOfSample),
        holdoutAvailable: Boolean(holdout),
        costTiersAvailable:
          Array.isArray(summary.costTiers) &&
          summary.costTiers.length > 0,
      },
      reasons,
    };
  });

  return {
    status: 'Completed',
    eligibleForExploratoryConsideration: candidates.some(
      (candidate) => candidate.eligibleForExploratoryConsideration
    ),
    eligibleForDeeperComparison: candidates.some(
      (candidate) => candidate.eligibleForDeeperComparison
    ),
    reasons: [
      'Qualification evaluates evidence completeness and basic occurrence thresholds.',
      'It does not authorize paper trading or live trading.',
    ],
    candidates,
  };
}
