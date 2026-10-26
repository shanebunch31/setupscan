# SetupScan

Personal market setup scanner and backtesting platform.

SetupScan is being built to scan SPY, stocks, ETFs, and eventually crypto for rule-based market setups.

The goal is to combine technical indicators, multi-timeframe confirmation, historical backtesting, and market data to identify setups worth watching.

This is a research and trading-analysis tool. Setup scores are not guarantees of future results.

## Run locally

Requirements: Node.js 18+ and npm.

```bash
npm install
npm run dev
```

Open the local URL printed by Vite. To create a production build, run `npm run build`.

## Automated paper observer deployment

**AUTOMATED PAPER OBSERVER — NO REAL ORDERS**

Deploy the observer as a Render **Background Worker**, not as the web dashboard. The exact start command is:

```bash
npm run worker
```

The worker runs independently of the browser, polls completed 1-hour Alpaca candles during the regular U.S. equity session, persists paper trades and checkpoints, and exposes its optional status endpoint on `/health` and `/api/paper-observer/status` at port `OBSERVER_PORT` (default `3102`). A Render background worker does not need an HTTP port for scheduling; the endpoint is useful for private monitoring when the process is reachable.

### Render environment configuration

Configure these in Render's Environment settings. Do not put values in `render.yaml`, source files, Git, or this README.

Required secrets:

- `ALPACA_API_KEY`
- `ALPACA_API_SECRET`
- `PAPER_ORDER_API_SECRET` — required to enable `POST /api/trading/paper-orders` and `GET /api/trading/paper-account`. Set a long, randomly generated value in Render only; callers must send the exact value as `Authorization: Bearer <secret>`. Never place it in browser code, source control, or logs.
- `DATABASE_URL` (the connection string for a persistent hosted PostgreSQL database)

Optional observer settings and current defaults:

- `PAPER_SYMBOLS=SPY,QQQ,IWM` — initial seed only, consulted only before the universe has been initialized.
- `PAPER_SYMBOL_CAP=10` — maximum requested active symbols for seeding/add/replace; valid integers from 1 to 100. Invalid values default to 10. A valid smaller value is restrictive; excessive requests are rejected, never truncated.
- `PAPER_TIMEFRAME=1Hour`
- `PAPER_MARKET_TIMEZONE=America/New_York`
- `PAPER_POLL_INTERVAL_MS=60000`
- `PAPER_FETCH_TIMEOUT_MS=30000` (per-symbol request deadline; positive values capped at 120000 ms). Requests receive an abort signal; late responses cannot advance observer state.
- `OBSERVER_PORT=3102`
- `DATABASE_SSL` defaults to enabled; set `DATABASE_SSL=false` only when the PostgreSQL deployment explicitly does not use SSL.

Observer freshness: `RUNNING` means the latest checks had no reported data failure, not that every poll produced a new candle. `cycleOutcome` distinguishes `FRESH`, `NO_NEW_DATA`, `PARTIAL`, `DATA_UNAVAILABLE`, `MARKET_CLOSED`, `NO_SYMBOLS`, and operational `ERROR`. Any failed/degraded symbol makes the overall status `ERROR` (including partial cycles), while later symbols are still attempted. Existing retry backoff applies.

`symbolResults` records each symbol's latest check, successful-poll timestamp, fresh-data timestamp, completed candle, processing flag, provider completeness flag, and error. Data statuses distinguish fresh processing, no new data, waiting for the first session interval, empty, stale, incomplete, timeout, fetch failure, and processing failure. `lastSuccessfulUpdate` advances only when at least one symbol processes timely usable data; consult the cycle summary because another symbol may have failed. Polling alone does not renew it. Closed-session checks do not fetch or count as failures.

Staleness means the latest completed interval ended more than one candle interval plus five minutes ago, with a grace period for the first regular-session interval using `PAPER_MARKET_TIMEZONE` (Eastern by default). The existing market-open scheduling still uses the U.S. equity weekday/Eastern session convention; this is not a holiday/early-close calendar or a provider completeness guarantee. Unfinished candles are excluded; rejected rows or an unexplained provider `complete: false` are reported as incomplete. The provider's known minimum-history-count warning on an incremental tail can be satisfied by retained validated context; both the original flag and this interpretation remain visible. Stale, empty, incomplete, and opening-grace responses do not advance positions, baselines, checkpoints, or cached context. Even when rejected rows appear unrelated, their aggregate count does not establish safe coverage, so the observer waits for a clean response. Normal unfinished bars may accompany timely valid completed candles, which remain usable for recovery. Missing historical prices are never reconstructed.

