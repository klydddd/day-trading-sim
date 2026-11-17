import { randomUUID } from 'node:crypto';
import { Engine, type EngineEvent, type EngineSnapshot } from '../engine/engine';
import { TradeTracker } from '../engine/trades';
import { dailyLimitState, evaluateEntry } from '../engine/rules';
import { ReplayFeed } from '../data/replay';
import { ReplayClock, type Speed } from '../data/replayClock';
import type { AlpacaRest } from '../data/alpacaRest';
import type { AlpacaStream } from '../data/alpacaStream';
import type { Repo } from '../db/repo';
import { CandleBuilder } from '../../shared/candles';
import { etDate, etTime, type TradingDay } from '../../shared/market';
import { computeStats, observations } from '../../shared/stats';
import { roundCents } from '../../shared/money';
import type { ClientMessage, Review, ServerMessage } from '../../shared/protocol';
import {
  DEFAULT_WATCHLIST, MAX_WATCHLIST, type EndReason, type Note, type Order, type OrderRequest,
  type PriceEvent, type Print, type RejectReason, type RuleBreak, type SessionConfig,
} from '../../shared/types';

export interface SessionDeps {
  repo: Repo; rest: Pick<AlpacaRest, 'getClock' | 'getCalendar' | 'getBars'>;
  liveStream?: Pick<AlpacaStream, 'start' | 'setSymbols' | 'stop' | 'onEvent' | 'onStatus'>;
  send: (m: ServerMessage) => void; now: () => number;
  setInterval: (fn: () => void, ms: number) => () => void; // returns cancel
  random?: () => number; idGen?: () => string;
}

const LOOP_MS = 250;
const PRICE_THROTTLE_MS = 250; // ≤ 4 messages/s per symbol and kind
const PERSIST_EVERY_MS = 5000;
const STALE_MS = 5000;
const DAY_MS = 86_400_000;

const NOTE_COPY = {
  iex_volume: "Live prices come from the IEX exchange (Alpaca's free data). Prices track the whole market closely, but the volume shown is only IEX's share, a small fraction of all shares traded.",
  modeled_spread: 'Replay uses real 1-minute price bars from that day. The second-by-second path inside each minute and the bid/ask spread are modeled, cautiously, so fills are never better than a real market would give.',
} as const;

interface Session {
  id: string; config: SessionConfig; replayDate: string | null; tradingDate: string;
  engine: Engine; tracker: TradeTracker;
  limit: { nearSent: boolean; paused: boolean; overridden: boolean };
  breaksByOrder: Record<string, RuleBreak[]>;
  posQty: Record<string, number>;
  orderNotes: Record<string, string>;
}
interface ReplayState { feed: ReplayFeed; clock: ReplayClock; day: TradingDay }
interface SessionSnapshot {
  engine: EngineSnapshot; tracker: unknown; limit: Session['limit'];
  breaksByOrder: Record<string, RuleBreak[]>; tradingDate: string; selected?: string; speed?: number;
}

/**
 * Owns the one active session: engine, trade tracking, rules, data feed, persistence.
 * All Learn/Challenge gating happens in `send` here, so Challenge never receives tips.
 */
export class SessionManager {
  private s?: Session;
  private replay?: ReplayState;
  private liveDay?: TradingDay;
  private builders: Record<string, CandleBuilder> = {};
  private recentPrints: Record<string, Print[]> = {};
  private selected?: string;
  private stopLoop?: () => void;
  private lastLoop = 0;
  private lastPersist = 0;
  private lastSent: Record<string, number> = {};
  private pending: Record<string, ServerMessage> = {};
  private accountDirty = false;
  private lastEndedSessionId?: string;
  private readonly idGen: () => string;
  private readonly random: () => number;

  constructor(private readonly deps: SessionDeps) {
    this.idGen = deps.idGen ?? randomUUID;
    this.random = deps.random ?? Math.random;
  }

  // ============ public API ============

  get active(): boolean { return Boolean(this.s); }

