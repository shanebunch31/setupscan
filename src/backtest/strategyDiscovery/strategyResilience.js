import {
  strategyDiscoveryCostTiers,
  strategyDiscoveryResearchWindows,
} from './discoveryMetrics.js'

export const RESILIENCE_DIMENSIONS = Object.freeze([
  'timeStability',
  'marketStability',
  'costResilience',
  'parameterStability',
  'regimeStability',
])

export const RESILIENCE_MIN_EVIDENCE = 100

function average(values) {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0
}

function summarizeTrades(trades) {
  const resolved = trades.filter(
    (trade) => Number.isFinite(trade.rMultiple),
  )

  const wins = resolved.filter((trade) => trade.rMultiple > 0)
  const losses = resolved.filter((trade) => trade.rMultiple < 0)

  const grossProfit = wins.reduce(
    (sum, trade) => sum + trade.rMultiple,
    0,
  )

  const grossLoss = Math.abs(
    losses.reduce((sum, trade) => sum + trade.rMultiple, 0),
  )

  let equity = 0
  let peak = 0
  let maximumDrawdown = 0

  resolved
    .slice()
    .sort(
      (a, b) =>
        new Date(a.timestamp).getTime() -
        new Date(b.timestamp).getTime(),
    )
    .forEach((trade) => {
      equity += trade.rMultiple
      peak = Math.max(peak, equity)
      maximumDrawdown = Math.max(
        maximumDrawdown,
        peak - equity,
      )
    })

  return {
    occurrenceCount: resolved.length,
    winRate: resolved.length
      ? wins.length / resolved.length
      : 0,
    profitFactor: grossLoss
      ? grossProfit / grossLoss
      : grossProfit
        ? Infinity
        : 0,
    expectancy: average(
      resolved.map((trade) => trade.rMultiple),
    ),
    averageR: average(
      resolved.map((trade) => trade.rMultiple),
    ),
    totalR: resolved.reduce(
      (sum, trade) => sum + trade.rMultiple,
      0,
    ),
    maximumDrawdown,
    lowEvidence:
      resolved.length < RESILIENCE_MIN_EVIDENCE,
  }
}

function groupTrades(trades, keyFn) {
  const groups = new Map()

  trades.forEach((trade) => {
    const key = keyFn(trade)

    if (!key) return

    if (!groups.has(key)) {
      groups.set(key, [])
    }

    groups.get(key).push(trade)
  })

  return [...groups.entries()]
    .sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    )
    .map(([label, groupedTrades]) => ({
      label,
      metrics: summarizeTrades(groupedTrades),
    }))
}

function classifyPeriod(timestamp) {
  const time = new Date(timestamp).getTime()

  for (const period of Object.values(
    strategyDiscoveryResearchWindows,
  )) {
    const start = new Date(period.start).getTime()
    const end = period.end
      ? new Date(period.end).getTime()
      : Infinity

    if (time >= start && time <= end) {
      return period.label
    }
  }

  return null
}

function deriveRisk(trade) {
  if (
    Number.isFinite(trade.entryPrice) &&
    Number.isFinite(trade.initialStopPrice)
  ) {
    return Math.abs(
      trade.entryPrice - trade.initialStopPrice,
    )
  }

  if (
    Number.isFinite(trade.entryPrice) &&
    Number.isFinite(trade.stopPrice)
  ) {
    return Math.abs(
      trade.entryPrice - trade.stopPrice,
    )
  }

  return null
}

function costAdjustedR(trade, tier) {
  const risk = deriveRisk(trade)

  if (
    risk === null ||
    !Number.isFinite(trade.entryPrice) ||
    !Number.isFinite(trade.rMultiple)
  ) {
    return null
  }

  const costPrice =
    trade.entryPrice *
    ((tier.entryBps + tier.exitBps) / 10000)

  return trade.rMultiple - costPrice / risk
}

function summarizeCostTier(trades, tier) {
  const values = trades
    .map((trade) => costAdjustedR(trade, tier))
    .filter((value) => Number.isFinite(value))

  return {
    label: tier.label,
    entryBps: tier.entryBps,
    exitBps: tier.exitBps,
    metrics: {
      occurrenceCount: values.length,
      expectancy: average(values),
      averageR: average(values),
      totalR: values.reduce(
        (sum, value) => sum + value,
        0,
      ),
      winRate: values.length
        ? values.filter((value) => value > 0).length /
          values.length
        : 0,
      lowEvidence:
        values.length < RESILIENCE_MIN_EVIDENCE,
    },
  }
}

function summarizeDimensionGroups(groups) {
  if (!groups.length) {
    return {
      status: 'Not assessed',
      groups: [],
    }
  }

  return {
    status: 'Measured',
    groups,
  }
}

/**
 * Builds a descriptive Strategy Resilience profile.
 *
 * No dimension is converted into a single resilience score.
 * The result reports the underlying evidence so it can be reviewed
 * without hiding instability behind one number.
 *
 * `candidateVariants` should contain alternate parameter/exit versions
 * of the same candidate strategy:
 *   [{ id, label, trades }]
 *
 * `regimeByTimestamp` is optional. When supplied, it should map a trade
 * timestamp to a causal regime label that was known by the signal time.
 */
export function buildStrategyResilience({
  trades = [],
  candidateVariants = [],
  regimeByTimestamp = null,
} = {}) {
  const normalizedTrades = trades
    .map((trade) => ({
      ...trade,
      period: classifyPeriod(
        trade.entryTimestamp ??
          trade.timestamp,
      ),
    }))
    .filter(
      (trade) =>
        Number.isFinite(trade.rMultiple),
    )

  const timeGroups = groupTrades(
    normalizedTrades,
    (trade) => trade.period,
  )

  const marketGroups = groupTrades(
    normalizedTrades,
    (trade) => trade.symbol,
  )

  const costGroups = strategyDiscoveryCostTiers.map(
    (tier) =>
      summarizeCostTier(
        normalizedTrades,
        tier,
      ),
  )

  const parameterGroups = candidateVariants.map(
    (variant) => ({
      label: variant.label ?? variant.id,
      metrics: summarizeTrades(
        variant.trades ?? [],
      ),
    }),
  )

  const regimeGroups =
    regimeByTimestamp
      ? groupTrades(
          normalizedTrades,
          (trade) =>
            regimeByTimestamp[
              trade.entryTimestamp ??
                trade.timestamp
            ] ?? null,
        )
      : []

  return {
    candidate: {
      occurrenceCount: normalizedTrades.length,
      lowEvidence:
        normalizedTrades.length <
        RESILIENCE_MIN_EVIDENCE,
    },

    timeStability: summarizeDimensionGroups(
      timeGroups,
    ),

    marketStability: summarizeDimensionGroups(
      marketGroups,
    ),

    costResilience: {
      status: normalizedTrades.length
        ? 'Measured'
        : 'Not assessed',
      tiers: costGroups,
    },

    parameterStability:
      summarizeDimensionGroups(
        parameterGroups,
      ),

    regimeStability:
      summarizeDimensionGroups(
        regimeGroups,
      ),

    definitions: {
      researchWindows:
        strategyDiscoveryResearchWindows,
      costTiers:
        strategyDiscoveryCostTiers,
      minimumEvidence:
        RESILIENCE_MIN_EVIDENCE,
    },
  }
}