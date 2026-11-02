import React, { useEffect, useMemo, useState } from 'react'
import { fetchHistoricalMarketData } from '../data/marketData.js'
import {
  chartSessionKey,
  completedChartCandles,
  createScanChartRange,
  selectChartRange,
} from '../data/scanChart.js'

const RANGE_OPTIONS = ['TRADE', '1D', '3D', '5D', 'ALL']

const formatPrice = (value) =>
  Number.isFinite(Number(value))
    ? `$${Number(value).toFixed(2)}`
    : '—'

const formatVolume = (value) =>
  Number.isFinite(Number(value))
    ? new Intl.NumberFormat('en-US', {
        notation: 'compact',
        maximumFractionDigits: 1,
      }).format(Number(value))
    : '—'

const formatCandleTime = (timestamp) =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(timestamp))

const formatChartDate = (timestamp) =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
  }).format(new Date(timestamp))

function calculateEma(candles, period) {
  if (!candles.length) return []

  const multiplier = 2 / (period + 1)
  let previous = Number(candles[0].close)

  return candles.map((candle, index) => {
    const close = Number(candle.close)

    if (index === 0) {
      previous = close
      return {
        timestamp: candle.timestamp,
        value: close,
      }
    }

    previous =
      close * multiplier +
      previous * (1 - multiplier)

    return {
      timestamp: candle.timestamp,
      value: previous,
    }
  })
}

function levelValue(trade, keys) {
  for (const key of keys) {
    const value = Number(trade?.[key])

    if (Number.isFinite(value)) {
      return value
    }
  }

  return null
}

const DAY_MS = 24 * 60 * 60 * 1000

function createPaperTradeFetchRange(trade) {
  const entry = Date.parse(trade?.entryTimestamp)
  const exit = Date.parse(trade?.exitTimestamp)

  if (!Number.isFinite(entry)) {
    return createScanChartRange()
  }

  const now = Date.now()

  const start = new Date(
    entry - 14 * DAY_MS,
  )

  const desiredEnd = Number.isFinite(exit)
    ? exit + 14 * DAY_MS
    : now

  const end = new Date(
    Math.min(desiredEnd, now),
  )

  return {
    start: start.toISOString(),
    end: end.toISOString(),
  }
}

function nearestCandleIndex(candles, timestamp) {
  const target = Date.parse(timestamp)

  if (
    !Number.isFinite(target) ||
    !candles.length
  ) {
    return -1
  }

  let nearestIndex = 0
  let nearestDistance = Infinity

  candles.forEach((candle, index) => {
    const candleTime = Date.parse(
      candle.timestamp,
    )

    const distance = Math.abs(
      candleTime - target,
    )

    if (distance < nearestDistance) {
      nearestDistance = distance
      nearestIndex = index
    }
  })

  return nearestIndex
}

function sessionIndexForTimestamp(
  candles,
  sessions,
  timestamp,
) {
  const candleIndex = nearestCandleIndex(
    candles,
    timestamp,
  )

  if (candleIndex < 0) return -1

  return sessions.indexOf(
    chartSessionKey(
      candles[candleIndex].timestamp,
    ),
  )
}