  /** Id of a running Challenge + Replay session, whose date must stay hidden. */
  activeChallengeReplayId(): string | null {
    const s = this.s;
    return s && s.config.helpLevel === 'challenge' && s.config.dataSource === 'replay' ? s.id : null;
  }

  async start(config: SessionConfig): Promise<void> {
    if (this.s) return this.error('A session is already running. End it before starting a new one.');
    const now = this.deps.now();
    const watchlist = this.watchlist();
    try {
      if (config.dataSource === 'live') {
        const clock = await this.deps.rest.getClock();
        if (!clock.isOpen) return this.error('The market is closed, so a Live session cannot start. Try a Replay instead.');
        const today = etDate(clock.now || now);
        const [day] = await this.deps.rest.getCalendar(today, today);
        if (!day) return this.error('Could not find today in the market calendar.');
        this.liveDay = day;
        this.begin(config, null, today);
        this.deps.liveStream?.start(watchlist);
        await this.loadLiveCandles(watchlist);
      } else {
        const date = await this.pickReplayDate(config, now);
        if (!date) return;
        const [day] = await this.deps.rest.getCalendar(date, date);
        if (!day || day.date !== date) return this.error(`${date} wasn't a trading day. Pick a weekday the market was open.`);
        const challenge = config.helpLevel === 'challenge';
        const startStr = challenge ? '09:30' : (config.replayStartTime ?? '09:30');
        const startTs = Math.min(Math.max(etTime(date, startStr), day.open), day.close - 60_000);
        const bars = await this.loadReplayBars(watchlist, day);
        const feed = new ReplayFeed(bars, day.close);
        this.replay = { feed, day, clock: new ReplayClock(startTs, { lockedSpeed: challenge }) };
        this.begin(config, date, date);
        for (const sym of feed.symbols()) this.seedBuilder(sym, feed.barsUpTo(sym, startTs));
        for (const ev of feed.skipTo(startTs)) this.applyPrice(ev);
      }
    } catch (e) {
      this.cleanupFailedStart();
      return this.error(`Could not start the session: ${(e as Error).message}`);
    }
    this.firstTimeNote(config);
    this.persist();
    this.startLoop();
    await this.sync();
  }

  async handle(msg: ClientMessage): Promise<void> {
    switch (msg.type) {
      case 'start_session': return this.start(msg.config);
      case 'end_session': return this.end('user');
      case 'set_watchlist': return this.setWatchlist(msg.symbols);
      case 'set_setting': this.deps.repo.setSetting(msg.key, msg.value); return;
      case 'save_note': return this.saveNote(msg.tradeId, msg.note);
      default: break;
    }
    const s = this.s;
    if (!s) return this.error('No session is running.');
    const now = this.simNow();
    switch (msg.type) {
      case 'preview_order': {
        const quote = s.engine.lastQuote(msg.req.symbol);
        if (!quote) return this.send({ type: 'preview', warnings: [] });
        const { warnings } = evaluateEntry(msg.req, this.ruleCtx(s, msg.req, quote));
        return this.send({ type: 'preview', warnings });
      }
      case 'submit_order': return this.submit(msg.req);
      case 'cancel_order': return this.process(s.engine.cancel(msg.orderId, now));
      case 'modify_order': return this.process(s.engine.modify(msg.orderId, msg.changes, now));
      case 'close_position': return this.process(s.engine.closePosition(msg.symbol, now));
      case 'cancel_all': return this.process(s.engine.cancelAll(now));
      case 'replay_control': return this.replayControl(msg.action, msg.speed);
      case 'select_symbol': return this.selectSymbol(msg.symbol);
      case 'override_daily_limit': return this.overrideDailyLimit();
    }
  }

  onPrice(ev: PriceEvent): void {
    if (!this.s) return;
    this.applyPrice(ev);
  }

