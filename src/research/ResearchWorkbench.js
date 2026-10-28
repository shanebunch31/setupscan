import React, { useEffect, useRef, useState } from 'react'
import { CandidateRobustnessResult } from './CandidateRobustnessResult.js'
import { ExecutionResolutionResult } from './ExecutionResolutionResult.js'
import { ScannerAblationResult } from './ScannerAblationResult.js'
import { ScannerScoreStabilityResult } from './ScannerScoreStabilityResult.js'
import { Link2, LoaderCircle, Play, Plus, Save } from 'lucide-react'
import { listResearchExperiments } from './registry.js'
import { getResearchRun, saveResearchRun } from './researchRunHistory.js'
import {
  attachResearchRunToInvestigation,
  createResearchInvestigation as createResearchInvestigationRequest,
  getResearchInvestigation,
  listResearchInvestigations,
} from './researchInvestigationHistory.js'
import { ResearchRunDetail } from './ResearchRunDetail.js'
import { ResearchInvestigationDetail } from './ResearchInvestigationDetail.js'
import { TermHelp } from '../TermHelp.js'
import {
  createInvestigationRunRequest,
  createWorkbenchInvestigationRequest,
  createWorkbenchRunRequest,
  executeWorkbenchRun,
  setWorkbenchRunFailure,
  investigationPlanForRun,
  prepareFollowUpForm,
  linkFollowUpResult,
} from './researchWorkbenchModel.js'

const h = React.createElement
const experiments = listResearchExperiments()
const defaultExperimentIds = experiments.filter((experiment) => experiment.defaultSelected !== false).map((experiment) => experiment.id)

function evidencePartitionLabel(partition) {
  if (typeof partition === 'string') return partition
  return partition?.label ?? partition?.type ?? null
}
function workbenchEvidenceTitle(evidence) {
  const key = String(evidence.metricsKey ?? 'Metrics')

  if (evidence.experimentId === 'robustness' || evidence.sourceRecordId === 'robustness') {
    const partition = key.match(/^__outOfSample\.([^.]+)\.(inSample|outOfSample)$/)
    if (partition) {
      const label = partition[2] === 'inSample' ? 'In-Sample Results' : 'Out-of-Sample Results'
      return `${partition[1]} — ${label}`
    }

    const multiSymbolThreshold = key.match(/^(.+?) · (\d+)\+$/)
    if (multiSymbolThreshold) return `${multiSymbolThreshold[1]} — Score ≥ ${multiSymbolThreshold[2]}`

    const threshold = key.match(/^(\d+)\+$/)
    if (threshold) return `Score ≥ ${threshold[1]}`
  }

  return key
}

function evidenceMetricLabel(key) {
  const labels = {
    tradeCount: 'Trades',
    winRate: 'Win rate',
    profitFactor: 'Profit factor',
    expectancy: 'Expectancy (R)',
    averageR: 'Average R',
    totalR: 'Net return (R)',
    maximumDrawdown: 'Max drawdown (R)',
    ambiguousCount: 'Ambiguous outcomes (all periods)',
    ambiguousInResearchWindowCount: 'Ambiguous outcomes (research windows)',
    classifiableInResearchWindowCount: 'Classifiable outcomes (research windows)',
    ambiguousInResearchWindowRate: 'Ambiguous share (research windows)',
    ambiguousTradeCount: 'Ambiguous trades',
    ambiguityRateDenominator: 'Trades in ambiguity percentage',
    ambiguousTradeRate: 'Ambiguous share of trades',
    periodBoundaryCount: 'Outcomes excluded at period boundaries',
    excursionPeriodBoundaryCount: 'Excursion windows excluded at period boundaries',
  }

  return labels[key] ?? key.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/^./, (character) => character.toUpperCase())
}

function formatEvidenceMetric(key, value) {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value !== 'number' || !Number.isFinite(value)) return String(value)
  if (key === 'winRate') return `${(value * 100).toFixed(1)}%`
  if (key === 'ambiguousInResearchWindowRate') return `${(value * 100).toFixed(1)}%`
  if (key === 'ambiguousTradeRate') return `${(value * 100).toFixed(1)}%`
  if (key === 'tradeCount') return Math.round(value).toLocaleString()

  return value.toLocaleString(undefined, { maximumFractionDigits: 2 })
}
const statusLabels = {
  idle: 'Ready',
  running: 'Running',
  completed: 'Completed',
  partial: 'Partial',
  unavailable: 'Unavailable',
  failed: 'Failed',
}

export function createWorkbenchActions({
  executeRun = executeWorkbenchRun,
  saveRun = saveResearchRun,
  createInvestigation: createInvestigationRequest = createResearchInvestigationRequest,
  listInvestigations: listInvestigationsRequest = listResearchInvestigations,
  getInvestigation: getInvestigationRequest = getResearchInvestigation,
  attachRun: attachRunRequest = attachResearchRunToInvestigation,
} = {}) {
  return {
    submit(event, form, onStart = () => {}) {
      event.preventDefault()
      const request = createWorkbenchRunRequest(form)
      onStart()
      return Promise.resolve(executeRun(request)).then((result) => linkFollowUpResult(result, form.followUp))
    },
    save(result) {
      if (!result) return undefined
      return saveRun(result)
    },
    createInvestigation(question, requestedExperiments) {
      const request = createWorkbenchInvestigationRequest(question, requestedExperiments)
      return createInvestigationRequest(request)
    },
    listInvestigations(filters) {
      return listInvestigationsRequest(filters)
    },
    getInvestigation(investigationId) {
      return getInvestigationRequest(investigationId)
    },
    attachRun(investigationId, runId) {
      return attachRunRequest(investigationId, runId)
    },
    runInvestigationPlan(form, investigation, onStart = () => {}) {
      const request = createInvestigationRunRequest(form, investigation)
      onStart()
      return executeRun(request)
    },
  }
}

function Field({ label, children, className = '' }) {
  return h('label', { className: `workbench-field ${className}` },
    h('span', null, label),
    children,
  )
}

export function RunStateStatus({ status, message }) {
  return h('div', {
    className: `workbench-state workbench-state-${status}`,
    role: status === 'failed' ? 'alert' : 'status',
    'data-testid': 'workbench-run-state',
  },
  status === 'running' ? h(LoaderCircle, { size: 16, className: 'workbench-spinner', 'aria-hidden': true }) : null,
  h('strong', null, statusLabels[status] ?? statusLabels.failed),
  message ? h('span', null, message) : null,
  )
}

