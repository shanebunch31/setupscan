import React, { useMemo } from 'react'
import { enrichHistoricalCandles } from '../data/marketData.js'
import {
  calculateResearchMetrics,
  runStrategyComparison,
  trendMomentumParameters,
} from './strategyComparison.js'

const formatPercent = (value) =>
  `${(value * 100).toFixed(1)}%`

const formatR = (value) =>
  `${value === Infinity ? '∞' : value.toFixed(3)}R`

const formatDate = (value) =>
  value
    ? new Date(value).toLocaleDateString('en-US', {
        timeZone: 'UTC',
      })
    : '—'

function MetricCells({ metrics }) {
  return (
    <>
      <td>{metrics.totalTrades}</td>
      <td>{formatPercent(metrics.winRate)}</td>
      <td>
        {metrics.profitFactor === Infinity
          ? '∞'
          : metrics.profitFactor.toFixed(2)}
      </td>
      <td>{formatR(metrics.expectancy)}</td>
      <td>{formatR(metrics.averageR)}</td>
      <td>{formatR(metrics.maximumDrawdown)}</td>
      <td>{metrics.averageHoldingTime.toFixed(0)}m</td>
    </>
  )
}

function groupPeriods(rawCandles, result) {
  const periodSize = Math.ceil(
    rawCandles.length / 4,
  )

  return Array.from({ length: 4 }, (_, index) => {
    const startIndex = index * periodSize
    const endIndex = Math.min(
      (index + 1) * periodSize,
      rawCandles.length,
    )

    const trades = result.trades.filter(
      (trade) => {
        const tradeIndex =
          rawCandles.findIndex(
            (candle) =>
              candle.timestamp ===
              trade.timestamp,
          )

        return (
          tradeIndex >= startIndex &&
          tradeIndex < endIndex
        )
      },
    )

    return {
      label: `P${index + 1}`,
      start:
        rawCandles[startIndex]?.timestamp,
      end:
        rawCandles[endIndex - 1]?.timestamp,
      metrics: calculateResearchMetrics(trades),
    }
  })
}

function StrategyRows({
  comparisons,
  variants,
}) {
  return comparisons.flatMap(
    (comparison) =>
      variants.map(({ label, resultKey }) => ({
        label: `${comparison.symbol} · ${label}`,
        comparison,
        result: comparison[resultKey],
      })),
  )
}

