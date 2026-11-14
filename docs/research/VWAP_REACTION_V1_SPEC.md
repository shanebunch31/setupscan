# SetupScan — VWAP Reaction v1 Research Specification

**Status:** Proposed / research-only / not deployed.  
**Drafted:** November 13, 2026  
**Working methodology ID:** `vwap-reaction-research-1`  
**Candidate IDs:** `vwap-reclaim-long-1` and `vwap-rejection-short-1`  
**Owner decision required before research freeze:** approve the fixed parameters below, data entitlement/coverage, and research window boundaries. No detector, score, paper-trader or production change is authorized by this document.

## 1. Goal and testable questions

Study whether precisely defined **five-minute, regular-session VWAP reactions** produce repeatable, positive **cost-adjusted underlying-price R outcomes**, separately for:

- **Long VWAP reclaim:** price recovers from below the session VWAP and closes above it.
- **Short VWAP rejection:** price approaches VWAP from below and closes back below it after testing that level.

These are separate hypotheses. This study is **not** an inversion of SetupScan's existing six-condition bullish scanner, and does not claim that a profitable stock backtest implies a profitable SPY/QQQ options strategy.

## 2. Frozen input definitions proposed for v1

| Item | v1 proposal |
|---|---|
| Primary timeframe | 5-minute OHLCV bars; **completed bars only** |
| Trading session | US equities regular trading hours (RTH): 09:30–16:00 `America/New_York`, including DST; exclude extended hours and holidays |
| Signal decision window | Completed signal candles closing **10:45–14:30 ET**, inclusive. No decisions before 14 completed earlier same-session 5-minute bars are available |
| Historical symbols | Start with **SPY**, then test eligible **QQQ** and **MSFT** independently; expand to supported watchlist symbols with adequate five-minute coverage |
| Session VWAP | Reset at each RTH open. At completion of bar `t`, `VWAP_t = sum(((high+low+close)/3) * volume) / sum(volume)` across completed RTH bars 09:30 through `t`. This is an **OHLCV-derived approximation** of session VWAP, not tick-level VWAP |
| ATR buffer | `ATR14_prior`: simple average of the last **14 completed same-session true ranges prior to** the signal bar. For each prior RTH candle, true range uses its high, low, and previous **same-session** close; for the first RTH bar, use `high-low` to avoid the overnight gap |
| Trend/regime metadata | Record causally available higher-timeframe trend, volatility, RTH time bucket, symbol and session date; **do not filter v1 candidates on these** |
| Data availability | No forward-fill of missing OHLCV/zero-volume candles. Missing prerequisites lead to `UNAVAILABLE`, not a failed setup |

The VWAP formula is the standard typical-price bar proxy; if the scanner/Alpaca uses a different VWAP definition or feed, compare and record the difference rather than silently treating them as identical. A completed-bar comparison **does not prove intrabar sequencing** of the VWAP touch.

## 3. Long candidate: `vwap-reclaim-long-1`

At the **close of signal candle t**, require all of:

1. `close[t-2] < vwap[t-2]` and `close[t-1] < vwap[t-1]` (two consecutive completed closes below their own session VWAP values).
2. `close[t] > vwap[t]` (first reclaim close above its completed session VWAP).
3. `low[t] <= vwap[t]` (the same candle reached the VWAP zone using bar-level information; do not imply the exact time of a touch is known).
4. All three candles are consecutive, complete RTH bars from the same session, with valid positive volume and the required prior ATR data.
5. Candidate occurs in the eligible decision window, and this direction has not already signaled for that symbol/session.

**Signal is detected only after candle t closes.** The hypothetical entry is at the **open of candle t+1**, subject to valid next-bar data and risk checks below. No entry at signal-bar close or intrabar high/low.

## 4. Short candidate: `vwap-rejection-short-1`

At the **close of signal candle t**, require all of:

1. `close[t-2] < vwap[t-2]` and `close[t-1] < vwap[t-1]` (approaching/testing VWAP from below, not a mirror image of bullish logic).
2. `high[t] >= vwap[t]` (completed-bar **touch proxy**; it does not prove exactly when intrabar VWAP was touched).
3. `close[t] < vwap[t]` and `close[t] < open[t]` (bearish rejection candle closes below VWAP and below its open).
4. All three candles are consecutive complete same-session RTH bars, with valid positive volume and prior ATR data.
5. Candidate occurs in the eligible decision window, and this direction has not already signaled for that symbol/session.

