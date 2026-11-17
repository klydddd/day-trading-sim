# Day Trading Simulator — Product Requirements

_Status: draft for approval · 2026-11-18_

## 1. Why this exists

The user wants to **learn day trading from scratch** with zero prior knowledge and without risking real money. Practicing against **real, live market prices** matters to them because it builds habits that carry over to real trading. Fake or random price data teaches the wrong instincts.

Because the user is a complete beginner, the product has two jobs:

1. **Teach.** Explain what is happening while they practice.
2. **Test.** Once they think they've learned something, let them prove it with no help.

### What success looks like
- In the first session, someone who has never traded can place a trade with a stop-loss and explain in their own words what they did and what they risked.
- After a few weeks, they can run a **Challenge** session with no help and see from their own stats whether they are improving.
- They always know why they won or lost a trade. A result is never a mystery.

## 2. Goals, non-goals, anti-goals

### Goals
- Simulated trading with virtual money on **real US stock prices**, both **live** and **replayed** from past days.
- A **Learn mode** that explains terms, orders, and risk in plain English as you go.
- A **Challenge mode** with **no tips, no explanations, and no warnings**.
- Built-in **risk guardrails** (stop-losses, loss limits) that teach the habits real traders use.
- A **trade journal and review** after every session.

### Non-goals (v1)
- A full trading course or video lessons. Teaching happens inside the simulator, in context.
- Options, crypto, futures, forex. US stocks and ETFs only.
- Short selling and margin. v1 is long-only on a cash account (see §8).
- Multiple users, logins, or cloud hosting. It runs locally for one person.
- Mobile layout. Desktop browser only.

### Anti-goals (a failure even if it "works")
- **Ever touching real money.** The app never connects to a funded brokerage account or places a real order.
- **Flattering fills.** If the simulator fills orders more favorably than a real market would (ignoring the spread, filling limit orders that price only touched), the user learns they are better than they are. Fills must be realistic or slightly pessimistic, never optimistic.
- **Buy/sell signals.** The app never says "buy this now." It explains what things mean, not what to do. The user has to build their own judgment.
- **Gamified overtrading.** No confetti for trade count, no streak rewards for trading more. Rewards, if any, go to following your rules.

## 3. Key concepts

| Concept | Meaning |
|---|---|
| **Data source** | Where prices come from: **Live** (now, during market hours) or **Replay** (a real past trading day played back). |
| **Help level** | How much the app helps: **Learn** (all tips and guardrail warnings) or **Challenge** (none). |
| **Session** | One sitting: a data source + a help level + a starting balance, from start to "end session." Ends with a review. |
| **Rules** | The user's personal risk rules (max loss per trade, daily loss limit, stop-loss required). Checked in both help levels. |

Data source and help level are independent. Every combination is valid: Live+Learn, Live+Challenge, Replay+Learn, Replay+Challenge.

## 4. Approaches considered

| Approach | Trade-off | Verdict |
|---|---|---|
| **A. Own simulation engine, Alpaca market data** | We write the order/fill logic, but it works the same in Live and Replay, and every fill can be explained step by step in Learn mode. | **Chosen** |
| B. Alpaca's built-in paper trading for Live + own engine for Replay | Less code for Live, but two engines behave differently, and Alpaca's paper fills can't be explained or tuned. Replay needs our own engine anyway. | Rejected |
| C. Another data provider (Finnhub, Polygon/Massive, etc.) | Some have better free tiers for one thing or another, but Alpaca's free plan gives live streaming **and** years of history from one API with one key. | Rejected for v1; keep the data layer swappable. |

**Data provider: Alpaca Market Data API, free plan.** The builder should check current limits when building. As of writing:
- Real-time data comes from the **IEX exchange only**. Prices track the full market closely, but volume shown is a fraction of total market volume. **Learn mode must say this.**
- WebSocket streaming is limited to about **30 symbols** at once.
- Historical bars and quotes go back years. The most recent ~15 minutes of full-market (SIP) history are restricted.
- It needs a free Alpaca account (paper-only, no deposit). API keys live in a local `.env`, never in the browser.

## 5. Features

### 5.1 Session setup
- Choose **data source** (Live / Replay) and **help level** (Learn / Challenge).
- **Starting balance:** default **$25,000**, editable. Learn mode explains why this number matters (the US pattern-day-trader rule).
- **Rules:** max loss per trade ($ or % of balance), daily loss limit, "stop-loss required" on/off. Sensible defaults: 1% per trade, 3% daily. Saved between sessions.
- **Replay:** pick a date (any past trading day) and a start time. Default: a recent, busy day at market open.
- **Live outside market hours:** show the market status clearly ("Market closed, opens Mon 9:30am ET") and offer to start a Replay instead.

