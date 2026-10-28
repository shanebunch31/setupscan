# SetupScan — Project Memory

## Implementation checkpoint — October 28, 2026: Scanner Score Redundancy / Stability

- Added opt-in research experiment `scanner-score-redundancy-stability`, methodology `scanner-score-redundancy-stability-1`.
- Five fixed definitions: current baseline (100), keep EMA/remove Trend (85), keep Trend/remove EMA (80), combined family 20 (85), combined family 15 (80). Baseline floor 75; each challenger has fixed 75 and mechanical ceil(75% of maximum), respectively 64 or 60. No weight/threshold search or score rescaling.
- Reuses Signal Quality outcome calculations and causal regimes, with available calculation pre-roll retained. Mechanical floors examine all scored observations, including those below the original 75. Combined families require available EMA/Trend inputs and award shared credit only when both conditions pass; disagreements and unavailable inputs are reported.
- Normalized saved evidence includes period/year/symbol/regime accounting, four R-cost tiers, baseline-ranked Eastern-date stress tests, equivalent-variant checks and deterministic conservative conclusions. Existing ablation records remain readable. Workbench and saved-run views use a small dedicated renderer, not a redesign.
- Verification: focused research/persistence/legacy/Shadow compatibility group 151/151 passed; `npm.cmd test` 1116/1116 passed with normal filesystem permissions (restricted execution blocked existing temporary-file rename tests); `npm.cmd run build` passed with the existing bundle-size warning; `git diff --check` passed. No real database/provider access. Shadow fingerprint regression passed.
- **Implementation only:** no real historical run was performed or reviewed for this new study. Historical conclusions and any candidate/production changes remain unapproved. Scanner scoring, Paper Trader eligibility/execution and the active Shadow Forward tracker are unchanged.

## 1. Project Purpose

SetupScan is a trading research application designed to investigate trading strategies and identify setups that may be consistent over time.

The eventual goal is to research strategies, validate them, scan markets for qualifying setups, paper trade, and potentially automate personal trading later.

The app must be understandable to beginners. Technical terms should have plain-English definitions.

The developer is learning to code. Instructions must include exact file paths, precise search targets, complete replacement blocks when practical, and commands that can be copied directly.

## 2. Development Rules

- Make the smallest safe change that solves the current problem.
- Do not ask the user to inspect hundreds of files for a small change.
- Before editing, review this file and the relevant existing code.
- Never invent file contents, line numbers, test results, or application behavior.
- Prefer exact search strings over line numbers when line numbers may have changed.
- Explain what a change does and why, in plain English.
- Preserve working features and existing research calculations unless a change is explicitly required.
- Run relevant tests and the build after code changes when practical.
- Record the actual results, including failures.
- Update this file when architecture, decisions, files, known issues, or verified status changes.
- Do not claim that a strategy is profitable or validated without sufficient supporting evidence.
- Do not enable live trading or change live-trading behavior without explicit authorization.

## 3. Windows Development Environment

Project folder:
`C:\Users\holle\OneDrive\Documents\setupscan`

Use `npm.cmd` in PowerShell because `npm.ps1` may be blocked by the system execution policy.

If PowerShell blocks npm commands, use the previously established process-level execution-policy workaround before continuing. Do not change the machine-wide execution policy unnecessarily.

Previously used development command:
`npm.cmd run dev`

The development server has used port 3001, with Vite on port 5173. Confirm current configuration before assuming these ports have not changed.

## 4. Known Architecture

The project has included:

- `src/main.jsx` — application entry point and major UI wiring.
- `src/research/ResearchWorkspace.js` — research workspace and Daily Research Results presentation.
- `src/research/ResearchRunDetail.js` — research-run detail presentation, including evidence and strategy groups.
- `src/research/adapters.js` — converts native experiment output into the research architecture's normalized records.
- `src/research/researchRecord.js` — creates and normalizes research records.
- `src/research/synthesis.js` — turns research records into evidence entries.
- `src/research/experimentExecutors.js` — connects research experiment types to their execution functions.
- `src/research/researchArchitecture.test.js` — research architecture tests.
- `src/backtest/strategyDiscovery/discoveryRunner.js` — runs Strategy Discovery experiments.
- `src/backtest/strategyDiscovery/discoveryMetrics.js` — summarizes outcomes and exclusion counts.
- `src/backtest/MetricsGlossary.jsx` — existing glossary component.
- `src/research/ResearchWorkspace.js.backup` — a backup was previously reported. Do not treat it as the current source of truth.