A short-entry result is **underlying-price research only**; it is neither a short-sale recommendation nor a validated put-option outcome.

## 5. Shared entry, stop, target, exits and collision policy

- **Entry:** next consecutive completed-data candle's **open** after confirmation. If next bar is absent, delayed, non-consecutive or otherwise invalid, log `UNAVAILABLE` and do not create a fill.
- **Long stop:** `min(low[t], low[t-1]) - 0.05 * ATR14_prior`.
- **Short stop:** `max(high[t], high[t-1]) + 0.05 * ATR14_prior`.
- **Initial risk per share:** long `entry - stop`; short `stop - entry`. Must be strictly positive and between **0.15 × ATR14_prior and 2.5 × ATR14_prior**, inclusive. Otherwise record a skipped trade with the reason. These are research risk-geometry constraints, not position-sizing advice.
- **Fixed profit target:** **+1.5R**, calculated from actual hypothetical next-open entry and initial risk.
- **Stop:** **−1.0R** before cost, except if the next tradable price gaps through the stop; use the worse available opening price rather than assuming a perfect stop fill.
- **Maximum hold:** 12 five-minute bars from entry (60 minutes). Exit at the **closing price of the 12th bar** if neither stop nor target hit, or the final valid regular-session closing bar if sooner. No overnight holding.
- **Collision:** if stop and target are within the **same completed five-minute candle**, assume stop first (conservative OHLC ambiguity). On an opening gap through a target, cap favorable execution at the target rather than claiming extra favorable slippage.
- **One candidate per direction per symbol per session**; while a position is hypothetically open, ignore overlapping or opposing candidate entries for that symbol, log the collision, and do not net or hedge them. Process candidates and fills in chronological order with fixed tie-breaking (long before short if an otherwise impossible same-timestamp collision occurs), for reproducibility.
- **Trade outcomes:** `gross_R = direction * (exit - entry) / initial_risk_per_share`, where long direction = +1 and short = −1. Record stop/target/time-exit reason, entry/exit timestamps, skipped/colliding observations and ambiguity flags.

## 6. Modeled costs and honest interpretation

Calculate net expectancy, gross expectancy, profit factor and drawdown at **0, 0.02, 0.05, 0.10 and 0.20 R per completed round trip**. Use **0.05R as the primary comparison tier**, plus the full cost-sensitivity table. These are explicit sensitivity assumptions, **not verified broker spreads or fills**. Use no claim of net profitability from a positive 0R outcome. For any future real execution assessment, measure actual spread/slippage with time-aligned market data rather than using this R proxy as evidence of true executable profitability.

The underlying equities/ETF study says **nothing direct about option prices, Greeks, implied volatility, bid-ask spreads, or 0/1 DTE fills**.

## 7. Evaluation protocol — before seeing results

1. **Validate data:** provenance/source/feed, RTH boundaries and DST, continuity, duplicates, missing candles, symbol eligibility, bars available at each decision, VWAP reset and formula, and split/corporate-action handling. Document unavailable sessions and exclusions. Verify the data entitlement covers the requested five-minute history.
2. **Freeze rules first:** store this definition + code revision + input dataset fingerprint and any later amendments as a new version. No retrospective tweaking of the v1 thresholds after seeing outcomes.
3. **Develop on historical training data only**, with a predeclared chronological cutoff. Any previously viewed SetupScan history is **exploratory**, never an untouched holdout.
4. **Test separately by symbol and direction**. Show resolved signals, days, exclusions, average and median R, win rate, net expectancy at all costs, profit factor, max drawdown, longest losing streak, and best-day/top-five-day concentration.
5. **Regime and time slices:** causally available trend × volatility, year, recent period, signal time of day, and liquidity/volume context. Show sample sizes in every slice. Do not turn subgroup winners into rules without a new preregistered test.
6. **Uncertainty:** report a date-clustered bootstrap interval for net expectancy (resample whole sessions, not independent trades); label estimates with too few independent sessions `INSUFFICIENT DATA`.
7. **Genuinely later holdout:** evaluate without any retuning, including the final rules, costs and exclusion policy. If no untouched period exists, label `HOLDOUT NOT AVAILABLE` and collect fresh forward observations.
8. **Forward observation:** if a candidate warrants it, log frozen signal/entry/exit hypotheses prospectively in a separate research-only channel. No automatic Paper Observer, Shadow Forward or live scanner modifications.
9. **Report negative evidence:** losing and mixed strategies, missing data, confounded periods, ambiguous fills, and strategies that worked only before costs or on one exceptional day.