### 5.2 Trading screen
- **Watchlist** of symbols (up to the provider's stream limit) with last price and % change. Comes with a beginner-friendly default list of liquid, popular stocks/ETFs (e.g. SPY, QQQ, AAPL, MSFT, NVDA, TSLA, AMD).
- **Chart** for the selected symbol: candlesticks + volume, timeframes 1m / 5m / 15m, with VWAP and 9/20 EMA toggles. Entry/exit markers and active stop/target lines are drawn on the chart.
- **Quote panel:** bid, ask, spread, last price, day high/low, volume.
- **Order ticket:** buy/sell, quantity (shares or $ amount), order types:
  - Market
  - Limit
  - Stop-loss and take-profit, attachable to an entry as a bracket
- **Positions:** open positions with live unrealized P&L ($ and %), one-click close.
- **Orders:** working orders, cancel/modify.
- **Account bar:** cash, equity, today's realized P&L, distance to daily loss limit.
- **Clock** in US Eastern time, always visible, with market phase (pre-market / open / closed).
- Keyboard shortcuts for buy, sell, close position, and cancel all orders.

### 5.3 Simulation engine (fills)
- **Market buy** fills at the current **ask**, **market sell** at the current **bid**. Never at "last."
- **Limit orders** fill only when price **trades through** the limit, not when it merely touches it (pessimistic, see anti-goals).
- **Stop orders** trigger when the price crosses the stop, then fill like a market order at the next available price. That can be worse than the stop (slippage). Learn mode explains this when it happens.
- **Size limits:** you cannot buy more than your cash allows.
- No commissions by default (matches most US brokers today). Optional per-share fee setting.
- **Replay data:** uses historical quotes where available. Where only 1-minute bars exist, synthesize a realistic price path inside each bar and a modeled spread. The exact model is the builder's call within the "never optimistic" rule.
- The engine is the same code for Live and Replay. Only the price feed differs.

### 5.4 Replay controls
- Play / pause, speed **1× / 2× / 5× / 10×**, and "jump to next 1 minute."
- **No skipping backwards.** Rewinding would show the future and ruin the practice.
- In **Challenge + Replay**, the date is hidden until the session ends, and speed is locked to 1×, so it feels like a real day and you can't look up what happened.

### 5.5 Learn mode (help on)
- **Glossary hovers:** every trading term on screen (bid, ask, spread, VWAP, limit order, slippage, P&L…) has a plain-English hover tooltip with a one-line example.
- **Pre-trade explanation:** before submitting, the ticket shows in dollars what the trade means: _"Buying 20 shares of AAPL at ~$187.40 = $3,748. Your stop at $186.00 risks $28 (0.1% of your account). Your target at $190 would make $52."_
- **Guardrail warnings** (warn, don't block): no stop-loss set, risk above your per-trade rule, approaching the daily loss limit, chasing a fast move, a wide spread.
- **Event explanations:** short notes when something notable happens: a stop filled with slippage, a limit didn't fill even though the price touched it, the IEX volume caveat the first time.
- **"First session" walkthrough:** a short, skippable guided tour that places one practice trade step by step.
- **Daily loss limit reached:** trading pauses for the session with an explanation. The user can override it in Learn mode, and the override is recorded.

### 5.6 Challenge mode (help off)
- **No** tooltips, glossary, pre-trade explanations, warnings, or event notes. The walkthrough is unavailable.
- **Rules are still checked silently.** Every rule break is recorded and shown in the end-of-session review, not during the session.
- **Daily loss limit is a hard stop.** Hitting it ends the session, like a real trading firm's evaluation. No override.
- **Optional profit target** (e.g. +2% of the account) set at session start. The review shows whether you hit it without breaking a rule.
- Challenge results are tracked separately from Learn results so progress is measurable.

### 5.7 Journal & review
- Every trade is logged automatically: symbol, entry/exit time and price, size, P&L, stop/target used, rule breaks, help level, data source.
- **Optional note** on each trade ("why I took it"). In Learn mode the ticket prompts for it but doesn't require it.
- **End-of-session review:** P&L, number of trades, win rate, average win vs average loss, biggest loss, rules followed vs broken, and each trade on the chart with its entry/exit. In Learn mode, a few plain-English observations ("Your average loss was 2× your average win; even a 60% win rate loses money this way").
- **History page:** all past sessions, filterable by help level and data source, with a simple equity curve and the stats above over time.

## 6. Constraints
- **Runs locally on macOS** in a desktop browser. One user, no login.
- API keys stay server-side (a small local backend), never sent to the browser.
- Data is stored locally (e.g. SQLite) and survives restarts.
- Must handle market-closed, holidays, half-days, and a lost data stream (reconnect, and show "data delayed/disconnected" clearly; never silently freeze prices).
- All times shown in US Eastern, labeled.
- Free-tier rate and symbol limits must be respected and hit gracefully.

## 7. Decided vs. left to the builder

**Decided:**
- Own simulation engine + Alpaca free market data (§4)
- Live + Replay data sources; Learn + Challenge help levels, independent of each other
- Long-only, cash account, US stocks/ETFs
- Realistic-to-pessimistic fills
- Local, single-user web app

**Left to the builder:**
- Exact framework/stack (suggested: React + TypeScript frontend, small Node backend, TradingView Lightweight Charts, SQLite)
- The intrabar price path and spread model for bar-only replay data
- Visual design and layout details
- Glossary wording (must be plain-English, beginner-level, with an example)

## 8. Calls made on the user's behalf (please check)
1. **Long-only, no short selling, no margin in v1.** Shorting adds borrow rules and unlimited-loss risk that confuse beginners. It's a good v2 addition.
2. **$25,000 default starting balance**, editable.
3. **Challenge mode still checks your rules silently** and shows breaks in the review. Hitting the daily loss limit ends the session.
4. **Challenge + Replay hides the date and locks speed to 1×**, so it can't be gamed.
5. **No rewind in Replay**, in any mode.
6. **Alpaca** as the data provider, which needs a free account and API keys.
7. **Local app only** for v1, no hosting.

## 9. Later (v2+ ideas, not in scope)
- Short selling and margin
- Pre-market / after-hours trading
- Level 2 / order-book view
- "Scenario packs": curated famous replay days (big gap-ups, crashes, earnings)
- Hosted version reachable from any device
