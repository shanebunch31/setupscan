import { mkdir, writeFile } from 'node:fs/promises'
import { fetchAlpacaHistoricalBars } from '../server/alpacaProxy.js'
import {
  buildMarketWideContext,
  marketContextResearchEnd,
  marketContextResearchStart,
  marketContextSymbols,
  marketContextTimeframe,
} from '../src/backtest/marketContext.js'

const outputPath = 'data/historical-market-context/market-wide/context.json'
const rawSeriesBySymbol = {}
const retrievalAtBySymbol = {}
const sourceResults = {}

for (const symbol of marketContextSymbols) {
  const result = await fetchAlpacaHistoricalBars({
    symbol,
    timeframe: marketContextTimeframe,
    start: marketContextResearchStart,
    end: marketContextResearchEnd,
  })
  rawSeriesBySymbol[symbol] = result.candles
  retrievalAtBySymbol[symbol] = new Date().toISOString()
  sourceResults[symbol] = {
    provider: result.provider,
    candleCount: result.candleCount,
    firstTimestamp: result.start,
    lastTimestamp: result.end,
    requestedStart: result.requestedStart,
    requestedEnd: result.requestedEnd,
    complete: result.complete,
  }
}

const context = buildMarketWideContext(rawSeriesBySymbol, { retrievalAtBySymbol })
context.metadata.sourceResults = sourceResults
context.metadata.retrievalMethod = 'server/alpacaProxy.js fetchAlpacaHistoricalBars'
context.metadata.retrievalRange = {
  start: marketContextResearchStart,
  end: marketContextResearchEnd,
}

await mkdir('data/historical-market-context/market-wide', { recursive: true })
await writeFile(outputPath, `${JSON.stringify(context, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({ outputPath, sourceResults, synchronizedTimestampCount: context.metadata.synchronizedTimestampCount, incompleteCoverageCount: context.metadata.incompleteCoverageCount }))