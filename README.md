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

Do not run the browser dashboard as the process responsible for observation. Codespaces and browser sessions are not reliable always-on hosting environments. No Alpaca trading or order endpoint is used.

## V1 scope

The dashboard scans SPY, QQQ, IWM, NVDA, TSLA, AAPL, AMD, META, and AMZN using a local demo adapter. It calculates a rule-based score from price vs VWAP, EMA 9/21 alignment, RSI, relative volume, breakout/reclaim, and trend confirmation. Scores are explicitly research scores, not probabilities. The threshold slider controls the Qualified Setups section, and symbols with insufficient alignment are shown as `No Setup`.

## Architecture

- `src/data/marketData.js` is the provider boundary. Replace `getWatchlistSnapshot` with a server-side or secure API adapter later; no API keys belong in this frontend.
- `src/logic/scanner.js` owns the scoring rules and reason breakdown shown in the UI.
- `src/backtest/strategy.js` is the initial historical strategy contract. It accepts candles and settings and returns trades and metrics for the next iteration.
- `src/main.jsx` and `src/styles.css` contain the responsive dashboard experience.

The current data is intentionally labeled demo data. A production data connection should use a backend or serverless function to protect credentials, normalize provider responses, and enforce rate limits.