The project has also included historical backtesting, research history, paper-trading functionality, Alpaca integration, and PostgreSQL/Supabase storage. Verify the current implementation before changing these systems.

## 5. Research and Trading Principles

- Research experiments and individual scan results are different things.
- A scan summary must not be presented as a validated strategy leaderboard.
- Sample size matters: performance percentages without enough observations can be misleading.
- Out-of-sample testing means testing on data not used to develop or select the strategy.
- Trading costs can materially change results and must be considered.
- Excluded or unresolved observations should not be silently counted as winning or losing trades.
- Zero resolved observations means performance conclusions are unavailable, not that the strategy necessarily has a 0% win rate.
- Distinguish a rule-based Setup Score from a statistically established probability of success.

Previously established scanner terminology:
- **Trend:** bullish or bearish direction.
- **Setup Score:** a rule-based score from 0–100; it is not a probability of winning.
- **Qualified Setup:** meets all six qualification conditions and is eligible for the paper-trading handoff.
- **Potential Setup:** elevated score without meeting all qualification requirements.
- **No Setup:** does not meet the relevant setup criteria.

Confirm these rules against the current implementation before modifying scanner behavior.

## 6. Recent Research Results UI Changes

The following changes were previously reported as implemented:

### `src/research/ResearchWorkspace.js`

- Removed the direct `.jsx` import of `MetricsGlossary.jsx` that caused Node's test runner to fail with `ERR_UNKNOWN_FILE_EXTENSION`.
- Added a `MetricsGlossaryComponent` prop and passed the component through `src/main.jsx`.
- Added beginner-friendly metric labels and formatting.
- When there are zero resolved observations, the UI explains that performance metrics are unavailable rather than displaying misleading zero performance values.
- Added a warning when the evidence is marked `not-partitioned`, explaining that performance on unseen data has not been established.
- Added labels for ambiguous outcomes, insufficient-data exclusions, and outcomes outside the research window.

### `src/research/adapters.js`

`adaptStrategyDiscoveryOutput` was changed to carry these exclusion counts from `experiment.summary.excluded` into normalized metrics:

- `ambiguousCount`
- `insufficientDataCount`
- `outsideResearchWindowCount`

### `src/research/researchArchitecture.test.js`

A test was added to verify that Strategy Discovery adapter output preserves exclusion counts alongside performance metrics.

Important unresolved issue: exclusion counts were not visible in the Daily Research Results UI after these changes, despite the adapter change. Possible explanations included a different live data path, a stale browser/server response, or metrics being dropped elsewhere. Do not guess which explanation is correct. Investigate only if this issue becomes the current priority.

## 7. Verified Project Status

Last verified: 2026-10-13.

- **Tests:** 631/631 passed, as reported by the user.
- **Production build:** Successful; Vite reported `✓ built in 1.02s`.
- **Verification status:** Both the test suite and production build passed in this verification cycle.

These results verify the current reported checks, not the profitability or live-trading readiness of any strategy.

## 8. Known Areas Requiring Caution

- Some dashboard views have previously used demo market data. Verify data provenance before presenting results as live or research-backed.
- A previous review flagged a research-history API without authentication and an exposed paper-order endpoint. Recheck the current implementation before any public deployment.
- Do not enable live automated trading until data integrity, risk controls, paper-trading behavior, security, and failure handling have been tested.
- Historical strategy metrics are preliminary unless sample size, costs, data coverage, and out-of-sample validation support stronger conclusions.

## 9. Workflow for Every New Task

1. Read this memory file.
2. Identify the specific feature or bug.
3. Inspect only the relevant files and tests.
4. Explain the proposed change before asking the user to make edits.
5. Give exact file paths and copyable instructions.
6. Make or guide the smallest safe change.
7. Run the relevant tests and build.
8. Report exactly what passed, failed, or remains unverified.
9. Update this file with the change, verification results, and next step.

## 10. Current Status

Last known test result: 631/631 passing, as reported by the user.

Current next step: confirm the file is saved, then continue from the user's latest project objective. Do not start a broad codebase review unless the task genuinely requires one.

## Progress Update � October 13, 2026
### Research Timeframe Foundation

#### Goal
Prepare SetupScan's historical research data layer to support multiple candle timeframes for strategy research. The intended workflow is:
- Daily candles (`1Day`) for broad market trend and important levels.
- 4-hour candles (`4Hour`) for setup structure.
- 5-minute candles (`5Min`) for entry timing.
- Preserve the existing hourly (`1Hour`) scanner behavior.
- Do not change paper-trading behavior during this foundation work.

