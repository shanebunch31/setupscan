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
    const warningIndex = Math.max(contents.indexOf('robustness-error'), contents.indexOf('ResearchDataStatus'))
    const firstDetailsIndex = contents.indexOf('LearningDetails label="More details"')
    assert.ok(warningIndex >= 0 && firstDetailsIndex >= 0, `${fileName} should retain its existing availability warning`)
    assert.ok(warningIndex < firstDetailsIndex, `${fileName} should keep availability visible before detailed disclosures`)
  }
})

test('empty metric rows retain their count and render unavailable performance values as dashes', () => {
  for (const fileName of [
    'RobustnessLab.jsx', 'RelativeValueResearchLab.jsx', 'SignalQualityResearchLab.jsx',
    'FrozenScoreHoldoutLab.jsx', 'YearlyRegimeLab.jsx', 'CausalRegimeLab.jsx',
    'WalkForwardRegimeLab.jsx', 'VolatilityAwareVariantsLab.jsx', 'StrategyComparisonLab.jsx',
  ]) {
    const contents = source(fileName)
    assert.match(contents, /hasPerformanceObservations/, `${fileName} should guard performance metrics by its own sample count`)
    assert.match(contents, /hasTrades \?[^\n]*: '—'/, `${fileName} should show a dash when no trades were observed`)
  }
  const discovery = source('StrategyDiscoveryLab.jsx')
  assert.match(discovery, /occurrenceCount > 0/)
  assert.match(discovery, /One or both datasets have no resolved observations/)
  assert.match(discovery, /comparison\.overall\.occurrenceCount\.batchA \? formatPercent/)
  assert.match(discovery, /comparison\.overall\.occurrenceCount\.batchC \? formatPercent/)
})

test('unsupported directions and zero-trade cumulative R are described as unavailable', () => {
  const contents = source('RobustnessLab.jsx')
  assert.match(contents, /No resolved trade observations are available to chart at this threshold/)
  assert.match(contents, /Performance is unavailable, not a measured zero/)
  assert.match(contents, /Short strategy results are unavailable because short-entry and exit rules are not implemented/)
})

