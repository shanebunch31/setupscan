/**
 * Creates the chart and accessible-table observations from the simulator's existing trade order.
 * This is a presentation adapter only: it neither filters nor reorders trades.
 */
export function buildCumulativeRObservations(trades = []) {
  let cumulativeR = 0
  let cumulativeAvailable = true

  return trades.map((trade, index) => {
    const rMultiple = Number.isFinite(trade?.rMultiple) ? trade.rMultiple : null
    if (rMultiple === null) cumulativeAvailable = false
    else if (cumulativeAvailable) cumulativeR += rMultiple

    return {
      sequence: index + 1,
      timestamp: trade?.timestamp ?? null,
      rMultiple,
      cumulativeR: cumulativeAvailable ? cumulativeR : null,
    }
  })
}