#### Changes Completed

**1. `src/research/orchestration.js`**
- Expanded accepted timeframe aliases to include `1Hour`, `1h`, `1Day`, `1D`, `4Hour`, `4h`, `5Min`, and `5m`.
- Unsupported timeframe values are rejected during research-run context validation.

**2. `src/research/orchestration.test.js`**
- Updated tests to cover the supported timeframe aliases and reject invalid timeframe inputs.

**3. `src/research/runResearch.test.js`**
- Added/updated validation coverage to confirm invalid symbols and unsupported timeframes reject before any historical-data fetch occurs.

**4. `src/data/marketData.js`**
- Exported `historicalFetchRange()` for direct testing.
- Exported `enrichHistoricalCandles()` and `buildHistoricalMarketDataResult()` for reuse and validation.
- Made candle enrichment retain the requested timeframe rather than always labeling candles as hourly.
- Updated historical market-data result construction to pass the requested timeframe into candle enrichment.
- Fixed the enrichment cache to keep separate cached results per candle array and timeframe, preventing one timeframe's enrichment from being reused for another.
- Added timeframe-specific historical warm-up periods:
  - `1Hour`: 30 calendar days.
  - `1Day`: 90 calendar days.
  - `4Hour`: 60 calendar days.
  - `5Min`: 30 calendar days.
- The requested research start and end dates remain distinct from the expanded fetch range, so earlier candles can warm up indicators without intentionally expanding the requested result period.

**5. `src/data/marketData.test.js`**
- Added coverage confirming enriched candles retain their requested timeframe.
- Added tests for requested-date preservation and open-ended date ranges.
- Added tests verifying each supported timeframe receives its configured warm-up period.

#### Latest Verification
- `npm.cmd test`: **636 tests passed, 0 failed**.
- `npm.cmd run build`: **successful**.
- Vite reports a non-fatal warning that the main JavaScript bundle exceeds 500 kB after minification. The production build still completes successfully.
- No claim is made that multi-timeframe indicator calculations are fully validated yet.

#### Current Limitations / Next Work
Timeframe acceptance and historical warm-up are implemented, but several calculations still need timeframe-aware validation:
1. VWAP currently uses hourly-oriented session logic and must be reviewed for daily, 4-hour, and 5-minute candles.
2. Relative volume needs a meaningful comparison baseline for each timeframe.
3. ATR and other indicator calculations need to be reviewed for consistency and correctness.
4. Add targeted tests proving indicator values behave correctly across timeframes before using them to rank setups.
5. Once indicator behavior is validated, connect daily trend, 4-hour setup structure, and 5-minute entry timing in the research workflow.

#### Protected Scope
- Preserve the working hourly scanner.
- Do not change the paper-trading worker or its hourly behavior as part of this research-foundation task.
- Do not introduce live trading or automated live orders.
- Preserve existing project changes, research architecture, persistence integrations, tests, and `.bak` backup files.
- Continue using `npm.cmd` in PowerShell because the `npm.ps1` script is blocked by the local execution policy.

#### Immediate Next Step
Inspect the current VWAP implementation in `src/data/marketData.js`, then make a narrowly scoped, test-backed change. Run the complete test suite and production build after the change.

## 10. Current Status

Last verified: 2026-10-14.

- **Tests:** 637/637 passed, as reported by the user.
- **Production build:** Successful, as reported by the user.
- **VWAP test:** Added coverage for volume-weighted VWAP and resetting the calculation for a new regular trading day.
- **Current next step:** Continue improving and validating the research engine while preserving the working scanner and leaving paper-trading behavior untouched.

## Progress Update — October 13, 2026
### VWAP Regular-Session Calculation

#### Goal
Improve and test VWAP behavior as part of the multi-timeframe historical research foundation, without disrupting the existing hourly scanner or paper-trading behavior.

#### Changes Completed

**1. `src/data/marketData.js`**
- Updated VWAP calculation logic to account for regular-session candles and reset cumulative price-volume and volume totals when the trading date changes.
- Regular-session filtering uses Eastern Time and excludes weekends and daily candles from the intraday VWAP accumulation.

**2. `src/data/marketData.test.js`**
- Added a test covering volume-weighted VWAP and the reset on a new trading day.
- Corrected the test timestamps so the sample candles fall within the intended regular-session window.
- Fixed a missing comma in the test data that caused the test run to fail.

