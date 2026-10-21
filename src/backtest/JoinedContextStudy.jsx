import React, { useMemo, useState } from 'react'
import { runJoinedContextStudy } from './joinedContextStudy.js'

const metric = (value, suffix = '') => value == null ? '—' : value === Infinity ? '∞' : `${value.toFixed(2)}${suffix}`
export function JoinedContextStudy({ rawSeriesBySymbol }) {
  const study = useMemo(() => runJoinedContextStudy(rawSeriesBySymbol), [rawSeriesBySymbol])
  const [symbol, setSymbol] = useState('pooled')
  const [tier, setTier] = useState(0)
  if (!study.available) return <p>Joined context study unavailable: {study.reason ?? 'SPY, QQQ and IWM hourly data are required.'}</p>
  return <details className="robustness-section">
    <summary>Joined context study — when did existing setups perform differently?</summary>
    <p>Context means market conditions surrounding a setup. An interaction means two conditions on the same occurrence. Membership is research-eligible 75+: Potential and Qualified Setups. No rules are optimized or promoted to trading.</p>
    <p>Development (2022–2024) is used to discover patterns; holdout (2025) checks repetition in later data; 2026 YTD is observational follow-up through the supplied data. Repeated exploration means a holdout is no longer untouched. Historical associations do not prove causation or future profit.</p>
    <p>Trend and volatility use the SPY market backdrop. Discovery VWAP uses UTC date boundaries. First-observed range uses the first supplied Eastern-date candle, including premarket, from the second candle onward. It reports above versus not above, not below versus inside. Unavailable means a context could not be evaluated causally.</p>
    <label>Symbol <select value={symbol} onChange={(event) => setSymbol(event.target.value)}>{['pooled', 'SPY', 'QQQ', 'IWM'].map((value) => <option key={value}>{value}</option>)}</select></label>
    <label>Modeled costs <select value={tier} onChange={(event) => setTier(Number(event.target.value))}>{study.rows[0].matched.costTiers.map((cost, index) => <option key={cost.label} value={index}>{cost.label} ({cost.costR}R)</option>)}</select></label>
    <p>Fewer than 30 resolved observations is insufficient evidence; 30–99 is exploratory (still small); 100+ is stronger descriptive evidence, not statistical significance. Comparison strength uses the smaller matched/nonmatched resolved group. Baseline includes unavailable contexts; the comparison group contains available, nonmatching occurrences.</p>
    <p>Available + unavailable = baseline candidates. Resolved + outcome excluded = baseline candidates. Exclusions overlap context categories and must not be added to them. Outcomes crossing periods or missing their full expiry window are excluded. Drawdown and total R describe sequential trade results, not account equity or capital constraints.</p>
    <p>Alignment removed {Object.values(study.alignmentDroppedCounts).reduce((a, b) => a + b, 0)} input bars across symbols (duplicates or nonshared timestamps). {study.outsidePeriodCount} candidates are outside the study periods.</p>
    <p>Supplied shared history: {study.actualDateRange.start} through {study.actualDateRange.end}. Completed-bar cutoff: {study.options.requestedEnd}. Validation rejected {Object.values(study.dataQuality).reduce((sum, quality) => sum + quality.rejectedCandleCount, 0)} invalid bars; {Object.values(study.completionExcludedCounts).reduce((a, b) => a + b, 0)} bars finish after the cutoff.</p>
    {study.periods.map((period) => <section key={period.key}><h4>{period.label} ({period.start.slice(0, 10)} – {period.end.slice(0, 10)})</h4>
      <div className="robustness-table-wrap"><table className="robustness-table"><thead><tr>
        {['Context / interaction', 'Baseline candidates / resolved', 'Available / unavailable', 'Baseline outcome excluded', 'Matched candidates / resolved / excluded', 'Comparison candidates / resolved', 'Win rate', 'Average R', 'Baseline avg R', 'Comparison avg R', 'Profit factor', 'Total R', 'Max drawdown R', 'Matched evidence / comparison evidence', 'Accounting'].map((label) => <th key={label}>{label}</th>)}
      </tr></thead><tbody>{study.rows.filter((row) => row.symbol === symbol && row.period.key === period.key).map((row) => {
        const m = row.matched.costTiers[tier].metrics
        return <tr key={row.key}><th scope="row">{row.label}</th><td>{row.baseline.candidateCount} / {row.baseline.resolvedCount}</td><td>{row.accounting.contextAvailableCount} / {row.accounting.contextUnavailableCount}</td><td>{row.baseline.outcomeExcludedCount}</td><td>{row.matched.candidateCount} / {row.matched.resolvedCount} / {row.matched.outcomeExcludedCount}</td><td>{row.comparison.candidateCount} / {row.comparison.resolvedCount}</td><td>{metric(m ? m.winRate * 100 : null, '%')}</td><td>{metric(m?.averageR)}</td><td>{metric(row.baseline.costTiers[tier].metrics?.averageR)}</td><td>{metric(row.comparison.costTiers[tier].metrics?.averageR)}</td><td>{metric(m?.profitFactor)}</td><td>{metric(m?.totalR)}</td><td>{metric(m?.maximumDrawdown)}</td><td>{row.matched.evidenceStrength} / {row.comparisonEvidence}</td><td>{row.accounting.reconciliationStatus}</td></tr>
      })}</tbody></table></div></section>)}
  </details>
}