  end(reason: EndReason): void {
    const s = this.s;
    if (!s) return;
    const now = this.simNow();
    this.stopLoop?.();
    this.stopLoop = undefined;
    const evs: EngineEvent[] = [...s.engine.cancelAll(now)];
    for (const sym of Object.keys(s.engine.state().positions)) evs.push(...s.engine.closePosition(sym, now));
    this.process(evs, { checkLimit: false, persist: false });
    for (const t of [...s.tracker.closed(), ...s.tracker.open()]) this.deps.repo.saveTrade(t);
    this.persist();
    this.deps.repo.endSession(s.id, reason, this.deps.now());

    const trades = s.tracker.closed();
    const stats = computeStats(trades);
    const sessionPnl = roundCents(s.engine.equity() - s.config.startingCash);
    const overrides = this.deps.repo.overrides(s.id) as Review['overrides'];
    const review: Review = {
      sessionId: s.id, config: s.config, replayDate: s.replayDate, reason, stats, trades, sessionPnl, overrides,
    };
    if (s.config.helpLevel === 'challenge' && s.config.profitTargetPct) {
      const target = (s.config.startingCash * s.config.profitTargetPct) / 100;
      const hit = sessionPnl >= target;
      review.profitTarget = { targetPct: s.config.profitTargetPct, hit, passed: hit && stats.ruleBreaks === 0 && overrides.length === 0 };
    }
    if (s.config.helpLevel === 'learn') review.observations = observations(trades);

    if (s.config.dataSource === 'live') this.deps.liveStream?.stop();
    this.send({ type: 'session', id: s.id, config: s.config, replayDate: s.replayDate, status: 'ended', paused: true });
    this.send({ type: 'session_ended', reason, review });
    this.lastEndedSessionId = s.id;
    this.s = undefined;
    this.replay = undefined;
    this.liveDay = undefined;
    this.builders = {};
    this.recentPrints = {};
    this.pending = {};
  }

  /** Stop timers without ending the session (server shutdown). */
  dispose(): void {
    if (this.s) this.persist();
    this.stopLoop?.();
    this.stopLoop = undefined;
  }

  /** Send the full current state (a browser connected or refreshed). */
  async sync(): Promise<void> {
    const s = this.s;
    if (!s) return;
    this.send(this.sessionMsg());
    this.sendAccount();
    for (const t of s.tracker.closed()) this.send({ type: 'trade_closed', trade: t });
    if (this.replay) this.sendClock();
    for (const [sym, b] of Object.entries(this.builders)) this.send({ type: 'candles', symbol: sym, candles: b.all() });
    for (const sym of Object.keys(this.builders)) {
      const q = s.engine.lastQuote(sym);
      if (q) this.send({ type: 'price', event: { kind: 'quote', quote: q } });
    }
  }

  static async restore(deps: SessionDeps): Promise<SessionManager | null> {
    const a = deps.repo.activeSession();
    if (!a) return null;
    const m = new SessionManager(deps);
    try {
      await m.resume(a);
    } catch (e) {
      deps.send({ type: 'error', message: `Could not restore the last session: ${(e as Error).message}` });
    }
    return m;
  }

  // ============ session lifecycle ============

  private begin(config: SessionConfig, replayDate: string | null, tradingDate: string) {
    const id = this.idGen();
    const engine = new Engine({ startingCash: config.startingCash, feePerShare: config.feePerShare ?? 0 });
    this.s = {
      id, config, replayDate, tradingDate, engine, tracker: new TradeTracker(id, this.idGen),
      limit: { nearSent: false, paused: false, overridden: false }, breaksByOrder: {}, posQty: {}, orderNotes: {},
    };
    this.deps.repo.createSession(id, config, replayDate, this.deps.now());
    this.deps.repo.setSetting('rules', config.rules); // rules are saved between sessions
    this.deps.repo.setSetting('feePerShare', config.feePerShare ?? 0);
    this.selected = this.watchlist()[0];
  }

  private cleanupFailedStart() {
    if (this.s) {
      this.deps.repo.endSession(this.s.id, 'user', this.deps.now());
      if (this.s.config.dataSource === 'live') this.deps.liveStream?.stop();
    }
    this.s = undefined;
    this.replay = undefined;
    this.liveDay = undefined;
    this.builders = {};
  }