function selectPaperTradeRange(
  candles,
  range,
  trade,
) {
  const ordered =
    completedChartCandles(candles)

  if (!ordered.length) return []

  if (range === 'ALL') {
    return ordered
  }

  const sessions = [
    ...new Set(
      ordered.map((candle) =>
        chartSessionKey(candle.timestamp),
      ),
    ),
  ]

  const entrySessionIndex =
    sessionIndexForTimestamp(
      ordered,
      sessions,
      trade?.entryTimestamp,
    )

  if (entrySessionIndex < 0) {
    return selectChartRange(
      ordered,
      range === 'TRADE' ? '5D' : range,
    )
  }

  const exitSessionIndex =
    trade?.status === 'closed' &&
    trade?.exitTimestamp
      ? sessionIndexForTimestamp(
          ordered,
          sessions,
          trade.exitTimestamp,
        )
      : entrySessionIndex

  let startIndex
  let endIndex

  if (range === 'TRADE') {
    startIndex = entrySessionIndex - 2

    endIndex =
      Math.max(
        entrySessionIndex,
        exitSessionIndex,
      ) + 2
  } else if (range === '1D') {
    startIndex = entrySessionIndex
    endIndex = entrySessionIndex
  } else if (range === '3D') {
    startIndex = entrySessionIndex - 1
    endIndex = entrySessionIndex + 1
  } else {
    startIndex = entrySessionIndex - 2
    endIndex = entrySessionIndex + 2
  }

  const allowedSessions = new Set(
    sessions.slice(
      Math.max(0, startIndex),
      Math.min(
        sessions.length,
        endIndex + 1,
      ),
    ),
  )

  return ordered.filter((candle) =>
    allowedSessions.has(
      chartSessionKey(candle.timestamp),
    ),
  )
}

