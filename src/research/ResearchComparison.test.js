import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { test } from 'node:test'
import { ResearchComparison, ResearchComparisonResult, ResearchComparisonView } from './ResearchComparison.js'
import { createResearchComparisonActions } from './researchComparisonModel.js'

const runs = [
  { runId: 'run/a', requestedAt: '2026-09-20T00:00:00Z', status: 'completed', symbols: ['SPY', 'QQQ'], timeframe: '1Hour', datasetId: 'dataset-a' },
  { runId: 'run b', requestedAt: '2026-09-21T00:00:00Z', status: 'partial', symbols: ['IWM'], timeframe: '1Hour', datasetId: 'dataset-b' },
]

function comparisonResult() {
  return {
    runA: { runId: 'run/a', datasetId: 'dataset-a', requestedAt: '2026-09-20T00:00:00Z', codeRevision: { status: 'unknown', reason: 'No run-level code revision is stored.' } },
    runB: { runId: 'run b', datasetId: 'dataset-b', requestedAt: '2026-09-21T00:00:00Z', codeRevision: { status: 'unknown', reason: 'No run-level code revision is stored.' } },
    comparisons: [{
      id: 'pair-1',
      evidenceA: {
        runId: 'run/a', evidenceId: 'evidence-a',
        evidence: {
          strategyId: 'baseline', experimentId: 'robustness', metricsKey: 'overall',
          symbols: ['SPY'], timeframe: '1Hour', provider: 'provider-a', metrics: { tradeCount: 12, expectancy: 0.4 },
          rawSeriesBySymbol: { SPY: [{ close: 'RAW_SERIES_MARKER' }] },
          nativeOutput: { value: 'NATIVE_OUTPUT_MARKER' }, nativePayload: 'NATIVE_PAYLOAD_MARKER',
        },
      },
      evidenceB: {
        runId: 'run b', evidenceId: 'evidence-b',
        evidence: { strategyId: 'baseline', experimentId: 'robustness', metricsKey: 'overall', symbols: ['QQQ'], timeframe: '1Hour', metrics: { tradeCount: 10 } },
      },
      sharedEvidenceFamilies: [{ id: 'shared-family-1', note: 'Derived from shared construction.' }],
      nonIndependentEvidence: true,
      compatibility: {
        compatible: false,
        hardConflicts: [{ field: 'symbols', valueA: ['SPY'], valueB: ['QQQ'] }],
        softMismatches: [{ field: 'requestedEnd', valueA: '2024-01-01', valueB: '2025-01-01' }],
        unknowns: [{ field: 'provenance', reason: 'Provenance is incomplete.' }],
      },
    }],
    unmatched: [
      { side: 'A', runId: 'run/a', reason: 'missing', counterpartStatus: 'unavailable', evidence: { id: 'run/a::only-a', evidenceId: 'only-a', evidence: { strategyId: 'context-a', experimentId: 'relative-value', metricsKey: 'SPY', metrics: { tradeCount: 3 } } }, compatibility: { unknowns: [{ field: 'counterpart', reason: 'No matching evidence exists in the other run; absence is not negative evidence.' }] } },
      { side: 'B', runId: 'run b', reason: 'missing', counterpartStatus: 'unavailable', evidence: { id: 'run b::only-b', evidenceId: 'only-b', evidence: { strategyId: 'context-b', experimentId: 'relative-value', metricsKey: 'QQQ', metrics: { tradeCount: 4 } } }, compatibility: { unknowns: [{ field: 'counterpart', reason: 'No matching evidence exists in the other run; absence is not negative evidence.' }] } },
    ],
    compatibilityNotes: [
      { type: 'dataset-identity-differs', datasetIdA: 'dataset-a', datasetIdB: 'dataset-b', note: 'Dataset identity differs; this is provenance context, not an automatic compatibility conflict.' },
      { type: 'run-code-revision-unknown', note: 'No run-level code revision is stored.' },
      { type: 'shared-evidence-families', familyIds: ['shared-family-1'], note: 'Evidence-family overlap is a non-independence annotation.' },
    ],
    provenance: { runIdA: 'run/a', runIdB: 'run b', datasetIdA: 'dataset-a', datasetIdB: 'dataset-b', datasetIdsEqual: false },
  }
}

