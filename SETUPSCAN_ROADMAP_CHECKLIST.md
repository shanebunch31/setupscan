# SetupScan Roadmap / To-Do Checklist

**Last organized:** October 28, 2026  
**Source:** Canonical SetupScan project memory plus the current project session.  
**Purpose:** A practical, prioritized checklist. The full project memory remains the detailed source of truth for architecture, evidence, decisions, and historical context.

---

## Status Key

- [x] Completed / validated
- [~] In progress / active
- [ ] Not started / remaining
- [!] Safety or readiness gate — do not skip

---

# 1. Active Now

## Multi-Timeframe Execution Resolution Study — Completed
- [x] Implement `candidate-execution-resolution`; corrected methodology is `candidate-execution-resolution-3`.
- [x] Keep the **Trend Up + Medium Volatility** hourly candidate definition frozen.
- [x] Compare the current next-1Hour-bar-open execution with the first valid 5Min execution opportunity after the same completed hourly decision.
- [x] Enforce the same hourly signal population, no lookahead, identical shared 12-observed-hourly-bar deadline, and paired evaluation.
- [x] Support SPY, QQQ, and IWM separately with full / development / recent / yearly views and 0R / 0.02R / 0.05R / 0.10R modeled costs.
- [x] Report entry delay, entry price, expectancy, total R, win rate, profit factor, max drawdown, holding time, exit reasons, outcome changes, and paired Eastern-date concentration checks.
- [x] Add normalized Workbench / saved-run output without beginning the broad UI redesign.
- [x] Fix real-provider coverage defect: extended-hours 5Min gaps are no longer treated as missing solely because an hourly aggregate bar exists; regular-session missing bars still exclude; no synthetic/forward-filled prices.
- [x] Preserve compatibility by advancing corrected evidence to v3; v2 remains incompatible.
- [x] Real SPY 2026 validation after the v3 fix: 20 common signals, **17 paired resolved**, 3 excluded; the prior defective logic falsely excluded 20/20.
- [x] Broader SPY 2022–present review: **183 common signals, 162 paired, 21 excluded**; all 162 paired entries had the same entry price; 0 improved / 4 worsened R outcomes; 5Min minus hourly total difference about **-0.74R**.
- [x] Manually inspect the four changed SPY trades: all four were stop exits; 5Min exposed worse adverse stop fills/intrabar path, accounting for essentially the entire -0.74R difference.
- [x] QQQ 2022–present review: **211 common signals, 189 paired, 22 excluded**; all 189 paired entries had the same entry price; 1 improved / 7 worsened outcomes; full-sample 5Min difference **+2.27R**, driven primarily by one 2023 trade rather than a repeatable entry advantage; recent 2025–2026 results were effectively identical.
- [x] IWM 2022–present review: **212 common signals, 207 paired, 5 excluded**; all 207 paired entries had the same entry price; 0 improved / 5 worsened outcomes; full-sample 5Min difference **-2.10R**.
- [x] Cross-symbol conclusion: **do not create a separate 5Min execution challenger** from this evidence. Keep **1Hour as the setup/decision timeframe** and retain **5Min as an execution/outcome-resolution realism layer**.
- [x] Record robustness caution: IWM remains weaker/concentrated; QQQ remains regime/year dependent; SPY remains the primary personal symbol.
- [x] Final verification before commit: **1002/1002 tests passed**, production build passed, `git diff --check` passed; prior Shadow fingerprint check unchanged.
- [x] Commit `e7958fc` created and pushed to GitHub on October 24, 2026.
- [x] Resolve saved-run provenance mismatch: stale `718f189` came from a Vite process started before commit `e7958fc`; restarting Vite caused new persisted runs to record the correct full revision `e7958fc11fb17be7f309d2f81197ce781f6972d9` with no code change required.
- [ ] Low-priority data-quality follow-up: classify the remaining broad-run coverage exclusions (SPY 21, QQQ 22, IWM 5) as genuine missing regular-session data vs holidays/early closes; do **not** weaken completeness checks or synthesize prices.

---

# 2. Shadow Forward — Active Forward Evidence Collection

## Current frozen candidate
- [x] Candidate: `trend-up-medium-volatility-v1`.
- [x] Historical methodology: `candidate-context-robustness-2`.
- [x] Forward protocol: `shadow-forward-1`.
- [x] Universe initially limited to SPY + QQQ.
- [x] Separate research-only worker.
- [x] Hosted PostgreSQL persistence.
- [x] Reporting kept private/disabled initially.
- [x] First real baseline established without historical backfill.
- [x] Storage/bootstrap reliability bugs fixed and committed.
- [~] Keep the local Shadow Forward worker running while collecting evidence.