  private async resume(a: NonNullable<ReturnType<Repo['activeSession']>>) {
    const snap = a.snapshot as SessionSnapshot | null;
    const config = a.config;
    const engine = snap ? Engine.restore(snap.engine, { feePerShare: config.feePerShare ?? 0 })
      : new Engine({ startingCash: config.startingCash, feePerShare: config.feePerShare ?? 0 });
    const tracker = snap ? TradeTracker.restore(snap.tracker, this.idGen) : new TradeTracker(a.id, this.idGen);
    const tradingDate = snap?.tradingDate ?? a.replayDate ?? etDate(this.deps.now());
    this.s = {
      id: a.id, config, replayDate: a.replayDate, tradingDate, engine, tracker,
      limit: snap?.limit ?? { nearSent: false, paused: false, overridden: false },
      breaksByOrder: snap?.breaksByOrder ?? {}, posQty: {}, orderNotes: {},
    };
    for (const p of Object.values(engine.state().positions)) this.s.posQty[p.symbol] = p.qty;
    this.selected = snap?.selected ?? this.watchlist()[0];

    if (config.dataSource === 'replay') {
      const date = a.replayDate as string;
      const [day] = await this.deps.rest.getCalendar(date, date);
      if (!day) throw new Error(`no calendar entry for ${date}`);
      const st = engine.state();
      const symbols = [...new Set([...this.watchlist(), ...Object.keys(st.positions), ...st.orders.map((o) => o.symbol)])];
      const feed = new ReplayFeed(await this.loadReplayBars(symbols, day), day.close);
      const simTs = a.simTs ?? day.open;
      const lockedSpeed = config.helpLevel === 'challenge';
      const clock = new ReplayClock(simTs, { lockedSpeed, speed: lockedSpeed ? 1 : ((snap?.speed as Speed) ?? 1) });
      this.replay = { feed, clock, day };
      for (const sym of feed.symbols()) this.seedBuilder(sym, feed.barsUpTo(sym, simTs));
      // The engine already saw prices up to simTs (they are in its snapshot); only refresh charts/prices.
      for (const ev of feed.skipTo(simTs)) this.observePrice(ev);
      this.startLoop();
      await this.sync();
      return;
    }

    const clock = await this.deps.rest.getClock();
    const now = this.deps.now();
    if (clock.isOpen && etDate(now) === tradingDate) {
      const [day] = await this.deps.rest.getCalendar(tradingDate, tradingDate);
      this.liveDay = day;
      this.deps.liveStream?.start(this.watchlist());
      await this.loadLiveCandles(this.watchlist());
      this.startLoop();
      await this.sync();
    } else {
      await this.sync();
      this.end('market_close');
    }
  }

  // ============ orders ============

  private async submit(req: OrderRequest) {
    const s = this.s!;
    const now = this.simNow();
    const sym = req.symbol.toUpperCase();
    const quote = s.engine.lastQuote(sym);

    if (req.side === 'buy' && s.limit.paused) return this.rejectOutside(req, 'daily_limit');
    if (s.config.dataSource === 'live' && req.type === 'market' && quote && this.deps.now() - quote.ts > STALE_MS) {
      return this.rejectOutside(req, 'stale_data');
    }

    let breaks: RuleBreak[] = [];
    if (req.side === 'buy') {
      const ref = quote ?? { symbol: sym, bid: req.limitPrice ?? 0, ask: req.limitPrice ?? 0, ts: now };
      const r = evaluateEntry({ ...req, symbol: sym }, this.ruleCtx(s, req, ref));
      for (const w of r.warnings) this.send({ type: 'warning', warning: w });
      breaks = r.breaks;
    }
    const events = s.engine.submit({ ...req, symbol: sym }, now);
    const order = (events[0] as Extract<EngineEvent, { kind: 'order_update' }>).order;
    if (order.status !== 'rejected' && breaks.length) s.breaksByOrder[order.id] = breaks;
    this.process(events);
  }

