# SetupScan Research Evidence

_Last updated: October 28, 2026_

## Purpose

This file is SetupScan's curated research record.

The Research Workspace keeps the technical audit trail: Run IDs, methodology IDs, raw tables, evidence entries, filters, and detailed metrics.

This file keeps the human-readable conclusions: what SetupScan tested, what it learned, what changed, what did not change, and what still needs forward validation.

A positive historical result is **not proof of future profitability**. SetupScan uses historical research to identify durable candidates, reject weak ideas, and decide what deserves forward validation.

---

## Evidence Status Guide

- **SUPPORTED FOR FURTHER STUDY** — historical evidence is promising enough to keep researching.
- **MIXED / UNSTABLE** — useful historical evidence exists, but it changes materially across years, symbols, regimes, costs, or stress tests.
- **REJECTED / NOT PROMOTED** — evidence is not strong or durable enough to justify changing production logic.
- **FORWARD VALIDATION IN PROGRESS** — a frozen candidate is being observed prospectively without changing its rules.
- **NO PRODUCTION CHANGE** — research was informative, but SetupScan's live scanner rules were intentionally left unchanged.

---

# 1. Strategy Discovery and Regime Research

## Question

Can SetupScan identify market environments where its rule-based setup behaves more consistently?

## What SetupScan tested

SetupScan has run multiple strategy-discovery, yearly/regime, causal-regime, walk-forward, volatility-aware, resilience, and comparison studies using SPY, QQQ, and IWM historical hourly data.

These studies repeatedly examined whether setup performance changes with:

- symbol,
- year / period,
- trend regime,
- volatility regime,
- combined trend + volatility regime,
- costs,
- execution assumptions,
- exit logic,
- and stress tests.

## Main result

The most promising recurring historical context has been:

**Trend Up + Medium Volatility**

This does **not** mean every trade in that environment wins. It means this context repeatedly appeared more favorable than broad pooled conditions and survived enough follow-up testing to justify a frozen forward-validation candidate.

## Plain-English explanation

SetupScan learned that the same setup can behave very differently depending on the market environment.

A setup that looks strong when the market is trending upward with controlled volatility may perform poorly in a mixed or high-volatility environment.

That means SetupScan should not assume one universal setup rule works equally well everywhere.

## Status

**SUPPORTED FOR FURTHER STUDY**

## Production impact

No automatic production rule change was made from discovery alone.

The strongest candidate was moved into separate forward validation instead.

---

# 2. Frozen Shadow Forward Candidate

## Candidate

**Trend Up + Medium Volatility v1**

## Historical methodology

`candidate-context-robustness-2`

## Forward protocol

`shadow-forward-1`

## Frozen rules

- Universe: SPY + QQQ initially
- Trend: causal Trend Up
- Volatility: causal Medium volatility
- Setup eligibility: research-eligible score threshold
- Timeframe: 1Hour
- Outcome horizon: 12 bars
- Cost checks: 0R, 0.02R, 0.05R, 0.10R

## Why this matters

Historical research can accidentally overfit the past.

Shadow Forward freezes the candidate and watches what happens on genuinely new observations without changing its rules after seeing results.

That gives SetupScan a cleaner test of whether the historical pattern continues.

## Status

**FORWARD VALIDATION IN PROGRESS**

## Production impact

None. Shadow Forward remains separate from the production scanner and Paper Observer.

---

# 3. Scanner Component Ablation

## Question

What happens if individual scanner conditions are removed?

## Why it mattered

SetupScan's scanner uses multiple confirmations. This study tested whether some of them were redundant or whether removing them materially changed historical results.

## Main findings

### EMA and Bullish Trend were structurally redundant in the tested dataset

- 16,094 observations had both true.
- 0 observations had EMA true without Trend.
- 0 observations had Trend true without EMA.
- Phi correlation: 1.0.

This means SetupScan was effectively giving two pieces of score credit to conditions that behaved identically in the tested historical data.

### Removing Breakout/Reclaim hurt important results

The ablation study found that removing Breakout/Reclaim weakened overall results and especially hurt the historically important Uptrend / Medium-volatility context.

### Counting EMA/Trend once looked historically better in some pooled results

But the improvement was not stable enough across recent periods, symbols, and regimes to justify changing the production score.

## Plain-English explanation

SetupScan discovered that EMA and Trend were acting like duplicate confirmations.

It also found that Breakout/Reclaim was doing real work in important environments.

But simply deleting one duplicate score component did not hold up consistently enough across different periods and symbols.

## Status

**MIXED / UNSTABLE**

## Production impact

**NO PRODUCTION CHANGE**

---

# 4. Scanner Score Redundancy / Stability Study

## Experiment

`scanner-score-redundancy-stability`

## Methodology

