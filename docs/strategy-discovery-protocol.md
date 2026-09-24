# SetupScan Strategy Discovery Protocol

## 1. Research Objective

The objective of this research process is to identify market setups with repeatable historical
behavior that may eventually justify real-time alerts and, only after extensive validation,
potential automated execution.

- Historical results are not guarantees of future performance.
- Discovery is exploratory. A candidate hypothesis is a starting point for investigation, not a claim.
- No strategy is considered validated merely because it performs well in a backtest.
- The research process should actively try to disprove promising hypotheses, not merely confirm them.

## 2. Initial Research Universe

Initial symbols:
- SPY
- QQQ
- IWM

Primary timeframe:
- 1-hour candles

Other timeframes and additional liquid instruments may be investigated later, but should not be
mixed into the first discovery campaign without a defined reason. Expanding the universe or
timeframe mid-campaign without documenting why increases the risk of quietly re-fitting a
hypothesis to whatever happens to look good.

## 3. Initial Strategy Families

The first discovery campaign documents these eight initial hypothesis families:

1. **Momentum / Breakout**
   - Initial hypothesis: breakout + confirmation

2. **Mean Reversion**
   - Initial hypothesis: extreme deviation followed by reversion

3. **Market Structure**
   - Initial hypothesis: prior-day level reclaim

4. **Opening Range / Time-of-Day**
   - Initial hypothesis: opening-range breakout

5. **Relative Strength**
   - Initial hypothesis: relative-strength divergence

6. **Volatility Expansion / Contraction**
   - Initial hypothesis: compression followed by expansion

7. **Market Context / Regime**
   - Initial hypothesis: setup behavior conditioned on market regime

8. **Scheduled Event Context**
   - Initial hypothesis: market reaction around scheduled economic events

News sentiment and unscheduled news analysis are explicitly **not** part of the first campaign.
These may be added in a later research phase, after the baseline framework above is established
and proven reliable.

## 4. First-Pass Experiment Philosophy

Each first-pass experiment should contain:
- One clearly defined hypothesis
- One core setup condition
- One clearly defined entry rule
- One clearly defined exit framework
- A predefined outcome/horizon

Do not optimize multiple variables simultaneously during the first pass. Do not immediately
combine numerous indicators simply because combinations improve historical results. The first
objective is to understand the baseline behavior of each concept in isolation, before layering
complexity on top of it.

## 5. Predefined Outcomes

Before running an experiment, define the outcome being measured. Initial outcomes may include:

- Whether +1R is reached before -1R within a fixed number of candles
- Whether +2R is reached before -1R within a fixed number of candles
- Maximum favorable excursion
- Maximum adverse excursion
- Distribution of R outcomes
- Holding time

Do not change the outcome definition after seeing results without documenting the change as a
new experiment. Redefining "success" after looking at the data is a common and subtle form of
overfitting.

## 6. Chronological Research Splits

Use chronological data splits. Initial framework:

- **Development:** 2022–2024
- **Out-of-sample:** 2025
- **Current holdout:** 2026 YTD

The final holdout should eventually become genuinely frozen and should not be repeatedly
inspected while developing or tuning strategies. Do not leak future information between periods —
a period's classification, indicators, and trade construction must only ever use information that
was available at or before that period.

## 7. Minimum Evidence Thresholds

Use these as initial research guidelines:

- Fewer than 100 occurrences: low-evidence result
- 100+ occurrences: eligible for exploratory consideration
- 200+ occurrences: eligible for deeper comparison

These are research guidelines, not statistical guarantees. Do not automatically discard smaller
samples — label them appropriately (e.g. "low-evidence") rather than omitting or hiding them.

## 8. Standard Metrics

Every experiment should eventually report, where applicable:

- Trade/occurrence count
- Win rate
- Profit factor
- Expectancy
- Average R
- Median R
- Total R
- Maximum drawdown
- Average holding time
- Maximum favorable excursion
- Maximum adverse excursion

Also report:
- Performance by year
- Performance by symbol
- Performance by market regime
- Performance by time of day
- Execution-cost sensitivity

Do not use a single metric as the sole basis for judging a candidate. A high win rate with a poor
profit factor, or a high expectancy built on one large outlier trade, are both misleading in
isolation.

## 9. Execution-Cost Framework

Use the existing SetupScan research assumptions for consistency:

