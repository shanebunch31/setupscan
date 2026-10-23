import React, { useEffect, useState } from 'react'
import { apiUrl } from '../config/apiBase.js'
import { parseResearchJson } from './researchRunSerialization.js'
const h = React.createElement
const number = (value) => value === Infinity ? '∞' : Number.isFinite(value) ? value.toFixed(2) : '—'

export function ShadowForwardEvidence({ snapshot }) {
  if (!snapshot) return h('p', null, 'No forward evidence is available. Missing data is not zero performance.')
  return h('section', { className: 'research-placeholder', 'aria-label': 'Shadow forward research evidence' },
    h('h2', null, snapshot.tracking.candidate.name),
    h('p', null, 'Frozen definition: research-eligible 75+ + causal Uptrend + Medium volatility, using completed 1Hour candles. These are shadow observations, not brokerage positions.'),
    h('p', null, 'The definition is frozen during forward evaluation. Poor results must not automatically trigger tuning. Any changed rule needs a new version. Milestones are descriptive, not statistical significance or permission to trade.'),
    h('p', null, `Tracking boundary: ${snapshot.tracking.startedAt}. Frozen: ${snapshot.tracking.frozenAt}. Historical methodology: ${snapshot.tracking.candidate.methodologyVersion ?? 'Unavailable'}. Forward protocol: ${snapshot.tracking.candidate.forwardVersion ?? 'Unavailable'}.`),
    h('p', { role: 'status' }, `${snapshot.freshness}. Last successful cycle: ${snapshot.checkpoint.lastSuccessfulCycle ?? 'Unavailable'}. No automatic promotion to Paper Trader.`),
    h('p', null, `Last shared completed candle (start timestamp): ${snapshot.checkpoint.latestDecisionBar ?? '—'}. Detection baseline: ${snapshot.checkpoint.detectionBoundary ?? '—'}. Missing, delayed or downtime observations are not backfilled as forward evidence.`),
    h('p', null, 'Outcomes use the historical stop-first model when a candle spans both barriers. Ambiguity rates use resolved observations with known ambiguity data. R measures results relative to theoretical initial risk; it is not account growth. Modeled costs are not executable quotes.'),
    ...(snapshot.summaries ?? []).map((summary) => h('section', { key: summary.symbol },
      h('h3', null, summary.symbol),
      h('p', null, `Observed: ${summary.total}; resolved: ${summary.resolved}; pending: ${summary.pending}; excluded: ${summary.excluded}; unavailable: ${summary.unavailable}. Active decision days: ${summary.activeDays}; observations/day: ${number(summary.occurrencesPerDay)}.`),
      h('p', null, `${summary.milestone}${summary.nextMilestone ? `; ${summary.resolved} / ${summary.nextMilestone} next review milestone` : ''}. Positive/negative resolved days: ${summary.positiveDays}/${summary.negativeDays}. Repeated signals are not independent evidence.`),
      h('p', null, `First observation: ${summary.firstObservation ?? '—'}; latest: ${summary.latestObservation ?? '—'}. Pending means required future bars are not yet available; no early expiry is guessed.`),
      h('table', null, h('caption', null, `${summary.symbol}: theoretical results by modeled cost`),
        h('thead', null, h('tr', null, ...['Cost (R)', 'Average R', 'Total R', 'Win rate (%)', 'Profit factor', 'Ambiguous / resolved', 'Ambiguity (%)'].map((label) => h('th', { key: label, scope: 'col' }, label)))),
        h('tbody', null, ...summary.costTiers.map(({ costR, metrics }) => h('tr', { key: costR },
          ...[number(costR), number(metrics?.averageR), number(metrics?.totalR), number(metrics ? metrics.winRate * 100 : null), number(metrics?.profitFactor), metrics ? `${metrics.ambiguousTradeCount ?? '—'} / ${metrics.ambiguityRateDenominator ?? '—'}` : '—', number(metrics?.ambiguousTradeRate == null ? null : metrics.ambiguousTradeRate * 100)].map((value, i) => h('td', { key: i }, value)))))),
    )),
    h('details', null, h('summary', null, 'Individual shadow observations and frozen evidence'),
      ...(snapshot.occurrences ?? []).map((row) => h('details', { key: row.id }, h('summary', null, `${row.symbol} · ${row.decisionTimestamp} · ${row.state}`),
        h('p', null, `Observed ${row.createdAt}; score ${row.qualification.score}; ${row.qualification.classification}; research eligible: ${String(row.qualification.researchEligible)}; ${row.qualification.trend}; ${row.qualification.volatility}.`),
        h('p', null, row.theoretical ? `Theoretical entry ${number(row.theoretical.entryPrice)}, stop ${number(row.theoretical.stopPrice)}, target ${number(row.theoretical.targetPrice)}; ${row.theoretical.side}.` : 'Theoretical entry awaits the next observed candle.'),
        h('p', null, `Theoretical outcome: ${row.outcome?.reason ?? 'Pending'}; raw R: ${number(row.outcome?.rawR)}; outcome time: ${row.outcome?.timestamp ?? '—'}.`),
        h('p', null, `Methodology: ${row.provenance.methodologyVersion}; context reference: ${row.provenance.regimeSourceSymbol}; history start: ${row.provenance.historyStart}; calculation fingerprint: ${row.provenance.sourceFingerprint}.`),
      ))),
  )
}
export function ShadowForward({ fetchSnapshot = async () => {
  const response = await fetch(apiUrl('/api/research-shadow'))
  const payload = parseResearchJson(await response.text())
  if (!response.ok) throw new Error(payload.error ?? 'Shadow evidence unavailable')
  return payload
} }) {
  const [state, setState] = useState({ loading: true, snapshot: null, error: null })
  useEffect(() => { let active = true; fetchSnapshot().then((snapshot) => { if (active) setState({ snapshot, loading: false }) }).catch((error) => { if (active) setState({ error: error.message, loading: false }) }); return () => { active = false } }, [])
  return state.loading ? h('p', { role: 'status' }, 'Loading saved shadow observations…') : state.error ? h('p', { role: 'alert' }, state.error) : h(ShadowForwardEvidence, { snapshot: state.snapshot })
}
