import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BACKTEST_EXTRA_DEFINITIONS, BACKTEST_LEARNING_INTRO } from './backtestLearning.js'

test('main Backtest learning copy covers historical limits, units, and calculation-check terms', () => {
  assert.match(BACKTEST_LEARNING_INTRO, /past price bars/)
  assert.match(BACKTEST_LEARNING_INTRO, /do not predict future performance/)
  const descriptions = new Map(BACKTEST_EXTRA_DEFINITIONS.map(({ term, description }) => [term, description]))
  assert.match(descriptions.get('Average hold'), /minutes/)
  assert.match(descriptions.get('Winning trades'), /positive R/)
  assert.match(descriptions.get('Losing trades'), /negative R/)
  assert.match(descriptions.get('Expired trades'), /maximum holding time/)
  assert.match(descriptions.get('Total positive R'), /Sum of winning results/)
  assert.match(descriptions.get('Total negative R'), /Sum of losing results/)
  assert.match(descriptions.get('Rule set'), /complete set of conditions/)
  assert.match(descriptions.get('Strategy variant'), /predefined alternative/)
})