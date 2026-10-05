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
  ? Date.parse(coveredEnd)
  : NaN

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
            start: covered.actualStart,
            end: covered.actualEnd,
            candleCount: covered.candleCount,
            requestedStart: start,
            requestedEnd: end,
            minimumExpectedCandles: 0,
            complete: covered.complete,
            candles: covered.candles,
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

        const mergedCandles = [...mergedByTime.values()].sort(
          (a, b) =>
            String(getCandleTime(a)).localeCompare(
              String(getCandleTime(b)),
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
          start:
            covered.actualStart ??
            tailData.start,
          end:
            tailData.end ??
            covered.actualEnd,
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

  const data =
    await fetchHistoricalMarketBars({
      symbol,
      timeframe,
      start,
      end,
    })

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