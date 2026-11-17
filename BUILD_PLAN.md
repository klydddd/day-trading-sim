# Day Trading Simulator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local, single-user web app for practicing day trading with virtual money on real US stock prices (live or replayed). It has a Learn mode that explains everything and a Challenge mode that explains nothing.

**Architecture:** A local Node server owns everything stateful: the Alpaca data connections, the simulation engine, the rules checks, and SQLite storage. It talks to a React browser app over one WebSocket. The engine is pure TypeScript fed by a stream of `PriceEvent`s. Live mode feeds it from Alpaca's IEX stream, and Replay mode feeds it ticks synthesized from historical 1-minute bars, so both modes share exactly the same fill code. Help-level gating (Learn vs Challenge) happens on the server in one place, so Challenge sessions never receive tips.

**Tech Stack:** Node 24, TypeScript, Fastify 5 + `@fastify/websocket`, `better-sqlite3`, `zod`, `luxon`; Vite + React 19 + Zustand + Tailwind v4; TradingView `lightweight-charts` v5; Vitest + Testing Library. Use the latest stable versions at build time.

**Spec:** `PRD.md` (read it before starting any task)

## Global Constraints

- Never connects to a funded brokerage or places real orders. Alpaca is used **only** for market data, clock, and calendar (paper endpoint `https://paper-api.alpaca.markets`, data endpoint `https://data.alpaca.markets`).
- API keys (`ALPACA_KEY_ID`, `ALPACA_SECRET_KEY`) live in `.env` and are read only by the server. Never send them to the browser.
- US stocks/ETFs, **long-only, cash account**, whole shares, regular hours only (9:30–16:00 ET, or the calendar's early close on half-days).
- Fills are **realistic-to-pessimistic, never optimistic**: market buy @ ask, market sell @ bid, limits fill only when price **trades through**, stops fill at the next available bid after triggering.
- The app never suggests what to buy or sell. No rewards for trade count.
- All displayed times are US Eastern (`America/New_York`) and labeled "ET". Internally, timestamps are epoch milliseconds.
- Default settings: starting balance **$25,000**; max loss per trade **1%**; daily loss limit **3%**; stop-loss required **on**; fee per share **$0**.
- Watchlist ≤ **30** symbols. Default watchlist: `SPY, QQQ, AAPL, MSFT, NVDA, TSLA, AMD`.
- Replay speeds: **1×, 2×, 5×, 10×**. No rewind in any mode. Challenge + Replay: date hidden until session end, speed locked to 1×.
- Desktop browser only. Server on port **4100**, Vite dev server on **5173** proxying `/api` and `/ws`.

## Review Focus

1. **Data stream drops mid-session (live).** The user expects prices to visibly stop being "live" (a banner) and no fills on stale prices. Market orders are rejected with `stale_data` when the symbol's last quote is > 5 s old. → Task 8 (reconnect/status), Task 11 (staleness rejection).
2. **Server restart or browser refresh mid-session.** The user expects the same cash, positions, working orders, and trades back, with Replay resumed **paused** at the same sim time. → Task 11.
3. **Market close while holding positions or working orders.** The user expects working orders cancelled, positions closed at the bid, and the session ended with reason `market_close`, including the 13:00 ET early close on half-days. → Task 9 (replay), Task 11 (both).
4. **Price gaps straight through a stop.** The user expects a fill at the next bid (worse than the stop), the slippage recorded, and a Learn note explaining it. → Task 4.
5. **Replay leaks the future.** Selecting a symbol mid-replay must return only candles at or before sim time, and Challenge must never reveal the replay date before the session ends. → Task 11.

---

## File Structure

```
package.json, tsconfig.json, vitest.config.ts, .env.example, README.md
shared/            # imported by server and web; pure, no I/O
  types.ts         # all domain types (Task 1)
  protocol.ts      # WebSocket message unions + zod schemas (Task 1)
  money.ts         # roundCents, fmtUsd, fmtPct (Task 1)
  candles.ts       # CandleBuilder, aggregateCandles (Task 2)
  indicators.ts    # ema, vwap (Task 2)
  explain.ts       # pre-trade explanation copy (Task 6)
  stats.ts         # computeStats, observations (Task 6)
  market.ts        # marketPhase, marketStatusLabel, formatChartTime (Task 7)
server/
  config.ts        # env loading/validation
  engine/engine.ts, engine/trades.ts, engine/rules.ts, engine/testing.ts
  data/alpacaRest.ts, data/alpacaStream.ts, data/replay.ts, data/replayClock.ts
  db/db.ts, db/repo.ts
  session/sessionManager.ts
  api/ws.ts, index.ts
web/
  index.html, vite.config.ts
  src/main.tsx, App.tsx, store.ts, wsClient.ts
  src/screens/SetupKeys.tsx, SessionSetup.tsx, Trading.tsx, Review.tsx, History.tsx
  src/trading/Watchlist.tsx, Chart.tsx, QuotePanel.tsx, OrderTicket.tsx,
              Positions.tsx, Orders.tsx, AccountBar.tsx, Clock.tsx,
              ReplayControls.tsx, useTradingShortcuts.ts
  src/learn/glossary.ts, Term.tsx, HelpContext.tsx, PreTrade.tsx,
            Warnings.tsx, EventNotes.tsx, Walkthrough.tsx
tests mirror sources: server/**/*.test.ts, shared/*.test.ts, web/src/**/*.test.tsx
```

---

## Phase 0: Foundation

### Task 1: Scaffold, shared types, protocol

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.env.example`, `.gitignore` (`node_modules`, `.env`, `data/`), `shared/types.ts`, `shared/protocol.ts`, `shared/money.ts`, `shared/money.test.ts`, `server/config.ts`, `server/config.test.ts`

**Interfaces:**
- Produces (`shared/types.ts`), used verbatim by every later task:

```ts
export type Side = 'buy' | 'sell';
export type OrderType = 'market' | 'limit' | 'stop';
export type HelpLevel = 'learn' | 'challenge';
export type DataSource = 'live' | 'replay';

export interface Quote { symbol: string; bid: number; ask: number; ts: number }
export interface Print { symbol: string; price: number; size: number; ts: number } // a market trade print
export type PriceEvent = { kind: 'quote'; quote: Quote } | { kind: 'print'; print: Print };
export interface Bar { t: number; o: number; h: number; l: number; c: number; v: number } // t = minute start
export type Candle = Bar;

export interface OrderRequest {
  symbol: string; side: Side; qty: number; type: OrderType;
  limitPrice?: number; stopPrice?: number;
  bracket?: { stopLoss?: number; takeProfit?: number };
  note?: string;
}
export type OrderStatus = 'pending_parent' | 'working' | 'filled' | 'cancelled' | 'rejected';
export interface Order extends OrderRequest {
  id: string; status: OrderStatus; createdAt: number;
  parentId?: string; ocoGroup?: string; triggered?: boolean;
  filledAt?: number; fillPrice?: number; rejectReason?: RejectReason;
}
export type RejectReason = 'no_quote' | 'stale_data' | 'insufficient_cash' | 'no_position'
  | 'invalid_qty' | 'invalid_price' | 'unsupported' | 'daily_limit' | 'session_ended';
export interface Fill { orderId: string; symbol: string; side: Side; qty: number; price: number; fee: number; ts: number; slippage?: number }
export interface Position { symbol: string; qty: number; avgPrice: number }
export interface AccountState { cash: number; positions: Record<string, Position>; orders: Order[]; realizedPnl: number }

export type RuleCode = 'no_stop' | 'risk_over_limit' | 'daily_limit_hit' | 'daily_limit_override';
export interface RuleBreak { rule: RuleCode; detail: string; ts: number }
export type WarningCode = 'no_stop' | 'risk_over_limit' | 'near_daily_limit' | 'chasing' | 'wide_spread';
export interface Warning { code: WarningCode; message: string }
export type NoteCode = 'stop_slippage' | 'limit_touched_no_fill' | 'iex_volume' | 'modeled_spread';
export interface Note { code: NoteCode; message: string; ts: number }

export interface Trade {           // one round trip: flat -> long -> flat
  id: string; sessionId: string; symbol: string;
  openedAt: number; closedAt?: number; maxQty: number;
  avgEntry: number; avgExit?: number; pnl: number; fees: number;
  stopUsed?: number; targetUsed?: number; note?: string;
  ruleBreaks: RuleBreak[]; fills: Fill[];
}
export interface Limit { kind: 'dollars' | 'percent'; value: number }
export interface Rules { maxLossPerTrade: Limit; dailyLossLimit: Limit; requireStop: boolean }
export interface SessionConfig {
  dataSource: DataSource; helpLevel: HelpLevel; startingCash: number; rules: Rules;
  replayDate?: string;     // 'YYYY-MM-DD'; ignored (random) in challenge+replay
  replayStartTime?: string; // 'HH:mm' ET, default '09:30'
  profitTargetPct?: number; // challenge only
}
export type EndReason = 'user' | 'daily_limit' | 'market_close';
```

- Produces (`shared/protocol.ts`): `ClientMessage` and `ServerMessage` discriminated unions on `type`, with a zod schema `clientMessageSchema` for parsing input on the server.
  - **Client message types:** `start_session{config}`, `end_session`, `preview_order{req}`, `submit_order{req}`, `cancel_order{orderId}`, `modify_order{orderId, changes:{qty?,limitPrice?,stopPrice?}}`, `close_position{symbol}`, `cancel_all`, `replay_control{action:'play'|'pause'|'step'|'speed', speed?:1|2|5|10}`, `select_symbol{symbol}`, `set_watchlist{symbols}`, `override_daily_limit`, `save_note{tradeId,note}`.
  - **Server message types:** `status{keysOk, market:{phase, nextOpen, nextClose}, data:'connected'|'reconnecting'|'disconnected'}`, `session{id, config, replayDate:string|null, status:'active'|'ended', paused:boolean}`, `account{state, equity, sessionPnl, buyingPower}`, `price{event}`, `candles{symbol, candles}`, `candle{symbol, candle}`, `order_update{order}`, `fill{fill}`, `trade_closed{trade}`, `preview{warnings}`, `warning{warning}`, `note{note}`, `daily_limit{state:'near'|'paused'}`, `clock{simTs, speed, playing}`, `session_ended{reason, review}`, `error{message}`.
- Produces (`shared/money.ts`): `roundCents(n: number): number`, `fmtUsd(n: number, decimals = 2): string` (`$3,748` for decimals 0, `-$12.50`), `fmtPct(fraction: number, decimals = 1): string` (`0.00112 → "0.1%"`).
- Produces (`server/config.ts`): `loadConfig(env): { keyId?: string; secret?: string; keysPresent: boolean; port: number; dbPath: string }`. Defaults: port 4100, `data/sim.db`.

- [ ] **Step 1:** `git init`. Create `package.json` with scripts `dev` (concurrently: `tsx watch server/index.ts` + `vite web`), `test` (`vitest run`), `typecheck` (`tsc --noEmit`). Install deps. Create `.env.example` with the two key names and a link to Alpaca's sign-up page.
- [ ] **Step 2: Write failing tests:** `money.test.ts` (`roundCents(1.005)===1.01`, `fmtUsd(3748,0)==="$3,748"`, `fmtUsd(-12.5)==="-$12.50"`, `fmtPct(28/25000)==="0.1%"`), and `config.test.ts` (missing keys gives `keysPresent:false` and doesn't throw).
- [ ] **Step 3:** Run `npm test`. Expected: FAIL (modules missing).
- [ ] **Step 4:** Implement `shared/types.ts`, `shared/protocol.ts`, `shared/money.ts`, `server/config.ts`.
- [ ] **Step 5:** Run `npm test && npm run typecheck`. Expected: PASS, no type errors.
- [ ] **Step 6:** Commit `chore: scaffold project with shared types and protocol`.

---

## Phase 1: Simulation core (pure, no I/O)

### Task 2: Candles and indicators

**Files:** Create `shared/candles.ts`, `shared/indicators.ts`, and tests for each.

**Interfaces:**
- Consumes: `Print`, `Candle` (Task 1)
- Produces:
  - `class CandleBuilder { constructor(symbol: string); onPrint(p: Print): { closed?: Candle; current: Candle }; seed(c: Candle[]): void; all(): Candle[] }`. Minute buckets are `Math.floor(ts/60000)*60000`.
  - `aggregateCandles(c1m: Candle[], minutes: 5 | 15): Candle[]`. Buckets align to ET clock minutes (9:30, 9:35…).
  - `ema(values: number[], period: number): (number | undefined)[]`, seeded with the SMA of the first `period` values.
  - `vwap(candles: Candle[]): number[]`, cumulative over the passed candles using typical price `(h+l+c)/3`.

- [ ] **Step 1: Write failing tests:**
  - `CandleBuilder`: prints at 9:30:05 (10), 9:30:40 (12), 9:30:50 (9), 9:31:01 (11). The 9:31 print returns `closed = {t: 9:30, o:10, h:12, l:9, c:9, v: Σ sizes}` and starts a new `current` at 11.
  - `aggregateCandles`: ten 1m candles → two 5m candles with correct o (first), c (last), h/l (extremes), v (sum).
  - `ema([1..10],3)`: first two `undefined`, third `2`, last `9`.
  - `vwap`: two candles, typical 10 v100 and 20 v300, gives `[10, 17.5]`.
- [ ] **Step 2:** Run `npx vitest run shared`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat: candle building, aggregation, EMA and VWAP`.

### Task 3: Engine, part 1: account, market and limit orders

**Files:** Create `server/engine/engine.ts`, `server/engine/testing.ts` (helpers `q(sym,bid,ask,ts)`, `p(sym,price,ts)` returning `PriceEvent`s), `server/engine/engine.test.ts`.

**Interfaces:**
- Consumes: Task 1 types.
- Produces:

```ts
export type EngineEvent =
  | { kind: 'order_update'; order: Order }
  | { kind: 'fill'; fill: Fill }
  | { kind: 'note'; note: Note };
export interface EngineSnapshot { state: AccountState; lastQuotes: Record<string, Quote>; seq: number }
export class Engine {
  constructor(opts: { startingCash: number; feePerShare: number; idGen?: () => string });
  submit(req: OrderRequest, now: number): EngineEvent[];   // first event is always the new order's order_update
  cancel(orderId: string, now: number): EngineEvent[];
  modify(orderId: string, changes: { qty?: number; limitPrice?: number; stopPrice?: number }, now: number): EngineEvent[];
  closePosition(symbol: string, now: number): EngineEvent[]; // market sell full qty; cancels the symbol's working sells
  cancelAll(now: number): EngineEvent[];
  onPrice(ev: PriceEvent): EngineEvent[];
  state(): AccountState;
  lastQuote(symbol: string): Quote | undefined;
  equity(): number;        // cash + Σ qty × bid (falls back to avgPrice with no quote)
  buyingPower(): number;   // cash − Σ (working buy limit qty × limitPrice + fees)
  snapshot(): EngineSnapshot;
  static restore(s: EngineSnapshot, opts: { feePerShare: number; idGen?: () => string }): Engine;
}
```

**Rules this task pins (each one is a test):**
- `qty` must be a positive integer (reject `invalid_qty`). Limit price must be > 0 (`invalid_price`).
- Market order with no quote for the symbol is rejected (`no_quote`).
- Market buy fills immediately at **ask**, market sell at **bid**. Fee = `feePerShare × qty`, deducted from cash.
- Buy rejected `insufficient_cash` if `qty × ask + fee > buyingPower()` (market) or `qty × limit + fee > buyingPower()` (limit).
- Sell with no position is rejected (`no_position`). Buy `stop` is rejected (`unsupported`, long-only).
- Marketable limit: buy limit ≥ current ask fills at once **at the ask**. Sell limit ≤ bid fills at once at the bid.
- Resting buy limit fills **at the limit** only on a print **strictly below** it. A print exactly at the limit emits one `limit_touched_no_fill` note per order and does not fill. Sell limits mirror this.
- At fill time, sell qty = `min(order.qty, position.qty)`. When a position reaches 0, the remaining working sells for that symbol are cancelled.
- `Position.avgPrice` is the weighted average of buys. `realizedPnl` += `(sellPrice − avgPrice) × qty − fee` per sell.

- [ ] **Step 1: Write failing tests**, one `it` per bullet above. Key vectors:
  - Start $25,000. `q('AAPL',187.38,187.40)`, market buy 20 → fill 187.40, cash `21,252`.
  - Limit buy 100 @ 50 with `q(49.98, 50.02)`: `p(50.00)` → no fill + note; `p(49.99)` → fill @ 50.00.
  - `snapshot()` → `restore()` round-trips `state()` exactly.
- [ ] **Step 2:** Run `npx vitest run server/engine`. Expected: FAIL.
- [ ] **Step 3:** Implement `Engine`. Keep all money math through `roundCents`.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(engine): account, market and limit orders`.

### Task 4: Engine, part 2: stops, brackets, slippage

**Files:** Modify `server/engine/engine.ts`. Test `server/engine/engine.stops.test.ts`.

**Interfaces:** Same `Engine` API. Adds behavior only.

**Rules (each a test):**
- A sell `stop` **triggers** on a print ≤ `stopPrice` (sets `triggered: true`). It **fills on the next quote event** for that symbol at that quote's **bid**. `slippage = stopPrice − fillPrice` (≥ 0). If slippage > 0, emit `stop_slippage` note: `"Your stop at $49.00 filled at $47.95 ($1.05 worse) because the price jumped past it. Stops limit losses but don't guarantee your price."`
- **Gap test (Review Focus #4):** position 100 @ 50, stop 49. `q(49.98,50.00)`, `p(48.00)` → triggered, no fill. `q(47.95,47.97)` → fill 47.95, slippage 1.05, note emitted.
- A buy with `bracket` creates two children (`stop` sell at `stopLoss`, `limit` sell at `takeProfit`), each with `qty = parent.qty`, `status: 'pending_parent'`, a shared `ocoGroup`, and `parentId`. When the parent fills, they become `working`. When one child fills, the sibling is cancelled. Cancelling the parent cancels its children. `closePosition` cancels them.
- A bracket's `stopLoss` must be < the entry reference price and `takeProfit` > it, or the order is rejected `invalid_price`.

- [ ] **Step 1:** Write failing tests for each rule.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx vitest run server/engine`. Expected: all engine tests PASS.
- [ ] **Step 5:** Commit `feat(engine): stop orders, brackets with OCO, slippage notes`.

### Task 5: Trade tracking (round trips)

**Files:** Create `server/engine/trades.ts`, `server/engine/trades.test.ts`.

**Interfaces:**
- Consumes: `Fill`, `Order`, `Trade`, `RuleBreak`.
- Produces:

```ts
export class TradeTracker {
  constructor(sessionId: string, idGen?: () => string);
  onFill(fill: Fill, order: Order, positionQtyAfter: number): { opened?: Trade; closed?: Trade };
  attachBreaks(symbol: string, breaks: RuleBreak[]): void; // to the open trade (or the next one opened for symbol)
  noteStop(symbol: string, stop: number): void;            // first stop seen during the trade → stopUsed
  noteTarget(symbol: string, target: number): void;
  open(): Trade[]; closed(): Trade[];
  snapshot(): unknown; static restore(s: unknown): TradeTracker;
}
```

- A trade opens on the fill that takes a position from 0 to > 0, and closes on the fill that returns it to 0. The entry order's `note` becomes `trade.note`. `pnl = Σ sell value − Σ buy value − fees`.

- [ ] **Step 1: Write failing tests:**
  - buy 10 @ 10, buy 10 @ 12, sell 20 @ 13 → `maxQty 20`, `avgEntry 11`, `avgExit 13`, `pnl 40`.
  - Two separate round trips → two closed trades.
  - Breaks attached before the entry fill end up on that trade.
  - Snapshot/restore round-trip.
- [ ] **Step 2:** Run. FAIL. **Step 3:** Implement. **Step 4:** Run. PASS.
- [ ] **Step 5:** Commit `feat(engine): round-trip trade tracking`.

### Task 6: Rules, warnings, explanation copy, stats

**Files:** Create `server/engine/rules.ts`, `shared/explain.ts`, `shared/stats.ts`, and tests for each.

**Interfaces:**
- Produces (`rules.ts`):

```ts
export function limitToDollars(l: Limit, startingCash: number): number;
export function evaluateEntry(req: OrderRequest, ctx: {
  quote: Quote; rules: Rules; startingCash: number; sessionPnl: number; recentPrints: Print[]; now: number;
}): { warnings: Warning[]; breaks: RuleBreak[] };
export function dailyLimitState(sessionPnl: number, rules: Rules, startingCash: number): 'ok' | 'near' | 'hit';
```

  - Only buys are "entries." Sells return empty results.
  - Risk = `(entryRef − stop) × qty` where `entryRef` = ask (market) or limit (limit), and `stop` = `bracket.stopLoss`.
  - No stop → warning `no_stop`, plus break `no_stop` if `rules.requireStop`.
  - Risk > per-trade limit → warning and break `risk_over_limit`.
  - `near` when loss ≥ 80% of the daily limit, `hit` at ≥ 100%.
  - `chasing`: a buy after price rose ≥ 1% across `recentPrints` from the last 2 minutes.
  - `wide_spread`: `(ask−bid)/mid > 0.001`.
  - Warning messages are plain English and never say "buy" or "sell" as advice. Example: `"This order has no stop-loss, so your possible loss isn't limited."`
- Produces (`shared/explain.ts`): `explainOrder(req: OrderRequest, quote: Quote, startingCash: number): string`.
- Produces (`shared/stats.ts`):
  - `computeStats(trades: Trade[]): { totalPnl; count; winRate; avgWin; avgLoss; biggestLoss; tradesFollowingRules; ruleBreaks }`. A win is pnl > 0, a loss is pnl < 0, and `avgLoss` is positive.
  - `observations(trades: Trade[]): string[]`.

- [ ] **Step 1: Write failing tests:**
  - `explainOrder({symbol:'AAPL',side:'buy',qty:20,type:'market',bracket:{stopLoss:186,takeProfit:190}}, q(…,187.38,187.40), 25000)` ===
    `"Buying 20 shares of AAPL at ~$187.40 = $3,748. Your stop at $186.00 risks $28 (0.1% of your account). Your target at $190.00 would make $52."` (spec copy, prices to 2 decimals).
  - With no bracket: `"Buying 20 shares of AAPL at ~$187.40 = $3,748. You have no stop-loss, so your possible loss isn't limited."`
  - `evaluateEntry`: no stop + `requireStop` → one warning + one break. Risk $300 on $25k with a 1% rule → `risk_over_limit`. Wide spread and chasing vectors.
  - `dailyLimitState(-600, 3%, 25000)` → `'near'` (limit 750, 80% = 600). `-750` → `'hit'`.
  - `observations`: avgLoss 100 / avgWin 50 → contains `"Your average loss was 2× your average win; even a 60% win rate loses money this way."` (fires when ratio > 1.5; ratio shown with 1 decimal, dropping `.0`). 2 of 5 trades without `stopUsed` → `"2 of your 5 trades had no stop-loss."` Losers held > 1.5× longer than winners → `"You held losing trades about N× longer than winning ones."` More than 20 trades → `"You made N trades. Every trade pays the spread, so fewer, better trades usually beat more trades."`
- [ ] **Step 2:** Run. FAIL. **Step 3:** Implement. **Step 4:** Run. PASS.
- [ ] **Step 5:** Commit `feat: rules evaluation, pre-trade explanations, session stats`.

---

## Phase 2: Market data

### Task 7: Alpaca REST client and market calendar

**Files:** Create `server/data/alpacaRest.ts`, `shared/market.ts`, and tests (inject a fake `fetch`).

**Interfaces:**
- Produces:

```ts
export interface TradingDay { date: string; open: number; close: number } // epoch ms, ET-correct
export class AlpacaRest {
  constructor(opts: { keyId: string; secret: string; fetch?: typeof fetch });
  verifyKeys(): Promise<boolean>;                           // GET paper /v2/clock; 401/403 → false
  getClock(): Promise<{ isOpen: boolean; nextOpen: number; nextClose: number; now: number }>;
  getCalendar(start: string, end: string): Promise<TradingDay[]>;  // paper /v2/calendar
  getBars(symbol: string, start: number, end: number, feed: 'iex' | 'sip'): Promise<Bar[]>; // data /v2/stocks/{s}/bars, timeframe=1Min, follows next_page_token
}
```
- Headers: `APCA-API-KEY-ID`, `APCA-API-SECRET-KEY`. On HTTP 429, wait `Retry-After` (default 2 s) and retry up to 3 times, then throw a typed `RateLimitError`.
- `shared/market.ts`:
  - `marketPhase(now: number, day?: TradingDay): 'pre' | 'open' | 'closed'`
  - `marketStatusLabel(isOpen: boolean, nextOpen: number, now: number): string` returns e.g. `"Market closed, opens Mon 9:30am ET"` and `"Market open, closes 4:00pm ET"`.
  - `formatChartTime(ts: number, hideDate: boolean): string` returns `"10:42"`, or `"Nov 14 10:42"` when not hidden.

- [ ] **Step 1: Write failing tests:**
  - Pagination concatenates two pages.
  - 429 then 200 succeeds.
  - Three 429s throw `RateLimitError`.
  - Calendar parses a half-day (`close: "13:00"`) to 13:00 ET epoch.
  - `marketStatusLabel` on a Saturday shows `"Market closed, opens Mon 9:30am ET"`.
  - `formatChartTime(…, true)` contains no date.
- [ ] **Step 2:** Run. FAIL. **Step 3:** Implement (luxon for ET). **Step 4:** Run. PASS.
- [ ] **Step 5:** Commit `feat(data): Alpaca REST client, calendar and market-hours helpers`.

### Task 8: Live stream adapter

**Files:** Create `server/data/alpacaStream.ts`, `server/data/alpacaStream.test.ts` (uses a local `ws` `WebSocketServer` on a random port as a fake Alpaca).

**Interfaces:**
- Produces:

```ts
export type StreamStatus = 'connected' | 'reconnecting' | 'disconnected';
export class AlpacaStream {
  constructor(opts: { keyId: string; secret: string; url?: string /* default wss://stream.data.alpaca.markets/v2/iex */;
                      backoffMs?: number[] /* default [1000,2000,4000,8000,16000,30000] */ });
  start(symbols: string[]): void;        // throws if symbols.length > 30
  setSymbols(symbols: string[]): void;   // diff → subscribe/unsubscribe for trades + quotes
  stop(): void;
  onEvent(cb: (e: PriceEvent) => void): void;
  onStatus(cb: (s: StreamStatus) => void): void;
}
```
- Protocol: on open send `{action:'auth',key,secret}`. After `[{T:'success',msg:'authenticated'}]` send `{action:'subscribe',trades,quotes}`. Map `T:'q'` (`S,bp,ap,t`) to quote and `T:'t'` (`S,p,s,t`) to print. Parse `t` (RFC-3339) to epoch ms. Re-subscribe after reconnect.

- [ ] **Step 1: Write failing tests:**
  - Auth then subscribe messages are sent in order.
  - A quote message becomes the right `PriceEvent`.
  - The server closing the socket → status `reconnecting` → reconnect → `connected` → subscription re-sent (use backoff `[10]`).
  - `start` with 31 symbols throws.
- [ ] **Step 2:** Run. FAIL. **Step 3:** Implement. **Step 4:** Run. PASS.
- [ ] **Step 5:** Commit `feat(data): live IEX stream with reconnect`.

### Task 9: Replay feed and clock

**Files:** Create `server/data/replay.ts`, `server/data/replayClock.ts`, and tests.

**Interfaces:**
- Produces:

```ts
export function modeledSpread(price: number): number;           // max(0.01, ceil-to-cent(price × 0.0002))
export function synthesizeTicks(bar: Bar, n = 60): number[];     // up bar (c ≥ o): o→l→h→c ; down bar: o→h→l→c
export class ReplayFeed {
  constructor(barsBySymbol: Record<string, Bar[]>, close: number);
  advanceTo(simTs: number): PriceEvent[];  // for each symbol, each tick i at bar.t + i*1000 ≤ simTs not yet emitted:
                                            // emit print(price, size = round(bar.v/60)) then quote(price ∓ spread/2)
  barsUpTo(symbol: string, simTs: number): Bar[];  // only bars whose minute has fully elapsed (t + 60000 ≤ simTs)
  isFinished(simTs: number): boolean;      // simTs ≥ close
}
export class ReplayClock {
  constructor(startTs: number, opts?: { speed?: 1 | 2 | 5 | 10; lockedSpeed?: boolean });
  play(): void; pause(): void; setSpeed(s: 1 | 2 | 5 | 10): void; // no-op when lockedSpeed
  stepMinute(): number;                  // jump to the next minute boundary; only while paused
  tick(realElapsedMs: number): number;   // advances by elapsed × speed when playing; returns simTs
  readonly simTs: number; readonly playing: boolean; readonly speed: number;
  // deliberately no method that moves time backwards
}
```
- Tick prices are linear along the path segments, distributed by distance, and rounded to cents. The first tick is `o`, the last is `c`, and `h` and `l` are each hit exactly.

- [ ] **Step 1: Write failing tests:**
  - `modeledSpread(187.4)===0.04`, `modeledSpread(20)===0.01`.
  - Up bar `{o:10,h:12,l:9,c:11}`: 60 ticks, first 10, last 11, min 9 before max 12. Mirror test for a down bar.
  - `advanceTo` never emits a tick with ts > simTs and never re-emits.
  - `barsUpTo` excludes the in-progress minute.
  - Clock at 5× for 1000 ms real advances 5000 ms. `lockedSpeed` ignores `setSpeed(10)`. `stepMinute` from 9:31:20 → 9:32:00.
  - `isFinished` at a 13:00 half-day close.
- [ ] **Step 2:** Run. FAIL. **Step 3:** Implement. **Step 4:** Run. PASS.
- [ ] **Step 5:** Commit `feat(data): replay tick synthesis, modeled spread, replay clock`.

---

## Phase 3: Server

### Task 10: Persistence

**Files:** Create `server/db/db.ts`, `server/db/repo.ts`, `server/db/repo.test.ts` (uses `:memory:`).

**Interfaces:**
- Schema (created on open, `PRAGMA user_version` = 1):
  - `settings(key TEXT PK, value TEXT)`: JSON values for `rules`, `watchlist`, `feePerShare`, `walkthroughDone`
  - `sessions(id PK, config TEXT, replay_date TEXT, status TEXT, end_reason TEXT, started_at INT, ended_at INT, sim_ts INT, snapshot TEXT, overrides TEXT)`
  - `trades(id PK, session_id, symbol, opened_at, closed_at, pnl, data TEXT)`
- Produces:

```ts
export class Repo {
  constructor(db: Database);
  getSetting<T>(key: string, fallback: T): T; setSetting(key: string, v: unknown): void;
  createSession(id: string, config: SessionConfig, replayDate: string | null, startedAt: number): void;
  saveSnapshot(id: string, snapshot: unknown, simTs: number | null): void;
  endSession(id: string, reason: EndReason, endedAt: number): void;
  activeSession(): { id; config; replayDate; snapshot; simTs } | null;
  saveTrade(t: Trade): void;  // upsert
  sessionTrades(id: string): Trade[];
  listSessions(filter?: { helpLevel?: HelpLevel; dataSource?: DataSource }): Array<{ id; config; replayDate; startedAt; endedAt; endReason; pnl: number; tradeCount: number }>;
}
```

- [ ] **Step 1: Write failing tests:** setting defaults and round-trip, session lifecycle (`activeSession` null after `endSession`), trade upsert, and `listSessions` filtering by help level.
- [ ] **Step 2:** Run. FAIL. **Step 3:** Implement. **Step 4:** Run. PASS.
- [ ] **Step 5:** Commit `feat(db): SQLite persistence`.

### Task 11: Session manager and WebSocket API

**Files:** Create `server/session/sessionManager.ts`, `server/api/ws.ts`, `server/index.ts`, and `server/session/sessionManager.test.ts` (fake feed, fake clock, in-memory repo, fake `AlpacaRest`).

**Interfaces:**
- Consumes: everything from Tasks 3–10.
- Produces:

```ts
export interface SessionDeps {
  repo: Repo; rest: Pick<AlpacaRest, 'getClock' | 'getCalendar' | 'getBars'>;
  liveStream?: Pick<AlpacaStream, 'start' | 'setSymbols' | 'stop' | 'onEvent' | 'onStatus'>;
  send: (m: ServerMessage) => void; now: () => number;
  setInterval: (fn: () => void, ms: number) => () => void; // returns cancel
  random?: () => number; idGen?: () => string;
}
export class SessionManager {
  constructor(deps: SessionDeps);
  start(config: SessionConfig): Promise<void>;
  handle(msg: ClientMessage): Promise<void>;
  onPrice(ev: PriceEvent): void;
  end(reason: EndReason): void;
  static restore(deps: SessionDeps): Promise<SessionManager | null>;
}
```
- `server/api/ws.ts`: Fastify route `/ws`. It validates each message with `clientMessageSchema` (invalid → `error`), forwards it to the single `SessionManager`, and sends `status` on connect. `GET /api/health` → `{ keysOk }`. `server/index.ts` wires config → `AlpacaRest.verifyKeys` → `SessionManager.restore` → listen on 4100.

**Behavior (each bullet is at least one test):**
- **Help gating:** `send` is wrapped so that in Challenge **no** `warning`, `note`, or `daily_limit:'near'` messages are sent, and `preview` always carries `warnings: []`. Rule breaks are still recorded on trades.
- **Start:**
  - Live is refused (`error`) unless `getClock().isOpen`.
  - Replay date must be a trading day in `getCalendar` (else `error`).
  - Challenge + Replay picks a random trading day between 730 and 7 days ago, sets `lockedSpeed`, and reports `replayDate: null` until `session_ended`.
  - On the first Live session, emit note `iex_volume`. On the first Replay session, emit note `modeled_spread`.
- **Orders:**
  - `submit_order` runs `evaluateEntry`. In Learn, it sends warnings. Breaks go to `TradeTracker.attachBreaks`. Then it calls the engine, persists the snapshot, and sends `order_update`/`fill`/`account`. Closed trades are saved and sent as `trade_closed`.
  - Live market orders on a quote older than 5 s are rejected `stale_data` without calling the engine.
- **Daily limit** (checked after every fill and every price event):
  - Learn: `near` warns once. `hit` → `daily_limit:'paused'`, and new buys are rejected `daily_limit` until `override_daily_limit`, which records a `daily_limit_override` break on the session's `overrides`.
  - Challenge: `hit` → `end('daily_limit')`.
- **End** (`user`, `daily_limit`, `market_close`): cancel all, close positions at the bid, save trades, `repo.endSession`, then send `session_ended{reason, review}`. The review contains `computeStats`, the trades, `replayDate` (now revealed), profit-target result (`hit` = sessionPnl ≥ target and 0 breaks), and `observations()` in Learn only.
- **Market close:** live checks `now() ≥ today's calendar close` every second. Replay checks `feed.isFinished(simTs)`. Both call `end('market_close')`.
- **Replay loop:** an interval every 250 ms runs `clock.tick` → `feed.advanceTo` → `onPrice` for each event, sends `clock`, and persists `simTs` at most every 5 s.
- **Charts:** `select_symbol` sends `candles`. Live uses `getBars(feed:'iex')` from today's open to now, merged with the `CandleBuilder`. Replay uses `feed.barsUpTo(symbol, simTs)` and **never** returns future bars. Prices are throttled to ≤ 4 `price` messages/s per symbol.
- **Watchlist:** `set_watchlist` with more than 30 symbols → `error`. Otherwise it persists and calls `liveStream.setSymbols`.
- **Restore:** `restore()` rebuilds `Engine`/`TradeTracker` from the snapshot. Replay resumes **paused** at the saved `simTs`. Live resumes if the market is open on the same trading day, and otherwise ends with `market_close` using the snapshot's last quotes.

- [ ] **Step 1: Write failing tests**, one per bullet, including:
  - **Challenge gating:** a no-stop order sends zero `warning` messages, and the trade has a `no_stop` break.
  - **Review Focus #1:** stale quote → `stale_data`.
  - **Review Focus #2:** restore after 2 fills and 1 working order, comparing state and paused replay at the same `simTs`.
  - **Review Focus #3:** close with an open position + working limit → position closed at bid, order cancelled, reason `market_close`.
  - **Review Focus #5:** mid-replay `select_symbol` returns only bars ≤ simTs, and `session.replayDate === null` in Challenge.
- [ ] **Step 2:** Run `npx vitest run server/session`. FAIL.
- [ ] **Step 3:** Implement `SessionManager`, then `ws.ts` and `index.ts`.
- [ ] **Step 4:** Run `npm test`. All PASS. Then run `npm run dev` with real keys in `.env`, and `curl localhost:4100/api/health` → `{"keysOk":true}`.
- [ ] **Step 5:** Commit `feat(server): session manager, help gating, WebSocket API`.

---

## Phase 4: Browser app

UI tests cover behavior (gating, validation, shortcuts, copy), not pixels. Layout follows PRD §5.2. Use a dark, dense trading-screen style, with green = up and red = down, never color alone (always add a sign or arrow).

### Task 12: App shell, connection, setup screens

**Files:** Create `web/index.html`, `web/vite.config.ts`, `web/src/main.tsx`, `App.tsx`, `store.ts`, `wsClient.ts`, `screens/SetupKeys.tsx`, `screens/SessionSetup.tsx`, `learn/HelpContext.tsx`, and tests for `store` and `SessionSetup`.

**Interfaces:**
- Produces:
  - `wsClient`: `connect(): void`, `send(m: ClientMessage): void`, auto-reconnect every 2 s.
  - `useStore` (Zustand) holding the latest of each `ServerMessage` type plus `prices: Record<string, {quote?, print?}>`, `candles: Record<string, Candle[]>`, `orders`, `trades`, `notes`, `warnings`, and `review`.
  - `HelpContext` providing `{ helpLevel: HelpLevel }` and `useHelp(): { learn: boolean }`.
  - Routing by state:
    - `keysOk === false` → SetupKeys
    - no active session → SessionSetup
    - active session → Trading
    - `session_ended` → Review
    - a History link is reachable from SessionSetup.
- **SetupKeys:** step-by-step instructions to create a free Alpaca account, copy the paper API keys into `.env`, and restart.
- **SessionSetup:**
  - Data source and help level toggles, starting balance (25,000), and rules (1%, 3%, stop required on) loaded from settings.
  - Replay date picker plus start time, hidden in Challenge with the text `"A random past trading day will be picked. You'll see which one at the end."`
  - Profit target (Challenge only).
  - Fee per share (default $0, under "Advanced").
  - Live is disabled when the market is closed, showing `marketStatusLabel(…)` and a "Start a Replay instead" button.

- [ ] **Step 1: Write failing tests:**
  - The store reduces `fill`/`order_update` correctly.
  - SessionSetup with the market closed: the Live option is disabled, the label is shown, and "Start a Replay instead" switches the data source.
  - In Challenge, the date picker is hidden and the random-day text is shown.
- [ ] **Step 2:** Run `npx vitest run web`. FAIL. **Step 3:** Implement. **Step 4:** Run. PASS.
- [ ] **Step 5:** Commit `feat(web): app shell, connection, setup screens`.

### Task 13: Trading screen: market view

**Files:** Create `screens/Trading.tsx`, `trading/Watchlist.tsx`, `Chart.tsx`, `QuotePanel.tsx`, `AccountBar.tsx`, `Clock.tsx`, `ReplayControls.tsx`, and tests for `Clock` and `ReplayControls`.

**Interfaces:**
- Consumes: store, `aggregateCandles`, `ema`, `vwap`, `formatChartTime`, `marketPhase`, and `fmtUsd`/`fmtPct`.
- **Watchlist:** last price, % change vs first candle of the day, click to `select_symbol`, add/remove symbol (`set_watchlist`).
- **Chart:** `lightweight-charts` candlesticks + volume, a 1m/5m/15m switch, VWAP and EMA 9/20 toggles, entry/exit markers from fills, and price lines for working stop/limit orders. Use the time formatter `formatChartTime(ts, hideDate)` where `hideDate = challenge && replay`.
- **QuotePanel:** bid, ask, spread ($ and %), last, day high/low, volume.
- **AccountBar:** cash, equity, today's realized P&L, and "$X left before daily limit." A banner shows when `status.data !== 'connected'` during a live session: `"Live data disconnected, reconnecting… Prices shown may be out of date."`
- **Clock:** sim or real time in ET with phase, e.g. `"10:42:15 ET · Market open"`. In Challenge + Replay, no date is shown.
- **ReplayControls:** play/pause, speed 1/2/5/10, "+1 min" (enabled only while paused). Speed buttons are disabled in Challenge with the tooltip "Speed is locked in Challenge". There is no back button.

- [ ] **Step 1: Write failing tests:**
  - Clock in Challenge + Replay renders no date.
  - ReplayControls in Challenge has the speed buttons disabled.
  - "+1 min" is disabled while playing.
  - The disconnected banner shows when `data:'reconnecting'`.
- [ ] **Step 2:** Run. FAIL. **Step 3:** Implement. **Step 4:** Run. PASS. Then check manually with `npm run dev` that a Replay renders and the chart updates.
- [ ] **Step 5:** Commit `feat(web): trading screen market view`.

### Task 14: Order entry, positions, orders, shortcuts

**Files:** Create `trading/OrderTicket.tsx`, `Positions.tsx`, `Orders.tsx`, `useTradingShortcuts.ts`, and tests.

**Interfaces:**
- **OrderTicket:**
  - Buy/sell, a shares ↔ dollars toggle (`dollarsToShares(amount, ask) = floor(amount / ask)`, exported from `OrderTicket.tsx`), type (market/limit; stop only for sells), and limit/stop price.
  - Bracket fields "Stop-loss" and "Take-profit" for buys.
  - An optional note field (Learn: placeholder `"Why are you taking this trade?"`).
  - As fields change, it debounces `preview_order` (300 ms), then submits `submit_order`. Rejections show the `rejectReason` in plain words.
- **Positions:** qty, avg price, unrealized P&L ($ and %), and a Close button (`close_position`).
- **Orders:** working orders with Cancel and inline modify (qty/price).
- **`useTradingShortcuts`:** `B` focuses the ticket on Buy, `S` on Sell, `C` closes the selected symbol's position, and `Shift+X` cancels all. Shortcuts are ignored while focus is in an input/textarea/select.

- [ ] **Step 1: Write failing tests:**
  - `dollarsToShares(1000, 187.4) === 5`.
  - A buy bracket with stop ≥ ask shows a validation error and doesn't send.
  - The `B` key while typing in the qty input does nothing.
  - `Shift+X` sends `cancel_all`.
- [ ] **Step 2:** Run. FAIL. **Step 3:** Implement. **Step 4:** Run. PASS.
- [ ] **Step 5:** Commit `feat(web): order ticket, positions, orders, keyboard shortcuts`.

### Task 15: Learn layer

**Files:** Create `learn/glossary.ts`, `Term.tsx`, `PreTrade.tsx`, `Warnings.tsx`, `EventNotes.tsx`, `Walkthrough.tsx`, and tests. Modify the Task 13/14 components to wrap terms in `<Term>`.

**Interfaces:**
- `glossary.ts`: `GLOSSARY: Record<TermId, { term: string; definition: string; example: string }>`. It covers at least:
  - Quotes and charts: bid, ask, spread, last price, volume, candlestick, VWAP, EMA
  - Orders: market order, limit order, stop-loss, take-profit, bracket order, slippage
  - Account: position, unrealized P&L, realized P&L, equity, buying power
  - Rules and stats: risk per trade, daily loss limit, win rate, average win/loss
  - Market: day trading, pattern day trader rule (explains the $25,000 default), market hours, IEX
  - Plain English at a beginner level, one-sentence definition, and an example with numbers.
- `<Term id>`: in Learn, renders children with a dotted underline and a hover tooltip. In Challenge, renders children only, with no tooltip markup in the DOM.
- `<PreTrade>`: shows `explainOrder(…)` under the ticket in Learn only.
- `<Warnings>`: shows the latest `preview.warnings` in the ticket, as warnings that don't block.
- `<EventNotes>`: a dismissible toast for each `note`.
- Daily-limit paused dialog (Learn): explains the pause and offers "Override and keep trading (this will be recorded)" → `override_daily_limit`.
- `<Walkthrough>`: skippable, 8 steps:
  1. pick a symbol
  2. read bid/ask
  3. set qty
  4. add a stop-loss
  5. read the explanation
  6. submit
  7. watch the position
  8. close it

  It shows on the first Learn session unless `walkthroughDone`. It is never available in Challenge.

- [ ] **Step 1: Write failing tests:**
  - Every `TermId` has non-empty fields.
  - `<Term>` in Challenge renders no tooltip element.
  - `<PreTrade>` is absent in Challenge.
  - The Walkthrough doesn't render in Challenge.
  - "Skip" sets `walkthroughDone`.
- [ ] **Step 2:** Run. FAIL. **Step 3:** Implement. **Step 4:** Run. PASS.
- [ ] **Step 5:** Commit `feat(web): Learn mode glossary, explanations, warnings, walkthrough`.

### Task 16: Review and history

**Files:** Create `screens/Review.tsx`, `screens/History.tsx`, and tests. Add `GET /api/sessions?helpLevel=&dataSource=` and `GET /api/sessions/:id/trades` to `server/api/ws.ts`, with a test in `server/api/http.test.ts`.

**Interfaces:**
- Consumes: `session_ended.review`, `computeStats`, `Repo.listSessions`/`sessionTrades`.
- **Review:**
  - End reason in plain words, with the replay date revealed.
  - Stats tiles: P&L, trades, win rate, average win vs average loss, biggest loss, rules followed vs broken.
  - Challenge: target hit/missed + "Passed" only if the target was hit with 0 breaks.
  - A trade list with notes (editable → `save_note`) and each trade's breaks; clicking a trade shows its chart with entry/exit markers.
  - Learn: an observations list.
  - "New session" button.
- **History:** filters (help level, data source), a session table (date, mode, P&L, trades, end reason), and a cumulative P&L equity curve over the filtered sessions (`lightweight-charts` line). Challenge and Learn are never mixed unless the filter is "All".

- [ ] **Step 1: Write failing tests:**
  - The HTTP filter returns only challenge sessions.
  - Review in Challenge shows "Passed" only with target hit and 0 breaks.
  - Review in Learn renders observations, and Challenge does not.
- [ ] **Step 2:** Run. FAIL. **Step 3:** Implement. **Step 4:** Run. PASS.
- [ ] **Step 5:** Commit `feat: session review and history`.

### Task 17: README and acceptance run

**Files:** Create `README.md`.

- [ ] **Step 1:** Write the README covering: what this is, getting free Alpaca keys (paper account, no deposit), `.env` setup, `npm install`, `npm run dev`, open `http://localhost:5173`, and the IEX/modeled-spread caveats.
- [ ] **Step 2:** Run `npm test && npm run typecheck`. Expected: all PASS.
- [ ] **Step 3: Acceptance with real keys.** Run through each and record the result:
  - Replay + Learn on a recent day: the walkthrough places a bracketed trade, a tooltip appears on "Spread", and the explanation matches the ticket.
  - Replay + Challenge: no tooltips, warnings, or date visible; speed locked; a no-stop trade shows up as a break in the review, which reveals the date.
  - Live + Learn during market hours: quotes update, a market buy fills at the ask, and turning off Wi-Fi shows the disconnected banner and rejects a market order as stale.
  - Restart the server mid-Replay: the session comes back paused with identical positions.
  - Reach the daily limit in Learn (pause + override recorded) and in Challenge (session ends).
- [ ] **Step 4:** Commit `docs: README and setup guide`.