`scanner-score-redundancy-stability-1`

## Question

If SetupScan removes duplicate EMA/Trend credit, does the apparent improvement remain stable across time, symbols, regimes, costs, and stress tests?

## Main result

**MIXED / UNSTABLE**

The older historical period looked much stronger than the recent period.

### Pooled examples

Baseline fixed-75 population:

- resolved: 3,157
- expectancy: +0.095R

Keep EMA / remove Trend, fixed-75:

- resolved: 491
- expectancy: +0.194R
- improvement: +0.099R

Keep Trend / remove EMA, fixed-75:

- resolved: 323
- expectancy: +0.195R
- improvement: +0.101R

But the apparent advantage weakened materially under broader mechanical thresholds and did not persist reliably into 2025–2026.

## Stability findings

- Older 2022–2024 results were much stronger.
- Recent 2025–2026 results were near zero or negative.
- Some symbol-level results contradicted the pooled result.
- Cost sensitivity existed.
- Day-concentration stress mattered.
- The result was not stable enough for promotion.

## Important limitation

Historical hourly VWAP is not identical to the live scanner's separate five-minute VWAP input.

## Plain-English explanation

At first glance, removing duplicate EMA/Trend score credit looked better.

But when SetupScan asked the harder question — "does that improvement keep working across newer years, different symbols, costs, and stress tests?" — the answer was no.

The improvement was too unstable to trust as a production change.

## Status

**MIXED / UNSTABLE**

## Production impact

**NO PRODUCTION CHANGE**

---

# 5. Qualification Stack / Condition Count

## Experiment

`qualification-stack-condition-count`

## Methodology

`qualification-stack-condition-count-1`

## Question

Do setups with more full confirmations historically perform better, and which missing conditions matter most?

## What SetupScan tested

Six-condition view:

- exactly 6/6,
- exactly 5/6,
- exactly 4/6,
- exactly 3/6,
- at most 2/6,
- every single missing condition,
- every pair of missing conditions.

Five-family view:

EMA + Trend were counted once as a shared trend-confirmation family so the duplicate-counting issue could be inspected separately.

Partial RSI/RVOL score credit did not count as a full confirmation.

## Overall conclusion

**MIXED / UNSTABLE**

The full historical sample showed a generally improving ladder as confirmations increased, but that pattern weakened or reversed in newer periods, some symbols, and some regimes.

No stack size or missing-condition combination was promoted into production.

---

## 5A. Full-sample condition-count ladder

Pooled SPY / QQQ / IWM:

- 6/6: 323 resolved, +0.195R
- 5/6: 1,832 resolved, +0.094R
- 4/6: 5,418 resolved, -0.014R
- 3/6: 4,259 resolved, -0.052R
- <=2/6: 12,504 resolved, -0.052R

At first glance, more confirmations looked better.

But that was not stable across time.

---

## 5B. Older period versus recent period

### Development period: 2022–2024

- 6/6: +0.379R
- 5/6: +0.152R
- 4/6: +0.045R
- 3/6: -0.050R

This was close to the confirmation ladder SetupScan hoped to see.

### Recent period: 2025–2026

- 6/6: -0.128R
- 5/6: +0.008R
- 4/6: -0.110R
- 3/6: -0.055R

The recent ordering was **not monotonic**.

## Plain-English explanation

The strict scanner looked very good in older data, but the advantage did not persist cleanly into 2025–2026.

That is exactly why SetupScan did not treat the pooled historical average as proof.

---

## 5C. Yearly strict-stack behavior

### 2022

- 6/6: +0.124R
- 5/6: -0.012R

### 2023

- 6/6: +0.504R
- 5/6: +0.282R

### 2024

- 6/6: +0.522R
- 5/6: +0.161R

### 2025

- 6/6: -0.143R
- 5/6: +0.037R

### 2026 YTD

- 6/6: -0.103R
- 5/6: -0.031R

## Plain-English explanation

The strongest stack was excellent in 2023–2024 but reversed at the top in 2025–2026.

That made the overall result too unstable for a production rule change.

---

## 5D. Symbol dependence

SetupScan found that the value of confirmations changed by symbol.

Examples:

### 2025

- SPY 6/6: -0.272R
- QQQ 6/6: -0.138R
- IWM 6/6: -0.005R

### 2026 YTD

- SPY 6/6: +0.031R
- QQQ 6/6: -0.195R
- IWM 6/6: -0.144R

## Plain-English explanation

The scanner's strictest setup did not behave the same way on SPY, QQQ, and IWM.

That is important evidence that SetupScan may eventually need symbol-aware interpretation rather than assuming one universal rule.

---

## 5E. Trend regimes

### Uptrend

