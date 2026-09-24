# Historical Market Context: Market-Wide Foundation

## Scope

This Phase 1C layer is a separate, descriptive context dataset for SPY, QQQ,
and IWM. It covers the research period **2022-01-03 through 2026-09-23** and
uses real Alpaca historical `1Hour` bars only. The derived cache is stored at
[data/historical-market-context/market-wide/context.json](../data/historical-market-context/market-wide/context.json).

The cache is not a trading filter, does not select a preferred regime, and does
not authorize execution. The risk-on/risk-off value is an internal descriptive
proxy, not a proven economic regime classifier.

## Source and retrieval

The existing canonical retrieval path is
`server/alpacaProxy.js:fetchAlpacaHistoricalBars`. It requests:

- provider label: `ALPACA HISTORICAL`;
- source path: `https://data.alpaca.markets/v2/stocks/{symbol}/bars`;
- symbols: SPY, QQQ, IWM;
- timeframe: `1Hour`;
- adjustment: `raw`;
- feed: `iex`;
- requested range: `2022-01-03T00:00:00.000Z` through
  `2026-09-23T23:59:59.999Z`;
- retrieval method: `scripts/buildMarketContextCache.mjs`, run with
  `node --env-file=.env`.

The three source retrieval timestamps were:

| Symbol | Retrieved at (UTC) | Source candles | First source timestamp | Last source timestamp |
| --- | --- | ---: | --- | --- |
| SPY | 2026-09-24T20:41:31.990Z | 9,821 | 2022-01-03T13:00:00Z | 2026-09-23T20:00:00Z |
| QQQ | 2026-09-24T20:41:35.984Z | 10,384 | 2022-01-03T14:00:00Z | 2026-09-23T20:00:00Z |
| IWM | 2026-09-24T20:41:40.821Z | 9,816 | 2022-01-03T14:00:00Z | 2026-09-23T20:00:00Z |

The normalized cache stores `sourcePath` once in metadata and stores retrieval
times in `retrievalAtBySymbol`, keyed by symbol. Rows identify symbols by their
`symbols` keys and retain coverage and derived states without repeating source
URLs or retrieval times. Each row retains its normalized `timestampUTC`, which
is the same instant as the original Alpaca source timestamp for every present
symbol. The metadata records the source-timestamp normalization rule and an
explicit `sourceTimestampExceptions` list; this retrieval has no instant-level
exceptions. Source counts, requested range, provider results, duplicate counts,
and exclusions remain in metadata.

## Coverage and data quality

The cache contains 10,501 unique timestamps on a sorted **union** axis across
the three symbols:

- complete SPY/QQQ/IWM coverage: 9,448 timestamps;
- incomplete universe coverage: 1,053 timestamps;
- duplicate source timestamps: 0 for each symbol;
- usable three-symbol breadth rows after causal warmups: 9,391;
- complete rows still lacking sufficient causal history: 57.

The union axis uses timestamps actually present in at least one source series.
Missing symbols are marked `coverageStatus: "missing"` at that row. No
forward-fill, interpolation, partial-bar reconstruction, or invented timestamp
is used. Three-symbol breadth and the risk proxy are not calculated when the
universe is incomplete. Duplicate timestamps are deduplicated per symbol by
keeping the first source occurrence and recording later occurrences as
exclusions; this retrieval had none.

The source path is the existing full-session Alpaca/IEX path. It does not apply
a regular-session-only filter. The cache therefore preserves whatever regular
and extended-hours bars the canonical path returns. It does not convert the
source into a regular-session dataset.

Source timestamps are preserved in each symbol snapshot. They are normalized to
UTC with JavaScript ISO timestamp normalization for the shared `timestampUTC`
axis and for ordering. No local-time interpretation is added.

## Frozen causal calculations

The layer reuses `computeCausalRegimeSeries` from
`src/backtest/causalRegimeBacktest.js` independently for each symbol after
per-symbol deduplication. It does not implement a competing trend or volatility
definition. Its frozen parameters are retained exactly:

### Trend

- `SMA50`: trailing 50-close simple moving average, including the current bar.
- `SMA200`: trailing 200-close simple moving average, including the current bar.
- `trendSlopeLookback: 10`: slope is the current SMA50 minus the SMA50 ten
  bars earlier.
- `return20`: current close versus the close 20 bars earlier.
- `return50`: current close versus the close 50 bars earlier.
- `trendState` is `Uptrend` when close is above SMA50 and the 10-bar SMA50 slope
  is positive; `Downtrend` when close is not above SMA50 and the slope is
  negative; otherwise it is `Mixed`.
- Trend classification requires SMA50 plus the 10-bar slope lookback, so it is
  `Insufficient-History` until 60 bars are available. SMA200 and returns have
  their own longer warmups and remain null until their required observations
  exist.

### Volatility

- `ATR14`: trailing 14-bar average true range, normalized by the current close.
  True range uses the current high-low and, where available, the prior close.
- `realizedVol20`: standard deviation of the trailing 20 close-to-close returns.
- `realizedVol50`: standard deviation of the trailing 50 close-to-close returns.
- Volatility classification uses the existing expanding history of
  `realizedVol20`, with `volatilityHistoryWarmup: 60`. The percentile rank uses
  only current and prior realized-volatility observations; it is never computed
  against later data. States are `Low`, `Medium`, `High`, or
  `Insufficient-History`.
- ATR14, realizedVol20, and realizedVol50 retain the existing warmups from the
  implementation. Volatility state requires 60 available realizedVol20
  observations after its initial 20-bar return warmup.

Every calculation is evaluated at index `i` using only bars at or before index
`i`. The focused tests verify that changing future candles cannot alter earlier
context values.

## Breadth

At a timestamp with all three source bars present and all three trend states
classified, breadth contains:

- `upCount`, `mixedCount`, and `downCount`;
- `upFraction`, `mixedFraction`, and `downFraction`;
- `coverageCount`, which is 3 for a breadth row.

Fractions are each count divided by 3 and sum to 1. Incomplete coverage or
insufficient trend history produces no breadth object, rather than a partial or
forward-filled estimate.

## Internal risk-on/risk-off proxy

This foundation uses a fixed, unoptimized descriptive proxy derived only from
the already-computed SPY/QQQ/IWM trend states and causal `return20` values:

1. Calculate the mean of the three available causal `trend.return20` values.
2. Return `Risk-On` when at least two symbols are `Uptrend` and the mean return
   is positive.
3. Return `Risk-Off` when at least two symbols are `Downtrend` and the mean
   return is negative.
4. Otherwise return `Neutral`.
5. Return `Insufficient-Coverage` for incomplete symbol coverage and
   `Insufficient-History` when complete coverage lacks the required causal
   states or returns.

This is an internal research label only. It is not an external market proxy,
an economic regime classifier, a trading filter, or evidence that one state is
preferable.

## Unavailable or incomplete portions

The source retrieval completed for all three requested symbols. The principal
limitations are the 1,053 union timestamps with incomplete symbol coverage and
the 57 complete timestamps that remain within causal warmup. Those rows remain
reviewable in the cache with explicit statuses, but are excluded from
three-symbol breadth and proxy calculations where required. No missing candle
was guessed, synthesized, forward-filled, or replaced by another provider.