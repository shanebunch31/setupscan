import React, { useState } from 'react'

const PALETTE = ['lab-chart-series-0', 'lab-chart-series-1', 'lab-chart-series-2', 'lab-chart-series-3']
const isAvailable = (point) => point?.tradeCount > 0 && Number.isFinite(point.value)
const hasSmallSample = (point, threshold) => [point?.tradeCount, point?.comparisonTradeCount]
  .some((count) => Number.isFinite(count) && count > 0 && count < threshold)

function observationCount(point, unit) {
  if (point?.comparisonTradeCount !== undefined) {
    const variant = point.tradeCount ?? '—'
    const control = point.comparisonTradeCount ?? '—'
    return `${variant} / ${control} ${unit} (variant / Control)`
  }
  return `${point?.tradeCount ?? '—'} ${unit}`
}

function emptyObservationLabel(point) {
  return point?.comparisonTradeCount !== undefined ? ' · no comparable observations' : ' · no observations'
}

function formatTimestamp(value, includeTime = false) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Unavailable'
  return new Date(value).toLocaleString('en-US', {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...(includeTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }) + ' UTC'
}

function segmentsFor(observations, seriesIndex, xForIndex, yForValue) {
  const segments = []
  let current = []
  observations.forEach((observation, index) => {
    const point = observation.series?.[seriesIndex]
    if (isAvailable(point)) current.push(`${xForIndex(index)},${yForValue(point.value)}`)
    else if (current.length) {
      segments.push(current)
      current = []
    }
  })
  if (current.length) segments.push(current)
  return segments
}