## Forward evidence milestones
- [ ] Review at ~30 resolved occurrences — early review only.
- [ ] Review at ~50 resolved occurrences — meaningful descriptive sample.
- [ ] Review at 100+ resolved occurrences — stronger descriptive evidence.
- [!] Never auto-promote at any milestone.
- [!] Never retune the frozen candidate in place because forward results are weak.
- [ ] If a materially different rule is tested later, create a new candidate/version and separate forward tracker.

## Operational follow-up
- [x] Validate real Shadow worker baseline/persistence and no-backfill behavior.
- [x] Confirm that private/disabled browser reporting does **not** mean the worker is stopped.
- [~] After the October 2026 Windows-update shutdown, restart/verify the local worker and continue untouched forward collection.
- [ ] Add a clearer operator status/stop workflow eventually.
- [ ] Consider safe auto-start/restart behavior later; do not compromise no-backfill rules.
- [ ] Keep PC awake/online when relying on local forward collection; missed detections are intentionally not backfilled.

---

# 3. Candidate Exit Management Research

## Completed core research
- [x] Implement `candidate-exit-management`.
- [x] Methodology: `candidate-exit-management-1`.
- [x] Compare fixed exit vs trailing exit using identical candidate signals and entries.
- [x] Fixed baseline retains existing initial stop, 2R target, 12-bar hold.
- [x] Trailing challenger activates at +1R and trails 0.3%.
- [x] Real persisted historical run completed for SPY, QQQ, IWM.
- [x] Run saved successfully after API restart.
- [x] Main finding:
  - SPY trailing raises win rate but slightly lowers full-sample expectancy;
  - QQQ trailing helps some periods but is regime-dependent;
  - IWM generally does not improve.
- [x] Treat trailing as a challenger, not a replacement.

## Remaining exit-management follow-up
- [ ] Build dedicated beginner-friendly Workbench result renderer.
- [ ] Show fixed vs trailing side-by-side by symbol.
- [ ] Show common trade count / evidence strength.
- [ ] Show win rate, expectancy, total R, PF, max drawdown, holding time, exit reasons, ambiguity.
- [ ] Show all modeled cost tiers.
- [ ] Show full / development / recent / yearly slices.
- [ ] Surface baseline / remove top 5 / remove top + bottom 5 robustness outputs.
- [ ] Clearly disclose that current concentration removals are independently ranked per exit method.
- [ ] Add stricter paired concentration view that removes the **same signal days** from fixed and trailing.
- [ ] Only after robust evidence, consider a narrow parameter-sensitivity study near +1R / 0.3%.
- [!] Avoid broad trailing-stop grid searches that encourage overfitting.
- [ ] If trailing becomes compelling, create a separate forward challenger instead of modifying the active fixed-exit Shadow tracker.

---

# 4. Research Workbench / Investigations Upgrade

## Guided follow-up workflow
- [ ] Make Suggested Follow-up Questions visible inside Investigation detail.
- [ ] Each suggestion should show:
  - what SetupScan noticed;
  - why it matters;
  - the research question;
  - suggested experiment/view;
  - Investigate button.
- [ ] Investigate should preload Workbench but never auto-run.
- [ ] Track suggested / investigated / dismissed state.
- [ ] Show which saved run answered each follow-up.
- [ ] Keep question, plan, attached runs, evidence summary, and follow-up trail together.

## Trade-management controls
- [ ] Keep signal/setup parameters visually separate from trade-management parameters.
- [ ] Add:
  - exit mode: fixed / trailing;
  - initial stop;
  - trailing enabled;
  - trailing activation in R;
  - trailing distance;
  - profit target;
  - max holding bars.
- [ ] Add Exit Management Investigation suggestions when drawdown, concentration, or exit-profile differences justify them.

## Result presentation
- [ ] Fix React duplicate-key warning in `ResearchRunDetail.js` (`SPY` appears as a duplicate child key in the saved-run detail UI); UI-only cleanup, not a research-calculation defect.
- [ ] Add experiment-specific “View Results” renderers.
- [ ] Reuse existing detailed result components where practical.
- [ ] Improve evidence hierarchy and beginner definitions.
- [ ] Add meaningful tables/charts without making weak evidence look authoritative.
- [ ] Improve Workbench/Lab navigation.
- [ ] Review responsive/browser/mobile behavior.

## Plain-English result summaries / Interpretation Layer v1
- [x] Product requirement confirmed: SetupScan must explain research results well enough that a beginner can understand **what was found, what it means, what it does not prove, and what to investigate next**.
- [ ] Deterministically summarize:
  - Main finding / bottom line;
  - Why it matters;
  - Key evidence;
  - Evidence strength / trust level;
  - Stability across symbols, years, regimes and recent periods;
  - Main strength;
  - Main concern / what could mislead us;
  - What this result does **not** prove;
  - Production decision: NO CHANGE / NEEDS MORE RESEARCH / PROMISING CANDIDATE / READY FOR FORWARD VALIDATION / REJECT-DEPRIORITIZE;
  - Recommended next investigation;
  - Evidence that triggered that recommendation.
