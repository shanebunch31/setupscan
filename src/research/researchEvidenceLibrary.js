// Curated product history, not a live run, calculated synthesis, or promotion policy.
// Keep source sections and historical methodology versions alongside each finding.
// Exact saved Run IDs are not supplied by these records; never infer one from an experiment ID.
export const EVIDENCE_RECORD_DATE = 'October 28, 2026'

export const RESEARCH_EVIDENCE_STATUSES = {
  study: 'SUPPORTED FOR FURTHER STUDY',
  mixed: 'MIXED / UNSTABLE',
  notPromoted: 'REJECTED / NOT PROMOTED',
  forward: 'FORWARD VALIDATION IN PROGRESS',
}

const record = (section) => ({ document: 'SETUPSCAN_RESEARCH_EVIDENCE.md', section })
const roadmap = (section) => ({ document: 'SETUPSCAN_ROADMAP_CHECKLIST.md', section })

export const RESEARCH_EVIDENCE = [
  {
    id: 'discovery-regimes', title: 'Strategy Discovery & Regime Research',
    question: 'Does the same setup behave differently in different market environments?',
    tested: 'Historical hourly SPY, QQQ and IWM studies across years, symbols, trend and volatility regimes, costs and stress tests.',
    finding: 'Trend Up + Medium Volatility was the strongest recurring historical context in the curated research record.',
    meaning: 'Market environment matters. A favorable pooled result is not a universal rule for every symbol or period.',
    status: 'study', productionImpact: 'NO PRODUCTION CHANGE — the candidate moved to separate forward validation only.',
    limitations: ['These studies overlap in their historical evidence; recurring results are not independent confirmations.', 'Historical context does not prove future profitability.'],
    methodologyIds: [], experimentIds: [], runId: null,
    sources: [record('1. Strategy Discovery and Regime Research')],
  },
  {
    id: 'shadow-candidate', title: 'Frozen Shadow Forward Candidate',
    question: 'Does Trend Up + Medium Volatility v1 continue to hold up on new observations?',
    tested: 'A frozen hourly research candidate, initially SPY + QQQ, with a 12-bar outcome horizon and modeled cost checks.',
    finding: 'The documented candidate moved into prospective observation with frozen rules, no historical backfill and no automatic promotion.',
    meaning: 'New observations test the unchanged candidate. Forward validation can still fail.',
    status: 'forward', productionImpact: 'NO PRODUCTION CHANGE — separate from the production scanner and Paper Trader.',
    forwardStatus: 'In progress in the curated record. This page does not verify whether the tracker is currently running or summarize its latest outcomes.',
    limitations: ['This is not a completed forward-validation result.', 'Historical holdout data is not prospective forward evidence.'],
    methodologyIds: ['candidate-context-robustness-2', 'shadow-forward-1'],
    experimentIds: ['candidate-context-robustness'], candidateId: 'trend-up-medium-volatility-v1', runId: null,
    sources: [record('2. Frozen Shadow Forward Candidate')],
  },
  {
    id: 'component-ablation', title: 'Scanner Component Ablation',
    question: 'What changes when one scanner confirmation is removed?',
    tested: 'Exploratory component removal on historical hourly SPY, QQQ and IWM; the production scanner was unchanged.',
    finding: 'EMA9 > EMA21 and Bullish Trend were perfectly redundant in the studied data. Removing Breakout/Reclaim weakened important results.',
    meaning: 'Two confirmations can repeat the same information. Counting them once looked better in some pooled results, but did not establish a stable scoring improvement.',
    status: 'mixed', productionImpact: 'NO PRODUCTION CHANGE — no component was removed or reweighted.',
    limitations: ['The record reports 16,094 observations with both EMA and Trend true, zero disagreements, and phi correlation 1.0 in this dataset only.', 'The apparent improvement did not remain stable across recent periods, symbols and regimes.'],
    methodologyIds: ['scanner-component-ablation-1'], experimentIds: ['scanner-component-ablation'], runId: null,
    sources: [record('3. Scanner Component Ablation'), { document: 'src/research/registry.js', section: 'scanner-component-ablation methodology' }],
  },
  {
    id: 'score-stability', title: 'Scanner Score Redundancy / Stability',
    question: 'Does removing duplicate EMA/Trend credit hold up across time, symbols and stress tests?',
    tested: 'Predeclared score alternatives, fixed and mechanical thresholds, historical periods, costs and day-concentration stress.',
    finding: 'Older 2022–2024 results looked stronger; the apparent advantage did not persist consistently into 2025–2026.',
    meaning: 'A better pooled historical average was not enough. Symbol differences and recent weakness prevented promotion.',
    status: 'mixed', productionImpact: 'NO PRODUCTION CHANGE — scoring alternatives were not promoted.',
    limitations: ['Historical hourly VWAP differs from the live scanner’s separate five-minute VWAP input.', 'Repeated historical follow-up is not an untouched holdout.'],
    methodologyIds: ['scanner-score-redundancy-stability-1'], experimentIds: ['scanner-score-redundancy-stability'], runId: null,
    sources: [record('4. Scanner Score Redundancy / Stability Study')],
  },
  {
    id: 'qualification-stack', title: 'Qualification Stack / Condition Count',
    question: 'Are more full confirmations always better, and which missing conditions matter?',
    tested: 'Six-condition counts and single/pair omissions, plus a five-family view counting EMA and Trend once. Partial RSI/RVOL credit was not a full confirmation.',
    finding: 'The pooled confirmation ladder weakened or reversed in newer periods and some symbols and regimes. More confirmations were not universally better.',
    meaning: 'Breakout/Reclaim looked important in favorable contexts; RSI and RVOL effects depended on context. None supports a global rule change.',
    status: 'mixed', productionImpact: 'NO PRODUCTION CHANGE — no stack size, omission or regime exclusion was promoted.',
    limitations: ['The favorable Uptrend / Medium-volatility strict 6/6 subgroup had only 53 resolved observations and remains exploratory.', 'A cleaner five-family ordering does not make those families statistically independent or remove instability.'],
    methodologyIds: ['qualification-stack-condition-count-1'], experimentIds: ['qualification-stack-condition-count'], runId: null,
    sources: [record('5. Qualification Stack / Condition Count'), record('6. Individual Conditions'), record('7. Five-Family View')],
  },
  {
    id: 'execution-resolution', title: 'Execution Resolution Research',
    question: 'Does five-minute execution resolution improve the same hourly candidate?',
    tested: 'Paired hourly versus five-minute outcomes for the same frozen hourly decisions, with the same holding deadline.',
    finding: 'The cross-symbol review did not support a separate 5Min execution challenger. Five-minute data remained useful for exposing execution and outcome-path differences.',
    meaning: 'More detailed candles can reveal worse stop fills or a different path without producing a repeatable entry advantage.',
    status: 'notPromoted', productionImpact: 'NO PRODUCTION CHANGE — 1Hour remains the research setup/decision timeframe; 5Min remains a research execution/outcome-resolution layer.',
    limitations: ['Coverage exclusions still matter; no missing bars or prices are fabricated.', 'These are historical candle models, not actual bid/ask executions. Earlier v2 evidence is not compatible with the corrected v3 methodology.'],
    methodologyIds: ['candidate-execution-resolution-3'], experimentIds: ['candidate-execution-resolution'], runId: null,
    sources: [roadmap('1. Multi-Timeframe Execution Resolution Study — Completed')],
  },
  {
    id: 'exit-management', title: 'Candidate Exit Management',
    question: 'Do trailing exits improve the candidate compared with fixed exits?',
    tested: 'Identical candidate signals and entries, comparing fixed stops/2R targets/12-bar holds with a +1R-activated, 0.3% trailing challenger.',
    finding: 'SPY trailing raised win rate but slightly lowered full-sample expectancy. QQQ varied by period/regime, and IWM generally did not improve.',
    meaning: 'A higher win rate can coexist with a lower average result. Trailing remains a research challenger, not a replacement selected by this study.',
    status: 'mixed', productionImpact: 'NO PRODUCTION CHANGE — this candidate study did not replace production exit rules.',
    limitations: ['Results vary by symbol and regime; no universal exit winner is established.', 'Concentration removals are independently ranked per exit method, so they are not an identical-day paired comparison.'],
    methodologyIds: ['candidate-exit-management-1'], experimentIds: ['candidate-exit-management'], runId: null,
    sources: [roadmap('3. Candidate Exit Management Research')],
  },
  {
    id: 'cost-concentration', title: 'Cost & Day-Concentration Stress',
    question: 'Does the historical average depend on friction assumptions or a few strong days?',
    tested: 'Qualified full-sample cost tiers and removal of the five strongest Eastern decision days in the condition-count study.',
    finding: 'Removing the strongest days substantially weakened the remaining average; larger modeled costs could turn it negative.',
    meaning: 'A small set of exceptional days can make the overall average look stronger than the rest of the sample.',
    status: 'mixed', productionImpact: 'NO PRODUCTION CHANGE — a limitation to investigate, not a new trading rule.',
    limitations: ['Day removal is a historical stress test, not a forecast.', 'Cost tiers are fixed R assumptions, not measured historical or future fills.'],
    methodologyIds: ['qualification-stack-condition-count-1'], experimentIds: ['qualification-stack-condition-count'], runId: null,
    sources: [record('8. Cost and Day-Concentration Stress')],
  },
]