/** Shared, data-backed line chart with keyboard selection and a matching accessible table. */
export function InspectableLineChart({
  id,
  title,
  question,
  observations,
  series,
  sampleUnit = 'trades',
  xAxisLabel = 'Period',
  sampleThreshold,
  formatValue = (value) => String(value),
}) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const rows = observations ?? []
  const hasValues = rows.some((row) => row.series?.some(isAvailable))
  const selectedRow = rows[Math.min(selectedIndex, Math.max(rows.length - 1, 0))]
  const width = 760
  const height = 330
  const plot = { left: 82, right: 735, top: 28, bottom: 260 }
  const values = rows.flatMap((row) => (row.series ?? []).filter(isAvailable).map((point) => point.value))
  const min = values.length ? Math.min(0, ...values) : 0
  const max = values.length ? Math.max(0, ...values) : 0
  const range = max - min || 1
  const xForIndex = (index) => plot.left + (index / Math.max(rows.length - 1, 1)) * (plot.right - plot.left)
  const yForValue = (value) => plot.bottom - ((value - min) / range) * (plot.bottom - plot.top)
  const selectedValues = selectedRow?.series ?? []

  return (
    <section className="lab-chart-card" aria-labelledby={`${id}-title`}>
      <h4 id={`${id}-title`}>{title}</h4>
      <p className="lab-chart-question">{question}</p>
      {sampleThreshold ? <p className="lab-chart-note">Counts below {sampleThreshold} {sampleUnit} are flagged as a small sample; that label is a caution, not a statistical confidence test.</p> : null}
      {hasValues ? (
        <svg className="lab-chart-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={`${id}-title ${id}-description`}>
          <desc id={`${id}-description`}>
            {title}. Each plotted point is an existing reported value with a nonzero observation count. The horizontal line marks zero. Use the keyboard control and data table below for exact values and counts.
          </desc>
          {[max, (max + min) / 2, min].filter((value, index, ticks) => ticks.indexOf(value) === index).map((value) => (
            <g key={`tick-${value}`} className="lab-chart-axis-tick">
              <line x1={plot.left} x2={plot.right} y1={yForValue(value)} y2={yForValue(value)} />
              <text x={plot.left - 9} y={yForValue(value) + 4} textAnchor="end">{formatValue(value)}</text>
            </g>
          ))}
          <line className="lab-chart-zero-line" x1={plot.left} x2={plot.right} y1={yForValue(0)} y2={yForValue(0)} />
          {series.map((entry, seriesIndex) => (
            <g key={entry.key} className={PALETTE[seriesIndex % PALETTE.length]}>
              {segmentsFor(rows, seriesIndex, xForIndex, yForValue).map((points, segmentIndex) => (
                <polyline key={`${entry.key}-segment-${segmentIndex}`} className="lab-chart-line" points={points.join(' ')} />
              ))}
              {rows.map((row, index) => {
                const point = row.series?.[seriesIndex]
                if (!isAvailable(point)) return null
                return <circle key={`${row.label}-${entry.key}`} className={`lab-chart-point${index === selectedIndex ? ' is-selected' : ''}`} cx={xForIndex(index)} cy={yForValue(point.value)} r={index === selectedIndex ? 5 : 3.5} />
              })}
            </g>
          ))}
          <line className="lab-chart-axis-line" x1={plot.left} x2={plot.left} y1={plot.top} y2={plot.bottom} />
          <line className="lab-chart-axis-line" x1={plot.left} x2={plot.right} y1={plot.bottom} y2={plot.bottom} />
          <text className="lab-chart-axis-title" x="18" y={(plot.top + plot.bottom) / 2} transform={`rotate(-90 18 ${(plot.top + plot.bottom) / 2})`}>{series[0]?.metricLabel ?? 'R expectancy per trade'}</text>
          <text className="lab-chart-axis-label" x={plot.left} y={plot.bottom + 23}>{rows[0]?.label ?? ''}</text>
          <text className="lab-chart-axis-label" x={plot.right} y={plot.bottom + 23} textAnchor="end">{rows.at(-1)?.label ?? ''}</text>
          <text className="lab-chart-axis-title" x={(plot.left + plot.right) / 2} y={height - 9} textAnchor="middle">{xAxisLabel}</text>
        </svg>
      ) : (
        <p className="lab-chart-empty" role="status">No populated observations are available to plot. Expectancy is unavailable, not a measured zero. Counts and missing values are shown in the data table.</p>
      )}
      <div className="lab-chart-count-strip" aria-label="Observation counts by period">
        {rows.map((row) => (
          <p key={row.label}>
            <strong>{row.label}</strong>
            {row.series.map((point) => (
              <span key={point.label}>{point.label}: {observationCount(point, sampleUnit)}{sampleThreshold && hasSmallSample(point, sampleThreshold) ? ' · small sample' : ''}{point.tradeCount === 0 || point.comparisonTradeCount === 0 ? emptyObservationLabel(point) : ''}</span>
            ))}
          </p>
        ))}
      </div>
      <div className="lab-chart-legend" role="group" aria-label="Chart series">
        {series.map((entry, index) => <span key={entry.key} className={PALETTE[index % PALETTE.length]}>{entry.label}</span>)}
      </div>
      <label className="lab-chart-inspector-label" htmlFor={`${id}-inspector`}>Inspect a period (use arrow keys)</label>
      <input
        id={`${id}-inspector`}
        className="lab-chart-inspector"
        type="range"
        min="0"
        max={Math.max(rows.length - 1, 0)}
        value={Math.min(selectedIndex, Math.max(rows.length - 1, 0))}
        step="1"
        disabled={!rows.length}
        onChange={(event) => setSelectedIndex(Number(event.target.value))}
        aria-valuetext={selectedRow ? `${selectedRow.label}: ${selectedValues.map((point) => `${point.label}, ${isAvailable(point) ? formatValue(point.value) : 'expectancy unavailable'}, ${point.tradeCount ?? 'trade count unavailable'} ${sampleUnit}`).join('; ')}` : 'No periods available'}
      />
      <output className="lab-chart-selected-detail" aria-live="polite">
        {selectedRow ? <>
          <strong>{selectedRow.label}</strong>
          {selectedRow.detail ? <span>{selectedRow.detail}</span> : null}
          {selectedValues.map((point) => (
            <span key={point.label}>
              {point.label}: {isAvailable(point) ? formatValue(point.value) : '—'}; {observationCount(point, sampleUnit)}
              {sampleThreshold && hasSmallSample(point, sampleThreshold) ? ' · small sample' : ''}
              {point.tradeCount === 0 || point.comparisonTradeCount === 0 ? emptyObservationLabel(point) : ''}
            </span>
          ))}
        </> : <span>No periods available.</span>}
      </output>
      <details className="lab-chart-table-details">
        <summary>View chart data table</summary>
        <div className="lab-chart-table-wrap">
          <table className="lab-chart-data-table">
            <caption>{title}; the table uses the same period observations as the chart. A dash means the metric or count is unavailable.</caption>
            <thead>
              <tr>
                <th scope="col" rowSpan="2">Period</th>
                {rows.some((row) => row.detail) ? <th scope="col" rowSpan="2">Date range (UTC)</th> : null}
                {series.map((entry) => <th key={entry.key} scope="colgroup" colSpan="2">{entry.label}</th>)}
              </tr>
              <tr>{series.flatMap((entry, seriesIndex) => [
                <th key={`${entry.key}-value`} scope="col">{entry.metricLabel ?? 'Expectancy (R/trade)'}</th>,
                <th key={`${entry.key}-count`} scope="col">{entry.countLabel ?? (rows.some((row) => row.series?.[seriesIndex]?.comparisonTradeCount !== undefined) ? 'Trades (variant / Control)' : 'Trades')}</th>,
              ])}</tr>
            </thead>
            <tbody>{rows.map((row, index) => (
              <tr key={row.label} aria-current={index === selectedIndex ? 'true' : undefined}>
                <th scope="row">{row.label}</th>
                {rows.some((entry) => entry.detail) ? <td>{row.detail ?? 'Unavailable'}</td> : null}
                {(row.series ?? []).flatMap((point) => [
                  <td key={`${point.label}-value`}>{isAvailable(point) ? formatValue(point.value) : '—'}</td>,
                  <td key={`${point.label}-count`}>{observationCount(point, sampleUnit)}{sampleThreshold && hasSmallSample(point, sampleThreshold) ? ' · small sample' : ''}{point.tradeCount === 0 || point.comparisonTradeCount === 0 ? emptyObservationLabel(point) : ''}</td>,
                ])}
              </tr>
            ))}</tbody>
          </table>
        </div>
      </details>
    </section>
  )
}