function FetchIssueList({ issues }) {
  if (!issues.length) return h('p', { className: 'workbench-muted' }, 'No fetch issues.')
  return h('ul', { className: 'workbench-issue-list' }, issues.map((issue, index) => h('li', { key: `${issue.symbol ?? 'run'}-${issue.type ?? 'issue'}-${index}` },
    h('strong', null, [issue.symbol, issue.timeframe, issue.type].filter(Boolean).join(' · ') || 'Run issue'),
    issue.error?.message ? h('span', null, issue.error.message) : null,
    issue.type === 'incomplete' ? h('span', null, "Provider marked this symbol's data incomplete.") : null,
    issue.type === 'empty' ? h('span', null, 'No candles were returned for this symbol.') : null,
  )))
}

function ExperimentStatusList({ results }) {
  if (!results.length) return h('p', { className: 'workbench-muted' }, 'No experiments were requested.')
  return h('ul', { className: 'workbench-experiment-list' }, results.map((result) => h('li', { key: result.experimentId },
    h('span', { className: 'workbench-experiment-name' }, result.experimentId),
    h('span', { className: `workbench-status-label workbench-status-${result.status}` }, result.status),
    result.error?.message ? h('span', { className: 'workbench-error-detail' }, result.error.message) : null,
  )))
}

