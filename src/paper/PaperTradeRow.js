import React from 'react'
import { TermHelp } from '../TermHelp.js'

const h = React.createElement
const formatR = (value) => `${value === Infinity ? '∞' : value.toFixed(2)}R`
const formatMoney = (value) => `$${value.toFixed(2)}`

export function PaperTradeRow({ row }) {
  const { trade } = row
  return h('tr', null,
    h('td', null, trade.symbol),
    h('td', null, row.signalTime),
    h('td', null, row.entryTime),
    h('td', null, trade.signalScore),
    h('td', null, trade.setupType),
    h('td', null, formatMoney(trade.theoreticalEntryPrice)),
    h(
  'td',
  null,
  trade.stopPrice == null
    ? '—'
    : formatMoney(trade.stopPrice),
),
h(
  'td',
  null,
  trade.trailingStopActive
    ? 'Trailing active'
    : 'Initial stop',
),
    h('td', null,
      row.exitLabel,
      row.exitLabel === 'Expired' ? h(TermHelp, { term: 'Expired', explanation: "The simulated holding limit was reached." }) : null,
      row.exitReason ? ` · ${row.exitReason}` : '',
    ),
    h('td', null, row.exitTime ?? '—'),
    h('td', null, trade.rMultiple === null ? '—' : formatR(trade.rMultiple)),
    h('td', null, trade.pnl === null ? '—' : formatMoney(trade.pnl)),
  )
}