function findElement(element, predicate) {
  if (!React.isValidElement(element)) return null
  if (predicate(element)) return element
  for (const child of React.Children.toArray(element.props.children)) {
    const found = findElement(child, predicate)
    if (found) return found
  }
  return null
}

test('component renders available runs without automatically comparing', () => {
  let compareCalls = 0
  const html = renderToStaticMarkup(React.createElement(ResearchComparison, {
    runs,
    compareRuns: async () => { compareCalls += 1; return comparisonResult() },
  }))
  assert.equal(compareCalls, 0)
  for (const text of ['run/a', '2026-09-20T00:00:00Z', 'completed', 'SPY, QQQ', '1Hour', 'dataset-a', 'run b', 'dataset-b']) {
    assert.ok(html.includes(text), `expected available run selector to include ${text}`)
  }
  assert.match(html, /Choose two runs to begin/)
})

test('Compare remains disabled until two distinct runs are selected', () => {
  const buttonFor = (selectedRunIdA, selectedRunIdB) => findElement(ResearchComparisonView({
    runs, selectedRunIdA, selectedRunIdB,
  }), (element) => element.type === 'button' && element.props.children?.[1] === 'Compare')
  assert.equal(buttonFor('', '').props.disabled, true)
  assert.equal(buttonFor('run/a', '').props.disabled, true)
  assert.equal(buttonFor('run/a', 'run b').props.disabled, false)
})

test('selecting the same run in both controls does not permit comparison', () => {
  let selectedRunIdA = ''
  let selectedRunIdB = ''
  const renderView = () => ResearchComparisonView({
    runs, selectedRunIdA, selectedRunIdB,
    onSelectRunA: (runId) => { selectedRunIdA = runId },
    onSelectRunB: (runId) => { selectedRunIdB = runId },
  })
  const firstSelect = findElement(renderView(), (element) => element.type === 'select' && element.props.id === 'research-comparison-run-a')
  const secondSelect = findElement(renderView(), (element) => element.type === 'select' && element.props.id === 'research-comparison-run-b')
  firstSelect.props.onChange({ target: { value: 'run/a' } })
  secondSelect.props.onChange({ target: { value: 'run/a' } })
  const compareButton = findElement(renderView(), (element) => element.type === 'button' && element.props.children?.[1] === 'Compare')
  assert.equal(selectedRunIdA, 'run/a')
  assert.equal(selectedRunIdB, 'run/a')
  assert.equal(compareButton.props.disabled, true)
})

test('selecting two runs and clicking the component Compare button invokes the comparison action with exact IDs', async () => {
  const calls = []
  const actions = createResearchComparisonActions({
    compareRuns: async (...ids) => {
      calls.push(ids)
      return comparisonResult()
    },
  })
  let selectedRunIdA = ''
  let selectedRunIdB = ''
  const renderView = () => ResearchComparisonView({
    runs, selectedRunIdA, selectedRunIdB,
    onSelectRunA: (runId) => { selectedRunIdA = runId },
    onSelectRunB: (runId) => { selectedRunIdB = runId },
    onCompare: () => actions.compare(selectedRunIdA, selectedRunIdB),
  })
  findElement(renderView(), (element) => element.type === 'select' && element.props.id === 'research-comparison-run-a').props.onChange({ target: { value: 'run/a' } })
  findElement(renderView(), (element) => element.type === 'select' && element.props.id === 'research-comparison-run-b').props.onChange({ target: { value: 'run b' } })
  const compareButton = findElement(renderView(), (element) => element.type === 'button' && element.props.children?.[1] === 'Compare')
  assert.equal(compareButton.props.disabled, false)
  await compareButton.props.onClick()
  assert.deepEqual(calls, [['run/a', 'run b']])
})