**Suggested review gates, not statistical guarantees:** at least 50 resolved trades on 20 different sessions **per candidate/symbol**, plus a distinct later holdout with at least 20 trades on 10 sessions before considering a *forward-observation candidate*. Any smaller cell is exploratory. Even meeting these counts alone does **not** justify live detection or trade execution; confidence intervals, generalization, costs and concentration also matter.

## 8. Acceptance-test checklist (required before any backtest claim)

- [ ] VWAP reset on next RTH session; no premarket leakage; DST and half-days handled correctly.
- [ ] No signal until bar `t` has closed; entry strictly at `t+1` open.
- [ ] Two preceding closes compared with **their own** completed-bar VWAP, not future VWAP.
- [ ] Long reclaim: below/below/above with signal-bar low in VWAP zone; both a passing and failing fixture.
- [ ] Short rejection: below/below, signal high at/above VWAP, bearish close below VWAP; both passing and failing fixtures.
- [ ] Reject zero volume, missing prerequisite bar, duplicate/misaligned timestamp, stale/nonconsecutive `t+1` candle, and incomplete live candle.
- [ ] ATR uses only previously completed **same-session** bars and does not incorporate overnight gap or signal candle.
- [ ] Apply minimum/maximum R geometry; reject nonpositive stop distance.
- [ ] Long and short target and stop computations are directionally correct.
- [ ] Same-bar stop/target collision fills **stop first**, including first bar after entry.
- [ ] Gap beyond stop fills conservatively; target gap gets no unearned favorable bonus.
- [ ] Exactly one signal per direction/session; overlapping hypothetical positions blocked and logged.
- [ ] Time exit uses the correct 12th candle close; early market closure / missing final bar recorded, not invented.
- [ ] Costs are subtracted in R exactly once per completed trade at all specified tiers.
- [ ] Signal counts, exclusions, trade list and day-concentration reconcile with summary statistics.
- [ ] Dataset fingerprint, config, methodology ID, code commit and run ID persist with output.
- [ ] Missing holdout/forward evidence explicitly displays as unavailable, not zero or a success.
- [ ] Existing six-condition scanner, `Qualified/Potential`, Paper Trader universe/logic, Shadow Forward and prior SPY/QQQ/IWM frozen research remain unchanged.

## 9. Proposed saved result schema (conceptual)

For each run: `runId`, `methodologyId`, `candidateId`, `symbol`, `direction`, `timeframe`, `sessionDefinition`, `vwapFormula`, `dataProvider`, `feed`, `datasetFingerprint`, `codeRevision`, `startDate`, `endDate`, `dataQuality`, `signalCount`, `resolvedCount`, `skipsByReason`, `trades`, `grossRStats`, `netRByCostTier`, `yearSlices`, `regimeSlices`, `timeOfDaySlices`, `dateConcentration`, `uncertainty`, `holdoutStatus`, `forwardStatus`, `warnings`. Keep exact linkage to Research Run History and the future Symbol Intelligence profile.

## 10. Implementation sequence with Git Group 3 already complete

1. Keep this research specification as a **new file**; do not edit current production/live rules or Group 4–8 work.
2. Have an isolated read-only inventory identify the project's existing five-minute data pipeline, RTH calendar/VWAP implementation, research registry and run-persistence contracts. Reuse what is actually compatible and record gaps without guessing file locations/line numbers.
3. Implement pure, testable candidate detection and trade-evaluation modules under a **new methodology ID**, initially using synthetic fixture candles only.
4. Add data-quality and causality tests before historical runs. Execute one bounded SPY exploratory historical run, then independent QQQ/MSFT runs when their data contracts are verified.
5. Inspect evidence and promote, at most, to **separate forward research observation**, only after explicit review. Do not modify the live scanner or enable paper/live orders by default.

---

**Research status:** SPECIFICATION DRAFT. No results have been run or validated under `vwap-reaction-research-1`; no new setup is approved as an alert, paper rule or trade signal.