#### Latest Verification
- `npm.cmd test`: **637 tests passed, 0 failed**.
- `npm.cmd run build`: **successful**, as reported by the user.

These results confirm that the test suite and production build passed. They do not establish that every VWAP edge case or all multi-timeframe indicator calculations are fully validated.

#### Current Limitations / Next Work
1. Review VWAP behavior against the actual timestamps and candle intervals returned by the market-data provider, especially for hourly candles near the regular-session open and close.
2. Validate VWAP behavior separately for daily, 4-hour, and 5-minute candles before relying on it in multi-timeframe setup qualification.
3. Continue reviewing relative volume, ATR, and other indicator calculations for timeframe-specific correctness.
4. After indicator behavior is validated, connect daily trend, 4-hour setup structure, and 5-minute entry timing in the research workflow.

#### Protected Scope
- Preserve the working hourly scanner.
- Do not change the paper-trading worker or its hourly behavior during this research-foundation work.
- Do not introduce live trading or automated live orders.
- Preserve existing research architecture, persistence integrations, tests, and backup files.

#### Immediate Next Step
Review the VWAP calculation against the actual market-data candle timestamps and intervals. Make only a targeted, test-backed change if needed, then run the full test suite and production build.

## Progress Update — October 13, 2026

### Current focus
Improving VWAP reliability in the SetupScan research scanner. The goal is to calculate VWAP from completed five-minute candles available at the completed hourly candle's evaluation time, without using future data or accepting incomplete candle sequences.

### Changes completed
- Updated `src/data/scannerSnapshot.js` to fetch hourly candles for scanner indicators and five-minute candles for VWAP.
- Added completed-hourly-candle filtering to avoid using an hourly candle that is still forming.
- Added evaluation-time filtering so five-minute candles that finish after the hourly cutoff are excluded.
- Added Eastern Time session-date handling.
- Added a five-minute candle completeness check for expected regular-session timestamps.
- Added validation that five-minute candles have finite high, low, and close values, plus finite positive volume.
- Preserved hourly scanner availability when the five-minute data request fails or VWAP cannot be calculated.
- Added a `regularSessionCandles` helper to `src/data/scannerSnapshot.test.js`.
- Added tests for missing opening, middle, and final five-minute candles.
- Updated tests for VWAP calculation and out-of-order five-minute candles.

### Latest verification
- Automated tests: **643 passed, 0 failed**.
- Production build: successful.
- Vite reports a nonfatal warning because the main JavaScript bundle exceeds 500 kB after minification.
- The paper trader and live-trading functionality were not intentionally changed as part of this VWAP work.

### Current files directly involved
- `src/data/scannerSnapshot.js`
- `src/data/scannerSnapshot.test.js`

Other existing modifications and backup files are present in the repository. Do not reset, clean, or revert unrelated files.

### Known issues requiring follow-up
The VWAP completeness helper still needs refinement before it can be considered reliable across all market sessions.

1. It assumes the evaluation cutoff aligns with a five-minute candle boundary. Seconds, milliseconds, or different provider timestamp conventions may cause incorrect validation.
2. The after-hours cutoff behavior needs correction. The helper currently bypasses its completeness check when the evaluation time is after 4:00 p.m. Eastern.
3. Exchange holidays and shortened trading sessions are not fully validated against an official market calendar.
4. Real Alpaca historical data has not yet been validated against the new completeness logic.
5. Candle timestamps and ordering through the historical-data pipeline still need to be verified.

### Next session — resume here
1. Inspect the current `hasMissingFiveMinuteCandles` implementation in `src/data/scannerSnapshot.js`.
2. Correct evaluation-cutoff alignment and regular-session cutoff handling without changing unrelated scanner behavior.
3. Add targeted tests for timestamps with seconds or milliseconds, after-hours evaluation cutoffs, shortened sessions, and missing or delayed market data.
4. Run `npm.cmd test`; resolve failures before proceeding.
5. Run `npm.cmd run build` after the tests pass.
6. Inspect the historical-data pipeline and validate timestamp assumptions against real Alpaca historical candles, if available.
7. Keep research-scanner changes separate from the paper trader and live-trading functionality.

### Working instructions
- The user is new to coding and needs exact file names and precise code blocks or line-specific editing instructions.
- In PowerShell, use `npm.cmd` rather than `npm`.
- Preserve existing work and backups. Do not use destructive Git cleanup or broad reverts.
- Explain technical terms in plain English.
- Do not claim that passing tests proves real-market reliability.
- Do not enable live trading or change the paper trader as part of this work.
