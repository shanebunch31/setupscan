import { scanSetups } from '../logic/scanner.js'

const timeframeMinutes = { '5m': 5, '15m': 15, '1h': 60, '4h': 240, '1D': 1440 }
const average = (values) => values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0

function getMetrics(trades) {
	const wins = trades.filter((trade) => trade.rMultiple > 0)
	const losses = trades.filter((trade) => trade.rMultiple < 0)
	const grossProfit = wins.reduce((total, trade) => total + trade.rMultiple, 0)
	const grossLoss = Math.abs(losses.reduce((total, trade) => total + trade.rMultiple, 0))
	let equity = 0
	let peak = 0
	let maximumDrawdown = 0
	trades.forEach((trade) => {
		equity += trade.rMultiple
		peak = Math.max(peak, equity)
		maximumDrawdown = Math.max(maximumDrawdown, peak - equity)
	})
	const rValues = trades.map((trade) => trade.rMultiple)
	const averageWinner = average(wins.map((trade) => trade.rMultiple))
	const averageLoser = average(losses.map((trade) => trade.rMultiple))
	const holdingMinutes = trades.map((trade) => trade.holdingBars * (timeframeMinutes[trade.timeframe] || 60))
	return {
		totalTrades: trades.length,
		numberOfTrades: trades.length,
		winningTrades: wins.length,
		losingTrades: losses.length,
		expiredTrades: trades.filter((trade) => trade.exitReason === 'Expired').length,
		totalPositiveR: grossProfit,
		totalNegativeR: -grossLoss,
		winRate: trades.length ? wins.length / trades.length : 0,
		averageWinner,
		averageLoser,
		averageR: average(rValues),
		expectancy: (wins.length / (trades.length || 1)) * averageWinner + (losses.length / (trades.length || 1)) * averageLoser,
		profitFactor: grossLoss ? grossProfit / grossLoss : grossProfit ? Infinity : 0,
		calculatedProfitFactor: grossLoss ? grossProfit / grossLoss : grossProfit ? Infinity : 0,
		calculatedExpectancy: (wins.length / (trades.length || 1)) * averageWinner + (losses.length / (trades.length || 1)) * averageLoser,
		maximumDrawdown,
		averageHoldingTime: average(holdingMinutes),
		averageHoldingBars: average(trades.map((trade) => trade.holdingBars)),
		netReturn: rValues.reduce((total, value) => total + value, 0),
	}
}

function createTrade(signal, entryCandle, candles, signalIndex, settings) {
	const entryPrice = entryCandle.open ?? entryCandle.close
	const risk = settings.stopDistance ?? entryPrice * settings.stopDistancePercent
	const stopPrice = entryPrice - risk
	const targetPrice = entryPrice + (settings.targetDistance ?? risk * settings.targetR)
	const maxBars = Math.min(settings.maxHoldingBars, candles.length - signalIndex - 1)
	let maximumFavorableExcursion = 0
	let maximumAdverseExcursion = 0
	let exitReason = 'Expired'
	let exitPrice = candles[signalIndex + maxBars]?.close ?? entryPrice
	let holdingBars = maxBars
	for (let offset = 1; offset <= maxBars; offset += 1) {
		const candle = candles[signalIndex + offset]
		maximumFavorableExcursion = Math.max(maximumFavorableExcursion, candle.high - entryPrice)
		maximumAdverseExcursion = Math.min(maximumAdverseExcursion, candle.low - entryPrice)
		if (candle.low <= stopPrice) { exitReason = 'Stop'; exitPrice = stopPrice; holdingBars = offset; break }
		if (candle.high >= targetPrice) { exitReason = 'Target'; exitPrice = targetPrice; holdingBars = offset; break }
	}
	const rMultiple = (exitPrice - entryPrice) / risk
	return {
		symbol: signal.symbol,
		timeframe: signal.timeframe,
		timestamp: signal.timestamp,
		setupType: signal.setupType,
		score: signal.score,
		entryPrice,
		stopPrice,
		targetPrice,
		exitPrice,
		outcome: rMultiple > 0 ? 'Win' : rMultiple < 0 ? 'Loss' : 'Breakeven',
		exitReason,
		rMultiple,
		maximumFavorableExcursion,
		maximumAdverseExcursion,
		holdingTime: holdingBars * (timeframeMinutes[signal.timeframe] || 60),
		holdingBars,
	}
}

export function runSetupScanBacktest(candles, settings = {}) {
	const options = { minimumScore: 65, stopDistance: null, targetDistance: null, stopDistancePercent: 0.005, targetR: 2, maxHoldingBars: 12, splitRatio: 0.7, ...settings }
	const splitIndex = options.splitIndex ?? Math.floor(candles.length * options.splitRatio)
	const signals = scanSetups(candles)
	const trades = signals.map((signal) => ({ signal, index: candles.findIndex((candle) => candle.timestamp === signal.timestamp) })).filter(({ signal, index }) => signal.score >= options.minimumScore && signal.status === 'Bullish' && index >= 0 && index < candles.length - 1).map(({ signal, index }) => createTrade(signal, candles[index + 1], candles, index, options)).sort((a, b) => a.timestamp.localeCompare(b.timestamp))
	const inSample = trades.filter((trade) => candles.findIndex((candle) => candle.timestamp === trade.timestamp) < splitIndex)
	const outOfSample = trades.filter((trade) => !inSample.includes(trade))
	return { candles, settings: { ...options, splitIndex }, trades, partitions: { inSample, outOfSample }, metrics: getMetrics(trades), inSampleMetrics: getMetrics(inSample), outOfSampleMetrics: getMetrics(outOfSample) }
}