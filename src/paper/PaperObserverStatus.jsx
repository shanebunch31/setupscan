import React from 'react'

const time = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('en-US', { timeZone: 'America/New_York', timeZoneName: 'short' }) : 'Not recorded'
export function PaperObserverStatus({ operational }) {
  return <div className="paper-disclaimer" aria-live="polite">
    <strong>{operational.label}</strong>
    <p>Journal: {operational.journal ?? 'checking'} · Open paper positions: {operational.openPositions ?? 'unknown'} · Provider: {operational.provider ?? 'unknown'}</p>
    <p>Last observer cycle: {time(operational.lastCycleCompletedAt)} · Last successful market-data cycle: {time(operational.lastSuccessfulMarketDataCycleAt)}</p>
    {operational.failureCode && <p>Failure: {operational.failureCode}. Runtime progress is not proof of a saved checkpoint.</p>}
    {operational.errorRecordingFailureCode && <p>Error recording also failed: {operational.errorRecordingFailureCode}.</p>}
    {operational.lastUncertainCommitAt && <p>Last unconfirmed commit: {time(operational.lastUncertainCommitAt)}. Whether it committed requires checking the saved state.</p>}
    <details><summary>Observer checkpoints and decision evidence</summary>
      <p>Live check: {time(operational.checkedAt)} · Journal read: {time(operational.journalReadAt)}. Completed-bar timestamps below are bar starts.</p>
      <p>Persisted universe: {operational.universe?.initialized ? operational.universe.symbols.join(', ') || 'empty' : 'not initialized or unavailable'}.</p>
      <p>Outside-session status uses the existing weekday/session schedule; exchange holidays and early closes are not modeled. Recent decision records are retained only when a normal observer save succeeds. Pending entries are not resumed after restart.</p>
      {(operational.checkpoints ?? []).map(row => <details key={row.symbol}><summary>{row.symbol} · {time(row.timestamp)} · {row.enabled === true ? 'enabled' : row.enabled === false ? 'not enabled for new entries' : 'membership unknown'}</summary>
        <p>Persisted data status: {row.observationStatus ?? 'not recorded'}. {row.decisions.length ? 'Recent saved decision evidence:' : 'No historical decision evidence was recorded.'}</p>
        {row.decisions.slice().reverse().map((decision, index) => <div key={index}>
          <p>{time(decision.completedDecisionBar)} · {decision.entryGate} · Latest score {decision.latestEvaluation?.score ?? 'unknown'} · Qualified {decision.latestEvaluation?.qualifiedSetup === true ? 'yes' : decision.latestEvaluation ? 'no' : 'unknown'}</p>
          <p>Authorized prior signal: {time(decision.newEntrySignalTimestamp)} · Score {decision.authorizedSignal?.score ?? 'not evaluated for entry'} · Duplicate {decision.duplicateSignal ? 'yes' : 'no'} · Pending {decision.pendingAfter?.length ?? 0} · Created {decision.createdTradeIds?.length ?? 0}</p>
          <details><summary>Recorded inputs and entry evidence</summary><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(decision, null, 2)}</pre></details>
        </div>)}
      </details>)}
    </details>
  </div>
}
