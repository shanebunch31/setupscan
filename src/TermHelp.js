import React from 'react'
import { CircleHelp } from 'lucide-react'

const h = React.createElement

export function TermHelp({ term, explanation }) {
  const label = `${term}: ${explanation}`
  return h('span', {
    className: 'term-help',
    role: 'note',
    tabIndex: 0,
    title: label,
    'aria-label': label,
  }, h(CircleHelp, { size: 13, 'aria-hidden': true }))
}