- **Low friction:** 1 bp entry, 1 bp exit
- **Moderate friction:** 3 bp entry, 3 bp exit
- **High friction:** 8 bp entry, 8 bp exit

These are research assumptions, not guaranteed real-world costs. Real execution costs vary by
broker, order type, liquidity, and market conditions, and may be higher or lower than these
tiers in practice.

## 10. Market Context

For every candidate where the required data is available, the future research engine should
eventually be capable of recording contextual variables such as:

**Price/market context:**
- Trend
- Gap
- Range behavior
- Volatility
- ATR
- SPY/QQQ/IWM relationships

**Time context:**
- Time of day
- Day of week
- Expiration proximity

**Scheduled event context:**
- CPI
- PPI
- FOMC
- Jobs reports
- GDP
- Other major scheduled economic releases

**Important:** Only information that was actually available at the hypothetical decision time may
be used. Future information must never be used to classify the setup or influence the simulated
trade, even if it is technically present in a historical database.

## 11. Anti-Overfitting Rules

1. Do not select a strategy based on one impressive backtest.
2. Do not repeatedly tune against the same holdout.
3. No look-ahead bias.
4. No future-data leakage.
5. Record failed experiments.
6. Do not add filters solely because they improve historical results without independent justification.
7. Prefer robust parameter ranges over isolated "magic" values.
8. Test sensitivity to reasonable parameter changes.
9. Consider multiple-testing/data-mining risk whenever many hypotheses are evaluated.
10. Do not call historical frequency a future probability.
11. Do not label a strategy validated until it has passed the defined validation process.

## 12. Discovery → Validation Pipeline

The intended progression for any candidate is:

Hypothesis → Development test → Stability analysis → Cost testing → Out-of-sample testing →
Frozen holdout → Adversarial testing → Paper trading → Real-time scanner candidate

A strategy should not automatically progress to the next stage merely because it has positive
historical performance at the current stage.

## 13. Adversarial Testing

For promising candidates, eventually test:

- Reasonable parameter perturbations
- Slight entry delays
- Different holding periods
- Different exit assumptions
- Different symbols
- Different years
- Higher transaction costs
- Slippage assumptions
- Missing/incomplete candles
- Different market regimes
- Time-of-day sensitivity

The purpose is to determine whether the observed behavior is robust or dependent on narrow
historical conditions.

## 14. Research Record

Every experiment should eventually have a reproducible record containing:

- Experiment ID
- Date created
- Hypothesis
- Exact rules
- Entry definition
- Exit definition
- Outcome definition
- Symbols
- Timeframe
- Development period
- Test period
- Holdout status
- Cost assumptions
- Dataset information
- Results
- Limitations
- Whether the hypothesis survived or failed

Failed experiments must remain documented rather than deleted. A record of what did not work is
as valuable as a record of what did.

### Reproducibility and Data Provenance

Every experiment should also record:

- Git commit/version
- Data provider
- Data retrieval timestamp
- Dataset date range
- Dataset candle count
- Exact parameter configuration
- Experiment code/version
- Whether the dataset was complete
- Any excluded or missing data

The purpose of this record is to make historical research reproducible and allow us to determine
exactly what data and code produced a given result.

## 15. Security and Data Integrity

- Never put Alpaca credentials in React/frontend code.
- Never put API keys in GitHub source files.
- Keep credentials in server-side environment variables.
- External market/event/news APIs must be accessed server-side.
- Never expose database credentials to the frontend.
- Do not expose private research data through public API endpoints.
- Maintain a clear separation between public scanner functionality and private research functionality.
- Paper trading must never place real orders.
- Future live trading must use explicit server-side safeguards and separate credentials/permissions.
- Research datasets and external APIs must be checked for timestamp integrity and availability.
- Do not use future information merely because it is present in a historical database.

## 16. Future Research Phases

Later phases may investigate:

- Additional timeframes
- Additional liquid symbols
- Sector/industry context
- Breadth
- VIX/volatility data
- News/event data
- Earnings
- Unscheduled news
- Geopolitical events
- Cross-asset relationships
- More sophisticated statistical validation

These are explicitly outside the first discovery campaign unless separately approved.

## 17. Final Research Principle

SetupScan is not trying to find the strategy that looks best in hindsight. It is trying to
identify market behavior that remains interesting after we deliberately try to disprove it.

The ultimate product goal is:

Research → validated candidate → real-time setup detection → phone alert → extended paper trading
→ only eventually, if justified and securely implemented, automated execution.
