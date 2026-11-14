export const BATCH_B_DEFINITIONS = [
  { term: 'Frozen baseline', description: 'Batch B reuses the exact, unmodified Batch A Momentum Breakout signal, entry, stop, and outcome rules. Nothing about which signals qualify is changed here \u2014 only how the already-qualifying signals are grouped for reporting.' },
  { term: 'Context dimension', description: 'One way of grouping the frozen breakout signals by a condition that was true at (or before) the signal candle \u2014 e.g. what time of day it fired, or whether the broader market was trending up.' },
  { term: 'Time of Day', description: 'Which part of the U.S. trading session (Eastern time) the signal candle fell in.' },
  { term: 'Market Trend Regime', description: 'A causal, predefined classification (reused unchanged from Research Experiment #5) of whether the broader market looked like an uptrend, downtrend, or mixed at the time of the signal.' },
  { term: 'Volatility Regime', description: 'A causal, predefined classification (reused unchanged from Research Experiment #5) of whether recent market volatility was low, medium, or high at the time of the signal.' },
  { term: 'Relative Strength', description: 'A causal, predefined check (reused unchanged from Research Experiment #1) of whether the symbol was outperforming its peers over a fixed trailing lookback at the time of the signal.' },
  { term: 'VWAP Context', description: 'Whether the signal candle closed above or at/below that day\u2019s running session VWAP.' },
  { term: 'Opening-Range Context', description: 'Whether the signal candle\u2019s high cleared the high of that trading day\u2019s first observed candle (a simple, non-optimized opening-range definition given the 1-hour candle data available).' },
  { term: 'Prior-Day Context', description: 'Whether the signal candle\u2019s high also cleared the previous completed trading day\u2019s high.' },
  { term: 'Volume Strength', description: 'A simple, predefined split of how far above the required 1.2x volume threshold the signal\u2019s actual volume was.' },
  { term: 'Low-evidence bucket', description: 'A context bucket with fewer than 100 occurrences \u2014 per the Strategy Discovery Protocol, treated as exploratory only, not a basis for any conclusion.' },
]

export const BATCH_C_DEFINITIONS = [
  { term: 'Frozen baseline', description: 'Batch C reuses the exact, unmodified Batch A Momentum Breakout signal, entry, stop, and outcome rules. Only the data universe changes.' },
  { term: 'Regular session', description: 'The core U.S. equity trading hours, 09:30\u201316:00 Eastern time.' },
  { term: 'Regular-session-only bars', description: 'Since 1-hour bars are aligned to the top of each hour rather than to 09:30, only bars whose Eastern start hour is 10:00\u201315:00 are fully inside the regular session. The 09:00 ET bar (spans 09:00\u201310:00) partially overlaps the open, and the 16:00 ET bar (spans 16:00\u201317:00) is entirely postmarket \u2014 both are excluded, along with all other extended-hours bars.' },
  { term: 'Batch A (full-session)', description: 'The original, unmodified Momentum Breakout experiment, run on whatever regular- and extended-hours bars Alpaca/IEX returns \u2014 preserved exactly as-is.' },
  { term: 'Batch C (regular-session-only)', description: 'The identical frozen signal, entry, stop, and outcome rules, run only on the stricter regular-session-only bar series described above.' },
  { term: 'Diff (Batch C \u2212 Batch A)', description: 'Batch C\u2019s value minus Batch A\u2019s value for the same metric. A positive diff means Batch C\u2019s number was higher in this sample \u2014 it is not a claim that either version is better.' },
]
export const DISCOVERY_HELP_TERMS = [
 { term: 'Frozen baseline', definition: 'Both batches keep the exact Batch A Momentum Breakout signal, entry, stop and outcome rules. Batch B only groups existing signals by context. Batch C changes only the data universe.' },
 ...[...BATCH_B_DEFINITIONS, ...BATCH_C_DEFINITIONS].filter(x => x.term !== 'Frozen baseline').map(({term, description}) => ({term, definition: description})),
]