export function PaperTradeChart({ trade }) {
  const [candles, setCandles] = useState([])
  const [range, setRange] = useState('TRADE')
  const [hoveredCandle, setHoveredCandle] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const symbol = trade?.symbol

  useEffect(() => {
    if (!symbol) {
      setCandles([])
      setError(null)
      return undefined
    }

    let active = true

    setLoading(true)
    setError(null)

    fetchHistoricalMarketData(
  symbol,
  '1Hour',
  createPaperTradeFetchRange(trade),
)
      .then((data) => {
        if (!active) return

        const completed = completedChartCandles(
          data?.candles ?? [],
        )

        setCandles(completed)

        if (!completed.length) {
          setError(
            'No completed 1-hour candles are available for this symbol.',
          )
        }

        setLoading(false)
      })
      .catch(() => {
        if (!active) return

        setCandles([])
        setError(
          'Price chart data is currently unavailable.',
        )
        setLoading(false)
      })

    return () => {
      active = false
    }
  }, [
  symbol,
  trade?.entryTimestamp,
  trade?.exitTimestamp,
])

  useEffect(() => {
    setHoveredCandle(null)
  }, [range, symbol])

  const visibleCandles = useMemo(
  () =>
    selectPaperTradeRange(
      candles,
      range,
      trade,
    ),
  [candles, range, trade],
)

  const ema9 = useMemo(
    () => calculateEma(candles, 9),
    [candles],
  )

  const ema21 = useMemo(
    () => calculateEma(candles, 21),
    [candles],
  )

  if (!trade) {
    return (
      <div className="paper-trade-chart-state">
        Select a paper trade to view its chart.
      </div>
    )
  }

  if (loading) {
    return (
      <div className="paper-trade-chart-state">
        Loading {symbol} price data…
      </div>
    )
  }

  if (error) {
    return (
      <div className="paper-trade-chart-state">
        {error}
      </div>
    )
  }

  if (visibleCandles.length < 2) {
    return (
      <div className="paper-trade-chart-state">
        Not enough completed candle data to draw this chart.
      </div>
    )
  }

  const width = 900
  const height = 300

  const left = 12
  const right = 92
  const annotationTop = 8
  const priceTop = 34
  const priceBottom = 226
  const volumeTop = 238
  const volumeBottom = 270

  const priceHeight = priceBottom - priceTop
  const volumeHeight = volumeBottom - volumeTop

  const entryPrice = levelValue(trade, [
    'theoreticalEntryPrice',
    'entryPrice',
  ])

  const stopPrice = levelValue(trade, [
    'stopPrice',
  ])

  const targetPrice = levelValue(trade, [
    'targetPrice',
    'profitTarget',
  ])

  const trailingStopPrice = levelValue(trade, [
    'trailingStopPrice',
    'activeTrailingStopPrice',
  ])

  const tradeLevels = [
    entryPrice,
    stopPrice,
    targetPrice,
    trailingStopPrice,
  ].filter((value) => Number.isFinite(value))

  const candleLows = visibleCandles.map(
    (candle) => Number(candle.low),
  )

  const candleHighs = visibleCandles.map(
    (candle) => Number(candle.high),
  )

  const rawLow = Math.min(
    ...candleLows,
    ...tradeLevels,
  )

  const rawHigh = Math.max(
    ...candleHighs,
    ...tradeLevels,
  )

  const rawRange = rawHigh - rawLow
  const pricePadding =
    rawRange > 0 ? rawRange * 0.07 : 1

  const minPrice = rawLow - pricePadding
  const maxPrice = rawHigh + pricePadding
  const priceRange = maxPrice - minPrice

  const yFor = (price) =>
    priceTop +
    ((maxPrice - price) / priceRange) *
      priceHeight

  const step =
    (width - left - right) /
    Math.max(visibleCandles.length, 1)

  const bodyWidth = Math.max(
    2,
    Math.min(9, step * 0.55),
  )

  const xFor = (index) =>
    left + step * index + step / 2

  const signalTimestamp =
  trade?.signalDetectedAt ??
  trade?.signalTimestamp

const signalMarkerIndex =
  nearestCandleIndex(
    visibleCandles,
    signalTimestamp,
  )

  const entryMarkerIndex =
  nearestCandleIndex(
    visibleCandles,
    trade?.entryTimestamp,
  )

const exitMarkerIndex =
  trade?.status === 'closed'
    ? nearestCandleIndex(
        visibleCandles,
        trade?.exitTimestamp,
      )
    : -1

const entryMarkerX =
  entryMarkerIndex >= 0
    ? xFor(entryMarkerIndex)
    : null

    const signalMarkerX =
  signalMarkerIndex >= 0
    ? xFor(signalMarkerIndex)
    : null

const exitMarkerX =
  exitMarkerIndex >= 0
    ? xFor(exitMarkerIndex)
    : null

const tradeWindowStart =
  entryMarkerX ?? null

const tradeWindowEnd =
  exitMarkerX ??
  (entryMarkerX != null
    ? xFor(visibleCandles.length - 1)
    : null)

  const maxVolume = Math.max(
    ...visibleCandles.map((candle) =>
      Number.isFinite(Number(candle.volume))
        ? Number(candle.volume)
        : 0,
    ),
    1,
  )

  const visibleTimestamps = new Set(
    visibleCandles.map((candle) => candle.timestamp),
  )

  const visibleEma9 = ema9.filter((point) =>
    visibleTimestamps.has(point.timestamp),
  )

  const visibleEma21 = ema21.filter((point) =>
    visibleTimestamps.has(point.timestamp),
  )

  const timestampIndex = new Map(
    visibleCandles.map((candle, index) => [
      candle.timestamp,
      index,
    ]),
  )

  const ema9Points = visibleEma9
    .map((point) => {
      const index = timestampIndex.get(point.timestamp)

      return index == null
        ? null
        : `${xFor(index)},${yFor(point.value)}`
    })
    .filter(Boolean)
    .join(' ')

  const ema21Points = visibleEma21
    .map((point) => {
      const index = timestampIndex.get(point.timestamp)

      return index == null
        ? null
        : `${xFor(index)},${yFor(point.value)}`
    })
    .filter(Boolean)
    .join(' ')

  const priceTicks = [0, 0.25, 0.5, 0.75, 1]

  const labelIndexes = [
    0,
    Math.floor((visibleCandles.length - 1) / 2),
    visibleCandles.length - 1,
  ].filter(
    (value, index, array) =>
      value >= 0 && array.indexOf(value) === index,
  )

  const sessionCount = new Set(
    visibleCandles.map((candle) =>
      chartSessionKey(candle.timestamp),
    ),
  ).size

  const renderLevel = (
    price,
    label,
    className,
  ) => {
    if (!Number.isFinite(price)) return null

    const y = yFor(price)

    return (
      <g className={className}>
        <line
          x1={left}
          x2={width - right}
          y1={y}
          y2={y}
          className="paper-trade-level-line"
        />

        <text
          x={width - right + 8}
          y={y + 3}
          textAnchor="start"
          className="paper-trade-level-label"
        >
          {label} {formatPrice(price)}
        </text>
      </g>
    )
  }

  return (
    <div className="paper-trade-chart-shell">
      <div className="paper-trade-chart-toolbar">
        <div>
          <strong>{symbol}</strong>

          <span>
            {sessionCount} trading sessions ·{' '}
            {visibleCandles.length} completed candles · 1H
          </span>
        </div>

        <div className="paper-trade-range-buttons">
          {RANGE_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              className={
                range === option
                  ? 'is-active'
                  : ''
              }
              onClick={() => setRange(option)}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      <div className="paper-trade-chart-legend">
        <span className="signal">Signal</span>
        <span className="ema9">EMA 9</span>
        <span className="ema21">EMA 21</span>

        {entryPrice != null && (
          <span className="entry">Entry</span>
        )}

        {stopPrice != null && (
          <span className="stop">Stop</span>
        )}

        {targetPrice != null && (
          <span className="target">Target</span>
        )}

        {trailingStopPrice != null && (
          <span className="trailing">
            Trailing stop
          </span>
        )}
      </div>

      <div className="paper-trade-hover-readout">
        {hoveredCandle ? (
          <>
            <span>
              {formatCandleTime(
                hoveredCandle.timestamp,
              )}
            </span>

            <span>
              O{' '}
              <strong>
                {formatPrice(hoveredCandle.open)}
              </strong>
            </span>

            <span>
              H{' '}
              <strong>
                {formatPrice(hoveredCandle.high)}
              </strong>
            </span>

            <span>
              L{' '}
              <strong>
                {formatPrice(hoveredCandle.low)}
              </strong>
            </span>

            <span>
              C{' '}
              <strong>
                {formatPrice(hoveredCandle.close)}
              </strong>
            </span>

            <span>
              Vol{' '}
              <strong>
                {formatVolume(
                  hoveredCandle.volume,
                )}
              </strong>
            </span>
          </>
        ) : (
          <span>
            Hover a candle to inspect OHLCV.
          </span>
        )}
      </div>

      <div className="paper-trade-chart">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`${symbol} completed one-hour candlestick chart`}
          onMouseLeave={() =>
            setHoveredCandle(null)
          }
        >
          {priceTicks.map((ratio) => {
            const y =
              priceTop +
              ratio * priceHeight

            const value =
              maxPrice -
              ratio * priceRange

            return (
              <g key={ratio}>
                <line
                  className="paper-trade-grid-line"
                  x1={left}
                  x2={width - right}
                  y1={y}
                  y2={y}
                />

                <text
                  className="paper-trade-price-label"
                  x={width - right + 8}
                  y={y + 3}
                >
                  {value.toFixed(2)}
                </text>
              </g>
            )
          })}

          {tradeWindowStart != null &&
  tradeWindowEnd != null && (
    <rect
      className="paper-trade-active-window"
      x={Math.min(
        tradeWindowStart,
        tradeWindowEnd,
      )}
      y={priceTop}
      width={Math.max(
        Math.abs(
          tradeWindowEnd -
            tradeWindowStart,
        ),
        step,
      )}
      height={priceHeight}
    />
  )}

          {ema21Points && (
            <polyline
              points={ema21Points}
              className="paper-trade-ema21"
            />
          )}

          {ema9Points && (
            <polyline
              points={ema9Points}
              className="paper-trade-ema9"
            />
          )}

          {signalMarkerX != null && (
  <g className="paper-trade-signal-marker">
    <line
      x1={signalMarkerX}
      x2={signalMarkerX}
      y1={priceTop}
      y2={priceBottom}
      className="paper-trade-time-marker"
    />

    <text
      x={signalMarkerX}
      y={annotationTop + 24}
      textAnchor="middle"
      className="paper-trade-time-marker-label"
    >
      SIGNAL
    </text>
  </g>
)}

          {renderLevel(
            entryPrice,
            'Entry',
            'paper-trade-entry-level',
          )}

          {renderLevel(
            stopPrice,
            'Stop',
            'paper-trade-stop-level',
          )}

          {renderLevel(
            targetPrice,
            'Target',
            'paper-trade-target-level',
          )}

          {renderLevel(
            trailingStopPrice,
            'Trail',
            'paper-trade-trailing-level',
          )}

          {visibleCandles.map(
            (candle, index) => {
              const x = xFor(index)

              const openY = yFor(
                Number(candle.open),
              )

              const closeY = yFor(
                Number(candle.close),
              )

              const highY = yFor(
                Number(candle.high),
              )

              const lowY = yFor(
                Number(candle.low),
              )

              const isUp =
                Number(candle.close) >=
                Number(candle.open)

              const bodyY = Math.min(
                openY,
                closeY,
              )

              const bodyHeight = Math.max(
                2,
                Math.abs(closeY - openY),
              )

              const volume =
                Number.isFinite(
                  Number(candle.volume),
                )
                  ? Number(candle.volume)
                  : 0

              const volumeBarHeight =
                (volume / maxVolume) *
                volumeHeight

              return (
                <g
                  key={`${candle.timestamp}-${index}`}
                  className={
                    isUp
                      ? 'paper-chart-candle-up'
                      : 'paper-chart-candle-down'
                  }
                  onMouseEnter={() =>
                    setHoveredCandle(candle)
                  }
                >
                  <rect
                    x={x - step / 2}
                    y={priceTop}
                    width={step}
                    height={
                      volumeBottom -
                      priceTop
                    }
                    fill="transparent"
                  />

                  <line
                    x1={x}
                    x2={x}
                    y1={highY}
                    y2={lowY}
                    stroke="currentColor"
                    strokeWidth="1.3"
                  />

                  <rect
                    x={x - bodyWidth / 2}
                    y={bodyY}
                    width={bodyWidth}
                    height={bodyHeight}
                    fill="currentColor"
                    rx="1"
                  />

                  <rect
                    className="paper-trade-volume-bar"
                    x={x - bodyWidth / 2}
                    y={
                      volumeBottom -
                      volumeBarHeight
                    }
                    width={bodyWidth}
                    height={volumeBarHeight}
                    fill="currentColor"
                  />
                </g>
              )
            },
          )}

          {entryMarkerX != null && (
  <g className="paper-trade-entry-marker">
    <line
      x1={entryMarkerX}
      x2={entryMarkerX}
      y1={priceTop}
      y2={priceBottom}
      className="paper-trade-time-marker"
    />

    <text
  x={entryMarkerX}
  y={annotationTop + 10}
  textAnchor="middle"
  className="paper-trade-time-marker-label"
>
  ENTRY
</text>

    {Number.isFinite(entryPrice) && (
      <circle
        cx={entryMarkerX}
        cy={yFor(entryPrice)}
        r="4"
        className="paper-trade-entry-point"
      />
    )}
  </g>
)}

{exitMarkerX != null && (
  <g className="paper-trade-exit-marker">
    <line
      x1={exitMarkerX}
      x2={exitMarkerX}
      y1={priceTop}
      y2={priceBottom}
      className="paper-trade-time-marker"
    />

   <text
  x={exitMarkerX}
  y={annotationTop + 24}
  textAnchor="middle"
  className="paper-trade-time-marker-label"
>
  EXIT
</text>
  </g>
)}

          <line
            className="paper-trade-volume-divider"
            x1={left}
            x2={width - right}
            y1={volumeTop - 5}
            y2={volumeTop - 5}
          />

          {labelIndexes.map((index) => (
            <text
              key={index}
              className="paper-trade-date-label"
              x={xFor(index)}
              y={292}
              textAnchor={
                index === 0
                  ? 'start'
                  : index ===
                      visibleCandles.length - 1
                    ? 'end'
                    : 'middle'
              }
            >
              {formatChartDate(
                visibleCandles[index]
                  .timestamp,
              )}
            </text>
          ))}
        </svg>
      </div>
    </div>
  )
}