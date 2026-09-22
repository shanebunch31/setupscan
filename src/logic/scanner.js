function scoreItem(item) {
  const reasons = []
  let score = 0
  const aboveVwap = item.price > item.vwap
  reasons.push({ label: 'Price vs VWAP', points: aboveVwap ? 20 : 0, detail: aboveVwap ? 'Trading above session VWAP, showing buyer control.' : 'Trading below session VWAP, limiting long-side conviction.' }); if (aboveVwap) score += 20
  const emaAligned = item.ema9 > item.ema21
  reasons.push({ label: 'EMA alignment', points: emaAligned ? 20 : 0, detail: emaAligned ? 'Fast EMA is above the slow EMA.' : 'Fast EMA remains below the slow EMA.' }); if (emaAligned) score += 20
  const rsiPoints = item.rsi >= 55 && item.rsi <= 70 ? 15 : item.rsi >= 45 ? 8 : 0
  reasons.push({ label: 'RSI momentum', points: rsiPoints, detail: rsiPoints === 15 ? `RSI ${item.rsi} supports momentum without being extended.` : `RSI ${item.rsi} is not in the preferred momentum range.` }); score += rsiPoints
  const volumePoints = item.relativeVolume >= 1.2 ? 15 : item.relativeVolume >= 1 ? 8 : 0
  reasons.push({ label: 'Relative volume', points: volumePoints, detail: volumePoints === 15 ? `${item.relativeVolume.toFixed(2)}x average volume confirms participation.` : `Volume at ${item.relativeVolume.toFixed(2)}x average is a softer confirmation.` }); score += volumePoints
  reasons.push({ label: 'Breakout / reclaim', points: item.breakout ? 15 : 0, detail: item.breakout ? 'Recent price action reclaimed a key range.' : 'No recent breakout or reclaim detected.' }); if (item.breakout) score += 15
  reasons.push({ label: 'Trend confirmation', points: item.trend === 'Bullish' ? 15 : 0, detail: item.trend === 'Bullish' ? 'Short-term structure confirms the directional bias.' : 'Trend structure is not confirming a long setup.' }); if (item.trend === 'Bullish') score += 15
  const status = score >= 75 ? 'Bullish' : score <= 40 ? 'No Setup' : 'Bearish'
  return { ...item, score, status, setupType: status === 'Bullish' ? (item.breakout ? 'Breakout reclaim' : 'Trend continuation') : 'Conditions incomplete', reasons }
}
export function scanSetups(snapshot) { return snapshot.map(scoreItem).sort((a, b) => b.score - a.score) }