# Practice Desk: a day trading simulator

Practice day trading with virtual money on **real US stock prices**, either live during market hours or replayed from a real past day. It never connects to a funded brokerage account and never places a real order.

There are two help levels:

- **Learn** explains as you go. Every trading term has a hover definition, the order ticket says in dollars what a trade means, and warnings and notes explain what just happened.
- **Challenge** gives no help at all. Your rules (stop-loss required, max loss per trade, daily loss limit) are still checked silently and shown in the end-of-session review. Hitting the daily loss limit ends the session.

Every session ends with a review: P&L, win rate, average win vs. loss, rule breaks, and every trade on the chart. Past sessions are on the History page, with Learn and Challenge results kept apart.

## What you need

- macOS (or any OS) with **Node.js 24+**
- A desktop browser
- A **free Alpaca account** for market data (no deposit, no funding)

## 1. Get free Alpaca API keys

1. Sign up at <https://app.alpaca.markets/signup>. You don't need to deposit money.
2. In the dashboard, switch to **Paper Trading** and open **API Keys**, then generate a key pair.
3. Keep the key ID and secret handy. The secret is shown only once.

The keys are used only to read prices, the market clock and the trading calendar. They stay in the local server and are never sent to the browser.

## 2. Set up `.env`

```sh
cp .env.example .env
```

Then edit `.env`:

```sh
ALPACA_KEY_ID=your key id
ALPACA_SECRET_KEY=your secret key
```

## 3. Install and run

```sh
npm install
npm run dev
```

Open <http://localhost:5173>. The server runs on port 4100 (local only), and the browser app proxies to it.

Other commands:

```sh
npm test          # all tests
npm run typecheck # TypeScript check
```

Your sessions, trades and settings are saved in `data/sim.db` (SQLite). They survive restarts, and a session that was running when the server stopped comes back where it left off, with Replay paused.

## How prices work, and their limits

- **Live** uses Alpaca's free real-time feed, which comes from the **IEX exchange only**. Prices track the whole market closely, but **volume shows only IEX's share**, a small fraction of all shares traded. The free stream allows at most **30 symbols**, so the watchlist is capped at 30.
- **Replay** uses real **1-minute bars** from the chosen day. Inside each minute the second-by-second path is **modeled**: up minutes go open → low → high → close, down minutes open → high → low → close, so stops and limits inside the minute's range get hit. The bid/ask spread is **modeled** too (2 basis points of the price, at least 1¢). You can play at 1×, 2×, 5× or 10× and jump ahead a minute, but never rewind. In Challenge the date is hidden until the end and speed is locked to 1×.
- **Fills are never flattering.** Market buys fill at the ask and market sells at the bid. Limit orders fill only when the price trades through your limit, not when it merely touches it. Stops fill at the next bid after they trigger, which can be worse than the stop price (slippage).
- Long only, cash account, whole shares, regular hours (9:30am–4:00pm ET, or the early close on half-days). At the close, working orders are cancelled and positions are sold at the bid.

If the live feed drops, a banner says so and market orders are refused when the last quote is more than 5 seconds old, so you never trade on frozen prices.

## Project layout

```
shared/   types, protocol, money formatting, candles/indicators, explanations, stats, market hours
server/   engine (fills, trades, rules), Alpaca data (REST, stream, replay), SQLite, session manager, WebSocket API
web/      React app: setup, trading screen, Learn layer, review, history
```
