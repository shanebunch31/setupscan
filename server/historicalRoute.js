import { candleCompletesBy, historicalCandleEndTime } from '../src/data/historicalDataContract.js'

function isWeekendOnlyGap(fromTimestamp, toTimestamp) {
  const fromMs = Date.parse(fromTimestamp)
  const toMs = Date.parse(toTimestamp)

  if (
    !Number.isFinite(fromMs) ||
    !Number.isFinite(toMs) ||
    toMs <= fromMs
  ) {
    return false
  }

  const cursor = new Date(fromMs)
  cursor.setUTCHours(0, 0, 0, 0)
  cursor.setUTCDate(cursor.getUTCDate() + 1)

  const target = new Date(toMs)
  target.setUTCHours(0, 0, 0, 0)

  while (cursor <= target) {
    const day = cursor.getUTCDay()

    if (day !== 0 && day !== 6) {
      return false
    }

    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }

  return true
}
export async function handleHistoricalRoute({
  response,
  url,
  fetchHistoricalMarketBars,
  researchRunStore,
  sendJson,
  createHistoricalCacheKey,
}) {
  const symbol =
    url.searchParams.get('symbol') || 'SPY'

  const timeframe =
    url.searchParams.get('timeframe') || '1Hour'

  const start =
    url.searchParams.get('start') || undefined

  const end =
    url.searchParams.get('end') || undefined

  const filterCandlesToRange = (candles = []) => {
    return candles.filter((candle) => {
      const timestamp =
        candle?.timestamp ??
        candle?.t ??
        candle?.time ??
        null

      const timeMs = Date.parse(timestamp)

      if (!Number.isFinite(timeMs)) return false

      if (start && timeMs < Date.parse(start)) return false
      if (end && !candleCompletesBy(candle, timeframe, end)) return false

      return true
    })
  }


  try {
      const cacheKey = createHistoricalCacheKey({
      symbol,
      timeframe,
      adjustmentMode: 'split',
    })

  if (researchRunStore) {
    if (
      typeof researchRunStore
        .findResearchHistoricalCacheCoverage === 'function'
    ) {
      const covered =
        await researchRunStore.findResearchHistoricalCacheCoverage({
          symbol,
          timeframe,
          adjustmentMode: 'split',
          requestedStart: start,
        })

      if (covered?.complete) {
        const coveredEnd =
  covered.actualEnd || covered.requestedEnd

const coveredEndMs = coveredEnd
  ? historicalCandleEndTime(coveredEnd, timeframe)
  : null

const requestedEndMs = end
  ? Date.parse(end)
  : NaN

if (
  !end ||
  !coveredEnd ||
  isWeekendOnlyGap(coveredEnd, end) ||
  (
    Number.isFinite(coveredEndMs) &&
    Number.isFinite(requestedEndMs) &&
    coveredEndMs >= requestedEndMs
  )
) {
          sendJson(response, 200, {
            provider: covered.provider,
            symbol: covered.symbol,
            timeframe: covered.timeframe,
            adjustmentMode: covered.adjustmentMode,
            start:
              filterCandlesToRange(covered.candles)[0]?.timestamp ??
              covered.actualStart,
            end:
              filterCandlesToRange(covered.candles).at(-1)?.timestamp ??
              covered.actualEnd,
            candleCount: filterCandlesToRange(covered.candles).length,
            requestedStart: start,
            requestedEnd: end,
            minimumExpectedCandles: 0,
            complete: covered.complete,
            candles: filterCandlesToRange(covered.candles),
          })

          return
        }

        const tailData =
          await fetchHistoricalMarketBars({
            symbol,
            timeframe,
            start: coveredEnd,
            end,
          })

        const getCandleTime = (candle) =>
          candle?.timestamp ??
          candle?.t ??
          candle?.time ??
          null

        const mergedByTime = new Map()

        for (const candle of [
          ...(covered.candles ?? []),
          ...(tailData.candles ?? []),
        ]) {
          const timestamp = getCandleTime(candle)
          const key =
            timestamp ?? JSON.stringify(candle)

          mergedByTime.set(key, candle)
        }

                const mergedCandles = filterCandlesToRange(
          [...mergedByTime.values()].sort(
            (a, b) =>
              String(getCandleTime(a)).localeCompare(
                String(getCandleTime(b)),
              ),
          ),
        )

        const mergedData = {
          ...tailData,
          provider:
            tailData.provider ?? covered.provider,
          symbol,
          timeframe,
          adjustmentMode:
            tailData.adjustmentMode ??
            covered.adjustmentMode,
          start: mergedCandles[0]?.timestamp ?? null,
          end: mergedCandles.at(-1)?.timestamp ?? null,
          requestedStart: start,
          requestedEnd: end,
          candleCount: mergedCandles.length,
          complete:
            Boolean(tailData.complete),
          candles: mergedCandles,
        }

        if (mergedData.complete) {
          await researchRunStore.saveResearchHistoricalCache({
            cacheKey,
            provider: mergedData.provider,
            symbol: mergedData.symbol,
            timeframe: mergedData.timeframe,
            adjustmentMode:
              mergedData.adjustmentMode,
            requestedStart:
              mergedData.requestedStart,
            requestedEnd:
              mergedData.requestedEnd,
            actualStart:
              mergedData.start,
            actualEnd:
              mergedData.end,
            candleCount:
              mergedData.candleCount,
            complete:
              mergedData.complete,
            candles:
              mergedData.candles,
          })
        }

        sendJson(response, 200, mergedData)
        return
      }
    }
  }

  const fetchedData =
    await fetchHistoricalMarketBars({
      symbol,
      timeframe,
      start,
      end,
    })

  const responseCandles = filterCandlesToRange(fetchedData.candles ?? [])
  const data = {
    ...fetchedData,
    start: responseCandles[0]?.timestamp ?? null,
    end: responseCandles.at(-1)?.timestamp ?? null,
    candleCount: responseCandles.length,
    candles: responseCandles,
  }

  if (researchRunStore && data.complete) {
    await researchRunStore.saveResearchHistoricalCache({
      cacheKey,
      provider: data.provider,
      symbol: data.symbol,
      timeframe: data.timeframe,
      adjustmentMode: data.adjustmentMode,
      requestedStart: data.requestedStart,
      requestedEnd: data.requestedEnd,
      actualStart: data.start,
      actualEnd: data.end,
      candleCount: data.candleCount,
      complete: data.complete,
      candles: data.candles,
    })
  }
    sendJson(response, 200, data)
  } catch (error) {
    const status =
      error.code === 'MISSING_ALPACA_ENV'
        ? 503
        : error.status || 502

    sendJson(response, status, {
      error: error.message,
    })
  }
}
