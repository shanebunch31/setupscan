import React from 'react'

// Reusable plain-English definitions for the metrics shown across the research labs.
// Intended as the first building block toward a future Learn/Education page.
export const METRIC_DEFINITIONS = [
  { term: 'Win rate', description: 'The share of trades that closed as winners. On its own it doesn’t say how big the wins or losses were.' },
  { term: 'Profit factor', description: 'Total profit from winners divided by total loss from losers. Above 1 means winners outweighed losers over this sample.' },
  { term: 'Expectancy', description: 'The average result per trade, in R-multiples. Positive expectancy means trades made money on average before real-world costs and slippage.' },
  { term: 'Average R', description: 'How many multiples of the amount risked (1R) a trade returned on average.' },
  { term: 'Max drawdown', description: 'The worst peak-to-trough decline in cumulative R across the trade sequence — the roughest stretch this history included, even if the end result was positive.' },
  { term: 'In-sample', description: 'Results from the data period used to build or tune the rules. Usually the best-case view and the least reliable on its own.' },
  { term: 'Out-of-sample', description: 'Results from data the rules were not tuned on. A more honest check of whether the approach holds up — still historical, not a guarantee.' },
]

export function MetricsGlossary({ title = 'What does this mean?', intro = 'Plain-English explanations for the metrics used throughout this research.', definitions = METRIC_DEFINITIONS }) {
  return (
    <div className="metrics-glossary">
      <h3>{title}</h3>
      <p className="metrics-glossary-intro">{intro}</p>
      <dl className="metrics-glossary-list">
        {definitions.map(({ term, description }) => (
          <div className="metrics-glossary-item" key={term}>
            <dt>{term}</dt>
            <dd>{description}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

const DEFAULT_HOW_TO_READ_ITEMS = [
  'Everything above describes historical results — what already happened, not what will happen next.',
  'Positive historical results do not guarantee future performance; market conditions change.',
  'In-sample and out-of-sample results should be considered separately, not blended together.',
  'Drawdowns matter even when expectancy is positive — a profitable average can still include an uncomfortable losing stretch.',
  'This research is for investigation and learning, not financial advice.',
]

export function HowToReadResults({ title = 'How to read this test', items = DEFAULT_HOW_TO_READ_ITEMS }) {
  return (
    <div className="how-to-read">
      <h3>{title}</h3>
      <ul className="how-to-read-list">
        {items.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </div>
  )
}

export function PlainEnglishTakeaway({ title = 'Plain-English takeaway', children }) {
  return (
    <div className="plain-english-takeaway">
      <h3>{title}</h3>
      <p className="plain-english-takeaway-text">{children}</p>
    </div>
  )
}