The status endpoint shows in-process polling metadata. The dashboard exposes the last persisted snapshot, saved on processing, failures, status transitions, or a newer successful-provider-poll timestamp, including repeated `NO_NEW_DATA` polls. Successful polling proves provider contact, not fresh usable data; consult the separate data status and fresh-data timestamp. Dashboard refresh time itself is not an observer heartbeat. No provider heartbeat is generated while the market is closed. Legacy snapshots without freshness fields remain readable and do not acquire invented timestamps.

The Postgres store creates these tables on startup: observer state, paper trades with a unique `(symbol, signal_timestamp)` key, and processed candle checkpoints. This implementation also adds `paper_observer_symbol_universe` (initialization marker) and `paper_observer_symbols` (enabled symbols). Initialization and universe writes use transactions with a shared advisory lock; a first-time add/remove failure rolls back its seed and schema changes together. Dashboard reads and CLI `list` never initialize schema. No existing research table, trade record, or journal is migrated by universe operations. These universe operations were subsequently validated against an isolated local PostgreSQL 17 database. The validation completed 22/22 database checks covering initialization, authoritative empty state, persistence, normalization, symbol caps, add/remove/re-add behavior, duplicate handling, transactional rollback, advisory-lock concurrency scenarios, and reconnect behavior. This does not establish production Supabase/network/permission readiness. The local JSON journal is retained only as a development fallback when `DATABASE_URL` is absent; deployed operation should always provide persistent Postgres.

### Private operator-managed paper universe

The observer evaluates one shared, server-managed universe with the existing SetupScan qualification and paper-risk rules. The browser scanner watchlist remains separate. There is no public universe-management endpoint, browser-held server secret, or real-order submission in this workflow.

Before first initialization only, `PAPER_SYMBOLS` seeds the universe; if absent, the seed is SPY, QQQ, IWM. Symbols are trimmed, uppercased and deduplicated. Empty entries and malformed symbols are rejected; this format check does not guarantee provider support. Once initialized, the persisted list overrides environment defaults, including an intentionally empty `[]`. Remove every enabled symbol to disable new entries; do not set an empty environment seed. Existing open positions remain managed.

With a privately configured `DATABASE_URL`, the operator CLI supports:

```powershell
npm.cmd run paper-symbols -- list
npm.cmd run paper-symbols -- add SYMBOL --confirm-target HOST:PORT/DATABASE
npm.cmd run paper-symbols -- remove SYMBOL --confirm-target HOST:PORT/DATABASE
```

Replace uppercase placeholders locally, not in chat or source control. `list` shows the host, port and database name without passwords or a connection string. Verify the target independently before supplying the exact confirmation for a mutation; the confirmation is an accident-prevention check, not proof of non-production isolation. Do not run the tool against production until separately approved. Unexpected driver errors are reported generically to avoid exposing credentials. A connection failure during commit can leave the outcome uncertain: inspect the list before retrying.

Choose the cap based on the market-data subscription, request limits, hosting costs and cycle duration. Each additional symbol requires warm-up data initially and incremental requests thereafter; symbols with open positions remain managed even after removal, so the cap is not a hard bound on total monitoring requests. Lowering the cap does not silently remove previously persisted symbols.

The worker reads the universe at each cycle boundary. A newly enabled or re-enabled symbol establishes a fresh completed-candle baseline before entry eligibility. Baseline-pending state survives market closure, failed fetches and restarts. Removal cancels pending entries and prevents new ones from the next boundary, while open trades retain their trailing stops and evaluation cursors. Provider failures or invalid/incomplete data cannot authorize a new baseline or fabricate an entry. Current failure handling retries the cycle with bounded backoff; each symbol request has a deadline and failure does not prevent later symbols from being attempted.

Without `DATABASE_URL`, the separate local sidecar is `server/data/paper-trades.json.symbols.json`. Universe operations do not rewrite `paper-trades.json`; reads create nothing. The local adapter supports read/ensure/set/add/remove through its server-side store interface and uses temporary-file rename, refusing to overwrite an existing temporary file. It supports one writer only; concurrent operators should use PostgreSQL. The CLI is PostgreSQL-only. Inspect any interrupted sidecar write deliberately; do not delete or replace it automatically.

