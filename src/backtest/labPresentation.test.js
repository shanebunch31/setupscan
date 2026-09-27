import assert from 'node:assert/strict'
import fs from 'node:fs'
import { test } from 'node:test'

const labFiles = [
  'RobustnessLab.jsx',
  'RelativeValueResearchLab.jsx',
  'SignalQualityResearchLab.jsx',
  'FrozenScoreHoldoutLab.jsx',
  'YearlyRegimeLab.jsx',
  'CausalRegimeLab.jsx',
  'WalkForwardRegimeLab.jsx',
  'VolatilityAwareVariantsLab.jsx',
  'StrategyDiscoveryLab.jsx',
]

function source(fileName) {
  return fs.readFileSync(new URL(`./${fileName}`, import.meta.url), 'utf8')
}

test('each Research Lab presents a first answer and keeps detailed research available', () => {
  for (const fileName of labFiles) {
    const contents = source(fileName)
    assert.match(contents, /ResearchFirstAnswer/, `${fileName} should show the result before detailed tables`)
    assert.match(contents, /LearningDetails label="More details"/, `${fileName} should retain its supporting details behind disclosure`)
  }
})

test('specialized Lab glossaries and test methodology remain available as separate disclosures', () => {
  for (const fileName of labFiles) {
    const contents = source(fileName)
    assert.match(contents, /LearningDetails label="What does this mean\?"/, `${fileName} should retain its terminology glossary`)
    assert.match(contents, /LearningDetails label="How was this tested\?"/, `${fileName} should retain test methodology`)
  }
})

test('data-unavailable warnings remain outside More details disclosures', () => {
  for (const fileName of labFiles) {
    const contents = source(fileName)
    const warningIndex = contents.indexOf('robustness-error')
    const firstDetailsIndex = contents.indexOf('LearningDetails label="More details"')
    assert.ok(warningIndex >= 0 && firstDetailsIndex >= 0, `${fileName} should retain its existing availability warning`)
    assert.ok(warningIndex < firstDetailsIndex, `${fileName} should keep availability visible before detailed disclosures`)
  }
})