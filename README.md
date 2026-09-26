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
- `DATABASE_URL` (the connection string for a persistent hosted PostgreSQL database)

Optional observer settings and current defaults:

- `PAPER_SYMBOLS=SPY,QQQ,IWM`
- `PAPER_TIMEFRAME=1Hour`
- `PAPER_MARKET_TIMEZONE=America/New_York`
- `PAPER_POLL_INTERVAL_MS=60000`
- `OBSERVER_PORT=3102`
- `DATABASE_SSL` defaults to enabled; set `DATABASE_SSL=false` only when the PostgreSQL deployment explicitly does not use SSL.

The Postgres store creates these tables on startup: observer state, paper trades with a unique `(symbol, signal_timestamp)` key, and processed candle checkpoints. The local JSON journal is retained only as a development fallback when `DATABASE_URL` is absent; deployed operation should always provide persistent Postgres.

### Research Run History (initial private, single-user boundary)

The research history API is separate from the paper observer journal and uses `research_runs` and `research_run_experiments` in the same Postgres database when `DATABASE_URL` is configured. Its idempotent schema initialization runs on the first history API request, following the repository's existing Postgres-store convention; no separate migration runner currently exists. Saves are transactional and a duplicate `run_id` is rejected rather than overwritten. The browser-side helper is `src/research/researchRunHistory.js`; callers explicitly save a completed `runResearch()` result with `saveResearchRun(result)`. Research execution does not automatically persist.

Available endpoints are `POST /api/research-runs`, `GET /api/research-runs/:runId`, and `GET /api/research-runs` with limit/offset, symbols, datasetId, experimentId, and status filters. Persisted datasets retain fetch metadata but not a separate copy of `rawSeriesBySymbol`; historical retrieval is for inspection and is not a replayable dataset. Native experiment payloads remain in each saved record and can themselves contain candle arrays. A representative three-symbol, 220-candle Signal Quality record plus synthesis serialized to 605,938 bytes in the persistence test; larger histories and multiple experiments scale higher. The run envelope stores persistence schema version `1`; synthesis retains its own schema version. There is no record/native-output version or run-level Git revision in this initial boundary.

This first boundary has no authentication or per-user ownership and must only be exposed in a trusted private/single-user deployment. CORS is not authentication. Do not expose these endpoints to untrusted users until an application identity and authorization policy exist. Research history is stored in separate tables and never reads or writes paper-observer state, paper trades, or processed-candle checkpoints.

Do not run the browser dashboard as the process responsible for observation. Codespaces and browser sessions are not reliable always-on hosting environments. No Alpaca trading or order endpoint is used.

## V1 scope

The dashboard scans SPY, QQQ, IWM, NVDA, TSLA, AAPL, AMD, META, and AMZN using a local demo adapter. It calculates a rule-based score from price vs VWAP, EMA 9/21 alignment, RSI, relative volume, breakout/reclaim, and trend confirmation. Scores are explicitly research scores, not probabilities. The threshold slider controls the Qualified Setups section, and symbols with insufficient alignment are shown as `No Setup`.

## Architecture

- `src/data/marketData.js` is the provider boundary. Replace `getWatchlistSnapshot` with a server-side or secure API adapter later; no API keys belong in this frontend.
- `src/logic/scanner.js` owns the scoring rules and reason breakdown shown in the UI.
- `src/backtest/strategy.js` is the initial historical strategy contract. It accepts candles and settings and returns trades and metrics for the next iteration.
- `src/main.jsx` and `src/styles.css` contain the responsive dashboard experience.

The current data is intentionally labeled demo data. A production data connection should use a backend or serverless function to protect credentials, normalize provider responses, and enforce rate limits.
