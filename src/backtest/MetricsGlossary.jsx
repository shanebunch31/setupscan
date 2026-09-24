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

export function MetricsGlossary() {
  return (
    <div className="metrics-glossary">
      <h3>What does this mean?</h3>
      <p className="metrics-glossary-intro">Plain-English explanations for the metrics used throughout this research.</p>
      <dl className="metrics-glossary-list">
        {METRIC_DEFINITIONS.map(({ term, description }) => (
          <div className="metrics-glossary-item" key={term}>
            <dt>{term}</dt>
            <dd>{description}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

export function HowToReadResults() {
  return (
    <div className="how-to-read">
      <h3>How to read this test</h3>
      <ul className="how-to-read-list">
        <li>Everything above describes historical results — what already happened, not what will happen next.</li>
        <li>Positive historical results do not guarantee future performance; market conditions change.</li>
        <li>In-sample and out-of-sample results should be considered separately, not blended together.</li>
        <li>Drawdowns matter even when expectancy is positive — a profitable average can still include an uncomfortable losing stretch.</li>
        <li>This research is for investigation and learning, not financial advice.</li>
      </ul>
    </div>
  )
}
