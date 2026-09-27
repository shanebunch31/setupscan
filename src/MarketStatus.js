import React from 'react'
import { isRegularSession } from '../server/marketSession.js'
import { formatMarketTime } from './marketTime.js'

const h = React.createElement

export function MarketStatus({ now = new Date() }) {
  const regularSession = isRegularSession(now)
  return h('div', { className: 'market-status', 'data-testid': 'market-status' },
    h('span', { className: `status-dot ${regularSession ? 'is-open' : 'is-closed'}`, 'aria-hidden': true }),
    regularSession ? 'Regular Session' : 'Outside Regular Session',
    h('span', { className: 'market-time' }, formatMarketTime(now)),
  )
}