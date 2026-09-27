export const BACKTEST_LEARNING_INTRO = "Applies today's fixed rules to past price bars. Results depend on these assumptions and do not predict future performance."

export const BACKTEST_EXTRA_DEFINITIONS = [
  { term: 'Average hold', description: 'Average time a simulated trade remained open. The main Backtest view shows minutes.' },
  { term: 'Winning trades', description: 'Trades ending with a positive R result.' },
  { term: 'Losing trades', description: 'Trades ending with a negative R result.' },
  { term: 'Expired trades', description: "Reached the test's maximum holding time without hitting its stop or target." },
  { term: 'Total positive R', description: 'Sum of winning results, measured in R.' },
  { term: 'Total negative R', description: 'Sum of losing results, measured in R.' },
  { term: 'Rule set', description: 'The complete set of conditions used to define a strategy.' },
  { term: 'Strategy variant', description: 'A predefined alternative set of trading rules.' },
]