test('comparison view renders explicit loading state', () => {
  const html = renderToStaticMarkup(ResearchComparisonView({ runs, loading: true }))
  assert.match(html, /Comparing persisted evidence/)
  assert.match(html, /role="status"/)
})

test('comparison error is rendered ahead of loading state', () => {
  const html = renderToStaticMarkup(ResearchComparisonView({ runs, loading: true, error: 'Comparison service unavailable.' }))
  assert.match(html, /Comparison service unavailable\./)
  assert.match(html, /role="alert"/)
  assert.doesNotMatch(html, /Comparing persisted evidence/)
})

test('matched evidence and normalized metadata render without object dumps', () => {
  const html = renderToStaticMarkup(React.createElement(ResearchComparisonResult, { result: comparisonResult() }))
  for (const text of ['run/a', 'run b', 'Matched evidence', 'Run A', 'Run B', 'baseline', 'overall', 'tradeCount: 12', 'Dataset differs']) {
    assert.ok(html.includes(text), `expected comparison output to include ${text}`)
  }
  assert.doesNotMatch(html, /\[object Object\]|<pre/)
})

test('unmatched evidence from both sides is displayed with unknown status kept neutral', () => {
  const html = renderToStaticMarkup(React.createElement(ResearchComparisonResult, { result: comparisonResult() }))
  assert.match(html, /Evidence present only in Run A/)
  assert.match(html, /Evidence present only in Run B/)
  assert.match(html, /absence is not negative evidence/)
  assert.match(html, /Matching status: unavailable/)
})

test('hard conflicts, soft mismatches, unknowns, shared families, and provenance notes render descriptively', () => {
  const html = renderToStaticMarkup(React.createElement(ResearchComparisonResult, { result: comparisonResult() }))
  for (const text of ['Hard conflicts', 'symbols', 'Soft mismatches', 'requestedEnd', 'Unknown metadata', 'Provenance is incomplete.', 'Shared evidence family', 'Non-independence annotation', 'Dataset identity differs', 'Reproducibility limitation']) {
    assert.ok(html.includes(text), `expected comparison details to include ${text}`)
  }
})

test('empty comparison states distinguish no evidence and unmatched evidence', () => {
  const noEvidence = renderToStaticMarkup(React.createElement(ResearchComparisonResult, {
    result: { runA: { runId: 'a' }, runB: { runId: 'b' }, comparisons: [], unmatched: [], compatibilityNotes: [], provenance: {} },
  }))
  const unmatchedOnly = renderToStaticMarkup(React.createElement(ResearchComparisonResult, {
    result: { ...comparisonResult(), comparisons: [] },
  }))
  assert.match(noEvidence, /No comparable evidence found/)
  assert.match(noEvidence, /No unmatched evidence reported/)
  assert.match(unmatchedOnly, /No comparable evidence found/)
  assert.match(unmatchedOnly, /Evidence present only in Run A/)
})

test('raw/native payload markers are excluded from comparison output', () => {
  const html = renderToStaticMarkup(React.createElement(ResearchComparisonResult, { result: comparisonResult() }))
  assert.doesNotMatch(html, /RAW_SERIES_MARKER|NATIVE_OUTPUT_MARKER|NATIVE_PAYLOAD_MARKER|rawSeriesBySymbol|nativeOutput|nativePayload/)
})

test('comparison UI contains no ranking or recommendation language', () => {
  const html = renderToStaticMarkup(React.createElement(ResearchComparisonResult, { result: comparisonResult() }))
  assert.doesNotMatch(html, /\b(?:better|worse|winner|loser|strongest|weakest|best|worst|score|rank|recommendation|confidence|preferred|superior|inferior|buy|sell|promote|reject)\b/i)
})

test('empty run choices and idle comparison state render clearly', () => {
  const noRuns = renderToStaticMarkup(ResearchComparisonView({ runs: [] }))
  const oneRun = renderToStaticMarkup(ResearchComparisonView({ runs: [runs[0]] }))
  assert.match(noRuns, /No historical runs are available/)
  assert.match(noRuns, /Choose two runs to begin/)
  assert.match(oneRun, /At least two historical runs are required/)
})