The dashboard remains read-only and includes configured symbols, baseline-pending symbols, removed symbols with open positions, and retained history. Its cached snapshot can lag a configuration change. `AVAILABLE` indicates an existing baseline/checkpoint, not proof of a current healthy heartbeat; inspect observer errors and timestamps separately. The existing dashboard is publicly readable wherever the API is exposed. CORS is not authentication; keep access private pending a separate access-policy decision.

Real PostgreSQL transaction and concurrency behavior has been validated against an isolated local PostgreSQL 17 database with 22/22 checks passing. Remote Supabase permissions, SSL/network behavior, production load, and crash-recovery behavior remain separate deployment-readiness checks. Do not infer production readiness from local validation alone.

### Research Run History (initial private, single-user boundary)

The research history API is separate from the paper observer journal and uses `research_runs` and `research_run_experiments` in the same Postgres database when `DATABASE_URL` is configured. Its idempotent schema initialization runs on the first history API request, following the repository's existing Postgres-store convention; no separate migration runner currently exists. Saves are transactional and a duplicate `run_id` is rejected rather than overwritten. The browser-side helper is `src/research/researchRunHistory.js`; callers explicitly save a completed `runResearch()` result with `saveResearchRun(result)`. Research execution does not automatically persist.

Available endpoints are `POST /api/research-runs`, `GET /api/research-runs/:runId`, and `GET /api/research-runs` with limit/offset, symbols, datasetId, experimentId, and status filters. Persisted datasets retain fetch metadata but not a separate copy of `rawSeriesBySymbol`; historical retrieval is for inspection and is not a replayable dataset. Native experiment payloads remain in each saved record and can themselves contain candle arrays. A representative three-symbol, 220-candle Signal Quality record plus synthesis serialized to 605,938 bytes in the persistence test; larger histories and multiple experiments scale higher. The run envelope stores persistence schema version `3`; synthesis retains its own schema version. Research runs record the EMA contract, historical adjustment mode, and build Git revision. The build uses `GIT_COMMIT_SHA` when supplied, otherwise the checked-out Git `HEAD`; if neither is available, code revision remains unknown. Existing runs are not changed.

Paper-order submission and paper-account access are disabled unless `PAPER_ORDER_API_SECRET` is configured. When enabled, callers must present it as a bearer credential; the server compares hashed values with a timing-safe comparison and never returns or logs the secret. This is a single shared-secret control, not a multi-user identity or authorization system. CORS is not authentication.

The browser paper dashboard uses `GET /api/paper-trading` and remains intentionally browser-accessible until a real user-authentication design is introduced. The dashboard is read-only: it reads the selected persisted paper journal and does not fetch market data, create entries, advance positions, or write paper trades.

The Research History API still has no authentication or per-user ownership and must only be exposed in a trusted private/single-user deployment. Do not expose the research endpoints to untrusted users until an application identity and authorization policy exists. Research history is stored in separate tables and never reads or writes paper-observer state, paper trades, or processed-candle checkpoints.

Do not run the browser dashboard as the process responsible for observation. Codespaces and browser sessions are not reliable always-on hosting environments. No automated SetupScan process submits Alpaca orders. The separate paper-order endpoint is disabled unless its server-only authorization secret is configured, and it is not called by the browser dashboard.

## V1 scope

The dashboard scans SPY, QQQ, IWM, NVDA, TSLA, AAPL, AMD, META, and AMZN using a local demo adapter. It calculates a rule-based score from price vs VWAP, EMA 9/21 alignment, RSI, relative volume, breakout/reclaim, and trend confirmation. Scores are explicitly research scores, not probabilities. The threshold slider controls the Qualified Setups section, and symbols with insufficient alignment are shown as `No Setup`.

## Architecture

- `src/data/marketData.js` is the provider boundary. Replace `getWatchlistSnapshot` with a server-side or secure API adapter later; no API keys belong in this frontend.
- `src/logic/scanner.js` owns the scoring rules and reason breakdown shown in the UI.
- `src/backtest/strategy.js` is the initial historical strategy contract. It accepts candles and settings and returns trades and metrics for the next iteration.
- `src/main.jsx` and `src/styles.css` contain the responsive dashboard experience.

The current data is intentionally labeled demo data. A production data connection should use a backend or serverless function to protect credentials, normalize provider responses, and enforce rate limits.