- [!] Ground the official interpretation only in SetupScan's structured results and frozen rules.
- [ ] Optional AI may later improve wording/natural-language explanation, but it must remain a **translator/research assistant**, not the authority that promotes strategies or changes rules.
- [ ] Use the Scanner Component Ablation run as the first acceptance example for Interpretation Layer v1.

---


## Live scanner VWAP cache defect — Fixed October 27, 2026
- [x] Reproduced VWAP unavailable across multiple active symbols during the regular session while hourly indicators remained available.
- [x] Root cause: `isWeekendOnlyGap()` treated a same-UTC-day intraday cache gap as weekend-only, so stale 5Min cache data could be reused without fetching the missing tail.
- [x] Fixed historical-route cache coverage so same-day stale tails fetch and merge correctly without duplicates.
- [x] Added structured VWAP diagnostics and regression coverage for healthy sessions, provider failures, wrong-day/future bars, mixed completed/incomplete bars, coverage, and timezone handling.
- [x] Verification: focused tests 74/74; full suite 1,104/1,104; build passed; `git diff --check` passed aside from line-ending notices.
- [x] Manual live verification after server restart: SPY, QQQ, NVDA, AMD all showed evaluable Price vs VWAP instead of unavailable.
- [x] Commit `8d6e0a0` pushed to `codespace-cautious-winner-4qvw96g6qwg6f6vw`; working tree clean.
- [!] Genuine provider/data gaps must still remain unavailable; do not fabricate VWAP.

# 5. Candidate / Context Research Still Open

## Trend Up + Medium Volatility
- [x] Joined causal context study identified this as the strongest current candidate.
- [x] Candidate robustness study completed.
- [x] SPY historically more stable than QQQ but still concentrated in strong days.
- [x] QQQ strongest recent behavior but more regime/sample dependent.
- [x] IWM retained only as comparison/reference.
- [x] Execution-resolution v3 expanded across SPY / QQQ / IWM and broad history; conclusion: **do not create a separate 5Min execution challenger**.
- [~] Continue collecting genuine frozen Shadow Forward evidence without retuning.

## Scanner component ablation — Completed first pass
- [x] Implement and persist `scanner-component-ablation` / `scanner-component-ablation-1`.
- [x] Real historical run completed on SPY, QQQ, IWM, 1Hour, 2022-01-01 through 2026-10-27: **28,920 observations**, **3,180 baseline research-eligible**, **322 Qualified**.
- [x] Confirm EMA9 > EMA21 and Bullish Trend were perfectly redundant in this dataset: **16,094 both true, 0 EMA-only, 0 Trend-only, 12,826 neither, phi = 1.0**.
- [x] Confirm counting EMA/Trend once shrank eligibility to **494 (15.5%)** and improved full-sample expectancy from **0.092R to 0.189R**, but the improvement was not stable enough to justify a production change.
- [x] Record instability: strong improvement in 2022-2024, little improvement in 2025, worse in 2026 YTD; SPY/IWM improved while QQQ slightly worsened.
- [x] Record regime evidence: EMA/Trend-once improved Uptrend, Medium-volatility and Low-volatility subsets, but worsened Mixed-trend results.
- [x] Record that Breakout/Reclaim removal reduced overall expectancy and also hurt Uptrend/Medium-volatility subsets; treat Breakout as potentially useful independent information, not proven optimal weighting.
- [!] **No production scanner-score change from this ablation alone.**

## Scanner Score Redundancy / Stability Study — Completed October 28, 2026
- [x] Implement and persist `scanner-score-redundancy-stability` / `scanner-score-redundancy-stability-1`.
- [x] Real historical run completed on SPY, QQQ, IWM, 1Hour, 2022-01-01 through 2026-10-28.
- [x] Compare the predeclared variants only: baseline; keep EMA/remove Trend; keep Trend/remove EMA; shared trend family 20; shared trend family 15.
- [x] Compare fixed 75-point floor and mechanically normalized 75%-of-maximum floors (64 for max 85; 60 for max 80); no optimizer/grid search.
- [x] Full-sample strict variants improved expectancy versus baseline, but retained only about 10–16% of baseline-eligible observations.
- [x] The apparent improvement was **not stable**: strong in 2022–2024, but weaker or negative versus baseline in 2025–2026 YTD.
- [x] Symbol split was contradictory: SPY improved historically, QQQ generally worsened, and IWM was mixed / often sample-limited.
- [x] Mechanically adjusted variants retained about 71–72% of baseline observations and produced only a very small full-sample expectancy lift (~0.007R), with recent evidence slightly worse than baseline.
- [x] Confirm equivalent/dependent variants are not independent confirmations: keep-EMA == shared-20 under matching threshold mode; keep-Trend == shared-15 under matching threshold mode on this dataset.
- [x] Deterministic conclusion: **MIXED / UNSTABLE — no production score change**.
- [x] Preserve production scanner scoring, Qualified/Potential definitions, Paper Trader eligibility, and active Shadow Forward candidate unchanged.
- [!] Historical hourly VWAP in this study follows the Signal Quality research path, not the live scanner's separate 5Min VWAP input; keep that limitation attached to the evidence.
- [ ] Relative-volume qualification / score-credit research remains later.
- [ ] Continue Breakout/Reclaim validation by year/regime/symbol/cost.
- [ ] Continue score × regime interaction research before changing production thresholds.