/** Discrete-category bar chart; vertical grouped bars or horizontal diverging bars. */
export function InspectableBarChart({
  id,
  title,
  question,
  observations,
  series,
  sampleUnit = 'trades',
  xAxisLabel = 'Research window',
  sampleThreshold,
  formatValue = (value) => String(value),
  layout = 'grouped',
}) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const rows = observations ?? []
  const hasValues = rows.some((row) => row.series?.some(isAvailable))
  const selectedRow = rows[Math.min(selectedIndex, Math.max(rows.length - 1, 0))]
  const selectedValues = selectedRow?.series ?? []
  const width = layout === 'diverging' ? 920 : 900
  const height = 360
  const plot = layout === 'diverging'
    ? { left: 230, right: 880, top: 28, bottom: 300 }
    : { left: 82, right: 875, top: 28, bottom: 285 }
  const values = rows.flatMap((row) => (row.series ?? []).filter(isAvailable).map((point) => point.value))
  const min = values.length ? Math.min(0, ...values) : 0
  const max = values.length ? Math.max(0, ...values) : 0
  const range = max - min || 1
  const baseline = layout === 'diverging'
    ? plot.left + ((0 - min) / range) * (plot.right - plot.left)
    : plot.bottom - ((0 - min) / range) * (plot.bottom - plot.top)
  const detail = (point) => `${point.label}: ${isAvailable(point) ? formatValue(point.value) : 'expectancy unavailable'}; ${observationCount(point, sampleUnit)}${sampleThreshold && hasSmallSample(point, sampleThreshold) ? ', small sample' : ''}`

  return (
    <section className="lab-chart-card" aria-labelledby={`${id}-title`}>
      <h4 id={`${id}-title`}>{title}</h4>
      <p className="lab-chart-question">{question}</p>
      {sampleThreshold ? <p className="lab-chart-note">Counts below {sampleThreshold} {sampleUnit} are flagged as a small sample; that label is a caution, not a statistical confidence test.</p> : null}
      {hasValues ? (
        <div className="lab-bar-chart-scroll">
          <svg className={`lab-bar-chart-svg is-${layout}`} viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={`${id}-title ${id}-description`}>
            <desc id={`${id}-description`}>{title}. Bars show only values with a nonzero observation count. The reference line marks zero. Use the keyboard control and data table for exact values, dates, and counts.</desc>
            {(layout === 'diverging' ? [min, 0, max] : [max, (max + min) / 2, min])
              .filter((value, index, ticks) => ticks.indexOf(value) === index)
              .map((value) => layout === 'diverging' ? (
                <g key={`tick-${value}`} className="lab-chart-axis-tick">
                  <line x1={plot.left + ((value - min) / range) * (plot.right - plot.left)} x2={plot.left + ((value - min) / range) * (plot.right - plot.left)} y1={plot.top} y2={plot.bottom} />
                  <text x={plot.left + ((value - min) / range) * (plot.right - plot.left)} y={plot.bottom + 19} textAnchor="middle">{formatValue(value)}</text>
                </g>
              ) : (
                <g key={`tick-${value}`} className="lab-chart-axis-tick">
                  <line x1={plot.left} x2={plot.right} y1={plot.bottom - ((value - min) / range) * (plot.bottom - plot.top)} y2={plot.bottom - ((value - min) / range) * (plot.bottom - plot.top)} />
                  <text x={plot.left - 9} y={plot.bottom - ((value - min) / range) * (plot.bottom - plot.top) + 4} textAnchor="end">{formatValue(value)}</text>
                </g>
              ))}
            {layout === 'diverging' ? (
              <line className="lab-chart-zero-line" x1={baseline} x2={baseline} y1={plot.top} y2={plot.bottom} />
            ) : (
              <line className="lab-chart-zero-line" x1={plot.left} x2={plot.right} y1={baseline} y2={baseline} />
            )}
            {rows.map((row, rowIndex) => {
              const seriesCount = Math.max(series.length, 1)
              if (layout === 'diverging') {
                const groupHeight = (plot.bottom - plot.top) / Math.max(rows.length, 1)
                const barHeight = Math.min(18, groupHeight * 0.65 / seriesCount)
                const centerY = plot.top + (rowIndex + 0.5) * groupHeight
                return <g key={row.label} className={rowIndex === selectedIndex ? 'lab-bar-group is-selected' : 'lab-bar-group'}>
                  <text className="lab-chart-axis-label" x={plot.left - 10} y={centerY + 4} textAnchor="end">{row.label}</text>
                  {series.map((entry, seriesIndex) => {
                    const point = row.series?.[seriesIndex]
                    if (!isAvailable(point)) return null
                    const x = plot.left + ((point.value - min) / range) * (plot.right - plot.left)
                    const y = centerY + (seriesIndex - (seriesCount - 1) / 2) * barHeight
                    if (point.value === 0) return <circle key={entry.key} className={`lab-bar-zero ${PALETTE[seriesIndex % PALETTE.length]}`} cx={baseline} cy={y} r="4" />
                    return <rect key={entry.key} className={`lab-bar ${PALETTE[seriesIndex % PALETTE.length]}`} x={Math.min(baseline, x)} y={y - barHeight * 0.38} width={Math.max(Math.abs(x - baseline), 1)} height={barHeight * 0.76} rx="2" />
                  })}
                </g>
              }
              const groupWidth = (plot.right - plot.left) / Math.max(rows.length, 1)
              const barWidth = Math.min(30, groupWidth * 0.72 / seriesCount)
              const centerX = plot.left + (rowIndex + 0.5) * groupWidth
              return <g key={row.label} className={rowIndex === selectedIndex ? 'lab-bar-group is-selected' : 'lab-bar-group'}>
                <text className="lab-chart-axis-label" x={centerX} y={plot.bottom + 19} textAnchor="middle">{row.label}</text>
                {series.map((entry, seriesIndex) => {
                  const point = row.series?.[seriesIndex]
                  if (!isAvailable(point)) return null
                  const y = plot.bottom - ((point.value - min) / range) * (plot.bottom - plot.top)
                  const x = centerX + (seriesIndex - (seriesCount - 1) / 2) * barWidth
                  if (point.value === 0) return <circle key={entry.key} className={`lab-bar-zero ${PALETTE[seriesIndex % PALETTE.length]}`} cx={x} cy={baseline} r="4" />
                  return <rect key={entry.key} className={`lab-bar ${PALETTE[seriesIndex % PALETTE.length]}`} x={x - barWidth * 0.38} y={Math.min(baseline, y)} width={barWidth * 0.76} height={Math.max(Math.abs(y - baseline), 1)} rx="2" />
                })}
              </g>
            })}
            {layout === 'diverging' ? (
              <text className="lab-chart-axis-title" x={(plot.left + plot.right) / 2} y={height - 8} textAnchor="middle">{xAxisLabel}</text>
            ) : (
              <>
                <line className="lab-chart-axis-line" x1={plot.left} x2={plot.left} y1={plot.top} y2={plot.bottom} />
                <line className="lab-chart-axis-line" x1={plot.left} x2={plot.right} y1={plot.bottom} y2={plot.bottom} />
                <text className="lab-chart-axis-title" x="18" y={(plot.top + plot.bottom) / 2} transform={`rotate(-90 18 ${(plot.top + plot.bottom) / 2})`}>{series[0]?.metricLabel ?? 'R expectancy per trade'}</text>
                <text className="lab-chart-axis-title" x={(plot.left + plot.right) / 2} y={height - 8} textAnchor="middle">{xAxisLabel}</text>
              </>
            )}
          </svg>
        </div>
      ) : <p className="lab-chart-empty" role="status">No populated observations are available to plot. Expectancy is unavailable, not a measured zero. Counts and missing values are shown in the data table.</p>}
      <div className="lab-chart-count-strip" aria-label="Observation counts by period">
        {rows.map((row) => <p key={row.label}><strong>{row.label}</strong>{row.detail ? <span>{row.detail}</span> : null}{row.series.map((point) => <span key={point.label}>{point.label}: {observationCount(point, sampleUnit)}{sampleThreshold && hasSmallSample(point, sampleThreshold) ? ' · small sample' : ''}{point.tradeCount === 0 || point.comparisonTradeCount === 0 ? emptyObservationLabel(point) : ''}</span>)}</p>)}
      </div>
      <div className="lab-chart-legend" role="group" aria-label="Chart series">
        {series.map((entry, index) => <span key={entry.key} className={PALETTE[index % PALETTE.length]}>{entry.label}</span>)}
      </div>
      <label className="lab-chart-inspector-label" htmlFor={`${id}-inspector`}>Inspect a period (use arrow keys)</label>
      <input id={`${id}-inspector`} className="lab-chart-inspector" type="range" min="0" max={Math.max(rows.length - 1, 0)} value={Math.min(selectedIndex, Math.max(rows.length - 1, 0))} step="1" disabled={!rows.length} onChange={(event) => setSelectedIndex(Number(event.target.value))}
        aria-valuetext={selectedRow ? `${selectedRow.label}: ${selectedValues.map(detail).join('; ')}` : 'No periods available'} />
      <output className="lab-chart-selected-detail" aria-live="polite">
        {selectedRow ? <><strong>{selectedRow.label}</strong>{selectedRow.detail ? <span>{selectedRow.detail}</span> : null}{selectedValues.map((point) => <span key={point.label}>{detail(point)}</span>)}</> : <span>No periods available.</span>}
      </output>
      <details className="lab-chart-table-details">
        <summary>View chart data table</summary>
        <div className="lab-chart-table-wrap">
          <table className="lab-chart-data-table">
            <caption>{title}; the table uses the same period observations as the chart. A dash means the metric or count is unavailable.</caption>
            <thead><tr><th scope="col">Period</th><th scope="col">Date range (UTC)</th>{series.map((entry) => <th key={entry.key} scope="col">{entry.label} — {entry.metricLabel ?? 'Expectancy (R/trade)'} / {entry.countLabel ?? 'Trades'}</th>)}</tr></thead>
            <tbody>{rows.map((row, index) => <tr key={row.label} aria-current={index === selectedIndex ? 'true' : undefined}>
              <th scope="row">{row.label}</th><td>{row.detail ?? 'Unavailable'}</td>
              {(row.series ?? []).map((point) => <td key={point.label}>{isAvailable(point) ? formatValue(point.value) : '—'}; {observationCount(point, sampleUnit)}{sampleThreshold && hasSmallSample(point, sampleThreshold) ? ' · small sample' : ''}{point.tradeCount === 0 || point.comparisonTradeCount === 0 ? emptyObservationLabel(point) : ''}</td>)}
            </tr>)}</tbody>
          </table>
        </div>
      </details>
    </section>
  )
}