test('cumulative-R chart provides keyboard inspection and an observation table from the same data', () => {
  const contents = source('RobustnessLab.jsx')
  assert.match(contents, /buildCumulativeRObservations\(result\?\.trades\)/)
  assert.match(contents, /type="range"[\s\S]*?onChange=\{\(event\) => setSelectedIndex/)
  assert.match(contents, /aria-valuetext=/)
  assert.match(contents, /Trade result: \{formatChartR\(selectedObservation\.rMultiple\)\}/)
  assert.match(contents, /Cumulative: \{formatChartR\(selectedObservation\.cumulativeR\)\}/)
  assert.match(contents, /observations\.map\(\(observation\) => \([\s\S]*?observation\.rMultiple[\s\S]*?observation\.cumulativeR/)
  assert.match(contents, /Trade sequence · chronological/)
  assert.match(contents, /account size, capital allocation, overlapping positions/)
  assert.match(contents, /Historical results do not establish future profitability/)
})

test('yearly and walk-forward bars plus variant bars expose keyboard inspection and accessible data tables', () => {
  const yearly = source('YearlyRegimeLab.jsx')
  assert.match(yearly, /buildYearlyExpectancyObservations\(research\?\.years\)/)
  assert.match(yearly, /<InspectableBarChart[\s\S]*?observations=\{yearlyExpectancyObservations\}[\s\S]*?layout="grouped"/)
  assert.match(yearly, /RV-confirmed is a filtered subset, not an independent sample/)

  const walkForward = source('WalkForwardRegimeLab.jsx')
  assert.match(walkForward, /<TrainingTestTimeline windows=\{timelineRows\}/)
  assert.match(walkForward, /buildWalkForwardTimelineRows\(research\?\.windows\)/)
  assert.match(walkForward, /buildWalkForwardRegimeExpectancyObservations\(research\?\.evidenceTable\)/)
  assert.match(walkForward, /<InspectableBarChart[\s\S]*?observations=\{regimeExpectancyObservations\}[\s\S]*?layout="grouped"/)
  assert.match(walkForward, /training data is used to calculate volatility cutoffs, then the later test data is evaluated/i)
  assert.match(walkForward, /not untouched future evidence/)

  const charts = source('LabsCharts.jsx')
  assert.match(charts, /type="range"[\s\S]*?onChange=\{\(event\) => setSelectedIndex/)
  assert.match(charts, /aria-valuetext=/)
  assert.match(charts, /rows\.map\(\(row, index\) => \([\s\S]*?row\.series[\s\S]*?formatValue\(point\.value\)/)
  assert.match(charts, /selectedValues\.map\(\(point\) => \([\s\S]*?formatValue\(point\.value\)/)
  assert.match(charts, /lab-chart-count-strip[\s\S]*?observationCount\(point, sampleUnit\)/)
  assert.match(charts, /Counts below \{sampleThreshold\} \{sampleUnit\} are flagged as a small sample/)
  assert.match(charts, /hasSmallSample\(point, sampleThreshold\)/)
  assert.match(charts, /comparisonTradeCount/)
  assert.match(charts, /No populated observations are available to plot/)
  assert.match(charts, /Each row shows the actual candle-date range/)

  const volatilityAware = source('VolatilityAwareVariantsLab.jsx')
  assert.match(volatilityAware, /buildVolatilityAwareExpectancyObservations\(research\?\.windows\)/)
  assert.match(volatilityAware, /buildVolatilityAwareControlDifferenceObservations\(research\?\.windows\)/)
  assert.match(volatilityAware, /<InspectableBarChart[\s\S]*?id="volatility-variant-expectancy"[\s\S]*?observations=\{variantExpectancyObservations\}[\s\S]*?layout="grouped"/)
  assert.match(volatilityAware, /<InspectableBarChart[\s\S]*?id="volatility-variant-control-difference"[\s\S]*?observations=\{controlDifferenceObservations\}[\s\S]*?layout="diverging"/)
  assert.match(volatilityAware, /Positive values extend right and negative values left/)
  assert.match(volatilityAware, /repeated exploration can make apparent test results less independent/)
  assert.match(charts, /View chart data table/)
  assert.match(charts, /Inspect a period \(use arrow keys\)/)
  assert.match(charts, /Date range \(UTC\)/)
  assert.match(charts, /row\.detail \?\? 'Unavailable'/)
  assert.match(charts, /layout === 'diverging'/)
  assert.match(charts, /layout = 'grouped'/)
  assert.match(charts, /point\.value === 0/)
  assert.match(charts, /No populated observations are available to plot/)
})

test('priority Labs use the shared question, finding, evidence, visual, and details hierarchy', () => {
  const sharedSummary = source('MetricsGlossary.jsx')
  assert.match(sharedSummary, /Research question/)
  assert.match(sharedSummary, /Evidence in this run/)
  assert.match(sharedSummary, /What the evidence shows/)
  assert.match(sharedSummary, /Evidence boundaries and limitations/)

  for (const fileName of ['YearlyRegimeLab.jsx', 'WalkForwardRegimeLab.jsx', 'VolatilityAwareVariantsLab.jsx', 'RobustnessLab.jsx']) {
    const contents = source(fileName)
    assert.match(contents, /research-primary-visual/, `${fileName} should put its existing primary visual before technical details`)
    assert.match(contents, /LearningDetails label="Research scope and safeguards"/, `${fileName} should keep methodology available without leading the page`)
    assert.ok(contents.indexOf('research-primary-visual') < contents.indexOf('LearningDetails label="More details"'), `${fileName} should place the main visual before full tables`)
  }
})

test('supported research screens disclose ambiguity and distinguish real-data states', () => {
  for (const fileName of [
    'RobustnessLab.jsx', 'RelativeValueResearchLab.jsx', 'SignalQualityResearchLab.jsx',
    'FrozenScoreHoldoutLab.jsx', 'YearlyRegimeLab.jsx', 'CausalRegimeLab.jsx',
    'WalkForwardRegimeLab.jsx', 'VolatilityAwareVariantsLab.jsx', 'StrategyComparisonLab.jsx',
  ]) {
    assert.match(source(fileName), /AmbiguousCandleDisclosure/, `${fileName} should disclose the recorded ambiguity information or its unavailability`)
  }
  for (const fileName of ['CausalRegimeLab.jsx', 'WalkForwardRegimeLab.jsx', 'VolatilityAwareVariantsLab.jsx']) {
    assert.match(source(fileName), /ResearchDataStatus/, `${fileName} should distinguish loading and unavailable inputs`)
  }
  assert.match(source('StrategyDiscoveryLab.jsx'), /ResearchDataStatus/)
  assert.match(source('StrategyDiscoveryLab.jsx'), /function AmbiguitySummary/)
  assert.match(source('LabEvidence.jsx'), /Partial historical data/)
  assert.match(source('LabEvidence.jsx'), /Loading real historical data/)
  assert.match(source('LabEvidence.jsx'), /Historical data is unavailable/)
})

test('signal-period cohort labels disclose that outcomes may extend past the named period', () => {
  for (const fileName of ['RelativeValueResearchLab.jsx', 'SignalQualityResearchLab.jsx', 'StrategyComparisonLab.jsx', 'YearlyRegimeLab.jsx']) {
    assert.match(source(fileName), /signal (?:date|candle)|signal-period cohorts/i, `${fileName} should explain the period assignment`)
  }
  assert.match(source('StrategyDiscoveryLab.jsx'), /signal date\. An outcome can complete after its signal period/)
})

test('Strategy Discovery marks empty resolved metrics unavailable in Batch C and each cost-tier comparison side', () => {
  const contents = source('StrategyDiscoveryLab.jsx')
  assert.match(contents, /batchCHasResolvedObservations = batchC\.summary\?\.overall\?\.occurrenceCount > 0/)
  assert.match(contents, /batchCHasResolvedObservations \? formatPercent\(batchC\.summary\.overall\.winRate\) : '—'/)
  assert.match(contents, /batchCHasResolvedObservations \? formatPf\(batchC\.summary\.overall\.profitFactor\) : '—'/)
  assert.match(contents, /batchCHasResolvedObservations \? formatR\(batchC\.summary\.overall\.expectancy\) : '—'/)
  assert.match(contents, /No resolved observations are available for this result, so performance metrics are unavailable/)

  assert.match(contents, /const hasResolvedObservations = tier\.metrics\.occurrenceCount > 0/)
  assert.match(contents, /hasResolvedObservations \? formatPercent\(tier\.metrics\.winRate\) : '—'/)
  assert.match(contents, /hasResolvedObservations \? formatPf\(tier\.metrics\.profitFactor\) : '—'/)
  assert.match(contents, /hasResolvedObservations \? formatR\(tier\.metrics\.averageR\) : '—'/)

  assert.match(contents, /function ComparisonTable\(\{ title, rows, gateEmptyObservations = false \}\)/)
  assert.match(contents, /row\.batchA && \(!gateEmptyObservations \|\| row\.batchA\.occurrenceCount > 0\) \? formatR\(row\.batchA\.expectancy\)/)
  assert.match(contents, /row\.batchC && \(!gateEmptyObservations \|\| row\.batchC\.occurrenceCount > 0\) \? formatR\(row\.batchC\.expectancy\)/)
  assert.match(contents, /row\.batchA && \(!gateEmptyObservations \|\| row\.batchA\.occurrenceCount > 0\) \? formatPercent\(row\.batchA\.winRate\)/)
  assert.match(contents, /row\.batchC && \(!gateEmptyObservations \|\| row\.batchC\.occurrenceCount > 0\) \? formatPercent\(row\.batchC\.winRate\)/)
  assert.match(contents, /title="Batch A vs\. Batch C \\u2014 cost sensitivity"[\s\S]*?gateEmptyObservations/)
})

test('Frozen Score Holdout is described as a retrospective older window, not a forward test', () => {
  const contents = source('FrozenScoreHoldoutLab.jsx')
  assert.match(contents, /fixed 2022\\u20132024 historical window/)
  assert.match(contents, /older retrospective comparison slice, not a forward-in-time test/)
  assert.match(contents, /cannot establish whether people had already inspected this period/)
  assert.match(contents, /This is not[\s\S]*a forward-in-time test/)
  assert.doesNotMatch(contents, /genuinely held-out historical window/)
})

test('Strategy Discovery reports its ambiguous outcome share with a matching research-window denominator', () => {
  const contents = source('StrategyDiscoveryLab.jsx')
  assert.match(contents, /function AmbiguitySummary\(\{ summary \}\)/)
  assert.match(contents, /ambiguousInResearchWindowCount/)
  assert.match(contents, /classifiableInResearchWindowCount/)
  assert.match(contents, /ambiguousInResearchWindowRate/)
  assert.match(contents, /candle\u2019s high and low touched both barriers but do not show which happened first/)
  assert.match(contents, /not a statement about actual trade execution/)
  assert.match(contents, /percentage unavailable/)
})

test('Resilience threshold headers and cells share one ordered presentation model', () => {
  const contents = source('RobustnessLab.jsx')
  assert.match(contents, /thresholdTableHeadings\.map/)
  assert.match(contents, /buildThresholdTableCells\(result\)\.map/)
})

test('Walk-Forward takeaway discloses and gates comparisons on comparable years', () => {
  const contents = source('WalkForwardRegimeLab.jsx')
  assert.match(contents, /criticalTest\.comparableYearCount === 0/)
  assert.match(contents, /criticalTest\.comparableYearCount/)
  assert.match(contents, /valid trades in both low- and medium-volatility regimes/)
})

test('Volatility-Aware yearly expectancy table discloses its years-with-trades denominator', () => {
  const contents = source('VolatilityAwareVariantsLab.jsx')
  assert.match(contents, /Years with trades \(mean\/median\)/)
  assert.match(contents, /row\.expectancyYearsWithTrades/)
  assert.match(contents, /row\.pooledTradeCount > 0/)
  assert.match(contents, /Performance for \$\{noTradeVariants\.join\(', '\)\} is unavailable/)
})