## Qualification Stack / Condition Count Study — Planned after redundancy/stability
- [ ] Test whether requiring **all six current production conditions** actually produces better trades than 5-of-6, 4-of-6, and lower-condition populations.
- [ ] Break 5-of-6 and other partial stacks down by **which specific condition is missing** (VWAP, EMA, RSI, RVOL, Breakout/Reclaim, Trend) rather than treating all partial stacks as equivalent.
- [ ] Report both the **current six-condition view** and an **independent-condition view** that treats EMA/Trend as one shared trend-confirmation family if the redundancy finding remains valid.
- [ ] Compare condition-count/stack populations across SPY, QQQ, IWM; years; causal regimes; recent/holdout periods; costs; sample size; expectancy; profit factor; max drawdown; win rate; and concentration.
- [ ] Answer two separate questions: **(1) does more independent confirmation improve trade quality? (2) which missing condition changes outcomes the most?**
- [ ] Do not assume 6-of-6 is best simply because it is called Qualified, and do not change Qualified/Potential definitions from this study alone.
- [ ] Use the study to inform later threshold/qualification research only after the Scanner Score Redundancy / Stability Study establishes how duplicated trend credit should be handled.

---

# 6. Scanner / Score Research

## Current production-score facts — preserve unless separately reviewed
- [x] Price above VWAP = 20.
- [x] EMA9 > EMA21 = 20.
- [x] RSI 55–70 = 15; partial 8 for 45–<55.
- [x] RVOL >=1.2 = 15; partial 8 for >=1.0.
- [x] Breakout = 15.
- [x] Bullish Trend = 15.
- [x] Qualified requires all six full conditions and therefore equals score 100.
- [x] Potential = not Qualified, score >=75.
- [x] Paper observer currently uses Qualified-only eligibility.

## Open scoring research
- [x] Establish the first component-ablation baseline and identify exact EMA/Trend redundancy.
- [!] Do not change production scoring from descriptive component tables or smaller high-expectancy subsets alone.
- [!] Keep Setup Score separate from probability-of-win language.
- [x] Complete the predeclared **Scanner Score Redundancy / Stability Study**; conclusion: MIXED / UNSTABLE, no production score change.
- [ ] Next scanner study after paper-observer health is confirmed: **Qualification Stack / Condition Count Study** to test whether all six current qualifying conditions are necessary and which missing components matter most.
- [ ] Compare cumulative thresholds: 75+, 80+, 85+, 90+, 95+, exactly 100 where the score definition makes those thresholds meaningful.
- [ ] Preserve year/regime/symbol/recent-period breakdowns in every future scoring revision.
- [~] Investigate why score behavior was stronger in 2023–2024 than 2025–2026; the ablation study now confirms recent-period instability is material.
- [ ] Determine which independent score components disproportionately populate the highest score bands after redundancy is addressed.
- [ ] Do not finalize a paper minimum score until score × regime behavior is understood.
- [ ] Version any future scoring revision and test one controlled change at a time.

---

# 7. Paper Trader Follow-Up

## Paper provenance / observer health audit — URGENT before next scanner study
- [~] Investigate the earlier AAPL Qualified-with-no-paper-trade case **and the October 28 AMD case**, where the live Scanner showed AMD as a 100/100 Qualified Setup but no paper trade appeared.
- [~] Investigate the broader operational symptom: **no visible new paper trade for roughly one week** as of October 28, 2026.
- [ ] First determine whether this is a normal semantics/timing difference or an observer reliability problem; the live scanner and Paper Observer do not necessarily evaluate the same bar at the same moment.
- [ ] Check, in order:
  - whether the Paper Observer process is currently running and cycling on schedule;
  - persisted paper-universe membership for AMD, AAPL, and other expected symbols;
  - latest observer checkpoint / last processed completed 1Hour decision bar per symbol;
  - observer health / overdue-cycle / provider/data-freshness state;
  - exact AMD decision bar/time that was Qualified in the live scanner versus the observer's completed-1Hour decision semantics;
  - observer-calculated score/setup state for that same completed decision bar;
  - whether a first adjacent completed post-detection entry bar became available;
  - dedupe/existing-trade rejection;
  - provider/data failure or incomplete candle handling;
  - persisted database write/CAS result and any uncertain-commit protection event.
