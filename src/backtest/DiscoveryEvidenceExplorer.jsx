import React, { useEffect, useMemo, useRef, useState } from 'react'
import { InspectableBarChart, InspectableLineChart } from './LabsCharts.jsx'
import { DISCOVERY_MIN_EXPLORATORY } from '../research/interpretation.js'
import {
  DiscoveryEvidenceNote,
  DiscoveryEvidenceTable,
  discoveryEvidenceKeyAt,
  discoveryEvidenceModel,
  discoveryEvidenceNote,
  discoveryEvidenceSelection,
  formatEvidenceR,
} from './discoveryEvidence.js'

const series = [
  {
    key: 'average-r',
    label: 'Average R',
    metricLabel: 'Average R',
    countLabel: 'Occurrences',
  },
]

/**
 * Shared evidence explorer.
 *
 * Batch A uses every supplied year/symbol row.
 * Batch B may keep all context evidence in the table while restricting
 * the comparison chart to buckets that meet the existing exploratory
 * occurrence guideline.
 *
 * This component only presents already-structured evidence.
 * It does not calculate research results.
 */
export function DiscoveryEvidenceExplorer({
  id,
  dimension,
  rows,
  interpretation,
  sectionTitle,
  chartTitle,
  question: questionOverride,
  dimensionLabel,
  noun,
  chartType = 'auto',
  comparisonChartOnly = false,
}) {
  const [selectedKey, setSelectedKey] = useState(null)
  const [chartSelectedKey, setChartSelectedKey] = useState(null)

  const model = useMemo(
    () => discoveryEvidenceModel(rows, interpretation),
    [rows, interpretation],
  )

  const chartRows = useMemo(
    () =>
      comparisonChartOnly
        ? model.rows.filter(
            (row) =>
              row.occurrenceCount >= DISCOVERY_MIN_EXPLORATORY &&
              Number.isFinite(row.averageR),
          )
        : model.rows,
    [model.rows, comparisonChartOnly],
  )

  const chartObservations = useMemo(
    () =>
      chartRows.map((row) => ({
  label: row.label,
  axisLabel:
    comparisonChartOnly && dimensionLabel === 'Time of Day'
      ? row.label.split(' (')[0]
      : row.label,
  series: [
          {
            label: 'Average R',
            value: row.averageR,
            tradeCount: row.occurrenceCount,
          },
        ],
      })),
    [chartRows],
  )

  const defaultChartKey = chartRows[0]?.key ?? null
  const effectiveSelectedKey = selectedKey ?? defaultChartKey

  const selected = discoveryEvidenceSelection(
    model.rows,
    effectiveSelectedKey,
  )

  const selectedIsChartEligible = chartRows.some(
    (row) => row.key === selected.key,
  )

  const effectiveChartKey = selectedIsChartEligible
    ? selected.key
    : chartSelectedKey ?? defaultChartKey

  const chartSelected = discoveryEvidenceSelection(
    chartRows,
    effectiveChartKey,
  )

  const rowRefs = useRef(new Map())
  const revealRow = useRef(false)

  const year = dimension === 'year'
  const symbol = dimension === 'symbol'

  const visibleDimensionLabel =
    dimensionLabel ?? (year ? 'Year' : symbol ? 'Symbol' : 'Bucket')

  const title =
    chartTitle ??
    (year
      ? 'Average R by entry year'
      : symbol
        ? 'Average R by symbol'
        : `Average R by ${visibleDimensionLabel.toLowerCase()}`)

  const question =
    questionOverride ??
    (year
      ? 'Compare historical average R across entry-year cohorts. Outcomes can extend beyond the calendar year in which the signal occurred; these are descriptive cohorts, not independent tests.'
      : symbol
        ? 'Compare the symbols in the same historical research sample. Their sample sizes can differ; these groups overlap the parent evidence and are not independent confirmation.'
        : 'Compare the same frozen historical setup across these context buckets. The underlying setup rules do not change; only the grouping used to inspect the evidence changes.')

  const heading =
    sectionTitle ??
    (year
      ? 'Year-by-year evidence'
      : symbol
        ? 'Symbol-by-symbol evidence'
        : `${visibleDimensionLabel} evidence`)

  useEffect(() => {
    if (!revealRow.current) return

    revealRow.current = false

    rowRefs.current
      .get(selected.key)
      ?.scrollIntoView({
        block: 'nearest',
        inline: 'nearest',
        behavior: 'auto',
      })
  }, [selected.key])

  const selectChart = (index) => {
    const key = discoveryEvidenceKeyAt(chartRows, index)

    if (key === null) return

    if (key === selected.key) {
      rowRefs.current
        .get(key)
        ?.scrollIntoView({
          block: 'nearest',
          inline: 'nearest',
          behavior: 'auto',
        })

      return
    }

    revealRow.current = true
    setSelectedKey(key)
    setChartSelectedKey(key)
  }

  const selectTableRow = (key) => {
    revealRow.current = false
    setSelectedKey(key)

    if (chartRows.some((row) => row.key === key)) {
      setChartSelectedKey(key)
    }
  }

  const Chart =
    chartType === 'line' || (chartType === 'auto' && year)
      ? InspectableLineChart
      : InspectableBarChart

  return (
    <section
      className="discovery-evidence-explorer"
      aria-labelledby={`${id}-heading`}
    >
      <h4 id={`${id}-heading`}>{heading}</h4>

      <p className="robustness-muted">{question}</p>

      {!model.comparable && (
        <p className="discovery-evidence-caution">
          Deeper evidence or its provenance is unavailable. Recorded row counts
          are retained where known; performance comparisons are withheld. The
          overall result above is separate.
        </p>
      )}

      {model.status === 'insufficient-evidence' && (
        <p className="discovery-evidence-caution">
          The parent sample has{' '}
          {model.parentResolvedCount ?? 'an unknown number of'} resolved
          observations and remains insufficient. These breakdowns do not
          strengthen it.
        </p>
      )}

      {!model.rows.length ? (
        <p className="robustness-muted">
          No identifiable {visibleDimensionLabel.toLowerCase()} rows are
          available. No breakdown has been manufactured.
        </p>
      ) : (
        <DiscoveryEvidenceTable
          id={id}
          dimension={dimension}
          labelOverride={visibleDimensionLabel}
          model={model}
          selectedKey={selected.key}
          rowRefs={rowRefs}
          onSelect={selectTableRow}
        />
      )}

      {comparisonChartOnly && (
        <p className="discovery-evidence-caution">
          The comparison chart includes only buckets with at least{' '}
          {DISCOVERY_MIN_EXPLORATORY} resolved observations. Smaller historical
          buckets remain visible in the evidence table and Research Note, but
          they do not set the chart scale.
        </p>
      )}

      {comparisonChartOnly &&
        selected.row &&
        !selectedIsChartEligible && (
          <p className="discovery-evidence-caution">
            {selected.row.label} has{' '}
            {selected.row.occurrenceCount ?? 'an unknown number of'} resolved
            observations, so it is not plotted in the comparison chart. Its
            recorded result remains available in the table and Research Note.
          </p>
        )}

      <div id={`${id}-chart`}>
        {chartRows.length ? (
          <Chart
            id={id}
            title={title}
            question={question}
            observations={chartObservations}
            series={series}
            sampleUnit={comparisonChartOnly ? 'observations' : 'occurrences'}
            xAxisLabel={
              year
                ? 'Entry year (UTC)'
                : symbol
                  ? 'Symbol'
                  : visibleDimensionLabel
            }
            sampleThreshold={DISCOVERY_MIN_EXPLORATORY}
            formatValue={formatEvidenceR}
            selectedIndex={chartSelected.index}
            onSelectionChange={selectChart}
            categoryLabel={
  year
    ? 'Year'
    : symbol
      ? 'Symbol'
      : visibleDimensionLabel
}
showInspector={!comparisonChartOnly}
showDetailColumn={!comparisonChartOnly}
          />
        ) : (
          <p className="discovery-evidence-caution">
            No buckets meet the existing{' '}
            {DISCOVERY_MIN_EXPLORATORY}-observation exploratory guideline, so
            SetupScan is withholding the comparison chart rather than
            magnifying very small samples.
          </p>
        )}
      </div>

      <DiscoveryEvidenceNote
        note={discoveryEvidenceNote(model, selected.key, dimension, { noun })}
      />
    </section>
  )
}