function formatCount(value) {
  return Number.isFinite(value) ? String(value) : 'Unavailable'
}

/** Training/test calendar timeline based only on realized bounds returned by the research run. */
export function TrainingTestTimeline({ windows }) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const rows = windows ?? []
  const selectedRow = rows[Math.min(selectedIndex, Math.max(rows.length - 1, 0))]
  const width = 1000
  const left = 150
  const right = 875
  const rowHeight = 52
  const height = Math.max(150, rows.length * rowHeight + 65)
  const intervals = rows.flatMap((row) => [row.training, row.test])
    .map((range) => ({ range, start: Date.parse(range.start ?? ''), end: Date.parse(range.end ?? '') }))
    .filter(({ start, end }) => Number.isFinite(start) && Number.isFinite(end) && end >= start)
  const hasIntervals = intervals.length > 0
  const minTime = hasIntervals ? Math.min(...intervals.map(({ start }) => start)) : 0
  const maxTime = hasIntervals ? Math.max(...intervals.map(({ end }) => end)) : 1
  const timeRange = maxTime - minTime || 1
  const xForTime = (time) => left + ((time - minTime) / timeRange) * (right - left)
  const dateTick = (time) => formatTimestamp(new Date(time).toISOString())

  return (
    <section className="lab-chart-card" aria-labelledby="walk-forward-timeline-title">
      <h4 id="walk-forward-timeline-title">When were boundaries set and results tested?</h4>
      <p className="lab-chart-question">Each row shows the actual candle-date range used for training and the later test period. Training calculates that window’s volatility cutoffs; the scanner rule itself remains frozen.</p>
      {hasIntervals ? (
        <div className="lab-timeline-scroll">
        <svg className="lab-timeline-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby="walk-forward-timeline-title walk-forward-timeline-description">
          <desc id="walk-forward-timeline-description">Training periods are shown in green and test periods in gold. Each bar uses the realized candle dates and counts returned by the research result. Select a window below for exact dates.</desc>
          {rows.map((row, index) => {
            const y = 34 + index * rowHeight
            return (
              <g key={row.label} className={index === selectedIndex ? 'lab-timeline-row is-selected' : 'lab-timeline-row'}>
                <text className="lab-timeline-window-label" x={left - 12} y={y + 14} textAnchor="end">{row.label}</text>
                {[['training', row.training], ['test', row.test]].map(([type, range]) => {
                  const start = Date.parse(range.start ?? '')
                  const end = Date.parse(range.end ?? '')
                  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null
                  const x = xForTime(start)
                  const barWidth = Math.max(2, xForTime(end) - x)
                  return <rect key={type} className={`lab-timeline-bar lab-timeline-${type}`} x={x} y={y} width={barWidth} height="18" rx="3" />
                })}
                <text className="lab-timeline-window-year" x={width - 10} y={y + 14} textAnchor="end">{row.testYear}</text>
              </g>
            )
          })}
          <line className="lab-chart-axis-line" x1={left} x2={right} y1={rows.length * rowHeight + 40} y2={rows.length * rowHeight + 40} />
          <text className="lab-chart-axis-label" x={left} y={height - 8}>{dateTick(minTime)}</text>
          <text className="lab-chart-axis-label" x={right} y={height - 8} textAnchor="end">{dateTick(maxTime)}</text>
        </svg>
        </div>
      ) : <p className="lab-chart-empty" role="status">Actual training and test candle dates are unavailable, so no timeline is drawn.</p>}
      <div className="lab-chart-legend" role="group" aria-label="Timeline periods"><span className="lab-timeline-key-training">Training: boundary-setting data</span><span className="lab-timeline-key-test">Test: measured data</span></div>
      <label className="lab-chart-inspector-label" htmlFor="walk-forward-window-inspector">Inspect a window (use arrow keys)</label>
      <input
        id="walk-forward-window-inspector"
        className="lab-chart-inspector"
        type="range"
        min="0"
        max={Math.max(rows.length - 1, 0)}
        value={Math.min(selectedIndex, Math.max(rows.length - 1, 0))}
        step="1"
        disabled={!rows.length}
        onChange={(event) => setSelectedIndex(Number(event.target.value))}
        aria-valuetext={selectedRow ? `${selectedRow.label}; training ${formatTimestamp(selectedRow.training.start, true)} through ${formatTimestamp(selectedRow.training.end, true)}; test ${formatTimestamp(selectedRow.test.start, true)} through ${formatTimestamp(selectedRow.test.end, true)}` : 'No windows available'}
      />
      <output className="lab-chart-selected-detail" aria-live="polite">
        {selectedRow ? <>
          <strong>{selectedRow.label}</strong>
          <span>Training: {formatTimestamp(selectedRow.training.start, true)} – {formatTimestamp(selectedRow.training.end, true)}; {formatCount(selectedRow.training.candleCount)} candles</span>
          <span>Test: {formatTimestamp(selectedRow.test.start, true)} – {formatTimestamp(selectedRow.test.end, true)}; {formatCount(selectedRow.test.candleCount)} candles</span>
        </> : <span>No walk-forward windows available.</span>}
      </output>
      <details className="lab-chart-table-details">
        <summary>View training and test date table</summary>
        <div className="lab-chart-table-wrap">
          <table className="lab-chart-data-table">
            <caption>Actual realized data bounds and candle counts from each walk-forward result.</caption>
            <thead><tr><th scope="col">Window</th><th scope="col">Test year</th><th scope="col">Training dates (UTC)</th><th scope="col">Training candles</th><th scope="col">Test dates (UTC)</th><th scope="col">Test candles</th></tr></thead>
            <tbody>{rows.map((row, index) => (
              <tr key={row.label} aria-current={index === selectedIndex ? 'true' : undefined}>
                <th scope="row">{row.label}</th>
                <td>{row.testYear}</td>
                <td>{formatTimestamp(row.training.start, true)} – {formatTimestamp(row.training.end, true)}</td>
                <td>{formatCount(row.training.candleCount)}</td>
                <td>{formatTimestamp(row.test.start, true)} – {formatTimestamp(row.test.end, true)}</td>
                <td>{formatCount(row.test.candleCount)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </details>
    </section>
  )
}
