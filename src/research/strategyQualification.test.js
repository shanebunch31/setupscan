
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  qualifyStrategyDiscovery,
} from './strategyQualification.js';
import { strategyDiscoveryCostTiers } from '../backtest/strategyDiscovery/discoveryMetrics.js';


function makeExperiment({
  occurrenceCount = 250,
  expectancy = 1.5,
  includeDevelopment = true,
  includeOutOfSample = true,
  includeHoldout = true,
  includeCostTiers = true,
  periodOccurrenceCounts = {},
  costTierExpectancies = {},
  developmentExpectancy = 1,
  outOfSampleExpectancy = 1,
  holdoutExpectancy = 1,
  costTierExpectancy = 0.8,
} = {}) {
  const byPeriod = [];

  if (includeDevelopment) {
    byPeriod.push({
      label: 'Development',
      occurrenceCount: periodOccurrenceCounts.Development ?? 100,
      expectancy: developmentExpectancy,
    });
  }

  if (includeOutOfSample) {
    byPeriod.push({
      label: 'Out-of-Sample',
      occurrenceCount: periodOccurrenceCounts['Out-of-Sample'] ?? 100,
      expectancy: outOfSampleExpectancy,
    });
  }

  if (includeHoldout) {
    byPeriod.push({
      label: 'Holdout (2026 YTD)',
      occurrenceCount: periodOccurrenceCounts['Holdout (2026 YTD)'] ?? 50,
      expectancy: holdoutExpectancy,
    });
  }

  return {
    experimentId: 'test-strategy',
    label: 'Test Strategy',
    summary: {
      overall: {
        occurrenceCount,
        expectancy,
      },
      byPeriod,
      costTiers: includeCostTiers
        ? strategyDiscoveryCostTiers.map((tier) => ({
            label: tier.label,
            metrics: {
              occurrenceCount,
              expectancy: costTierExpectancies[tier.label] ?? costTierExpectancy,
            },
          }))
        : [],
    },
  };
}

test('unavailable discovery results are not qualified', () => {
  const result = qualifyStrategyDiscovery({
    available: false,
  });

  assert.equal(result.status, 'Unavailable');
  assert.equal(result.candidates.length, 0);
});

test('missing experiments produce insufficient evidence', () => {
  const result = qualifyStrategyDiscovery({
    available: true,
    experiments: [],
  });

  assert.equal(result.status, 'Insufficient Evidence');
  assert.equal(result.candidates.length, 0);
});

test('fewer than 100 occurrences means insufficient evidence', () => {
  const result = qualifyStrategyDiscovery({
    available: true,
    experiments: [makeExperiment({ occurrenceCount: 99 })],
  });

  assert.equal(
    result.candidates[0].status,
    'Insufficient Evidence'
  );
  assert.equal(
    result.candidates[0].eligibleForExploratoryConsideration,
    false
  );
});

test('100 occurrences meet the exploratory guideline', () => {
  const result = qualifyStrategyDiscovery({
    available: true,
    experiments: [makeExperiment({ occurrenceCount: 100 })],
  });

  assert.equal(
    result.candidates[0].eligibleForExploratoryConsideration,
    true
  );
  assert.equal(
    result.candidates[0].eligibleForDeeperComparison,
    false
  );
});

test('200 occurrences meet the deeper-comparison guideline', () => {
  const result = qualifyStrategyDiscovery({
    available: true,
    experiments: [makeExperiment({ occurrenceCount: 200 })],
  });

  assert.equal(
    result.candidates[0].eligibleForDeeperComparison,
    true
  );
});

test('positive expectancy alone is not enough', () => {
  const result = qualifyStrategyDiscovery({
    available: true,
    experiments: [
      makeExperiment({
        occurrenceCount: 250,
        expectancy: 1.5,
        includeOutOfSample: false,
      }),
    ],
  });

  assert.equal(
    result.candidates[0].status,
    'Needs More Testing'
  );

  assert.equal(
    result.candidates[0].evidence.outOfSampleAvailable,
    false
  );
});

