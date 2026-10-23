# Shadow Forward — operator setup and limitations

Status: implemented locally and isolated-PostgreSQL validated; not permanently initialized, activated or deployment-verified. The disposable validation schema was removed. No production database has been accessed for this implementation. Synthetic validation does not establish provider readiness.

## What is frozen

`trend-up-medium-volatility-v1`, historical methodology `candidate-context-robustness-2`, forward protocol `shadow-forward-1`:

- The existing research-eligible 75+ scanner population AND existing causal Uptrend AND Medium volatility.
- 1Hour completed bars, existing next-observed-bar open theoretical entry, 0.5% initial risk, 2R target, maximum 12 observed bars, adverse stop gaps, no favorable target improvement, stop-first ambiguous intrabar outcomes. Ambiguous outcomes remain included and counted, matching this historical experiment (not Strategy Discovery's exclusion policy).
- Existing modeled costs 0 / 0.02 / 0.05 / 0.10R.
- Universe, fixed context-history start, provider/adjustment and calculation dependency fingerprint are frozen at initialization. Context uses SPY if supplied, otherwise the first alphabetically sorted supplied symbol. Symbols do not have separate independently recalibrated regime definitions.

Choose the history start to match the effective historical calculation data, **including pre-roll**. It is deliberately not guessed. The expanding volatility distribution and aligned scanner indicators depend on this start and the supplied universe. A different history start/universe is not an exact replication of an earlier historical run. A 200-bar minimum only establishes a warm-up floor, not equivalent historical context.

Changing symbols or any calculation dependency requires a separately reviewed tracking identity. Do not reuse the old identity or change its persisted definition. A changed rule requires a new candidate version. No automatic tuning or promotion exists.

## Separate process and storage

The paper worker and API do not start shadow observation. Browser scanner watchlists and paper symbol settings are not synchronized with shadow settings. The shadow process imports no paper engine, paper store or brokerage order module.

Tables, created only by the explicit `init` operation:

- `research_shadow_tracking`: frozen definition, successful-cycle checkpoint.
- `research_shadow_candles`: one immutable source candle per tracker/symbol/timestamp, shared by observations, not duplicated into each occurrence.
- `research_shadow_occurrences`: immutable qualification/provenance snapshot, pending theoretical entry, terminal outcome. Existing research/paper tables are not altered.

Cycle writes are atomic. A PostgreSQL advisory lock prevents concurrent workers from processing one tracker. Failure rolls back candles, observations and checkpoint together. Read API uses a read-only repeatable-read transaction and never creates schema. Resolved/excluded/unavailable records cannot be changed through the store's cycle interface. This is an application invariant, not protection against a database administrator manually changing rows.

## Manual setup — NOT EXECUTED

First validate in an explicitly isolated PostgreSQL database and verify backups before any later production initialization. Do not paste credentials into chat or commands. Configure secrets through an approved private environment mechanism.

Required operator environment names (no values are supplied here):

- `SHADOW_DATABASE_URL`: explicit separate selection; never falls back to `DATABASE_URL`. Remote URLs require `sslmode=verify-full` for the CLI; configure the trusted CA through the installed PostgreSQL driver's supported certificate mechanism. Confirm the actual destination privately before initialization. Local plaintext is only appropriate for an isolated loopback server.
- `SHADOW_TRACKING_ID`: lowercase letters/digits/hyphens, 1–80 characters.
- `SHADOW_SYMBOLS`: comma-separated validated symbols; 1–10 maximum. There are no default tickers. A syntactically valid ticker is not proof the provider supports it.
- `SHADOW_HISTORY_START`: explicit effective calculation-history start, including pre-roll.
- `SHADOW_START_AT`: future UTC timestamp at initialization. Bootstrap history is never forward evidence.
- `SHADOW_CONFIRM_INITIALIZE`: literal `create-separate-shadow-tables`, required only for initialization.
- Existing `ALPACA_API_KEY` / `ALPACA_API_SECRET`: required only when the explicitly started worker fetches data.

From the project root, after confirming the isolated destination and configuring the above privately:

```powershell
node --env-file=.env scripts/shadow-forward.js init
node --env-file=.env scripts/shadow-forward.js run
```

These are **future operator actions**, not commands run during implementation. `init` writes only new shadow tables/definition and does not start polling. `run` requires an already initialized tracker and matching source fingerprint. Restart with the same ID; persisted settings remain authoritative. Stop a manually started worker with Ctrl+C; it waits for the active cycle before closing its pool. Never add this command to the paper worker's start command.

## Freshness and recovery policy

- Poll every 60 seconds, without overlap; failures back off to at most 15 minutes, visibly reporting ERROR. Provider requests have a 120-second cancellation deadline across pagination.
- First successful cycle is a baseline, even if current bars qualify. Future detections require a new shared completed bar, completed after the initial/resumption baseline, observed within five minutes, with no polling gap longer than five minutes. A slightly delayed bar can qualify within that freshness window. Downtime establishes a new detection boundary. Long fetch/calculation latency cannot be relabeled as timely observation.
- Missing/delayed bars, unsupported symbols and incompatible/revised source data fail closed. Restart after downtime skips missed detections; it still resolves existing pending observations. Skipped detection cycles are not a count of missed qualifying signals.
- Warm-up history is fetched once, persisted once and expanded incrementally. Restart reads persisted candles and requests only overlap/new data. Conflicting candle revisions or late insertions stop progress for manual review; no automatic correction/backfill is performed.
- The provider's existing minimum-count completeness heuristic is used only for bootstrap. It expects at least 20 candles even in one-bar ranges, so incremental polls instead require the dedicated adapter's successful exhaustion of pagination. Neither proves that the provider has every expected market interval.
- A bar is complete under the existing start-timestamp-plus-one-hour convention. Provider timestamp/early-close guarantees and complete absence of missing bars are **not proven**. Shared timestamp intersection and the historical observed-bar holding convention are retained. There is no new market calendar or fabricated missing bar.
- Pending means insufficient future observations, not zero performance. A market closure or provider outage does not force an invented expiry. Irrecoverably missing history requires a reviewed exclusion/correction procedure; no such automatic procedure is implemented.

The fixed-history causal helper recomputes expanding ranks and enrichment; CPU and database read cost grow with history. This first version stores source candles once but reloads the frozen history each cycle. Benchmark the intended history/universe in isolation before deployment; do not use an unbounded universe. Optimizing this computation requires equivalence tests, not a rolling window substitution.

## Reporting and privacy

Research → Shadow Forward uses GET `/api/research-shadow`. To enable reads explicitly, configure `SHADOW_READ_API_ENABLED=true`, `SHADOW_DATABASE_URL` and `SHADOW_TRACKING_ID` in the API process. This starts no observer. Disabled/missing storage reports unavailable, not zero.

This endpoint follows the existing research API's **public read access**. Enabling it exposes the configured candidate, symbols and occurrence research snapshots; CORS is not authentication. Leave disabled on public deployments until that disclosure is explicitly acceptable or a separate access-control design is approved. No secret belongs in browser code. Responses disable caching and hide raw database errors.

The UI reports the last persisted success, not proof of live worker health. Snapshots older than three minutes are marked stale. It shows per-symbol evidence, modeled costs, ambiguity counts with resolved denominators, day clustering, details and descriptive milestones: <30 insufficient, 30–49 early review, 50–99 meaningful sample for review, 100+ stronger descriptive evidence. No milestone authorizes trading. Repeated signals are not independent observations; totals are not account equity or options-contract validation.

Investigation linking is deferred. The stable tracking and occurrence identities permit a later reference without copying or reinterpreting historical runs.

## Activation-readiness review (2026-10-22; no activation performed)

### History and initial universe

Configure `SHADOW_SYMBOLS=SPY,QQQ` only during future initialization. These are operator settings, not required tickers; 1–10 validated symbols are supported. IWM is not required. Neither `PAPER_SYMBOLS` nor the browser watchlist changes the frozen universe. SPY is the regime reference for this initial universe; otherwise the alphabetically first symbol is the reference. All calculations use the shared timestamp intersection, so a shorter or incomplete symbol history reduces usable history for everyone.

Technical warm-up, counting the decision candle where applicable:

- EMA9/EMA21: 9/21 valid closes for the SMA seeds, followed by recursive updates.
- RSI14: 15 closes for the first value, followed by Wilder smoothing.
- Breakout: 20 prior candles plus the current candle.
- Relative volume: at least five positive-volume prior observations; prefers the same Eastern clock slot from up to 20 prior sessions, otherwise the prior-bar fallback. For a full same-slot baseline, retain at least 20 prior sessions with usable observations for each relevant slot.
- Historical VWAP: accumulated regular-session typical-price/volume on the existing hourly bars, reset each Eastern date. This is not the live scanner's separate five-minute VWAP request. It requires appropriate session coverage; the shadow path does not prove every expected interval exists.
- Causal Uptrend: SMA50 and its ten-bar slope, first evaluable with 60 bars. SMA200 is also calculated but is not part of this Uptrend classification.
- Causal volatility: 20 returns plus 60 expanding volatility observations, first classified with 80 closes (the current volatility observation is included). ATR14 and 50-return volatility are descriptive fields.
- The observer independently requires at least **200 shared completed bars** before committing a cycle. That is the operational floor, not a promise that every input is available or equivalent to historical research.

Recommended pre-roll: use the exact effective history start, including pre-roll, of the historical candidate study; ensure at least 200 shared completed bars and 20 prior usable sessions per clock slot. Do not substitute an arbitrary fixed number of days. Expanding volatility ranks and recursively seeded EMA/RSI depend on the chosen start. More history changes context, not merely numerical precision. The exact historical start has not been recovered from a saved dataset in this review and must be approved before freezing. New listings, missing slots and disjoint histories require explicit review, not invented data or a per-symbol rolling substitute.

### Provider and operational capacity

The adapter requests Alpaca's stock bars endpoint separately for each symbol, with `feed=iex`, `adjustment=split`, `timeframe=1Hour`, and up to 10,000 bars per page. It does not batch symbols. Bootstrap exhausts pagination; subsequent requests start at the last stored bar and include overlap. Normally SPY/QQQ require two HTTP requests per cycle if each fits one page. There is no market-hours scheduler: the worker polls around the clock, waiting 60 seconds after cycle completion. Two one-page symbols therefore approach, but do not exceed, 120 requests/hour or 2,880/day from this worker at that cadence; pagination and other application clients add usage.

Each symbol fetch has a 120-second abort deadline covering its pagination. Fetches are sequential. Any symbol failure rolls back the entire shared cycle, including pending outcome updates for other symbols; no partial-success checkpoint is reported. Failure delays are 120, 240, 480, then at most 900 seconds. Persistent failures continue indefinitely at the capped cadence, with ERROR logs. No HTTP rate-limit retry or Retry-After handling is implemented inside a fetch. Confirm account limits, feed entitlement, publication latency, timestamp conventions and early-close behavior separately; none was verified against the provider here.

The prior local synthetic benchmark (8,000 bars each for two symbols) measured 4.79 seconds bootstrap and 0.81 seconds unchanged polling. This suggests no immediate two-symbol CPU blocker, but does not establish production memory stability, network latency or long-term scaling. Larger-universe benchmarking remains deferred.

### Database and privacy gates before initialization

`init` uses unqualified table names in the configured database/search path. The explicit connection and confirmation string do **not** prove that the operator selected the correct database. Before any write, use an approved read-only identity check and privately verify the intended schema/search path. A safe preflight report should contain only host class (loopback/remote), database name, SSL state, candidate ID and symbols; never a URL, username, password or token. There is currently no built-in `status`, `preflight` or `stop` CLI command.

Provision a dedicated least-privilege destination/role. Initialization needs CONNECT, schema USAGE/CREATE, table/index/constraint creation and tracker INSERT/SELECT. Runtime needs shadow-table SELECT/INSERT and occurrence/checkpoint UPDATE. Reporting should use SELECT-only access. No sequence permissions are needed by these text-key tables. Init is explicit and transactional, not an API/startup migration. Remote TLS must verify certificates; actual destination, CA setup, permissions and recoverable backup must be confirmed before activation.

Reporting is optional for collection. Leave `SHADOW_READ_API_ENABLED` unset on a public API unless public research disclosure is explicitly accepted or access control is separately approved. The existing API listens without a loopback-only host restriction; CORS does not authenticate callers. Enabling reporting exposes frozen definitions, symbols, snapshots and fingerprints. A local/private reporting deployment must be network-restricted independently; do not put server secrets in the browser.

### Future operator procedure — commands NOT executed

Only after approval, privately configure the existing documented environment names. Select a stable tracking ID, the approved historical start, and a future UTC `SHADOW_START_AT` with enough time to initialize and bootstrap. Do not select a timestamp in this review. `init` permits equality with its current clock even though operators should deliberately choose a future time with margin.

```powershell
# INITIALIZE once, after destination/permissions/backup checks:
node --env-file=.env scripts/shadow-forward.js init

# START in a separate terminal (never append to the paper worker command):
node --env-file=.env scripts/shadow-forward.js run

# CHECK saved status only, if the intended LOCAL reporting API is already running/enabled:
Invoke-RestMethod -Uri 'http://localhost:3001/api/research-shadow' |
  Select-Object freshness, checkpoint

# RESTART after stopping: use the same ID and unchanged calculation source.
node --env-file=.env scripts/shadow-forward.js run
```

STOP: press Ctrl+C in that shadow-worker terminal; SIGINT/SIGTERM waits for the current cycle and closes the pool. There is no separate stop command or guaranteed shutdown deadline for a stalled database operation. VIEW: in the running frontend, choose Research → Shadow Forward (`/research/shadow`). No dashboard refresh starts a worker. The panel loads on mount, not continuously; reload it to read a newer snapshot. Saved freshness is not a worker liveness probe.

The first successful worker cycle establishes a baseline without detections. Later observations must be new shared completed bars, at/after the configured start, after the detection baseline, and processed within five minutes with polling continuity. A long outage establishes a new baseline rather than backfilling detections. Pending outcomes still resume from persisted history.

An API Node restart affects reporting only. A shadow-worker restart preserves definition, universe, boundary, fingerprint, candles and pending observations. An initialization/read failure at process startup exits and requires explicit restart. Provider or database failures during an established worker cycle retry with capped backoff. A Windows reboot does not automatically restart this standalone worker: no OS startup task is installed. A deployment supervisor's restart behavior remains an operator decision. Source-fingerprint mismatches intentionally prevent resume until reviewed.

### Local readiness verification scope

The actual frontend was run with the existing React entry point and local mocked API handlers, without starting the application API, shadow worker or any database client. Research → Shadow Forward navigation, loading feedback, disabled reporting, storage-error feedback and an initialized empty SPY/QQQ snapshot were inspected in the browser. Empty performance remained unavailable (dashes), and both persisted version labels were visible. This complements the earlier PostgreSQL-backed component preview; it is not a production-network or real-provider end-to-end test.

Activation remains blocked on approval of the effective historical start, real destination/TLS/permissions/backup checks, provider freshness/capacity confirmation and the reporting privacy decision. Keep the candidate rules unchanged and perform no initialization until those gates and explicit activation approval are satisfied.

## Validation before activation

1. Review the frozen universe, effective history start and planned future boundary against the historical study.
2. In an approved isolated database, run initialization, two concurrent-worker lock tests, duplicate/restart recovery and transactional rollback tests using fixtures. No production connection is needed.
3. Verify the source fingerprint, read-only API permissions and intended privacy policy. Test the UI on desktop/mobile and with keyboard/screen reader.
4. Measure bootstrap/poll latency and data volume; confirm provider feed, timestamp conventions and delayed-bar behavior. Five-minute freshness is an observation policy, not a provider guarantee.
5. Only after explicit deployment approval configure a separate worker. Keep the existing paper worker and records untouched. Monitor failure logs and last-success timestamps; disabling the shadow worker does not require deleting evidence.