- 6/6: 171 resolved, +0.271R
- 5/6: +0.090R
- 4/6: -0.042R
- 3/6: -0.045R
- <=2/6: -0.077R

This was one of the cleanest broad trend-regime results.

### Mixed trend

- 6/6: +0.048R
- 5/6: +0.120R
- 4/6: +0.131R

The strictest stack did not dominate.

### Downtrend

The strict 6/6 sample was too small to draw a reliable conclusion.

## Plain-English explanation

The scanner's confirmation logic made the most sense historically in Uptrends.

Mixed conditions weakened the relationship between "more confirmations" and better outcomes.

---

## 5F. Volatility regimes

### Low volatility

- 6/6: +0.219R
- 5/6: +0.069R
- 4/6: -0.035R

### Medium volatility

- 6/6: +0.423R
- 5/6: +0.224R
- 4/6: +0.052R
- 3/6: +0.082R
- <=2/6: -0.136R

### High volatility

- 6/6: -0.078R
- 5/6: -0.028R
- 4/6: -0.053R

## Plain-English explanation

Medium volatility was the strongest broad volatility environment.

High volatility was clearly hostile to the current scanner stack.

---

## 5G. Joined regime: Uptrend / Medium Volatility

This was the most important joined-context result.

- 6/6: 53 resolved, 56.6% win rate, +0.574R
- 5/6: 306 resolved, +0.142R
- 4/6: 1,011 resolved, +0.050R
- 3/6: 762 resolved, +0.169R
- <=2/6: 619 resolved, -0.139R

The six-condition ordering was not perfectly monotonic because 3/6 exceeded 4/6, but the jump from 5/6 to 6/6 was large.

The five-family view was cleaner and classified as nondecreasing within the negligible band.

## Plain-English explanation

This independently reinforced the same environment that earlier SetupScan research had already identified:

**Uptrend + Medium Volatility**

That is important because two different research paths pointed toward the same general market context.

## Status

**SUPPORTED FOR FURTHER STUDY**

Not production proof. The 6/6 sample remains exploratory.

---

## 5H. Joined regime: Mixed / High Volatility

- 6/6: -0.208R
- 5/6: -0.111R
- 4/6: -0.017R
- 3/6: -0.013R
- <=2/6: +0.002R

Performance improved as strict confirmations were removed.

## Plain-English explanation

This was almost the opposite of what SetupScan wants from a qualification stack.

**Mixed trend + High volatility currently looks like a historically hostile environment for the strict scanner logic.**

## Status

**AVOIDANCE CANDIDATE FOR FURTHER STUDY**

No production exclusion rule has been added.

---

# 6. What Qualification Stack Taught Us About Individual Conditions

## Breakout / Reclaim

Breakout/Reclaim repeatedly looked important in favorable environments.

### Uptrend

Qualified 6/6: +0.271R  
Missing Breakout/Reclaim: -0.029R

### Low volatility

Qualified 6/6: +0.219R  
Missing Breakout/Reclaim: -0.010R

### Medium volatility

Qualified 6/6: +0.423R  
Missing Breakout/Reclaim: +0.045R

### Uptrend / Medium

Qualified 6/6: +0.574R  
Missing Breakout/Reclaim: -0.023R

Difference: approximately -0.596R.

## Plain-English explanation

Breakout/Reclaim appears to be one of the most important confirmations in the market environment where SetupScan's strict setup historically worked best.

This is not universal across every regime, but it is strong enough that there is currently no evidence supporting its removal from production.

## Status

**SUPPORTED AS AN IMPORTANT CONDITION FOR CONTINUED STUDY**

---

## RSI

RSI produced a very different pattern.

### Uptrend / Medium

Qualified 6/6: +0.574R  
Missing RSI: +0.573R

Historically, removing full RSI confirmation barely changed expectancy in this specific regime.

### Recent symbol slices

Some 2025–2026 SPY and QQQ slices also showed setups missing full RSI outperforming the strict Qualified population.

However, many of those recent samples were very small.

## Plain-English explanation

RSI may be acting more like a restrictive filter than an essential edge contributor in some favorable environments.

But the evidence changes by symbol and regime, and many of the most dramatic recent results are under-sampled.

## Status

**IMPORTANT FOLLOW-UP QUESTION — NO PRODUCTION CHANGE**

Do not remove RSI globally based on current evidence.

---

## RVOL

RVOL was inconsistent across symbols and regimes.

In some environments, missing RVOL weakened results. In others, missing RVOL remained positive or even outperformed the strict baseline.

## Plain-English explanation

RVOL appears more context-dependent than Breakout/Reclaim.

Its value may vary by symbol and market environment.

## Status

**MIXED / CONTEXT-DEPENDENT**

No production change.

---

# 7. Five-Family View: EMA + Trend Counted Once

## Why SetupScan tested this