export function RunResultSummary({ result }) {
  const [riskAmount, setRiskAmount] = useState(100)

  if (!result) return null
  const runContext = result.runContext ?? {}
  const synthesis = result.synthesis ?? {}
  const coverage = synthesis.coverage ?? {}
  const experimentResults = result.experimentResults ?? []
  const qualification = result.qualification ?? null
  const requested = coverage.requested?.length ? coverage.requested : runContext.requestedExperiments ?? []
  const policyExperimentIds = requested.length
    ? requested
    : experimentResults.map((item) => item.experimentId)
  const policyExperiments = [...new Set(policyExperimentIds)]
    .map((id) => experiments.find((experiment) => experiment.id === id))
    .filter((experiment) => experiment?.ambiguityPolicy)
  const evaluated = coverage.evaluated ?? []
  const unavailable = coverage.unavailable ?? []
  const incomplete = coverage.incomplete ?? []
  const strategyGroups = synthesis.strategyGroups ?? []
  const conflicts = synthesis.conflicts ?? []
  const unresolvedQuestions = synthesis.unresolvedQuestions ?? []
  const compatibilityNotes = synthesis.compatibilityNotes ?? []
  const fetchIssues = result.fetchIssues ?? []
  const candleQualityBySymbol = Object.entries(result.dataset?.fetchResultsBySymbol ?? {})
    .filter(([, fetchResult]) => fetchResult?.dataQuality)
    .map(([symbol, fetchResult]) => ({ symbol, ...fetchResult.dataQuality }))
  const executionInputMetadata = result.dataset?.effectiveMetadata?.executionResolution?.fiveMinuteMetadata?.symbols
  const evidenceCount = strategyGroups.reduce((total, group) => total + (group.evidence?.length ?? 0), 0)
  const completedCount = experimentResults.filter((item) => item.status === 'succeeded' || item.status === 'completed').length
  const experimentCount = requested.length || experimentResults.length
  const requestedDates = [runContext.requestedStart, runContext.requestedEnd].filter(Boolean).join(' – ') || 'Unbounded'
  const resultHeadline = result.status === 'completed'
    ? 'Your research run is complete'
    : result.status === 'partial'
      ? 'Your research run has partial results'
      : result.status === 'unavailable'
        ? 'Your research run has unavailable evidence'
        : `Your research run status: ${statusLabels[result.status] ?? result.status ?? 'Unknown'}`
  return h('section', { className: 'workbench-result', 'aria-label': 'Research run result' },
    h('div', { className: 'workbench-result-heading' },
      h('div', null,
        h('p', { className: 'workbench-eyebrow' }, 'RESEARCH RUN', h(TermHelp, { term: 'Research Run', explanation: 'One saved execution of selected experiments using shared historical data.' })),
        h('h2', null, 'Run summary'),
      ),
      h(RunStateStatus, { status: result.status }),
    ),
    h('dl', { className: 'workbench-result-overview-grid' },
      h('div', null, h('dt', null, 'Symbols'), h('dd', null, (runContext.symbols ?? []).join(', ') || 'Unavailable')),
      h('div', null, h('dt', null, 'Timeframe'), h('dd', null, runContext.timeframe ?? 'Unavailable')),
      h('div', null, h('dt', null, 'Requested period'), h('dd', null, requestedDates)),
      h('div', null, h('dt', null, 'EMA contract'), h('dd', null, runContext.emaContractVersion ?? 'Legacy version unknown')),
      h('div', null, h('dt', null, 'Adjustment mode'), h('dd', null, runContext.adjustmentMode ?? 'Legacy adjustment unknown')),
      h('div', null, h('dt', null, 'Historical dataset'), h('dd', null, result.dataset?.datasetId ? 'Available' : 'Unavailable')),
      h('div', null, h('dt', null, 'Evidence entries'), h('dd', null, String(evidenceCount))),
      h('div', null, h('dt', null, 'Fetch issues'), h('dd', null, String(fetchIssues.length))),
    ),
    h('p', { className: 'workbench-result-caveat' }, 'Historical results describe past data and do not establish future performance.'),
    (result.records ?? []).filter((record) => record.id === 'candidate-context-robustness').map((record) => h(CandidateRobustnessResult, { key: record.id, record })),
    (result.records ?? []).filter((record) => record.id === 'candidate-execution-resolution').map((record) => h(ExecutionResolutionResult, { key: record.id, record })),
    (result.records ?? []).filter((record) => record.id === 'scanner-component-ablation').map((record) => h(ScannerAblationResult, { key: record.id, record })),
    (result.records ?? []).filter((record) => record.id === 'scanner-score-redundancy-stability').map((record) => h(ScannerScoreStabilityResult, { key: record.id, record })),
    h('p', { className: 'workbench-result-caveat' }, 'Research uses underlying-stock prices, not option-contract quotes or fills. Cost tiers are modeled assumptions, not historical bid/ask or actual execution replay. A large search across variants is more likely to produce a chance result than a small search; this review does not provide a complete cross-run variant count.'),
    h('section', { className: 'workbench-result-ambiguity', 'aria-label': 'Same-candle outcome policies' },
      h('h3', null, 'How same-candle stop and target outcomes are handled'),
      h('p', { className: 'workbench-result-caveat' }, 'A historical candle records its high and low but not the order in which prices occurred. This is uncertainty in the candle data, not a description of an actual trade fill.'),
      policyExperiments.length
        ? h('ul', { className: 'workbench-plain-list' }, policyExperiments.map((experiment) => h('li', { key: experiment.id },
          h('strong', null, `${experiment.title}: ${experiment.ambiguityPolicy.label}. `),
          experiment.ambiguityPolicy.explanation,
          h('p', { className: 'workbench-muted' }, experiment.ambiguityPolicy.countStatus === 'reported'
            ? 'This experiment reports ambiguity counts in its detailed result metrics.'
            : 'This experiment does not separately report how often both barriers were touched.'),
        )))
        : h('p', { className: 'workbench-muted' }, 'The selected experiment policy is unavailable.'),
    ),
    candleQualityBySymbol.length
      ? h('p', { className: 'workbench-result-caveat' }, 'Historical candle checks: ', candleQualityBySymbol.map((entry) => `${entry.symbol}: ${entry.acceptedCandleCount} accepted, ${entry.outOfOrderCandleCount} reordered, ${entry.duplicateCandleCount} duplicates skipped, ${entry.rejectedCandleCount} rejected, ${entry.requestedEndExcludedCandleCount ?? 'unavailable'} excluded because the bar interval ended after the requested end.`).join(' '))
      : null,
    executionInputMetadata
      ? h('p', { className: 'workbench-result-caveat' }, '5Min execution inputs: ', Object.entries(executionInputMetadata).map(([symbol, input]) => `${symbol}: ${input?.requestedCandleCount ?? 'unavailable'} requested-range candles; ${input?.complete === true ? 'input completeness check passed' : input?.complete === false ? 'incomplete input' : 'availability unconfirmed'}.`).join(' '))
      : null,
    h('section', { className: 'workbench-summary-section' },
    h('h3', null, 'Research takeaway'),
    h('p', { className: 'workbench-muted' },
      `Research completed with ${completedCount} of ${experimentCount} experiments completed and ${evidenceCount} evidence entries.`,
    ),
    h('p', { className: 'workbench-muted' },
      `Review next: ${conflicts.length} ${synthesis.contrastSummary ? 'comparable metric contradictions' : 'legacy conflicts'} · ${unresolvedQuestions.length} unresolved questions.`,
    ),

  ),
    
    h('section', { className: 'workbench-summary-section' },
      h('h3', null, 'Strategy Evidence Review',
        h(TermHelp, {
          term: 'Strategy Evidence Review',
          explanation: 'Checks whether a strategy has enough historical evidence to deserve more testing. It does not predict future profits or approve a strategy for trading.',
        })),
      !qualification || qualification.status === 'Unavailable'
        ? h('p', { className: 'workbench-muted' },
          'Strategy review is unavailable because the required research results were not available.')
        : qualification.status !== 'Completed'
          ? h('p', { className: 'workbench-muted' },
            'No strategy review could be completed. More research results are needed.')
          : qualification.candidates.length
            ? h(React.Fragment, null,
              h('p', { className: 'workbench-muted' },
                'These checks help identify strategies that deserve further investigation. Passing them does not mean a strategy will make money.'),
              h('div', { className: 'workbench-risk-estimator' },
  h('label', { htmlFor: 'research-risk-amount' },
    h('strong', null, 'Assumed risk per trade ($)'),
    h(TermHelp, {
      term: 'Assumed risk per trade',
      explanation: 'A hypothetical dollar amount used to translate historical R results into dollars. It is not a recommended position size or a prediction.',
    })),
  h('input', {
    id: 'research-risk-amount',
    type: 'number',
    min: '1',
    step: '1',
    value: riskAmount,
    onChange: (event) => {
      const value = Number(event.target.value)
      if (Number.isFinite(value) && value >= 1) {
        setRiskAmount(value)
      }
    },
  }),
  h('p', { className: 'workbench-muted' },
    'Dollar figures below are hypothetical historical averages. They do not represent actual account results or guaranteed future profits.')
),
                h('ul', { className: 'workbench-plain-list' },
                qualification.candidates.map((candidate, index) =>
                  h('li', { key: candidate.experimentId ?? index },
                    h('h4', null, candidate.label),
                    h('p', null,
                      h('strong', null, 'Review result: '),
                      candidate.status === 'Initial Evidence Passed'
                        ? 'Initial evidence checks passed. This describes the historical evidence reviewed; it does not guarantee future results, and more testing is still required.'
                        : candidate.status === 'Needs More Testing'
                          ? 'Needs more testing - enough historical examples are available for an initial review, but important checks may still be missing.'
                          : 'Not enough evidence yet - more historical examples or research results are needed.'),
                    h('p', null,
                      h('strong', null, 'Completed historical examples: '),
                      String(candidate.occurrenceCount ?? 0)),
                    h('p', null,
                      h('strong', null, 'Average historical result (R per trade): '),
                      candidate.expectancy === null || candidate.expectancy === undefined
                        ? 'Unavailable'
                        : candidate.expectancy.toFixed(3)),
                        h('p', null,
  h('strong', null, 'Estimated average result per historical trade: '),
  candidate.expectancy === null || candidate.expectancy === undefined
    ? 'Unavailable'
    : new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
      }).format(candidate.expectancy * riskAmount)),
h('p', null,
  h('strong', null, 'Estimated average after modeled costs: ')),
h('ul', { className: 'workbench-plain-list' },
  (candidate.costTiers ?? []).map((tier, tierIndex) =>
    h('li', { key: `${tier.label}-${tierIndex}` },
      `${tier.label}: `,
      tier.expectancy === null
        ? 'Unavailable'
        : new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
          }).format(tier.expectancy * riskAmount)
    )
  )
),
                    h('p', { className: 'workbench-muted' },
                      'R measures a result against the amount initially risked. For example, +1R means a gain equal to the amount risked, while -1R means a loss equal to that amount. This is a historical average, not a prediction of future trades.'),
                    
h('details', { className: 'workbench-result-disclosure' },
  h('summary', null, 'Period-by-Period Results'),
  h('p', { className: 'workbench-muted' },
    'Compare performance across separate historical periods. R is measured relative to the amount initially risked.'),
  (candidate.periodMetrics ?? []).length
    ? h('ul', { className: 'workbench-plain-list' },
        candidate.periodMetrics.map((period, periodIndex) =>
          h('li', { key: `${period.label}-${periodIndex}` },
            h('h4', null, period.label),
            h('p', null,
              h('strong', null, 'Completed examples: '),
              String(period.occurrenceCount ?? 0)),
            h('p', null,
              h('strong', null, 'Win rate: '),
              period.winRate === null
                ? 'Unavailable'
                : `${(period.winRate * 100).toFixed(1)}%`),
            h('p', null,
              h('strong', null, 'Average result per trade: '),
              period.expectancy === null
                ? 'Unavailable'
                : `${period.expectancy.toFixed(3)}R`),
            h('p', null,
              h('strong', null, 'Profit factor: '),
              period.profitFactor === null
                ? 'Unavailable'
                : period.profitFactor.toFixed(2)),
            h('p', null,
              h('strong', null, 'Maximum drawdown: '),
              period.maximumDrawdown === null
                ? 'Unavailable'
                : `${period.maximumDrawdown.toFixed(2)}R`)
          )
        )
      )
             : h('p', { className: 'workbench-muted' },
               'Period-by-period metrics are not available for this result.')
    ),
                      h('p', null,
                      h('strong', null, 'What has been tested')),
                    h('ul', { className: 'workbench-plain-list' },
                      h('li', null,
                        `Initial research: ${candidate.evidence?.developmentAvailable ? 'Available' : 'Missing'}`,
                        h('p', { className: 'workbench-muted' },
                          'Checks how the strategy performed during the period used to develop it.')),
                      h('li', null,
                        `Testing on separate historical data: ${candidate.evidence?.outOfSampleAvailable ? 'Available' : 'Missing'}`,
                        h('p', { className: 'workbench-muted' },
                          'Checks whether the strategy also worked on data that was not used to develop it.')),
                      h('li', null,
                        `Final reserved test: ${candidate.evidence?.holdoutAvailable ? 'Available' : 'Missing'}`,
                        h('p', { className: 'workbench-muted' },
                          'Checks performance on data kept separate for a final review. This does not by itself prove the period was never inspected or that it is later in time. Missing means this check has not been confirmed.')),
                      h('li', null,
                        `Estimated trading costs: ${candidate.evidence?.costTiersAvailable ? 'Available' : 'Missing'}`,
                        h('p', { className: 'workbench-muted' },
                          'Checks results using modeled cost assumptions, which can reduce gains or increase losses; these are not actual bid/ask quotes or fills.'))
                    )
                  )
                )
              ),
              h('p', { className: 'workbench-result-caveat' },
                'This is a research assessment, not a buy or sell signal. It does not authorize paper trading or live trading.')
            )
            : h('p', { className: 'workbench-muted' },
              'No strategy candidates were available to review.'),
              h('h3', null, 'Experiment execution',
              h(TermHelp, { term: 'Experiment', explanation: 'One registered research method tested during a run.' })),
              h('p', { className: 'workbench-muted' }, `${completedCount} of ${experimentCount} ${experimentCount === 1 ? 'experiment' : 'experiments'} completed`),
              h('details', { className: 'workbench-result-disclosure' },
              h('summary', null, 'More details'),
              h(ExperimentStatusList, { results: experimentResults }),
         ),
        ),
              h('section', { className: 'workbench-summary-section' },
              h('h3', null, 'Synthesis coverage', h(TermHelp, {
        term: 'Synthesis coverage',
        explanation: 'Shows which requested research was available and evaluated.',
      })),
      h('p', { className: 'workbench-muted' },
        `${requested.length} requested \u00b7 ${evaluated.length} evaluated \u00b7 ${unavailable.length} unavailable \u00b7 ${incomplete.length} incomplete`,
      ),
      h('details', { className: 'workbench-result-disclosure' },
        h('summary', null, 'More details'),
        h('p', null, h('strong', null, 'Requested experiment identifiers: '), requested.join(', ') || 'None'),
        h('p', null, h('strong', null, 'Evaluated experiment identifiers: '), evaluated.join(', ') || 'None'),
        h('p', null, h('strong', null, 'Unavailable experiment identifiers: '), unavailable.join(', ') || 'None'),
        h('p', null, h('strong', null, 'Incomplete experiment identifiers: '), incomplete.join(', ') || 'None'),
      ),
    ),h('section', { className: 'workbench-summary-section' },
      h('h3', null, 'Unresolved questions', h(TermHelp, { term: 'Unresolved questions', explanation: 'Evidence gaps or limitations the current research did not settle.' })),
      unresolvedQuestions.length
        ? h('ul', { className: 'workbench-plain-list' }, unresolvedQuestions.map((question, index) => h('li', { key: `${index}-${question}` }, question)))
        : h('p', { className: 'workbench-muted' }, 'None reported.'),
    ),
    h('section', { className: 'workbench-summary-section' },
      h('h3', null, synthesis.contrastSummary ? 'Comparable contradictions and research contrasts' : 'Conflicts'),
      synthesis.contrastSummary ? h(React.Fragment, null,
        h('p', null, `Comparable metric contradictions: ${conflicts.length}. Different symbols, periods and contexts are research contrasts, not failures to reproduce the same result. Counts below describe pairs, not independent evidence.`),
        h('ul', null, Object.entries(synthesis.contrastSummary).sort(([a], [b]) => a.localeCompare(b)).map(([category, summary]) => h('li', { key: category }, `${category}: ${summary.pairCount} pairs; ${summary.opposingSignPairCount} with opposing metric signs.`))),
      ) : null,
      conflicts.length
        ? h(React.Fragment, null,
          h('p', { className: 'workbench-muted' }, synthesis.contrastSummary ? 'These results describe equivalent recorded conditions but disagree in metric sign. Inspect sample size and shared observations before interpreting them.' : 'Legacy conflicts are shown as originally saved; their comparability has not been reclassified.'),
          h('details', { className: 'workbench-result-disclosure research-detail-conflicts' },
            h('summary', null, `View conflicts (${conflicts.length})`),
            h('ul', { className: 'workbench-issue-list' }, conflicts.map((conflict, index) => h('li', { className: 'research-detail-conflict-row', key: conflict.id ?? index },
              h('span', { className: 'research-detail-conflict-text' }, conflict.observation ?? conflict.dimension ?? conflict.message ?? 'Conflict recorded'),
            ))),
          ),
        )
        : h('p', { className: 'workbench-muted' }, 'No conflicts reported.'),
    ),
    h('section', { className: 'workbench-summary-section' },
      h('h3', null, 'Strategy groups and evidence', h(TermHelp, { term: 'Evidence', explanation: 'A measured result from an experiment and sample. It is not a conclusion by itself.' })),
      strategyGroups.length
        ? h(React.Fragment, null,
          h('p', { className: 'workbench-muted' }, `${strategyGroups.length} strategy groups · ${evidenceCount} evidence entries`),
          h('ul', { className: 'workbench-group-list' }, strategyGroups.map((group, groupIndex) => {
            const groupEvidence = group.evidence ?? []
            const families = group.evidenceFamilies ?? []
            return h('li', { key: String(group.strategyId ?? groupIndex) },
              h('details', { className: 'workbench-result-disclosure workbench-result-group' },
                h('summary', null, h('strong', null, group.strategyId ?? 'Unknown strategy'), h('span', null, `${groupEvidence.length} evidence entries`)),
                                groupEvidence.length
                  ? h('ul', { className: 'research-detail-evidence' },
                    groupEvidence.map((evidence, evidenceIndex) => {
                      const experimentId = evidence.experimentId ?? evidence.sourceRecordId
                      const experimentLabel = experimentTitles.get(experimentId)
                        ?? evidence.sourceRecordId
                        ?? evidence.experimentId
                        ?? 'Evidence'
                      const metricEntries = Object.entries(evidence.metrics ?? {})
                        .filter(([key, value]) => (
                          key !== 'symbol' &&
                          ['string', 'number', 'boolean'].includes(typeof value)
                        ))
                        .slice(0, 12)

                      return h('li', {
                        key: evidence.id ?? `${evidence.sourceRecordId}-${evidence.metricsKey}-${evidenceIndex}`,
                      },
                        h('strong', null, experimentLabel),
                        h('span', null, workbenchEvidenceTitle(evidence)),
                        h('span', { className: 'research-methodology-version' }, `Methodology: ${evidence.methodologyVersion ?? 'Legacy / unknown'}`),
                        h('span', { className: 'research-membership-rule' }, `Population: ${evidence.membershipRule ?? 'legacy-unknown'}`),
                        evidencePartitionLabel(evidence.partition)
                          ? h('span', null, evidencePartitionLabel(evidence.partition))
                          : null,
                        metricEntries.length
                          ? h('details', { className: 'research-detail-metric-details' },
                            h('summary', null, 'View metrics'),
                            h('dl', { className: 'research-detail-metric-grid' },
                              metricEntries.map(([key, value]) => h('div', {
                                className: 'research-detail-metric-card',
                                key,
                              },
                                h('dt', null, evidenceMetricLabel(key)),
                                h('dd', null, formatEvidenceMetric(key, value)),
                              )),
                            ),
                          )
                          : null,
                      )
                    }),
                  )
                  : h('p', { className: 'workbench-muted' }, 'No evidence entries.'),
                families.length ? h('p', { className: 'workbench-muted' }, `Shared evidence families: ${families.map((family) => family.id).join(', ')}`) : null,
              ),
              families.length ? h('small', { className: 'research-detail-family-note' }, `${families.length} shared evidence families. Related results may reuse data, trades, or test windows and are not independent confirmations.`) : null,
            )
          })),
        )
        : h('p', { className: 'workbench-muted' }, 'No normalized evidence groups.'),
    ),
    h('section', { className: 'workbench-summary-section' },
      h('details', { className: 'workbench-result-disclosure workbench-result-technical' },
        h('summary', null, 'How was this tested? View technical details'),
        h('dl', { className: 'workbench-metadata' },
          h('div', null, h('dt', null, 'Run ID'), h('dd', null, runContext.runId ?? '—')),
          h('div', null, h('dt', null, 'Fetch status'), h('dd', null, result.fetchStatus ?? '—')),
          h('div', null, h('dt', null, 'Dataset ID'), h('dd', null, result.dataset?.datasetId ?? 'Unavailable')),
          h('div', null, h('dt', null, 'Requested dates'), h('dd', null, requestedDates)),
        ),
        h('h4', null, 'Fetch issues'),
        h(FetchIssueList, { issues: fetchIssues }),
        compatibilityNotes.length ? h(React.Fragment, null,
          h('h4', null, 'Compatibility notes'),
          h('ul', { className: 'workbench-plain-list' }, compatibilityNotes.map((note, index) => h('li', { key: `${note.type ?? 'note'}-${index}` }, note.note ?? note.message ?? note.type))),
        ) : null,
      ),
    ),
    h('section', { className: 'workbench-investigation-handoff', 'aria-label': 'Optional Investigation workflow' },
      h('p', { className: 'workbench-eyebrow' }, 'OPTIONAL NEXT STEP'),
      h('h3', null, resultHeadline),
      h('p', null, 'Want to organize this research into an Investigation?'),
      h('p', { className: 'workbench-muted' }, 'An Investigation groups a research question and experiment plan across saved Research Runs. Creating one does not save or attach this run; those actions remain explicit.'),
    ),
  )
}