- [ ] Reconcile whether the apparent week-long silence is explained by no observer-side Qualified signals or by missed/stalled processing.
- [!] Do not manually create or backfill a historical paper trade merely to make the journal match the live scanner.
- [!] Do not weaken completed-1Hour, Qualified-only, or freshness rules merely to force a trade.

## Terminology / explanations
- [ ] Clarify legacy `Signal candle` vs newer `Detected` wording.
- [ ] Explain that 1R = planned risk, not a guaranteed maximum loss if price gaps through a stop.
- [ ] Preserve historical records rather than rewriting them.

## Paper-observer operational readiness
- [x] Harden PostgreSQL client/error handling and stale multi-process writer/CAS protection.
- [x] Recover open positions without requiring the original signal candle.
- [x] Add provider/data freshness checks, provider timeouts, partial-failure reporting, and overdue-cycle health.
- [x] Add bounded database-operation deadlines and uncertain-COMMIT protection.
- [x] Add graceful shutdown/drain behavior with bounded shutdown timeout and idempotent repeated stop/signals.
- [x] Validate Qualified-only, long-only, completed-1Hour-candle paper semantics including stop/target ambiguity, gaps, trailing behavior and 12-bar time exit.
- [x] Final architecture readiness audit at commit `4519721` returned **READY for unattended PERSONAL PAPER OBSERVATION using PostgreSQL-backed worker**.
- [!] This readiness result is **not** live-trading readiness, profitability validation, or hosted-deployment verification.
- [ ] Continue ordinary operational observation for real market-open/closed/provider/restart behavior; treat issues as reliability defects if discovered.
- [ ] Paper provenance audit for the earlier AAPL case remains separate and open.

---

# 8. Backup / Recovery / Data Safety

- [ ] Confirm the configured Supabase/PostgreSQL identity before any destructive history operation.
- [ ] Create a recoverable PostgreSQL backup using a safe method.
- [ ] Preserve the local JSON paper journal separately.
- [ ] Verify hashes where appropriate.
- [ ] Restore the database backup into an isolated database.
- [ ] Compare schema, counts, run IDs, dataset links, and paper records.
- [ ] Preserve PostgreSQL observer history and JSON journal until their roles are fully reconciled.
- [!] Never reset/clear research or paper history without a verified recovery path.

---

# 9. Full UI Upgrade — Deferred Until Current Research/Forward Work Is Stable

- [ ] Evidence-first redesign of research pages.
- [ ] Stronger visual hierarchy.
- [ ] Consistent status styling.
- [ ] Beginner-friendly definitions next to technical metrics.
- [ ] Better charts where they materially improve understanding.
- [ ] Clear sample size, exclusions, cost assumptions, and OOS status.
- [ ] Avoid presenting rule-based scores as probabilities.
- [ ] Consider a concise Research overview only if the audited workflow proves it is useful.
- [ ] Do not restore deleted Daily Research Results merely because older notes mention it.

---

# 10. Strategy Catalog Expansion — Later

## Preserve current implemented families
- [x] Momentum / Breakout.
- [x] Mean Reversion.
- [x] Prior-Day Reclaim.
- [x] Volatility Compression → Expansion.

## Future setup hypotheses
- [ ] Bullish trend continuation.
- [ ] Bearish trend continuation.
- [ ] VWAP reclaim.
- [ ] VWAP rejection.
- [ ] VWAP pullback continuation.
- [ ] Prior-day high reclaim.
- [ ] Prior-day low reclaim / breakdown.
- [ ] Support breakdown.
- [ ] Resistance breakout.
- [ ] Failed breakout.
- [ ] Failed breakdown.
- [ ] Opening-range breakout.
- [ ] Opening-range failure / reversal.
- [ ] Trend pullback continuation.
- [ ] Extreme-deviation mean reversion.
- [ ] Failed extension / exhaustion reversal.
- [ ] Relative-strength continuation.
- [ ] Relative-weakness continuation.
- [ ] Volatility compression followed by expansion.

## Research guardrails
- [ ] Keep the catalog curated (~12–20 genuinely different hypotheses).
- [ ] Test bullish and bearish hypotheses independently.
- [ ] Track multiple-testing / false-discovery risk.
- [ ] Prefer fewer well-defined strategies over many overlapping combinations.

---

# 11. Options Mode / Personal-Use v1 Roadmap

## Architecture principle
- [x] Keep the current scanner as the **underlying signal engine**.
- [ ] Add Options Mode as an additive layer, not a replacement scanner.
- [ ] Keep Underlying Setup Score separate from Option Contract Quality.

## Options market-data layer
- [ ] Add reliable option-chain data:
  - calls / puts;
  - strike;
  - expiration;
  - bid / ask;
  - midpoint / mark;
  - volume;
  - open interest;
  - IV;
  - delta / gamma / theta / vega;
  - underlying price and timestamp/provenance.