  private rejectOutside(req: OrderRequest, reason: RejectReason) {
    const order: Order = { ...req, symbol: req.symbol.toUpperCase(), id: `x-${this.idGen()}`, status: 'rejected', rejectReason: reason, createdAt: this.simNow() };
    this.send({ type: 'order_update', order });
  }

  /** Apply engine events: forward them, track trades, then account, daily limit and persistence. */
  private process(events: EngineEvent[], opts: { checkLimit?: boolean; persist?: boolean } = {}) {
    const s = this.s;
    if (!s || !events.length) return;
    let changed = false;
    const orders = new Map<string, Order>();
    for (const ev of events) {
      if (ev.kind === 'order_update') {
        orders.set(ev.order.id, ev.order);
        this.send({ type: 'order_update', order: ev.order });
        const o = ev.order;
        if (o.status === 'working' && o.side === 'sell') {
          if (o.type === 'stop' && o.stopPrice) s.tracker.noteStop(o.symbol, o.stopPrice);
          if (o.type === 'limit' && o.limitPrice) s.tracker.noteTarget(o.symbol, o.limitPrice);
        }
        if (o.status === 'cancelled' || o.status === 'rejected') delete s.breaksByOrder[o.id];
        changed = true;
      } else if (ev.kind === 'fill') {
        const f = ev.fill;
        const order = orders.get(f.orderId) ?? s.engine.state().orders.find((o) => o.id === f.orderId)!;
        const after = (s.posQty[f.symbol] ?? 0) + (f.side === 'buy' ? f.qty : -f.qty);
        s.posQty[f.symbol] = after;
        if (after === 0) delete s.posQty[f.symbol];
        const { closed } = s.tracker.onFill(f, order, after);
        const br = s.breaksByOrder[f.orderId];
        if (br) { s.tracker.attachBreaks(f.symbol, br); delete s.breaksByOrder[f.orderId]; }
        this.send({ type: 'fill', fill: f });
        if (closed) {
          this.deps.repo.saveTrade(closed);
          this.send({ type: 'trade_closed', trade: closed });
        }
        changed = true;
      } else {
        this.send({ type: 'note', note: ev.note });
      }
    }
    if (!changed) return;
    // Bracket children activated in this batch: record their stop/target on the (now open) trade.
    for (const o of orders.values()) {
      if (o.status === 'working' && o.side === 'sell' && o.parentId) {
        if (o.type === 'stop' && o.stopPrice) s.tracker.noteStop(o.symbol, o.stopPrice);
        if (o.type === 'limit' && o.limitPrice) s.tracker.noteTarget(o.symbol, o.limitPrice);
      }
    }
    this.sendAccount();
    if (opts.persist !== false) this.persist();
    if (opts.checkLimit !== false) this.checkDailyLimit();
  }

  private ruleCtx(s: Session, req: OrderRequest, quote: NonNullable<ReturnType<Engine['lastQuote']>>) {
    return {
      quote, rules: s.config.rules, startingCash: s.config.startingCash, sessionPnl: this.sessionPnl(),
      recentPrints: this.recentPrints[req.symbol.toUpperCase()] ?? [], now: this.simNow(),
    };
  }

  private checkDailyLimit() {
    const s = this.s;
    if (!s) return;
    const state = dailyLimitState(this.sessionPnl(), s.config.rules, s.config.startingCash);
    if (state === 'ok') return;
    if (s.config.helpLevel === 'challenge') {
      if (state === 'hit') this.end('daily_limit');
      return;
    }
    if (state === 'near' && !s.limit.nearSent) {
      s.limit.nearSent = true;
      this.send({ type: 'daily_limit', state: 'near' });
    }
    if (state === 'hit' && !s.limit.paused && !s.limit.overridden) {
      s.limit.nearSent = true;
      s.limit.paused = true;
      this.send({ type: 'daily_limit', state: 'paused' });
      this.persist();
    }
  }