The scanner historically counted EMA9 > EMA21 and Bullish Trend separately even though prior research found them perfectly redundant in the tested data.

The five-family view counted them once.

## Main result

The five-family view often produced a cleaner confirmation ladder, particularly in favorable environments such as:

- Uptrend,
- Medium volatility,
- Uptrend / Low,
- Uptrend / Medium.

But the broader historical instability across time and symbols remained.

## Plain-English explanation

Removing duplicate counting makes the research easier to interpret, but it does not magically solve the scanner's stability problem.

## Status

**SUPPORTED FOR INTERPRETATION, NOT YET A PRODUCTION SCORE CHANGE**

---

# 8. Cost and Day-Concentration Stress

## Why it mattered

A historical average can look good because of a few exceptional days or because trading costs were ignored.

SetupScan tested both.

## Qualified full-sample cost tiers

6/6 expectancy:

- 0R cost: +0.195R
- 0.02R: +0.175R
- 0.05R: +0.145R
- 0.10R: +0.095R

## Day concentration

Qualified full sample used 173 active Eastern decision days.

When the five best days were removed, the remaining 296 observations fell to:

- 0R: +0.047R
- 0.02R: +0.027R
- 0.05R: -0.003R
- 0.10R: -0.053R

## Plain-English explanation

A meaningful portion of the historical edge came from a small number of strong days.

That does not invalidate the strategy, but it makes the pooled average less convincing.

## Status

**IMPORTANT LIMITATION**

---

# 9. Research Methodology Guardrails

SetupScan's research currently follows these principles:

- Completed historical candles only.
- No fabricated missing bars.
- Causal regime labels where specified.
- Costs modeled as fixed R deductions.
- Same-candle stop/target uncertainty handled conservatively with stop-first logic.
- Underlying stock prices are used; these are not options-contract fills.
- Exact-count studies require all required inputs to be evaluable.
- Unavailable input is not treated as a failed condition.
- Partial RSI/RVOL score credit is not treated as a full confirmation.
- Small samples are explicitly labeled.
- Repeated historical follow-up is not treated as an untouched holdout.
- Production rules are not changed merely because one historical subgroup looks best.
- Shadow Forward candidates remain frozen.

---

# 10. Current Research-Level Conclusion

SetupScan has **not** found one universal scanner formula that behaves equally well across every year, symbol, and market environment.

Instead, the research increasingly supports a more nuanced conclusion:

1. Market regime matters.
2. Symbol behavior can differ.
3. More confirmations are not always better.
4. The strict stack has looked strongest in favorable environments, especially **Uptrend / Medium Volatility**.
5. **Breakout/Reclaim** appears particularly important in that favorable regime.
6. **RSI** appears less essential in some favorable and recent contexts, but evidence is not stable enough for removal.
7. **EMA and Trend** are structurally redundant in the tested historical dataset.
8. High-volatility and mixed/high environments are materially less favorable.
9. Older 2022–2024 strength did not fully persist into 2025–2026.
10. The correct next step for the strongest candidate is forward validation, not more historical tuning.

---

# 11. Production Decisions So Far

## Kept unchanged

Production scanner scoring remains:

- VWAP: 20
- EMA9 > EMA21: 20
- RSI 55–70: 15
- RVOL >= 1.2: 15
- Breakout/Reclaim: 15
- Bullish Trend: 15

Qualified remains all six full conditions.

Potential remains below Qualified but at or above the production score threshold.

## Why no change yet

The research has found meaningful structure, but not enough stable evidence to justify changing production rules without forward validation.

This is intentional.

SetupScan's research process is designed to reject tempting but unstable historical improvements.

---

# 12. What This Record Proves — and What It Does Not

## What this record demonstrates

SetupScan has:

- tested its scanner conditions rather than assuming they work,
- compared different symbols,
- compared different years,
- compared different market regimes,
- tested duplicate conditions,
- tested missing conditions,
- tested costs,
- tested concentration,
- rejected unstable improvements,
- and moved promising candidates into frozen forward validation.

## What this record does NOT prove

It does not prove:

- future profitability,
- guaranteed win rates,
- options execution quality,
- live trading safety,
- or that a historically strong condition will remain strong forever.

The purpose of this record is research transparency.

---

# 13. Next Research Milestones

1. Continue Shadow Forward without changing the frozen candidate.
2. Preserve Paper Observer reliability and provenance.
3. Use existing research before building new experiments.
4. Revisit RSI only if additional evidence justifies a narrow follow-up.
5. Continue studying whether regime-aware interpretation is more useful than one universal score.
6. Later connect these findings to SetupScan's plain-English explanation layer.
7. Eventually expose a curated Research Evidence section inside SetupScan's About / What Is SetupScan area.