- [!] Missing/stale options data must produce unavailable / no recommendation.

## Contract selection
- [ ] Bullish qualified setup → evaluate long calls.
- [ ] Bearish qualified setup → evaluate long puts.
- [ ] Research DTE.
- [ ] Research delta.
- [ ] Research moneyness/strike.
- [ ] Research acceptable spread.
- [ ] Research liquidity / volume / open interest.
- [ ] Research IV context.
- [ ] Research max premium / affordability.
- [ ] Do not assume cheapest contract is best.

## Options research
- [ ] Build historical options methodology.
- [ ] Model realistic fills / spread / slippage.
- [ ] Account for time decay and IV effects where data permits.
- [ ] Compare underlying-based vs premium-based stops/targets.
- [ ] Keep underlying research conclusions separate from option-contract conclusions.
- [!] Mark results preliminary/unavailable when historical chain data is insufficient.

## Options paper trading
- [ ] Support long calls.
- [ ] Support long puts.
- [ ] Extend journal with strike, expiration, DTE, premium, contracts, Greeks/IV snapshot, setup, entry/exit reason, provenance.
- [ ] Validate restart/recovery and expiration handling.

## Bearish research
- [ ] Build independent bearish setup research.
- [ ] Do not simply invert bullish rules.
- [ ] Validate long-put behavior separately.

## v1 options safeguards
- [x] No naked short options in v1.
- [ ] No option recommendation when underlying setup is unqualified.
- [ ] No option recommendation when required contract data is unavailable.

---

# 12. Research-to-Paper Promotion Flow — Later

- [ ] Research identifies a reproducible candidate.
- [ ] Research validates robustness, costs, OOS evidence, and limitations.
- [ ] SetupScan may label it **Recommended for Paper Testing**.
- [ ] Recommendation shows exact rules, threshold, universe, timeframe, and evidence.
- [ ] User explicitly approves promotion.
- [ ] Paper Trader begins forward testing from that point only.
- [ ] No retrospective paper entries.
- [ ] Compare historical expectation vs actual forward paper performance.
- [ ] Define a future **Paper Validated** status with explicit criteria.
- [!] Paper validation must never automatically authorize live trading.

---

# 13. Longer-Term Product / Operations Features

## SetupScan Home / Morning Brief — Product requirement
- [x] Build the first compact daily landing page / Morning Brief for routine use; keep it concise rather than turning it into another giant dashboard.
- [x] Show market open/closed state and current ET time.
- [x] Surface scanner/market-data health in the Home/top-bar shell; continue refining deeper provider/observer diagnostics separately.
- [x] Summarize active paper positions from the persisted paper journal; strategy/forward-testing summary remains a refinement.
- [x] Highlight strongest current Qualified/Potential setups without presenting Setup Score as win probability.
- [~] Summarize recent research runs since the previous visit; upgrade to persisted findings/synthesis and meaningful Shadow Forward evidence is tracked in the separate UI refinements checklist.
- [ ] Flag strategies with weakening forward evidence or other items that require user attention.
- [ ] Keep the brief evidence-first and drill-down oriented: each summary should link into the relevant Scan, Paper, Research, or diagnostics view instead of duplicating full detail.
- [ ] Explain why nothing happened when there are no setups, no new research, or insufficient evidence; do not turn a valid quiet day into an error state.

## Permanent chart rule — Candlesticks for price action
- [!] When the UI is showing OHLC/price-action data and candle data are available, use a **candlestick chart by default** rather than replacing it with a generic line chart.
- [!] Preserve timeframe controls and readable price/time axes; show volume beneath price when it materially helps interpretation.
- [!] Scanner selected-setup detail and Paper Trading selected-position/trade detail should use candlesticks when appropriate, matching the approved UI mockups.
- [!] Backtest/Research performance views should still use the chart type that matches the question: equity curves for cumulative performance, bars for discrete comparisons, histograms for R/outcome distributions, drawdown charts for drawdown, and candlesticks only for underlying price-action views.
- [!] Charts must explain evidence rather than decorate it: label what is measured, expose tooltips/legends where useful, and never make weak evidence look more authoritative.


- [ ] Strategy Passports / versioned Strategy Cards.
- [ ] Edge-Decay Monitor comparing forward results to historical expectations.
- [ ] Multiple-testing / false-discovery protection.
- [ ] Data Health Center.
- [ ] “Why No Trade?” explanations.
- [ ] Portfolio / correlation risk layer.
- [ ] Market Replay / Decision Replay.
- [ ] Research Receipts.
- [ ] Security / Operations Center.
- [ ] Trading Disabled / Kill Switch state before any future live automation.
- [ ] Options Contract Replay / Selection Audit.
- [ ] Compact SetupScan Home / Morning Brief.

---

# 14. Live Automation — Much Later Safety Gate