  private overrideDailyLimit() {
    const s = this.s!;
    if (s.config.helpLevel !== 'learn' || !s.limit.paused) return;
    s.limit.paused = false;
    s.limit.overridden = true;
    this.deps.repo.addOverride(s.id, {
      rule: 'daily_limit_override', ts: this.simNow(),
      detail: `Kept trading after reaching the daily loss limit (session P&L ${this.sessionPnl().toFixed(2)}).`,
    });
    this.persist();
    this.sendAccount();
  }

  private async saveNote(tradeId: string, note: string) {
    const fromTracker = this.s?.tracker.setNote(tradeId, note);
    if (fromTracker) {
      if (fromTracker.closedAt !== undefined) this.deps.repo.saveTrade(fromTracker);
      this.persist();
      return;
    }
    const sid = this.lastEndedSessionId;
    const trades = sid ? this.deps.repo.sessionTrades(sid) : [];
    const t = trades.find((x) => x.id === tradeId) ?? this.deps.repo.getTrade(tradeId);
    if (t) this.deps.repo.saveTrade({ ...t, note });
  }

  // ============ prices, charts, replay ============

  /** Feed a price to the engine, charts and browser. */
  private applyPrice(ev: PriceEvent) {
    const s = this.s;
    if (!s) return;
    this.observePrice(ev);
    const events = s.engine.onPrice(ev);
    if (events.length) this.process(events);
    else this.accountDirty = true;
    if (this.s && Object.keys(s.posQty).length) this.checkDailyLimit();
  }

  /** Charts, recent prints and throttled price messages (no engine). */
  private observePrice(ev: PriceEvent) {
    if (ev.kind === 'print') {
      const p = ev.print;
      const arr = (this.recentPrints[p.symbol] ??= []);
      arr.push(p);
      const cutoff = p.ts - 120_000;
      while (arr.length && arr[0].ts < cutoff) arr.shift();
      const b = (this.builders[p.symbol] ??= new CandleBuilder(p.symbol));
      const r = b.onPrint(p);
      if (r.closed) this.send({ type: 'candle', symbol: p.symbol, candle: r.closed });
      this.throttled(`${p.symbol}:candle`, { type: 'candle', symbol: p.symbol, candle: r.current });
      this.throttled(`${p.symbol}:print`, { type: 'price', event: ev });
    } else {
      this.throttled(`${ev.quote.symbol}:quote`, { type: 'price', event: ev });
    }
  }

  private throttled(key: string, m: ServerMessage) {
    const now = this.deps.now();
    if (now - (this.lastSent[key] ?? -Infinity) >= PRICE_THROTTLE_MS) {
      this.lastSent[key] = now;
      delete this.pending[key];
      this.send(m);
    } else {
      this.pending[key] = m;
    }
  }

  private flush() {
    const now = this.deps.now();
    for (const [key, m] of Object.entries(this.pending)) {
      if (now - (this.lastSent[key] ?? -Infinity) >= PRICE_THROTTLE_MS) {
        this.lastSent[key] = now;
        delete this.pending[key];
        this.send(m);
      }
    }
    if (this.accountDirty && this.s) this.sendAccount();
  }

  private startLoop() {
    this.stopLoop?.();
    this.lastLoop = this.deps.now();
    this.stopLoop = this.deps.setInterval(() => this.loop(), LOOP_MS);
  }

  private loop() {
    if (!this.s) return;
    const now = this.deps.now();
    const elapsed = now - this.lastLoop;
    this.lastLoop = now;
    if (this.replay) {
      if (this.replay.clock.playing) {
        this.replay.clock.tick(elapsed);
        this.advanceReplay();
        if (!this.s) return;
        if (now - this.lastPersist >= PERSIST_EVERY_MS) this.persist();
      }
    } else if (this.liveDay && now >= this.liveDay.close) {
      this.end('market_close');
      return;
    } else if (now - this.lastPersist >= PERSIST_EVERY_MS) {
      this.persist();
    }
    this.flush();
  }

