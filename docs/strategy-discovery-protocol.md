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

## 17. Session and Data-Handling Conventions

Established by a read-only audit of the actual Alpaca 1H historical data path:

- Alpaca 1H bar timestamps represent the **start** of the 1-hour interval (e.g. a bar timestamped
  09:00 ET covers 09:00–10:00 ET), not the end.
- The current historical data path (`server/alpacaProxy.js`) fetches Alpaca IEX data with no
  regular-session-only filter. Existing "full-session" experiments (Batch A, Batch B) therefore
  include whatever regular- and extended-hours bars Alpaca/IEX actually returns.
- Existing Batch A and Batch B results are **not retroactively changed** by this section and must
  be preserved exactly as they are: full-session experiments.
- For any future "Regular Session Only" 1H research: because bars are hour-aligned rather than
  09:30-aligned, use only bars fully contained inside the regular U.S. equity session (09:30–16:00
  ET). Concretely, retain only bars whose Eastern start hour is 10:00, 11:00, 12:00, 13:00, 14:00,
  or 15:00 — excluding the 09:00 ET bar (spans 09:00–10:00, partially overlaps the session open)
  and the 16:00 ET bar (spans 16:00–17:00, entirely postmarket).
- Do not reconstruct, interpolate, or splice partial bars to approximate the 09:30 boundary.
- This is a research convention for defining a stricter data universe, not a threshold
  optimization, and it does not change the frozen Momentum Breakout signal, entry, stop, or
  outcome rules themselves.

## 19. Historical Market Context Research Protocol

Historical market context is intended to test whether a setup's behavior changes
depending on the environment surrounding the signal.

Context research must remain separate from the frozen setup definition unless a
later validation phase explicitly approves a change. Context variables are
descriptive research inputs first, not automatic trade filters.

### 19.1 Initial Context Families

The first context campaign may investigate:

- **Scheduled macro events:** Federal Reserve decisions, CPI, PPI, employment reports,
  GDP releases, and other major scheduled economic releases.
- **Market-wide conditions:** broad market trend, volatility level, market breadth,
  and risk-on/risk-off conditions where reliable historical data is available.
- **Scheduled company events:** earnings releases and other material scheduled
  corporate events for the underlying symbol.
- **Cross-asset context:** relationships involving major index, rates, volatility,
  commodity, or currency benchmarks where the historical data is sufficiently
  complete.
- **Major external events:** historically documented geopolitical or macro events
  that could reasonably have been known to market participants at the time.

These families are research categories, not evidence that any particular factor
causes a trading outcome.

### 19.2 Information-Availability Rule

A context variable may only use information that was publicly available by the
time the setup signal occurred.

The research system must not use:

- later revisions to economic data when an initial release value was available;
- final event classifications that were not knowable at the time;
- future market prices or future indicators;
- post-event labels created with hindsight;
- news, event, earnings, or macro information whose publication time cannot be
  established reliably.

Where publication timing cannot be established with sufficient precision, the
observation should be excluded rather than assigned using hindsight.

### 19.3 Event-Time Convention

Every scheduled event used in research should retain:

- event name;
- event category;
- scheduled or published timestamp;
- relevant timezone;
- source/provider;
- the earliest timestamp at which the information was publicly available;
- any revision status that materially affects interpretation.

A setup should be classified relative to the event timestamp using only causal
information available at that moment.

### 19.4 Event Windows

Initial research should use predefined event windows rather than selecting a
window after observing results.

Examples may include:

- before the event;
- same-session after the event;
- next regular session;
- no nearby scheduled event.

The exact windows must be fixed before the corresponding experiment is run.

### 19.5 Context Comparison

For each frozen setup family, compare context groups using the standard research
metrics already defined in this protocol:

- occurrence count;
- win rate;
- profit factor;
- expectancy;
- average and median R;
- total R;
- maximum drawdown;
- average hold;
- MFE and MAE;
- execution-cost sensitivity.

Results should be shown by symbol and research period where sample size permits.

Context research should distinguish:

1. **setup occurrence rate** — how often the setup appears under a context;
2. **setup outcome** — how the setup behaves once it occurs under that context;
3. **market base rate** — how common the context is across all underlying market
   bars.

These are different quantities and must not be treated as interchangeable.

### 19.6 Chronological Research Splits

Context research must follow the same chronological development, out-of-sample,
and holdout structure already established for Strategy Discovery.

A context definition may not be tuned using later-period results and then treated
as independently validated on that same later period.

### 19.7 Data Quality and Coverage

Every context dataset must record:

- provider/source;
- retrieval timestamp;
- covered date range;
- number of observations;
- timezone convention;
- event or market-condition coverage;
- missing observations;
- revisions or restatements where applicable;
- exclusions made because timing or provenance was uncertain.

No synthetic or demo context data may be substituted for unavailable historical
information.

### 19.8 Multiple Testing and Interpretation

Context research may produce many comparisons. A context relationship should not
be treated as confirmed merely because one subgroup shows a strong historical
difference.

Research should examine:

- consistency across chronological periods;
- consistency across symbols;
- sensitivity to reasonable predefined context definitions;
- sample size;
- whether the relationship survives execution-cost assumptions;
- whether the finding can be explained without relying on future information.

A context finding that does not survive these checks remains exploratory.

### 19.9 Discovery Before Filtering

No context variable should automatically become a scanner filter merely because
it is associated with better historical outcomes in one experiment.

A context relationship must first pass through the existing discovery →
validation → adversarial-testing process before it can be considered for any
production scanner behavior.

### 19.10 Research Record

Every context experiment should preserve:

- research question;
- frozen setup definition;
- context definition;
- event/window definition;
- chronological split;
- exact parameters;
- data provenance;
- exclusions;
- standard metrics;
- execution-cost assumptions;
- observed limitations;
- interpretation status: exploratory, supported, or unsupported.

Failed or inconclusive context experiments remain part of the research record.

### 19.11 Phase Boundary

Historical Market Context is a research layer around existing setup candidates.
It does not replace Strategy Discovery, and it does not authorize live trading.

The purpose of this phase is to determine whether market environment provides
useful, reproducible information about setup behavior before any context variable
is considered for candidate validation or production use.

## 20. Final Research Principle

SetupScan is not trying to find the strategy that looks best in hindsight. It is trying to
identify market behavior that remains interesting after we deliberately try to disprove it.

The ultimate product goal is:

Research → validated candidate → real-time setup detection → phone alert → extended paper trading
→ only eventually, if justified and securely implemented, automated execution.