function dateLabel(value) {
  return typeof value === 'string' && value ? value.slice(0, 10) : '—'
}

const experimentTitles = new Map(experiments.map((experiment) => [experiment.id, experiment.title]))
const experimentExplanations = {
  'robustness': 'What it tests: Whether the strategy continues to work when the symbols, market conditions, or time periods change.',
  'relative-value': 'Looks at the relationship between related instruments or prices rather than one price alone.',
  'causal-regime': 'Groups results using information available at the time. It does not prove that a market condition caused the result.',
  'walk-forward-regime': 'Repeated tests that move forward through time, using earlier data for each later test.',
  'volatility-aware-variants': 'Tests predefined strategy variants (alternative rule sets) under different volatility conditions; it does not automatically adapt live trading.',
  'strategy-discovery': 'Tests predefined strategy ideas historically; discovery is not validation.',
  'strategy-comparison': 'Places predefined strategies side by side using the same research evidence.',
  'yearly-regime': 'Groups results by year and experiment-specific labels for observed market conditions.',
  'frozen-score-holdout': 'Compares the frozen score across an older 2022–2024 historical window and later development data. This is a retrospective comparison, not a forward-in-time test.',
}

export function ResearchInvestigationPanel({
  investigations = [],
  listLoading = false,
  listError = null,
  onSelectInvestigation = () => {},
  selectedInvestigationId = null,
  selectedInvestigation = null,
  investigationLoading = false,
  investigationError = null,
  onRunPlan = () => {},
  runLoading = false,
  question = '',
  onQuestionChange = () => {},
  requestedExperiments = [],
  onToggleExperiment = () => {},
  creating = false,
  createError = null,
  createMessage = null,
  onCreate = () => {},
  savedRunId = null,
  attaching = false,
  attachError = null,
  attachMessage = null,
  onAttachRun = () => {},
  selectedRunId = null,
  onOpenDetail = () => {},
  getRun = getResearchRun,
  onSelectRun = () => {},
}) {
  const listContent = listError
    ? h('p', { className: 'workbench-form-error', role: 'alert' }, listError)
    : listLoading
      ? h('p', { className: 'workbench-muted', role: 'status' }, h(LoaderCircle, { size: 14, className: 'workbench-spinner', 'aria-hidden': true }), ' Loading investigations')
      : investigations.length
        ? h('ul', { className: 'workbench-investigation-list' }, investigations.map((investigation) => h('li', { key: investigation.investigationId },
          h('button', {
            type: 'button',
            className: `workbench-investigation-select${selectedInvestigationId === investigation.investigationId ? ' is-selected' : ''}`,
            'aria-pressed': selectedInvestigationId === investigation.investigationId,
            onClick: () => onSelectInvestigation(investigation.investigationId),
          },
          h('strong', null, investigation.question),
          h('span', null, `${investigation.status} · ${dateLabel(investigation.createdAt)} · ${investigation.runIds?.length ?? 0} runs`),
          ),
        )))
        : h('p', { className: 'workbench-muted' }, 'No Investigations yet.')

  let selectedContent
  if (investigationError) {
    selectedContent = h('p', { className: 'workbench-form-error', role: 'alert' }, investigationError)
  } else if (investigationLoading) {
    selectedContent = h('p', { className: 'workbench-muted', role: 'status' }, h(LoaderCircle, { size: 14, className: 'workbench-spinner', 'aria-hidden': true }), ' Loading investigation')
  } else if (!selectedInvestigation) {
    selectedContent = h('p', { className: 'workbench-muted' }, 'Select an Investigation to view its plan and saved runs.')
  } else {
    const runIds = selectedInvestigation.runIds ?? []
    const alreadyAttached = savedRunId ? runIds.includes(savedRunId) : false
    selectedContent = h(React.Fragment, null,
      h('dl', { className: 'workbench-investigation-metadata' },
        h('div', null, h('dt', null, 'Question'), h('dd', null, selectedInvestigation.question)),
        h('div', null, h('dt', null, 'Status'), h('dd', null, selectedInvestigation.status)),
        h('div', null, h('dt', null, 'Created'), h('dd', null, selectedInvestigation.createdAt ?? '—')),
        h('div', null, h('dt', null, 'Updated'), h('dd', null, selectedInvestigation.updatedAt ?? '—')),
        h('div', null, h('dt', null, 'Experiments'), h('dd', null, (selectedInvestigation.requestedExperiments ?? []).map((id) => experimentTitles.get(id) ?? id).join(', ') || 'None')),
        h('div', null, h('dt', null, 'Associated runs'), h('dd', null, String(runIds.length))),
      ),
      h('div', { className: 'workbench-investigation-run-heading' },
        h('h3', null, 'Saved Research Runs'),
        h('button', { className: 'workbench-secondary', type: 'button', onClick: onOpenDetail }, 'Open Investigation Detail'),
        h('button', {
          className: 'workbench-secondary',
          type: 'button',
          disabled: runLoading,
          onClick: onRunPlan,
        },
        runLoading ? h(LoaderCircle, { size: 14, className: 'workbench-spinner', 'aria-hidden': true }) : h(Play, { size: 14, 'aria-hidden': true }),
        runLoading ? 'Research running' : 'Prepare investigation plan',
        ),
      ),
      runIds.length
        ? h('ul', { className: 'workbench-investigation-runs' }, runIds.map((runId) => h('li', { key: runId },
          h('code', null, runId),
          h('button', { type: 'button', className: 'research-history-select', onClick: () => onSelectRun(runId) }, 'View run'),
        )))
        : h('p', { className: 'workbench-muted' }, 'No runs associated yet.'),
      h('div', { className: 'workbench-investigation-attach' },
        h('p', { className: 'workbench-muted' }, savedRunId ? `Saved run ready to attach: ${savedRunId}` : 'Save a Research Run to enable attachment.'),
        h('button', {
          className: 'workbench-secondary',
          type: 'button',
          disabled: !savedRunId || attaching || alreadyAttached,
          onClick: onAttachRun,
        },
        attaching ? h(LoaderCircle, { size: 14, className: 'workbench-spinner', 'aria-hidden': true }) : h(Link2, { size: 14, 'aria-hidden': true }),
        attaching ? 'Adding run' : 'Add Run to Investigation',
        ),
        alreadyAttached ? h('p', { className: 'workbench-muted', role: 'status' }, 'This run is already attached.') : null,
        attachError ? h('p', { className: 'workbench-form-error', role: 'alert' }, attachError) : null,
        attachMessage ? h('p', { className: 'workbench-muted', role: 'status' }, attachMessage) : null,
      ),
      selectedRunId ? h(ResearchRunDetail, { runId: selectedRunId, getRun }) : null,
    )
  }

  return h('section', { className: 'workbench-investigations', 'aria-labelledby': 'workbench-investigations-title' },
    h('header', { className: 'workbench-investigations-heading' },
      h('div', null,
        h('p', { className: 'workbench-eyebrow' }, 'RESEARCH ORGANIZATION'),
        h('h2', { id: 'workbench-investigations-title' }, 'Investigations'),
        h('p', { className: 'workbench-muted' }, 'An Investigation is a question and experiment plan used to organize related Research Runs. Evidence stays with each saved run.'),
      ),
    ),
    h('div', { className: 'workbench-investigation-layout' },
      h('div', { className: 'workbench-investigation-create-column' },
        h('form', { className: 'workbench-investigation-create', onSubmit: onCreate, noValidate: true },
          h('p', { className: 'workbench-muted' }, 'Create an investigation to save the question and experiment plan. Creating it does not run research.'),
          h(Field, { label: 'Research question' }, h('textarea', {
            name: 'investigationQuestion',
            value: question,
            maxLength: 1000,
            required: true,
            onChange: (event) => onQuestionChange(event.target.value),
            'aria-label': 'Research question',
          })),
          h('fieldset', { className: 'workbench-experiment-picker workbench-investigation-plan' },
            h('legend', null, 'Experiment plan', h(TermHelp, { term: 'Experiment plan', explanation: 'The experiments selected for this question.' })),
            h('div', { className: 'workbench-experiment-grid' }, experiments.map((experiment) => h('label', { className: 'workbench-check', key: experiment.id },
              h('input', {
                type: 'checkbox',
                name: 'investigationExperiments',
                value: experiment.id,
                checked: requestedExperiments.includes(experiment.id),
                onChange: () => onToggleExperiment(experiment.id),
                'aria-label': `Investigation experiment ${experiment.title}`,
              }),
                              h('div', { className: 'workbench-experiment-label' },
                h('span', null,
                  experiment.title,
                  experimentExplanations[experiment.id]
                    ? h(TermHelp, {
                        term: experiment.title,
                        explanation: experimentExplanations[experiment.id],
                      })
                    : null,
                ),
                experiment.id === 'robustness'
                  ? h('small', { className: 'workbench-experiment-question' },
                      'Try asking: Does this strategy remain effective across different symbols and market conditions?',
                    )
                  : null,
              ),
            ))),
            h('p', { className: 'workbench-muted' }, `${requestedExperiments.length} selected · plan order is preserved.`),
          ),
          createError ? h('p', { className: 'workbench-form-error', role: 'alert' }, createError) : null,
          h('div', { className: 'workbench-actions' },
            h('button', { className: 'workbench-primary', type: 'submit', disabled: creating },
              creating ? h(LoaderCircle, { size: 14, className: 'workbench-spinner', 'aria-hidden': true }) : h(Plus, { size: 14, 'aria-hidden': true }),
              creating ? 'Creating Investigation' : 'Create Investigation',
            ),
            createMessage ? h('span', { className: 'workbench-muted', role: 'status' }, createMessage) : null,
          ),
        ),
      ),
      h('div', { className: 'workbench-investigation-context' },
        h('h3', null, 'Existing Investigations'),
        listContent,
        h('div', { className: 'workbench-investigation-selected' },
          h('h3', null, selectedInvestigation ? 'Investigation detail' : 'Selected Investigation'),
          selectedContent,
        ),
      ),
    ),
  )
}

