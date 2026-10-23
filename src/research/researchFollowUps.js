// Fixed descriptive prompts, never threshold optimization or automatic execution.
export const followUpRulesVersion = 'candidate-follow-ups-1'
export const followUpRules = Object.freeze({ minimumResolved: 30, concentrationPercent: 50, differenceR: 0.10, fragileR: 0.02 })
export const researchFollowUpLink = (run) => run?.records?.find((record) => record.provenance?.followUp)?.provenance.followUp ?? null
const experimentId = 'candidate-context-robustness'
const finite = Number.isFinite
const highest = (row) => row?.matched?.costTiers?.at(-1)?.metrics
const enough = (row) => row?.matched?.resolvedCount >= followUpRules.minimumResolved

export function deriveResearchFollowUps(run) {
  const sourceRunId = run?.runContext?.runId
  if (!sourceRunId) return []
  const record = run.records?.find((item) => item.id === experimentId)
  if (!record || !['completed', 'incomplete'].includes(record.status)) return []
  const rows = Object.entries(record.metrics ?? {}).map(([key, value]) => ({ ...value.robustness, evidenceKey: key })).filter((row) => row.symbol && row.period).sort((a, b) => a.evidenceKey.localeCompare(b.evidenceKey))
  const major = rows.filter((r) => !r.bucket && !r.session && ['development', 'recent'].includes(r.period.key))
  const prompts = []
  function add(kind, symbols, period, question, reason, observations, view, decisionHelp) {
    const sortedSymbols = [...symbols].sort()
    prompts.push({
      id: [sourceRunId, kind, sortedSymbols.join(','), period].map(encodeURIComponent).join('::'),
      rulesVersion: followUpRulesVersion, title: question, question, reason, sourceRunId,
      triggerEvidence: observations.map(([row, metric, value]) => ({ sourceRunId, experimentId, methodologyVersion: record.methodologyVersion ?? null, metricsKey: row.evidenceKey, metric, value })),
      suggestedExperimentIds: [experimentId],
      // Preserve the whole supplied universe: narrowing it may change the causal backdrop/alignment.
      suggestedSettings: { symbols: [...(run.runContext.symbols ?? [])].sort(), timeframe: run.runContext.timeframe, requestedStart: run.runContext.requestedStart ?? null, requestedEnd: run.runContext.requestedEnd ?? null, focus: { symbols: sortedSymbols, period, view } },
      decisionHelp, priority: kind === 'cost-sensitivity' ? 'high' : 'normal', status: 'suggested',
    })
  }
  for (const row of major) {
    if (!enough(row)) continue
    const c = row.clustering
    if (finite(c?.multiSignalDayTradePercent) && c.multiSignalDayTradePercent >= followUpRules.concentrationPercent || finite(c?.topFivePercentOfNetR) && c.topFivePercentOfNetR >= followUpRules.concentrationPercent) {
      add('clustering', [row.symbol], row.period.key, 'Does the edge remain positive after removing the five strongest signal days?',
        'At least half of trades occur on repeated-signal days or the top days contribute at least half of positive net R.',
        [[row, 'multiSignalDayTradePercent', c.multiSignalDayTradePercent], [row, 'topFivePercentOfNetR', c.topFivePercentOfNetR]], 'day-sensitivity', 'Review day-removal results already recorded; repeated signals are not independent confirmations.')
    }
    const base = row.matched.costTiers?.[0]?.metrics, harsh = highest(row)
    if (finite(base?.averageR) && finite(harsh?.averageR) && base.averageR > 0 && harsh.averageR <= followUpRules.fragileR) {
      add('cost-sensitivity', [row.symbol], row.period.key, 'At what modeled execution cost does the setup lose its edge?',
        'Positive before-cost expectancy falls to 0.02R or less at the highest existing cost tier.',
        [[row, 'beforeCostAverageR', base.averageR], [row, 'highestCostAverageR', harsh.averageR]], 'cost-sensitivity', 'Decide whether the modeled margin is too thin for further validation; these costs are assumptions, not executable quotes.')
    }
    const regular = rows.find((s) => s.symbol === row.symbol && s.period.key === row.period.key && s.session === 'regular')
    const outside = rows.find((s) => s.symbol === row.symbol && s.period.key === row.period.key && s.session === 'outside')
    if (enough(regular) && enough(outside) && finite(highest(regular)?.averageR) && finite(highest(outside)?.averageR) && Math.abs(highest(regular).averageR - highest(outside).averageR) >= followUpRules.differenceR) {
      add('session-dependence', [row.symbol], row.period.key, 'Is this setup dependent on regular-session or outside-session conditions?',
        'The two decision-session groups each have at least 30 resolved trades and differ by at least 0.10R at the highest cost tier.',
        [[regular, 'highestCostAverageR', highest(regular).averageR], [outside, 'highestCostAverageR', highest(outside).averageR]], 'session-comparison', 'Inspect session dependence without adopting a session filter. Options execution is a separate question.')
    }
  }
  for (const symbol of [...new Set(major.map((row) => row.symbol))].sort()) {
    const development = major.find((row) => row.symbol === symbol && row.period.key === 'development')
    const recent = major.find((row) => row.symbol === symbol && row.period.key === 'recent')
    if (enough(development) && enough(recent) && finite(highest(development)?.averageR) && finite(highest(recent)?.averageR) && Math.abs(highest(recent).averageR - highest(development).averageR) >= followUpRules.differenceR) {
      add('recent-difference', [symbol], 'development-vs-recent', 'Is recent behavior stable, or mainly a recent market-regime effect?',
        'Development and recent samples each have at least 30 resolved trades and differ by at least 0.10R at the highest cost tier.',
        [[development, 'highestCostAverageR', highest(development).averageR], [recent, 'highestCostAverageR', highest(recent).averageR]], 'development-vs-recent', 'Examine whether newer results repeat earlier evidence; this does not prove permanent regime change.')
    }
    const years = rows.filter((row) => row.symbol === symbol && row.period.type === 'year' && !row.bucket && !row.session && enough(row) && finite(highest(row)?.averageR))
    const mixed = years.some((row) => highest(row).averageR > 0) && years.some((row) => highest(row).averageR < 0)
    const total = years.reduce((n, row) => n + highest(row).totalR, 0)
    const concentrated = years.length >= 2 && total > 0 && years.some((row) => 100 * highest(row).totalR / total >= followUpRules.concentrationPercent)
    if (mixed || concentrated) add('year-consistency', [symbol], 'years', 'Which years support or weaken this setup?',
      'Years with at least 30 resolved trades have mixed expectancy signs, or one contributes at least half of their positive net R.',
      years.map((row) => [row, 'highestCostAverageR', highest(row).averageR]).concat(years.map((row) => [row, 'highestCostTotalR', highest(row).totalR])), 'yearly', 'Check whether combined results hide instability or concentration; no significance is calculated.')
  }
  for (const period of ['development', 'recent']) {
    const available = major.filter((row) => row.period.key === period && enough(row) && finite(highest(row)?.averageR)).sort((a, b) => a.symbol.localeCompare(b.symbol))
    if (available.length >= 2 && Math.max(...available.map((row) => highest(row).averageR)) - Math.min(...available.map((row) => highest(row).averageR)) >= followUpRules.differenceR) {
      add('symbol-difference', available.map((row) => row.symbol), period, 'Does this setup behave differently across the symbols in this run?',
        'Symbol-level expectancy spans at least 0.10R at the highest cost tier, using groups with at least 30 resolved trades.',
        available.map((row) => [row, 'highestCostAverageR', highest(row).averageR]), 'symbol-comparison', 'A universal interpretation may be inappropriate. Keep symbol identities separate.')
    }
  }
  return prompts.sort((a, b) => a.id.localeCompare(b.id))
}

export function investigationFollowUps(runReferences = []) {
  const available = runReferences.filter((ref) => ref.status === 'available' && ref.run)
  return available.flatMap((ref) => deriveResearchFollowUps(ref.run)).map((question) => {
    const investigatedByRunIds = available.filter((ref) => {
      const link = researchFollowUpLink(ref.run)
      return ref.run.status === 'completed' && link?.id === question.id && link?.sourceRunId === question.sourceRunId &&
        ref.run.records?.some((record) => question.suggestedExperimentIds.includes(record.id) && record.status === 'completed')
    }).map((ref) => ref.runId).sort()
    return { ...question, status: investigatedByRunIds.length ? 'investigated' : 'suggested', investigatedByRunIds }
  }).sort((a, b) => a.id.localeCompare(b.id))
}
