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

## V1 scope

The dashboard scans SPY, QQQ, IWM, NVDA, TSLA, AAPL, AMD, META, and AMZN using a local demo adapter. It calculates a rule-based score from price vs VWAP, EMA 9/21 alignment, RSI, relative volume, breakout/reclaim, and trend confirmation. Scores are explicitly research scores, not probabilities. The threshold slider controls the Qualified Setups section, and symbols with insufficient alignment are shown as `No Setup`.

## Architecture

- `src/data/marketData.js` is the provider boundary. Replace `getWatchlistSnapshot` with a server-side or secure API adapter later; no API keys belong in this frontend.
- `src/logic/scanner.js` owns the scoring rules and reason breakdown shown in the UI.
- `src/backtest/strategy.js` is the initial historical strategy contract. It accepts candles and settings and returns trades and metrics for the next iteration.
- `src/main.jsx` and `src/styles.css` contain the responsive dashboard experience.

The current data is intentionally labeled demo data. A production data connection should use a backend or serverless function to protect credentials, normalize provider responses, and enforce rate limits.
