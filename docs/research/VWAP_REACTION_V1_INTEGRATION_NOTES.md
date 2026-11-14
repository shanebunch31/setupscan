# SetupScan VWAP Reaction v1 — research-only implementation handoff

**State:** isolated, fixture-tested draft, not registered in the live app; no historical runs, database writes, alerts or trades.

## Files to add

- `src/backtest/vwapReactionResearch.js` — pure session VWAP/ATR calculation, two frozen candidate definitions, simulated next-open entries, conservative OHLCV exits, exclusions, and cost tiers.
- `src/backtest/vwapReactionResearch.test.js` — self-contained Node test fixtures.

These paths are new in the reviewed GitHub feature-branch tree. No existing files are replaced or touched by the package.

## Validation (Windows PowerShell from SetupScan repo root)

```powershell
node --test src/backtest/vwapReactionResearch.test.js
npm.cmd test
npm.cmd run build
```

The first command has passed **18/18** in an isolated Node ESM sandbox. The full SetupScan test/build commands **have not been run** on this package in the full project. Do not claim repo-wide validation yet.

## API

```js
import { analyzeVwapReactionSession } from './src/backtest/vwapReactionResearch.js'

const result = analyzeVwapReactionSession(fiveMinuteBars, {
  symbol: 'SPY',
  sessionDate: '2026-11-16',
  sessionClose: '16:00', // caller must obtain this from verified market schedule; 13:00 on early closes
  completedThrough: '2026-11-16T21:00:00Z',
})
```

Input bars are chronological full-session 5-minute OHLCV bars with ISO UTC **bar-start** timestamps. Positive volume and no missing session-opening or intervening bars are required. `completedThrough` is mandatory to avoid using an unfinished candle. `sessionClose` is an explicit caller-supplied verified market-calendar input; this module **does not infer market holidays/early closes** or fetch data. It returns `UNAVAILABLE` rather than guessing if inputs are unsuitable.

## Scope and remaining integration gates

1. Confirm 5Min OHLCV feed entitlement/coverage, split adjustments, timestamps, market-calendar schedule and costs assumptions; compare formula with the existing `enrichHistoricalCandles(candles, '5Min')` (this module uses *prior 14 same-session true ranges*, unlike generic `candle.atr` in `marketData.js`).
2. Freeze the methodology only with owner approval; keep `vwap-reaction-research-1` as exploratory. A real run needs a dataset fingerprint, source/feed and revision provenance, session completeness audit and appropriate holdout split.
3. Add a **separate offline research runner** and aggregate evidence with session-clustered uncertainty. No `registry.js`, `experimentExecutors.js`, `src/main.jsx`, live scanner or API edits are included here.
4. Run bounded historical research only after verifying data/calendar requirements, and preserve negative findings. Do not infer options execution profitability.
5. Keep Groups 4–8, historical SPY/QQQ/IWM studies, Paper Observer, Shadow Forward and production untouched.

This code uses supplied bars only. It does **not** represent current signals, a validated strategy, or a trading recommendation.