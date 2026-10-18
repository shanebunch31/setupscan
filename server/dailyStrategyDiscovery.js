import { createDailyResearchMarketDataFetcher } from './dailyResearchMarketData.js'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { runResearch } from '../src/research/runResearch.js'
import { createResearchRunStore } from './researchRunStore.js'

export const DAILY_DISCOVERY_SYMBOLS = ['SPY', 'QQQ', 'IWM']
export const DAILY_DISCOVERY_TIMEFRAME = '1Hour'
export const DAILY_DISCOVERY_EXPERIMENTS = ['strategy-discovery']

const ONE_DAY_MS = 24 * 60 * 60 * 1000
const ONE_YEAR_DAYS = 365

/**
 * Runs the existing Strategy Discovery experiment and persists its
 * composed research result. Dependencies can be replaced in tests.
 */
export async function runDailyStrategyDiscovery({
  runResearchFn = runResearch,
  store,
  now = () => new Date(),
} = {}) {
  if (!store || typeof store.saveResearchRun !== 'function') {
    throw new Error(
      'Daily Strategy Discovery requires a store with saveResearchRun().',
    )
  }

  const end = now()
  if (!(end instanceof Date) || !Number.isFinite(end.getTime())) {
    throw new Error('Daily Strategy Discovery requires a valid current date.')
  }

  const start = new Date(
    end.getTime() - ONE_YEAR_DAYS * ONE_DAY_MS,
  )

  const result = await runResearchFn({
    symbols: [...DAILY_DISCOVERY_SYMBOLS],
    timeframe: DAILY_DISCOVERY_TIMEFRAME,
    requestedStart: start.toISOString(),
    requestedEnd: end.toISOString(),
    requestedExperiments: [...DAILY_DISCOVERY_EXPERIMENTS],
  })

  if (!result || !result.runContext || !Array.isArray(result.experimentResults)) {
    throw new Error('Research returned an invalid result; it was not saved.')
  }

  // Preserve partial/unavailable outcomes for review, but never describe
  // them as successful research.
  const saved = await store.saveResearchRun(result)

  return {
    runId: result.runContext.runId,
    status: result.status,
    fetchStatus: result.fetchStatus,
    experimentResults: result.experimentResults.map(
      ({ experimentId, status }) => ({ experimentId, status }),
    ),
    persistence: saved,
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL is required. Configure the PostgreSQL connection before running daily research.',
    )
  }

  const store = createResearchRunStore()

  try {
    const fetchHistoricalMarketData =
  createDailyResearchMarketDataFetcher({ store })

const summary = await runDailyStrategyDiscovery({
  store,
  runResearchFn: (request) =>
    runResearch(request, { fetchHistoricalMarketData }),
})
    console.log('Daily Strategy Discovery finished:')
    console.log(JSON.stringify(summary, null, 2))

    if (
      summary.status !== 'completed' ||
      summary.fetchStatus !== 'complete' ||
      summary.experimentResults.some((item) => item.status !== 'succeeded')
    ) {
      process.exitCode = 1
    }
  } finally {
    await store.pool.end()
  }
}

const isDirectExecution =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href

if (isDirectExecution) {
  main().catch((error) => {
    console.error('Daily Strategy Discovery failed:', error.message)
    process.exitCode = 1
  })
}