test('missing cost-tier evidence prevents promising status', () => {
  const result = qualifyStrategyDiscovery({
    available: true,
    experiments: [
      makeExperiment({ includeCostTiers: false }),
    ],
  });

  assert.equal(
    result.candidates[0].status,
    'Needs More Testing'
  );
});

test('complete initial evidence checks use the evidence-strength status label', () => {
  const result = qualifyStrategyDiscovery({
    available: true,
    experiments: [makeExperiment()],
  });

  assert.equal(
    result.candidates[0].status,
    'Initial Evidence Passed'
  );
});

test('qualification does not modify the original payload', () => {
  const payload = {
    available: true,
    experiments: [makeExperiment()],
  };

  const original = structuredClone(payload);

  qualifyStrategyDiscovery(payload);

  assert.deepEqual(payload, original);
});

test('qualification never authorizes trading', () => {
  const result = qualifyStrategyDiscovery({
    available: true,
    experiments: [makeExperiment()],
  });

  assert.equal('liveTradingAuthorized' in result, false);
  assert.equal('paperTradingAuthorized' in result, false);
});


test('negative out-of-sample expectancy cannot pass the initial evidence label', () => {
  const result = qualifyStrategyDiscovery({
    available: true,
    experiments: [
      makeExperiment({ outOfSampleExpectancy: -0.5 }),
    ],
  });

  assert.notEqual(
    result.candidates[0].status,
    'Initial Evidence Passed'
  );
});

test('missing cost-tier expectancy cannot pass the initial evidence label', () => {
  const result = qualifyStrategyDiscovery({
    available: true,
    experiments: [
      makeExperiment({ costTierExpectancy: 'invalid' }),
    ],
  });

  assert.notEqual(
    result.candidates[0].status,
    'Initial Evidence Passed'
  );
});

test('negative overall expectancy cannot pass the initial evidence label', () => {
  const result = qualifyStrategyDiscovery({
    available: true,
    experiments: [
      makeExperiment({ expectancy: -0.5 }),
    ],
  });

  assert.notEqual(
    result.candidates[0].status,
    'Initial Evidence Passed'
  );
});

test('a positive average from only one completed trade in a required period is insufficient', () => {
  const result = qualifyStrategyDiscovery({
    available: true,
    experiments: [makeExperiment({ periodOccurrenceCounts: { 'Out-of-Sample': 1 } })],
  });
  const candidate = result.candidates[0];
  assert.equal(candidate.status, 'Needs More Testing');
  assert.ok(candidate.reasons.some((reason) => reason.includes('Out-of-Sample has 1 resolved occurrences')));
});

test('a negative high-cost tier prevents the initial evidence label', () => {
  const highCost = strategyDiscoveryCostTiers.at(-1).label;
  const result = qualifyStrategyDiscovery({
    available: true,
    experiments: [makeExperiment({ costTierExpectancies: { [highCost]: -0.1 } })],
  });
  assert.equal(result.candidates[0].status, 'Needs More Testing');
  assert.ok(result.candidates[0].reasons.some((reason) => reason.includes('Every configured cost tier must have a positive expectancy')));
});

test('missing or unresolved period data cannot pass the initial evidence label', () => {
  const missing = qualifyStrategyDiscovery({
    available: true,
    experiments: [makeExperiment({ includeHoldout: false })],
  });
  assert.equal(missing.candidates[0].status, 'Needs More Testing');

  const unresolved = qualifyStrategyDiscovery({
    available: true,
    experiments: [makeExperiment({ periodOccurrenceCounts: { 'Holdout (2026 YTD)': 0 } })],
  });
  assert.equal(unresolved.candidates[0].status, 'Needs More Testing');
});

test('sufficient positive evidence passes with a label and explanation that make no profit guarantee', () => {
  const candidate = qualifyStrategyDiscovery({
    available: true,
    experiments: [makeExperiment()],
  }).candidates[0];
  assert.equal(candidate.status, 'Initial Evidence Passed');
  assert.ok(candidate.reasons.some((reason) => reason.includes('does not predict or guarantee future profitability')));
});
