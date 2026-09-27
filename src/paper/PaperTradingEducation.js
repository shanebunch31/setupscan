import React from 'react'
import { TermHelp } from '../TermHelp.js'

const h = React.createElement
const dollars = (value) => `$${Number(value).toLocaleString('en-US')}`

export function PaperTradingEducation({ account = {} }) {
  const risk = account.riskPerTrade ?? 100
  const equity = account.startingEquity ?? 10000
  return h('p', { className: 'paper-learning-note' },
    'Real market bars, simulated trades, no orders or real money. ',
    `In this paper model, 1R = ${dollars(risk)} planned risk and starting paper equity = ${dollars(equity)}. Hypothetical P&L is not actual money.`,
  )
}

export function PaperMetricLabel({ label, explanation }) {
  return h('span', null, label, h(TermHelp, { term: label, explanation }))
}

const formatR = (value) => `${value === Infinity ? '∞' : value.toFixed(2)}R`
const formatMoney = (value) => `$${value.toFixed(2)}`
const formatPercent = (value) => `${(value * 100).toFixed(1)}%`

export function PaperMetrics({ metrics }) {
  return h(React.Fragment, null,
    h('div', { className: 'paper-metrics paper-metrics-headline' },
      h('div', null, h('span', null, 'Total trades'), h('strong', null, metrics.totalTrades)),
      h('div', null, h('span', null, 'Wins / losses'), h('strong', null, `${metrics.wins} / ${metrics.losses}`)),
      h('div', null, h('span', null, h(PaperMetricLabel, { label: 'Win rate', explanation: 'Share of closed trades with a positive R result.' })), h('strong', null, formatPercent(metrics.winRate))),
      h('div', null, h('span', null, h(PaperMetricLabel, { label: 'Hypothetical P&L', explanation: 'Simulated results using the paper-trading assumptions; not real money.' })), h('strong', null, formatMoney(metrics.cumulativePnl))),
    ),
    h('details', { className: 'paper-metric-details' },
      h('summary', null, 'More metrics'),
      h('div', { className: 'paper-metrics' },
        h('div', null, h('span', null, h(PaperMetricLabel, { label: 'Profit factor', explanation: 'Total gains divided by total losses in this sample.' })), h('strong', null, metrics.profitFactor === Infinity ? '∞' : metrics.profitFactor.toFixed(2))),
        h('div', null, h('span', null, h(PaperMetricLabel, { label: 'Expectancy', explanation: 'Average R result per closed trade in this journal.' })), h('strong', null, formatR(metrics.expectancy))),
        h('div', null, h('span', null, h(PaperMetricLabel, { label: 'Average R', explanation: 'Average result per closed trade, measured in units of planned risk.' })), h('strong', null, formatR(metrics.averageR))),
        h('div', null, h('span', null, h(PaperMetricLabel, { label: 'Max drawdown', explanation: 'Largest drop from a previous paper-equity high.' })), h('strong', null, formatMoney(metrics.maximumDrawdown))),
        h('div', null, h('span', null, 'Paper equity'), h('strong', null, formatMoney(metrics.currentEquity))),
        h('div', null, h('span', null, h(PaperMetricLabel, { label: 'Cumulative R', explanation: 'Closed-trade R results added together.' })), h('strong', null, formatR(metrics.cumulativeR))),
      ),
    ),
  )
}