function ComparisonTable({ comparisons }) {
  const rows = StrategyRows({
    comparisons,
    variants: [
      {
        label: 'SetupScan Fixed Stop',
        resultKey: 'baseline',
      },
      {
        label: 'SetupScan Trailing Stop',
        resultKey: 'trailingStop',
      },
    ],
  })

  return (
    <div className="robustness-table-wrap">
      <table className="robustness-table">
        <thead>
          <tr>
            <th>Symbol / strategy</th>
            <th>Candles</th>
            <th>Range</th>
            <th>Trades</th>
            <th>Win rate</th>
            <th>Profit factor</th>
            <th>Expectancy</th>
            <th>Average R</th>
            <th>Max DD</th>
            <th>Avg hold</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(
            ({
              label,
              comparison,
              result,
            }) => (
              <tr key={label}>
                <td>{label}</td>
                <td>{comparison.candleCount}</td>
                <td>
                  {formatDate(comparison.start)}{' '}
                  –{' '}
                  {formatDate(comparison.end)}
                </td>
                <MetricCells
                  metrics={result.metrics}
                />
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  )
}

function SampleComparisonTable({
  comparisons,
}) {
  const rows = StrategyRows({
    comparisons,
    variants: [
      {
        label: 'SetupScan Fixed Stop',
        resultKey: 'baseline',
      },
      {
        label: 'SetupScan Trailing Stop',
        resultKey: 'trailingStop',
      },
    ],
  })

  return (
    <div className="robustness-table-wrap">
      <table className="robustness-table">
        <thead>
          <tr>
            <th>Symbol / strategy</th>
            <th>Sample</th>
            <th>Trades</th>
            <th>Win rate</th>
            <th>Profit factor</th>
            <th>Expectancy</th>
            <th>Average R</th>
            <th>Max DD</th>
          </tr>
        </thead>
        <tbody>
          {rows.flatMap(
            ({ label, result }) => [
              {
                label,
                sample: 'In-sample',
                metrics:
                  result.inSampleMetrics,
              },
              {
                label,
                sample: 'Out-of-sample',
                metrics:
                  result.outOfSampleMetrics,
              },
            ],
          ).map(
            ({
              label,
              sample,
              metrics,
            }) => (
              <tr
                key={`${label}-${sample}`}
              >
                <td>{label}</td>
                <td>{sample}</td>
                <MetricCells
                  metrics={metrics}
                />
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  )
}

function PeriodComparisonTable({
  comparisons,
}) {
  const rows = StrategyRows({
    comparisons,
    variants: [
      {
        label: 'SetupScan Fixed Stop',
        resultKey: 'baseline',
      },
      {
        label: 'SetupScan Trailing Stop',
        resultKey: 'trailingStop',
      },
    ],
  })

  return (
    <div className="robustness-table-wrap">
      <table className="robustness-table">
        <thead>
          <tr>
            <th>Symbol / strategy</th>
            <th>Period</th>
            <th>Date range</th>
            <th>Trades</th>
            <th>Win rate</th>
            <th>Profit factor</th>
            <th>Expectancy</th>
            <th>Average R</th>
            <th>Max DD</th>
          </tr>
        </thead>
        <tbody>
          {rows.flatMap(
            ({ label, comparison, result }) =>
              groupPeriods(
                comparison.rawCandles,
                result,
              ).map((period) => ({
                label,
                period,
              })),
          ).map(
            ({ label, period }) => (
              <tr
                key={`${label}-${period.label}`}
              >
                <td>{label}</td>
                <td>{period.label}</td>
                <td>
                  {formatDate(period.start)}{' '}
                  –{' '}
                  {formatDate(period.end)}
                </td>
                <MetricCells
                  metrics={period.metrics}
                />
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  )
}

function ExitReasonTable({ comparisons }) {
  const rows = StrategyRows({
    comparisons,
    variants: [
      {
        label: 'SetupScan Fixed Stop',
        resultKey: 'baseline',
      },
      {
        label: 'SetupScan Trailing Stop',
        resultKey: 'trailingStop',
      },
    ],
  })

  const reasons = [
    'Target',
    'Stop',
    'Trailing Stop',
    'Expired',
  ]

  return (
    <div className="robustness-table-wrap">
      <table className="robustness-table">
        <thead>
          <tr>
            <th>Symbol / strategy</th>
            {reasons.map(
              (reason) => (
                <th key={reason}>
                  {reason}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map(
            ({ label, result }) => (
              <tr key={label}>
                <td>{label}</td>
                {reasons.map(
                  (reason) => (
                    <td key={reason}>
                      {
                        result.trades.filter(
                          (trade) =>
                            trade.exitReason ===
                            reason,
                        ).length
                      }
                    </td>
                  ),
                )}
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  )
}

function ExistingTrendMomentumTable({
  comparisons,
}) {
  return (
    <div className="robustness-table-wrap">
      <table className="robustness-table">
        <thead>
          <tr>
            <th>Symbol / strategy</th>
            <th>Candles</th>
            <th>Range</th>
            <th>Trades</th>
            <th>Win rate</th>
            <th>Profit factor</th>
            <th>Expectancy</th>
            <th>Average R</th>
            <th>Max DD</th>
            <th>Avg hold</th>
          </tr>
        </thead>
        <tbody>
          {comparisons.map(
            (comparison) => (
              <tr
                key={`${comparison.symbol}-trend-momentum`}
              >
                <td>
                  {comparison.symbol} ·
                  Trend/Momentum
                </td>
                <td>
                  {comparison.candleCount}
                </td>
                <td>
                  {formatDate(
                    comparison.start,
                  )}{' '}
                  –{' '}
                  {formatDate(
                    comparison.end,
                  )}
                </td>
                <MetricCells
                  metrics={
                    comparison
                      .trendMomentum
                      .metrics
                  }
                />
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  )
}

export function StrategyComparisonLab({
  datasets,
}) {
  const comparisons = useMemo(
    () =>
      datasets
        .filter(
          (dataset) =>
            dataset.status ===
            'AVAILABLE',
        )
        .map((dataset) => {
          const rawCandles =
            dataset.data.candles

          const result =
            runStrategyComparison(
              rawCandles,
              enrichHistoricalCandles(
                rawCandles,
              ),
            )

          return {
            symbol: dataset.symbol,
            candleCount:
              dataset.data.candleCount,
            start: dataset.data.start,
            end: dataset.data.end,
            rawCandles,
            baseline: result.baseline,
            trailingStop:
              result.trailingStop,
            control: result.control,
            trendMomentum:
              result.trendMomentum,
          }
        }),
    [datasets],
  )

  if (!comparisons.length) {
    return (
      <div className="robustness-error">
        Strategy comparison unavailable
        until real Alpaca datasets load.
      </div>
    )
  }

  return (
    <div className="strategy-comparison">
      <div className="comparison-strategy-definition">
        <strong>
          RESEARCH ONLY — NOT PRODUCTION
        </strong>

        <span>
          Fixed Stop: next-candle-open
          entry; initial stop = 0.5%;
          target = 2R; max hold = 12
          bars.
        </span>

        <span>
          Trailing Stop: same signals,
          same entry and initial risk;
          trail activates at +1R; trail
          distance = 0.3%; target = 2R;
          max hold = 12 bars.
        </span>

        <span>
          Trailing exits use the stop level
          carried into each candle before
          using that candle's high to
          ratchet the stop. This avoids
          assuming intrabar ordering that
          hourly OHLC data does not reveal.
        </span>
      </div>

      <h4>
        Fixed Stop vs Trailing Stop
      </h4>
      <ComparisonTable
        comparisons={comparisons}
      />

      <h4>
        Fixed Stop vs Trailing Stop ·
        In-sample / Out-of-sample
      </h4>

      <SampleComparisonTable
        comparisons={comparisons}
      />

      <h4>
        Fixed Stop vs Trailing Stop ·
        Historical periods
      </h4>

      <PeriodComparisonTable
        comparisons={comparisons}
      />

      <h4>
        Exit reason counts
      </h4>

      <ExitReasonTable
        comparisons={comparisons}
      />

      <h4>
        Existing Trend/Momentum research
      </h4>

      <ExistingTrendMomentumTable
        comparisons={comparisons}
      />

      <p className="robustness-muted">
        All SetupScan stop models use
        next-candle-open entries and the
        same chronological 70/30 split.
        Parameters are fixed before
        evaluating results. No production
        threshold or strategy winner is
        selected.
      </p>

      <p className="robustness-muted">
        Trailing parameters: activation
        1R, trail distance 0.3%.
      </p>

      <p className="robustness-muted">
        Existing Trend/Momentum parameters:
        momentum lookback{' '}
        {trendMomentumParameters.momentumLookback},
        ATR period{' '}
        {trendMomentumParameters.atrPeriod},
        stop{' '}
        {trendMomentumParameters.stopAtrMultiple}{' '}
        ATR, target{' '}
        {trendMomentumParameters.targetRMultiple}
        R.
      </p>
    </div>
  )
}