  private advanceReplay() {
    const r = this.replay;
    if (!r) return;
    const target = Math.min(r.clock.simTs, r.day.close);
    for (const ev of r.feed.advanceTo(target)) {
      this.applyPrice(ev);
      if (!this.s) return;
    }
    this.sendClock();
    if (r.feed.isFinished(r.clock.simTs)) this.end('market_close');
  }

  private async replayControl(action: 'play' | 'pause' | 'step' | 'speed', speed?: Speed) {
    const r = this.replay;
    if (!r) return this.error('Replay controls only work in a Replay session.');
    if (action === 'play') r.clock.play();
    if (action === 'pause') { r.clock.pause(); this.persist(); }
    if (action === 'speed' && speed) r.clock.setSpeed(speed);
    if (action === 'step') {
      r.clock.stepMinute();
      this.advanceReplay();
      if (!this.s) return;
      this.persist();
      this.flush();
    }
    this.lastLoop = this.deps.now();
    this.sendClock();
    this.send(this.sessionMsg());
  }

  private async selectSymbol(symbol: string) {
    const sym = symbol.toUpperCase();
    this.selected = sym;
    if (this.replay) {
      const { feed, clock, day } = this.replay;
      if (!feed.symbols().includes(sym)) {
        const bars = await this.deps.rest.getBars(sym, day.open, day.close, 'sip');
        this.seedBuilder(sym, bars.filter((b) => b.t + 60_000 <= clock.simTs));
        for (const ev of feed.addSymbol(sym, bars, clock.simTs)) this.applyPrice(ev);
      }
      const simTs = this.replay?.clock.simTs ?? 0;
      const candles = (this.builders[sym]?.all() ?? feed.barsUpTo(sym, simTs)).filter((c) => c.t <= simTs);
      this.send({ type: 'candles', symbol: sym, candles });
    } else {
      await this.loadLiveCandles([sym]);
      this.send({ type: 'candles', symbol: sym, candles: this.builders[sym]?.all() ?? [] });
    }
  }

  private async setWatchlist(symbols: string[]) {
    const list = [...new Set(symbols.map((x) => x.toUpperCase()))];
    if (list.length > MAX_WATCHLIST) return this.error(`The free data plan allows at most ${MAX_WATCHLIST} symbols in the watchlist.`);
    this.deps.repo.setSetting('watchlist', list);
    if (!this.s) return;
    if (this.s.config.dataSource === 'live') {
      this.deps.liveStream?.setSymbols(list);
      const fresh = list.filter((x) => !this.builders[x]);
      await this.loadLiveCandles(fresh);
      for (const x of fresh) this.send({ type: 'candles', symbol: x, candles: this.builders[x]?.all() ?? [] });
    } else if (this.replay) {
      const { feed, clock, day } = this.replay;
      for (const sym of list.filter((x) => !feed.symbols().includes(x))) {
        const bars = await this.deps.rest.getBars(sym, day.open, day.close, 'sip');
        if (!this.replay) return;
        this.seedBuilder(sym, bars.filter((b) => b.t + 60_000 <= clock.simTs));
        for (const ev of feed.addSymbol(sym, bars, clock.simTs)) this.applyPrice(ev);
        this.send({ type: 'candles', symbol: sym, candles: this.builders[sym]?.all() ?? [] });
      }
    }
  }

  private async loadReplayBars(symbols: string[], day: TradingDay) {
    const out: Record<string, Awaited<ReturnType<SessionDeps['rest']['getBars']>>> = {};
    for (const sym of symbols) out[sym] = await this.deps.rest.getBars(sym, day.open, day.close, 'sip');
    return out;
  }

  private async loadLiveCandles(symbols: string[]) {
    const day = this.liveDay;
    if (!day) return;
    const now = this.deps.now();
    for (const sym of symbols) {
      try {
        const bars = await this.deps.rest.getBars(sym, day.open, Math.min(now, day.close), 'iex');
        this.seedBuilder(sym, bars);
      } catch (e) {
        this.error(`Could not load today's chart for ${sym}: ${(e as Error).message}`);
      }
    }
  }