- [!] No live trading is enabled now.
- [!] Do not place live orders.
- [!] Do not expose privileged broker/order credentials to browser code.
- [ ] Complete underlying research reliability.
- [ ] Complete options data/research/paper workflow.
- [ ] Complete backup/recovery validation.
- [ ] Complete operational/security controls.
- [ ] Build a risk engine that can veto trades.
- [ ] Only after explicit user approval, consider manual live → limited automation → managed automation in stages.

---


# 14A. Curated Research Evidence / Product Transparency — Added October 28, 2026

- [x] Create `/SetupScanApp/SETUPSCAN_RESEARCH_EVIDENCE.md` as the permanent human-readable research record.
- [x] Preserve technical Run IDs, methodology IDs, raw metrics, evidence entries, and provenance in Research Workspace; do not replace the technical audit trail with summaries.
- [x] Record both successful and failed/unstable studies so SetupScan can show how decisions were made rather than only displaying winning results.
- [x] Record explicit **production impact** for each major study, including `NO PRODUCTION CHANGE` when evidence is not stable enough.
- [!] Treat this record as evidence of a real research process, **not proof of future profitability**.
- [!] Do not silently rewrite an old study conclusion after later evidence arrives. Add a dated follow-up, superseding study, or updated status so the historical research trail remains auditable.
- [ ] Build an in-app **Research Evidence** section under **About SetupScan / What Is SetupScan** rather than burying the primary explanation in Settings.
- [ ] Let users drill from a curated study summary into its technical Research Run / methodology details when available.
- [ ] Add beginner-friendly definitions beside technical terms such as expectancy, R, profit factor, drawdown, regime, volatility, sample size, and forward validation.
- [ ] Show evidence status clearly, using supported states such as:
  - `SUPPORTED FOR FURTHER STUDY`
  - `MIXED / UNSTABLE`
  - `REJECTED / NOT PROMOTED`
  - `FORWARD VALIDATION IN PROGRESS`
  - `NO PRODUCTION CHANGE`
- [ ] During the Plain-English Explanation upgrade, use the curated research record as the editorial reference for tone and structure while keeping live summaries deterministic and grounded in structured run data.
- [ ] Add a brief **How SetupScan researches strategies** explanation covering: historical research → robustness/stability checks → explicit rejection of unstable ideas → frozen forward validation → user-approved promotion gates.
- [ ] Make limitations visible: historical evidence is not a guarantee, underlying-stock research is not options-fill evidence, small samples are not proof, and repeated historical follow-up is not an untouched holdout.

---

# 15. Permanent Guardrails

- [!] Reliability and research integrity outrank UI polish.
- [!] Scanner scoring stays unchanged unless a separately reviewed research decision approves a new version.
- [!] Qualified / Potential definitions remain unchanged unless explicitly reviewed.
- [!] Paper Trader remains separate from Research recommendations.
- [!] Never silently promote research into Paper Trader.
- [!] Never silently promote Paper Trader into live trading.
- [!] Preserve existing paper history and research history.
- [!] Preserve conservative stop-first ambiguity handling unless separately researched/versioned.
- [!] Prefer isolated/local PostgreSQL for schema/integration validation before touching production.
- [!] Use `npm.cmd ...` in PowerShell.
- [!] For Codex tasks, always specify recommended model and thinking level.
- [!] Explain technical terms in plain English for beginner usability.

---

# Recommended Priority Order From Here

1. [~] **Keep Shadow Forward collecting untouched** and verify/restart it after workstation interruptions; review only at the predefined ~30 / 50 / 100+ milestones.
2. [~] **Paper Observer operational reliability remains the immediate engineering priority.** The scanner watchlist is now synchronized with the persisted Paper Observer universe, so symbols added in SetupScan are monitored by the observer after confirmed persistence. Next, add/verify visible worker-health and provenance warnings so the app cannot look healthy while the worker is stopped.
3. [x] **Scanner Score Redundancy / Stability Study completed:** MIXED / UNSTABLE; older-history improvement did not persist into 2025–2026; no production score change.
4. [x] **Qualification Stack / Condition Count Study completed:** MIXED / UNSTABLE overall; the strongest recurring historical context is **Uptrend / Medium Volatility**; Breakout/Reclaim appears especially important there; RSI appears less essential in some favorable/recent contexts; no production score change.
5. [x] **Create a curated permanent research-evidence record:** `/SetupScanApp/SETUPSCAN_RESEARCH_EVIDENCE.md`. Use it as the plain-English record of completed studies, conclusions, limitations, production decisions, and forward-validation status while preserving raw Run IDs in Research Workspace.
6. [ ] Complete **backup/recovery readiness** for research/paper PostgreSQL data and local journal.
7. [ ] **Interpretation Layer v1:** implement deterministic beginner-friendly research summaries. Use `SETUPSCAN_RESEARCH_EVIDENCE.md` as the reference style/source for human-readable explanations, but generate in-app summaries from actual structured run evidence rather than static text.
8. [ ] Add a curated **About SetupScan / What Is SetupScan → Research Evidence** section that explains what was tested, what was learned, what was rejected, and what is still being forward-validated. Keep Settings for controls/preferences rather than making it the primary research-history surface.
9. [ ] Complete deferred **Candidate Exit Management detailed UI + paired concentration comparison** when it can be bundled efficiently.
10. [ ] Continue controlled component/threshold research only when a specific unresolved question justifies it; do not start a broad optimizer. Current high-value follow-up questions include regime-aware interpretation, the role of RSI in favorable/recent contexts, and whether Mixed + High volatility should become an avoidance candidate after sufficient validation.
11. [~] Continue the broader **Research Terminal UI migration** in controlled batches; Scan + Home/Morning Brief foundation are implemented, while Paper Trading / Backtest / Research refinements remain in the separate UI checklist.
12. [ ] Begin additive **Options Mode / options research** only after the underlying score/research workflow is trustworthy enough to serve as its signal layer.
13. [!] Only much later, after research + paper + backup/risk/security gates, consider any live automation.