export function ResearchWorkbench({
  executeRun = executeWorkbenchRun,
  saveRun = saveResearchRun,
  createInvestigation = createResearchInvestigationRequest,
  listInvestigations = listResearchInvestigations,
  getInvestigation = getResearchInvestigation,
  attachRun = attachResearchRunToInvestigation,
  getRun = getResearchRun,
}) {
  const actions = createWorkbenchActions({ executeRun, saveRun, createInvestigation, listInvestigations, getInvestigation, attachRun })
  const [form, setForm] = useState({
    symbols: 'SPY, QQQ, IWM',
    timeframe: '1Hour',
    requestedStart: '2022-01-01',
    requestedEnd: '',
    requestedExperiments: defaultExperimentIds,
  })
  const [runState, setRunState] = useState('idle')
  const [runResult, setRunResult] = useState(null)
  const [formError, setFormError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState(null)
  const [savedRunId, setSavedRunId] = useState(null)
  const [investigations, setInvestigations] = useState([])
  const [investigationListLoading, setInvestigationListLoading] = useState(true)
  const [investigationListError, setInvestigationListError] = useState(null)
  const [investigationQuestion, setInvestigationQuestion] = useState('')
  const [investigationPlan, setInvestigationPlan] = useState([])
  const [creatingInvestigation, setCreatingInvestigation] = useState(false)
  const [investigationCreateError, setInvestigationCreateError] = useState(null)
  const [investigationCreateMessage, setInvestigationCreateMessage] = useState(null)
  const [selectedInvestigationId, setSelectedInvestigationId] = useState(null)
  const [selectedInvestigation, setSelectedInvestigation] = useState(null)
  const [investigationLoading, setInvestigationLoading] = useState(false)
  const [investigationError, setInvestigationError] = useState(null)
  const [attachingRun, setAttachingRun] = useState(false)
  const [attachError, setAttachError] = useState(null)
  const [attachMessage, setAttachMessage] = useState(null)
  const [selectedInvestigationRunId, setSelectedInvestigationRunId] = useState(null)
  const [investigationDetailOpen, setInvestigationDetailOpen] = useState(false)
  const investigationLoadSequence = useRef(0)

  useEffect(() => {
    let active = true
    setInvestigationListLoading(true)
    setInvestigationListError(null)
    listInvestigations({ limit: 20, offset: 0 })
      .then((response) => {
        if (active) {
          const loaded = Array.isArray(response?.investigations) ? response.investigations : []
          const loadedIds = new Set(loaded.map((item) => item.investigationId))
          setInvestigations((current) => [...loaded, ...current.filter((item) => !loadedIds.has(item.investigationId))])
        }
      })
      .catch((error) => {
        if (active) setInvestigationListError(error.message)
      })
      .finally(() => {
        if (active) setInvestigationListLoading(false)
      })
    return () => { active = false }
  }, [listInvestigations])

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value, followUp: null }))
  }

  function toggleExperiment(experimentId) {
    setForm((current) => ({
      ...current,
      followUp: null,
      requestedExperiments: current.requestedExperiments.includes(experimentId)
        ? current.requestedExperiments.filter((id) => id !== experimentId)
        : [...current.requestedExperiments, experimentId],
    }))
  }

  function toggleInvestigationExperiment(experimentId) {
    setInvestigationPlan((current) => current.includes(experimentId)
      ? current.filter((id) => id !== experimentId)
      : [...current, experimentId])
  }

  async function selectInvestigation(investigationId) {
    const loadSequence = investigationLoadSequence.current + 1
    investigationLoadSequence.current = loadSequence
    setSelectedInvestigationId(investigationId)
    setSelectedInvestigation(null)
    setSelectedInvestigationRunId(null)
    setInvestigationDetailOpen(true)
    setInvestigationError(null)
    setAttachError(null)
    setAttachMessage(null)
    setInvestigationLoading(true)
    try {
      const investigation = await actions.getInvestigation(investigationId)
      if (loadSequence !== investigationLoadSequence.current) return
      setSelectedInvestigation(investigation)
    } catch (error) {
      if (loadSequence === investigationLoadSequence.current) setInvestigationError(error.message)
    } finally {
      if (loadSequence === investigationLoadSequence.current) setInvestigationLoading(false)
    }
  }

  async function handleCreateInvestigation(event) {
    event.preventDefault()
    setInvestigationCreateError(null)
    setInvestigationCreateMessage(null)
    setCreatingInvestigation(true)
    try {
      const investigation = await actions.createInvestigation(investigationQuestion, investigationPlan)
      investigationLoadSequence.current += 1
      setInvestigations((current) => [investigation, ...current.filter((item) => item.investigationId !== investigation.investigationId)])
      setSelectedInvestigationId(investigation.investigationId)
      setSelectedInvestigation(investigation)
      setSelectedInvestigationRunId(null)
      setInvestigationDetailOpen(true)
      setInvestigationError(null)
      setInvestigationLoading(false)
      setInvestigationCreateMessage('Investigation created. Research has not been run.')
    } catch (error) {
      setInvestigationCreateError(error.message)
    } finally {
      setCreatingInvestigation(false)
    }
  }

  function runInvestigationPlan() {
    if (!selectedInvestigation) return
    setFormError(null)
    setForm((current) => ({ ...current, requestedExperiments: [...selectedInvestigation.requestedExperiments], followUp: null }))
    setInvestigationCreateMessage('Plan prepared in Workbench. Review settings, then click Run research. Nothing has run.')
  }

  function prepareFollowUp(question) {
    if (runState === 'running') return
    try {
      setForm(prepareFollowUpForm(form, question))
      setFormError(null)
    } catch (error) { setFormError(error.message) }
  }

  async function handleAttachRun() {
    if (!selectedInvestigation || !savedRunId) return
    setAttachError(null)
    setAttachMessage(null)
    setAttachingRun(true)
    try {
      const investigation = await actions.attachRun(selectedInvestigation.investigationId, savedRunId)
      setSelectedInvestigation(investigation)
      setInvestigations((current) => current.map((item) => item.investigationId === investigation.investigationId ? investigation : item))
      setAttachMessage('Saved run added to this Investigation.')
    } catch (error) {
      setAttachError(error.message)
    } finally {
      setAttachingRun(false)
    }
  }

  async function submit(event) {
    setFormError(null)
    setSaveMessage(null)
    try {
      const result = await actions.submit(event, form, () => {
        setRunState('running')
        setRunResult(null)
        setSavedRunId(null)
        setAttachError(null)
        setAttachMessage(null)
      })
      setRunResult(result)
      setRunState(result.status)
      setInvestigationPlan(investigationPlanForRun(result))
    } catch (error) {
      setWorkbenchRunFailure(error, setFormError, setRunState)
    }
  }

  async function saveResult() {
    if (!runResult) return
    setSaving(true)
    setSaveMessage(null)
    try {
      const saved = await actions.save(runResult)
      if (typeof saved?.runId !== 'string' || !saved.runId) {
        setSavedRunId(null)
        setSaveMessage('Run save could not be confirmed; attachment is unavailable.')
        return
      }
      setSavedRunId(saved.runId)
      setAttachError(null)
      setAttachMessage(null)
      setSaveMessage('Research run saved to history.')
    } catch (error) {
      setSaveMessage(`Save failed: ${error.message}`)
    } finally {
      setSaving(false)
    }
  }

  return h('section', { className: 'research-workbench', 'aria-labelledby': 'workbench-title' },
    h('header', { className: 'workbench-header' },
      h('div', null,
        h('p', { className: 'workbench-eyebrow' }, 'RESEARCH'),
        h('h1', { id: 'workbench-title' }, 'Research Workbench'),
        h('p', { className: 'workbench-intro' }, 'Configure and execute a registered research run. A Research Run is one saved execution of selected experiments using shared historical data.'),
      ),
      h(RunStateStatus, { status: runState, message: runState === 'running' ? 'Fetching shared market data and running experiments.' : null }),
    ),
    h('form', { className: 'workbench-form', onSubmit: submit, noValidate: true },
      form.followUp ? h('p', { role: 'status' }, `Queued for manual research: ${form.followUp.question}. Focus: ${form.followUp.focus?.symbols?.join(', ')} / ${form.followUp.focus?.view}. Original data universe retained. Review settings, then click Run research; nothing has run. Editing settings clears this follow-up link.`) : null,
      h('div', { className: 'workbench-form-grid' },
        h(Field, { label: 'Symbols', className: 'workbench-field-wide' }, h('input', {
          name: 'symbols', value: form.symbols, onChange: (event) => updateField('symbols', event.target.value),
          autoComplete: 'off', placeholder: 'SPY, QQQ, IWM', 'aria-label': 'Symbols',
        })),
        h(Field, { label: 'Timeframe' }, h('select', {
          name: 'timeframe', value: form.timeframe, onChange: (event) => updateField('timeframe', event.target.value), 'aria-label': 'Timeframe',
        }, h('option', { value: '1Hour' }, '1 hour'))),
        h(Field, { label: 'Start date' }, h('input', {
          name: 'requestedStart', type: 'date', value: form.requestedStart,
          onChange: (event) => updateField('requestedStart', event.target.value), 'aria-label': 'Start date',
        })),
        h(Field, { label: 'End date' }, h('input', {
          name: 'requestedEnd', type: 'date', value: form.requestedEnd,
          onChange: (event) => updateField('requestedEnd', event.target.value), 'aria-label': 'End date',
        })),
      ),
      h('fieldset', { className: 'workbench-experiment-picker' },
        h('legend', null, 'Experiments', h(TermHelp, { term: 'Experiment', explanation: 'One registered research method tested during a run.' })),
        h('div', { className: 'workbench-experiment-grid' }, experiments.map((experiment) => h('label', { className: 'workbench-check', key: experiment.id },
          h('input', {
            type: 'checkbox',
            name: 'requestedExperiments',
            value: experiment.id,
            'aria-label': experiment.title,
            checked: form.requestedExperiments.includes(experiment.id),
            onChange: () => toggleExperiment(experiment.id),
          }),
                    h('span', null,
            experiment.title,
            experimentExplanations[experiment.id]
              ? h(TermHelp, {
                  term: experiment.title,
                  explanation: experimentExplanations[experiment.id],
                })
              : null,
          ),
        ))),
        h('p', { className: 'workbench-muted' }, `${form.requestedExperiments.length} selected · ready to run research with the configured market data and experiment plan.`),
        ),
        formError ? h('p', { className: 'workbench-form-error', role: 'alert' }, formError) : null,      h('div', { className: 'workbench-actions' },
        h('button', { className: 'workbench-primary', type: 'submit', disabled: runState === 'running' },
          runState === 'running' ? h(LoaderCircle, { size: 15, className: 'workbench-spinner', 'aria-hidden': true }) : h(Play, { size: 15, 'aria-hidden': true }),
          runState === 'running' ? 'Running' : 'Run research',
        ),
        runResult ? h('button', { className: 'workbench-secondary', type: 'button', onClick: saveResult, disabled: saving },
          h(Save, { size: 15, 'aria-hidden': true }),
          saving ? 'Saving' : 'Save run',
        ) : null,
        saveMessage ? h('span', { className: 'workbench-muted', role: 'status' }, saveMessage) : null,
      ),
    ),
    runResult ? h(RunResultSummary, { result: runResult }) : null,
    h(ResearchInvestigationPanel, {
      investigations,
      listLoading: investigationListLoading,
      listError: investigationListError,
      onSelectInvestigation: selectInvestigation,
      selectedInvestigationId,
      selectedInvestigation,
      investigationLoading,
      investigationError,
      onRunPlan: runInvestigationPlan,
      runLoading: runState === 'running',
      question: investigationQuestion,
      onQuestionChange: setInvestigationQuestion,
      requestedExperiments: investigationPlan,
      onToggleExperiment: toggleInvestigationExperiment,
      creating: creatingInvestigation,
      createError: investigationCreateError,
      createMessage: investigationCreateMessage,
      onCreate: handleCreateInvestigation,
      savedRunId,
      attaching: attachingRun,
      attachError,
      attachMessage,
      onAttachRun: handleAttachRun,
      selectedRunId: selectedInvestigationRunId,
      getRun,
      onSelectRun: setSelectedInvestigationRunId,
      onOpenDetail: () => setInvestigationDetailOpen(true),
    }),
    investigationDetailOpen && selectedInvestigation ? h(ResearchInvestigationDetail, {
      investigationId: selectedInvestigation.investigationId,
      investigation: selectedInvestigation,
      getRun,
      onClose: () => setInvestigationDetailOpen(false),
      onPrepareFollowUp: prepareFollowUp,
    }) : null,
  )
}