  private seedBuilder(sym: string, bars: Parameters<CandleBuilder['seed']>[0]) {
    const b = (this.builders[sym] ??= new CandleBuilder(sym));
    b.seed(bars);
  }

  private async pickReplayDate(config: SessionConfig, now: number): Promise<string | null> {
    const today = etDate(now);
    if (config.helpLevel === 'challenge') {
      const days = await this.deps.rest.getCalendar(etDate(now - 730 * DAY_MS), etDate(now - 7 * DAY_MS));
      if (!days.length) { this.error('Could not load the market calendar.'); return null; }
      return days[Math.min(days.length - 1, Math.floor(this.random() * days.length))].date;
    }
    if (config.replayDate) {
      if (config.replayDate >= today) { this.error('Pick a past trading day to replay.'); return null; }
      return config.replayDate;
    }
    const days = await this.deps.rest.getCalendar(etDate(now - 14 * DAY_MS), etDate(now - DAY_MS));
    const last = days.filter((d) => d.date < today).at(-1);
    if (!last) { this.error('Could not find a recent trading day.'); return null; }
    return last.date;
  }

  // ============ helpers ============

  private simNow(): number {
    return this.replay ? this.replay.clock.simTs : this.deps.now();
  }

  private sessionPnl(): number {
    const s = this.s;
    return s ? roundCents(s.engine.equity() - s.config.startingCash) : 0;
  }

  private watchlist(): string[] {
    return this.deps.repo.getSetting<string[]>('watchlist', DEFAULT_WATCHLIST);
  }

  private firstTimeNote(config: SessionConfig) {
    if (config.helpLevel !== 'learn') return;
    const code: Note['code'] = config.dataSource === 'live' ? 'iex_volume' : 'modeled_spread';
    const seen = this.deps.repo.getSetting<string[]>('seenNotes', []);
    if (seen.includes(code)) return;
    this.deps.repo.setSetting('seenNotes', [...seen, code]);
    this.send({ type: 'note', note: { code, message: NOTE_COPY[code], ts: this.simNow() } });
  }

  private sessionMsg(): ServerMessage {
    const s = this.s!;
    const hide = s.config.helpLevel === 'challenge' && s.config.dataSource === 'replay';
    const config = hide ? { ...s.config, replayDate: undefined, replayStartTime: undefined } : s.config;
    return { type: 'session', id: s.id, config, replayDate: hide ? null : s.replayDate, status: 'active', paused: this.replay ? !this.replay.clock.playing : false };
  }

  private sendAccount() {
    const s = this.s;
    if (!s) return;
    this.accountDirty = false;
    this.send({ type: 'account', state: s.engine.state(), equity: s.engine.equity(), sessionPnl: this.sessionPnl(), buyingPower: s.engine.buyingPower() });
  }

  private sendClock() {
    const r = this.replay;
    if (r) this.send({ type: 'clock', simTs: Math.min(r.clock.simTs, r.day.close), speed: r.clock.speed, playing: r.clock.playing });
  }

  private persist() {
    const s = this.s;
    if (!s) return;
    const snap: SessionSnapshot = {
      engine: s.engine.snapshot(), tracker: s.tracker.snapshot(), limit: s.limit, breaksByOrder: s.breaksByOrder,
      tradingDate: s.tradingDate, selected: this.selected, speed: this.replay?.clock.speed,
    };
    this.deps.repo.saveSnapshot(s.id, snap, this.replay ? this.replay.clock.simTs : null);
    this.lastPersist = this.deps.now();
  }

  private error(message: string) {
    this.send({ type: 'error', message });
  }

  /** The single gate between the session and the browser. Challenge gets no tips, warnings or notes. */
  private send(m: ServerMessage) {
    const challenge = this.s?.config.helpLevel === 'challenge';
    if (challenge) {
      if (m.type === 'warning' || m.type === 'note') return;
      if (m.type === 'daily_limit' && m.state === 'near') return;
      if (m.type === 'preview') return this.deps.send({ type: 'preview', warnings: [] });
    }
    this.deps.send(m);
  }
}