## Codex-credit efficiency rule
- [!] Do not turn every research idea or UI improvement into a separate Codex task.
- [x] Use ChatGPT conversation time for interpretation, prioritization, experiment design, result review and prompt preparation.
- [ ] Reserve Codex primarily for code changes, difficult repo audits and implementation verification.
- [ ] Batch tightly related implementation work into one well-scoped prompt when safe, while avoiding oversized prompts that mix unrelated high-risk systems.
- [ ] Keep a backlog of good ideas instead of interrupting the current readiness sequence.
- [!] When Codex capacity is limited, prioritize **research integrity / safety / persistence / high-value experiments** over cosmetic polish.

## UI Migration Guardrails — October 27, 2026

### Figma / mockup source-of-truth rule
- [!] Use the approved SetupScan UI mockups / Figma Research Terminal as the **visual and layout source of truth** for shell, spacing, cards, tables, navigation, density, chart placement, hierarchy, and interaction feel.
- [!] Use the **real SetupScan application and research architecture as the terminology, data, metric, status, and feature source of truth**.
- [!] Do not add product claims, metrics, controls, strategy names, setup names, alerts, account states, or trading capabilities merely because they appear in a visual prototype.
- [!] Prototype/demo numbers must never replace live or persisted SetupScan values in production UI.

### Current terminology guardrail
- [!] Do not label current setups with unresearched named chart/candlestick patterns such as **Bull Flag**, **Engulfing**, **Wedge**, etc. unless that setup family has first been implemented as a defined research methodology and validated through SetupScan research.
- [!] Current scanner language should prefer existing supported concepts such as **Qualified Setup**, **Potential Setup**, **No Setup**, setup score, VWAP, EMA alignment, RSI momentum, relative volume, breakout/reclaim, and trend confirmation.
- [!] Candlestick **charts** are allowed and preferred for price-action visualization; this does not imply candlestick-pattern research has been implemented.

### Chart presentation rule
- [!] Use candlestick charts by default for symbol price-action views when OHLC candle data is available and a candle view is meaningful (for example Scan selected-symbol detail and Paper Trading position detail).
- [!] Continue using equity curves, bar charts, distributions, drawdown charts, benchmark comparisons, heatmaps, and other chart types where they are the correct representation of research/performance evidence.
- [!] Charts must remain evidence-first: labeled axes, clear timeframe, tooltips/hover where practical, and no decorative chart that implies unsupported precision.

### Morning / Daily Brief
- [ ] Build the planned compact **SetupScan Home / Morning Brief** as a later controlled UI batch.
- [ ] Keep it concise and operational rather than another giant dashboard.
- [ ] Candidate sections: market status/ET time, data-health warnings, active paper positions, strategies currently in paper testing, strongest current Qualified/Potential setups, research completed since the previous visit, weakening forward evidence, and items requiring attention.
- [!] Morning Brief content must be sourced from real SetupScan state/evidence; do not fabricate news, strategy conclusions, probabilities, or trade recommendations.

### UI implementation sequencing
- [x] First redesign batch complete: global Research Terminal shell + Scan page, preserving current scanner calculations, filters, statuses, watchlist behavior, refresh/data-quality handling, routing, and selected-symbol explanation logic.
- [x] Replace prototype-only scan labels such as "Bull Flag" and generic "high-probability" wording with current SetupScan terminology and actual condition evidence.
- [x] Bind summary cards to actual current scanner metrics rather than prototype placeholders (evaluated count, Qualified count, Potential count, average setup score / availability context).
- [x] Add the approved real-data candlestick selected-symbol chart with completed 1Hour candles, range controls, and OHLCV hover details.
- [ ] After Scan passes tests/build/visual review, migrate Paper Trading, Backtest, Research, then Research Labs in the approved order.