export const RESEARCH_PROCESS = [
  ['Hypothesis', 'Define a question and rules before examining outcomes.'],
  ['Historical research', 'Study completed price bars, sample sizes and exclusions.'],
  ['Resilience & stability', 'Compare periods, symbols, regimes, costs and concentration.'],
  ['Research decision', 'Reject an unstable idea, continue studying, or freeze a candidate.'],
  ['Forward validation', 'Observe new data under frozen rules, without historical backfill.'],
  ['User approval', 'Require explicit review and approval before any future promotion. Nothing promotes automatically.'],
]

export const RESEARCH_LIMITATIONS = [
  'Historical evidence is not a guarantee of future performance.',
  'Small samples are not proof, and overlapping studies are not independent confirmations.',
  'Repeated historical follow-up is not equivalent to an untouched holdout.',
  'Underlying-stock research does not prove options-contract execution quality.',
  'Modeled trading costs are assumptions, not measured future fills.',
  'Forward validation can still fail.',
  'Research findings do not automatically change the production scanner or promote anything into Paper Trader or live trading.',
]

// Metric definitions come from the existing shared glossary at the UI boundary.
// Only concepts not already defined there are added here.
export function evidenceDefinitions(sharedDefinitions = []) {
  const selected = new Set(['R (risk unit)', 'Expectancy', 'Profit factor', 'Max drawdown', 'Out-of-sample'])
  return [
    ...sharedDefinitions.filter(item => selected.has(item.term)),
    { term: 'Regime', description: 'A defined market environment, such as trend direction combined with a volatility category. A label describes the research context, not what happens next.' },
    { term: 'Volatility', description: 'How much prices vary. Low, medium and high are categories defined by the study, not guarantees of risk or return.' },
    { term: 'Sample size', description: 'The number of observations being evaluated. Check resolved counts and exclusions; splitting a sample does not create more independent evidence.' },
    { term: 'Historical evidence', description: 'Outcomes observed in past data under a stated research model. They are not future results or actual execution fills.' },
    { term: 'Forward validation', description: 'Observe genuinely new data after rules are frozen. Historical holdout data does not count as prospective observation.' },
    { term: 'Frozen candidate', description: 'A named research hypothesis whose rules and protocol are fixed before forward observations. Freezing does not mean it passed validation or was promoted.' },
  ]
}
