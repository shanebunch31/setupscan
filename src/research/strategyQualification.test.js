
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  qualifyStrategyDiscovery,
} from './strategyQualification.js';

function makeExperiment({
  occurrenceCount = 250,
  expectancy = 1.5,
  includeDevelopment = true,
  includeOutOfSample = true,
  includeHoldout = true,
  includeCostTiers = true,
} = {}) {
  const byPeriod = [];

  if (includeDevelopment) {
    byPeriod.push({
      label: 'Development',
      occurrenceCount: 100,
      expectancy: 1,
    });
  }

  if (includeOutOfSample) {
    byPeriod.push({
      label: 'Out-of-Sample',
      occurrenceCount: 100,
      expectancy: 1,
    });
  }

  if (includeHoldout) {
    byPeriod.push({
      label: 'Holdout (2026 YTD)',
      occurrenceCount: 50,
      expectancy: 1,
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
        ? [{ label: 'Moderate' }]
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

test('complete initial evidence checks can produce a promising candidate', () => {
  const result = qualifyStrategyDiscovery({
    available: true,
    experiments: [makeExperiment()],
  });

  assert.equal(
    result.candidates[0].status,
    'Promising Candidate'
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
