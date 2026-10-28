import React, { useEffect, useState } from 'react'
import {
  enrichHistoricalCandles,
  fetchHistoricalMarketData,
} from './data/marketData.js'
import { createScannerRange } from './data/scannerSnapshot.js'

const MARKET_SYMBOLS = ['SPY', 'QQQ', 'IWM']
const HOUR_MS = 60 * 60 * 1000
const REFRESH_MS = 15 * 60 * 1000

const formatPrice = (value) =>
  Number.isFinite(value) ? `$${value.toFixed(2)}` : '—'

async function loadMarketSnapshot(symbol) {
  try {
    const data = await fetchHistoricalMarketData(
      symbol,
      '1Hour',
      createScannerRange(),
    )

    if (data?.complete === false) {
      return {
        symbol,
        available: false,
      }
    }

    const nowMs = Date.now()

    const completedCandles = (data?.candles ?? []).filter(
      (candle) => {
        const candleStart = new Date(
          candle.timestamp,
        ).getTime()

        return (
          Number.isFinite(candleStart) &&
          candleStart + HOUR_MS <= nowMs
        )
      },
    )

    if (!completedCandles.length) {
      return {
        symbol,
        available: false,
      }
    }

    const enriched = enrichHistoricalCandles(
      completedCandles,
      '1Hour',
    )

    const latest = enriched.at(-1)
    const previous = enriched.at(-2) ?? latest

    if (
      !latest ||
      !Number.isFinite(latest.close)
    ) {
      return {
        symbol,
        available: false,
      }
    }

    const change =
      Number.isFinite(previous?.close) &&
      previous.close !== 0
        ? ((latest.close - previous.close) /
            previous.close) *
          100
        : 0

    return {
      symbol,
      available: true,
      price: latest.close,
      change,
      timestamp: latest.timestamp,
    }
  } catch {
    return {
      symbol,
      available: false,
    }
  }
}

export function MarketSnapshotStrip() {
  const [snapshots, setSnapshots] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true

    async function refresh() {
      setLoading(true)

      const nextSnapshots = await Promise.all(
        MARKET_SYMBOLS.map(loadMarketSnapshot),
      )

      if (!active) return

      setSnapshots(nextSnapshots)
      setLoading(false)
    }

    refresh()

    const timer = setInterval(
      refresh,
      REFRESH_MS,
    )

    return () => {
      active = false
      clearInterval(timer)
    }
  }, [])

  const availableCount = snapshots.filter(
    (snapshot) => snapshot.available,
  ).length

  const health =
    loading
      ? 'loading'
      : availableCount === MARKET_SYMBOLS.length
        ? 'healthy'
        : availableCount > 0
          ? 'partial'
          : 'unavailable'

  const healthLabel =
    loading
      ? 'Market data loading'
      : health === 'healthy'
        ? 'Market data healthy'
        : health === 'partial'
          ? 'Market data partial'
          : 'Market data unavailable'

  return (
    <div className="topbar-market-context">
      <div
        className="topbar-market-snapshots"
        aria-label="Latest completed one-hour market snapshots"
      >
        {MARKET_SYMBOLS.map((symbol) => {
          const snapshot = snapshots.find(
            (item) => item.symbol === symbol,
          )

          const available =
            snapshot?.available === true

          return (
            <div
              className="topbar-market-snapshot"
              key={symbol}
              title="Latest completed 1-hour candle compared with the previous completed 1-hour candle."
            >
              <div>
                <strong>{symbol}</strong>
                <small>1H</small>
              </div>

              <span>
                {available
                  ? formatPrice(snapshot.price)
                  : '—'}
              </span>

              <em
                className={
                  available &&
                  snapshot.change >= 0
                    ? 'positive'
                    : available
                      ? 'negative'
                      : ''
                }
              >
                {available
                  ? `${snapshot.change >= 0 ? '+' : ''}${snapshot.change.toFixed(2)}%`
                  : 'Unavailable'}
              </em>
            </div>
          )
        })}
      </div>

      <div
        className={`topbar-data-health ${health}`}
        title={healthLabel}
      >
        <span
          className="status-dot"
          aria-hidden="true"
        />

        <span>{healthLabel}</span>
      </div>
    </div>
  )
}