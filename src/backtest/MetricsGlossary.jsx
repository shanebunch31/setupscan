import React from 'react'
import { TermHelp } from '../TermHelp.js'

export { TermHelp }

// Reusable plain-English definitions for the metrics shown across the research labs.
// Intended as the first building block toward a future Learn/Education page.
export const METRIC_DEFINITIONS = [
  { term: 'R (risk unit)', description: '1R is one unit of planned risk. For example, if you risk $20 on a trade, +1R means a $20 gain, +2R means a $40 gain, and -1R means a $20 loss.' },
  { term: 'Win rate', description: 'The percentage of trades that ended with a profit. For example, a 60% win rate means 6 out of every 10 trades were winners. It does not show how large the wins or losses were.' },
  { term: 'Profit factor', description: 'Total profit from winning trades divided by total loss from losing trades. For example, a 1.50 profit factor means the strategy made $1.50 for every $1.00 lost across this historical sample. Above 1 means winners outweighed losers overall.' },
  { term: 'Expectancy', description: 'The average result per trade, measured in R. For example, +0.30R expectancy means the strategy made an average of 0.30R per trade across this historical sample. Positive expectancy means the average result was profitable.' },
  { term: 'Average R', description: 'The average amount gained or lost per trade compared with the amount originally risked. For example, +0.50R means the strategy gained an average of half the planned risk per trade across this historical sample.' },
  { term: 'Max drawdown', description: 'The largest drop from a previous high point to a later low point in the cumulative results. For example, a 5R max drawdown means the strategy went as much as 5R below a previous high during this historical sample.' },
  { term: 'Average holding period', description: 'The average time or number of candles that simulated trades stayed open. It describes this backtest’s trade timing, not how long a real order would take to fill.' },
  { term: 'In-sample', description: 'Results from historical data used to build or adjust strategy rules. These results can look better than results on other data.' },
  { term: 'Out-of-sample', description: 'Results from a separate historical period. This is a stronger check only when that period was not used to choose the rules or experiment; it is still not a future result.' },
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
  'These results show what happened in the historical data tested. They do not predict what will happen next.',
  'A strong historical result does not guarantee future performance. Market conditions can change.',
  'In-sample and out-of-sample results should be reviewed separately. Out-of-sample results are especially useful for seeing how the strategy performs on data it did not use during development.',
  'Pay attention to drawdown, not just profits. A strategy can have a positive average result and still experience a difficult losing stretch.',
  'This research is designed for investigation and learning. It is not financial advice.',
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

export function ResearchFirstAnswer({ question, sample, takeaway, limitation }) {
  return (
    <section className="research-first-answer">
      <div className="research-first-answer-question">
        <p className="research-first-answer-kicker">Research question</p>
        <h3>{question}</h3>
      </div>
      <div className="research-first-answer-grid">
        {sample ? <div className="research-first-answer-evidence"><span>Evidence in this run</span><p>{sample}</p></div> : null}
        <div className="research-first-answer-finding"><span>What the evidence shows</span><p>{takeaway ?? 'A conclusion is unavailable until the required historical data and resolved observations are available.'}</p></div>
      </div>
      {limitation ? <p className="research-first-answer-limitation">{limitation}</p> : null}
      <details className="research-first-answer-boundaries">
        <summary>Evidence boundaries and limitations</summary>
        <p>These tests measure historical underlying-stock price behavior, not option-contract results. Cost tiers are assumptions; they do not replay historical bid/ask quotes or actual fills.</p>
        <p>Results tested across many variants are more exposed to chance findings than results from a small test. Consider the number of variants and completed observations where shown; small or missing samples are insufficient evidence.</p>
      </details>
    </section>
  )
}

export function LearningDetails({ label = 'More details', children }) {
  return (
    <details className="research-learning-details">
      <summary>{label}</summary>
      {children}
    </details>
  )
}

