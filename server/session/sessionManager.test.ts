import { DateTime } from 'luxon';
import { SessionManager, type SessionDeps } from './sessionManager';
import { openDb } from '../db/db';
import { Repo } from '../db/repo';
import { etTime, type TradingDay } from '../../shared/market';
import { DEFAULT_RULES, type Bar, type PriceEvent, type SessionConfig } from '../../shared/types';
import type { ServerMessage } from '../../shared/protocol';

// ---------- fixtures ----------

const NOW = Date.UTC(2026, 10, 18, 15); // Wed 2026-11-18 10:00 ET
const CAL: TradingDay[] = (() => {
  const out: TradingDay[] = [];
  let d = DateTime.fromISO('2024-10-01', { zone: 'America/New_York' });
  while (d.toISODate()! <= '2026-11-18') {
    if (d.weekday <= 5) {
      const date = d.toISODate()!;
      out.push({ date, open: etTime(date, '09:30'), close: etTime(date, '16:00') });
    }
    d = d.plus({ days: 1 });
  }
  return out;
})();

/** Flat $50 bars every minute, with optional per-minute-index overrides (minute 0 = 9:30). */
function genBars(start: number, end: number, over: Record<number, Partial<Bar>> = {}, base = 50): Bar[] {
  const bars: Bar[] = [];
  const dayOpen = etTime(DateTime.fromMillis(start, { zone: 'America/New_York' }).toISODate()!, '09:30');
  let last = base;
  for (let t = start; t < end; t += 60000) {
    const i = Math.round((t - dayOpen) / 60000);
    const o = over[i];
    const b: Bar = o ? { t, o: last, h: last, l: last, c: last, v: 600, ...o } : { t, o: last, h: last, l: last, c: last, v: 600 };
    last = b.c;
    bars.push(b);
  }
  return bars;
}

const DROP: Record<number, Partial<Bar>> = {
  5: { o: 50, h: 50, l: 44, c: 44 },
  6: { o: 44, h: 44, l: 44, c: 44 },
  7: { o: 44, h: 44, l: 42, c: 42 },
  8: { o: 42, h: 42, l: 42, c: 42 },
};

interface HarnessOpts { isOpen?: boolean; bars?: Record<number, Partial<Bar>>; repo?: Repo }
function harness(opts: HarnessOpts = {}) {
  const sent: ServerMessage[] = [];
  let now = NOW;
  let isOpen = opts.isOpen ?? false;
  const intervals = new Set<() => void>();
  const repo = opts.repo ?? new Repo(openDb(':memory:'));
  const barCalls: { symbol: string; feed: string; start: number; end: number }[] = [];
  const stream = {
    started: [] as string[][], symbols: [] as string[][], stopped: 0,
    start(s: string[]) { this.started.push(s); }, setSymbols(s: string[]) { this.symbols.push(s); }, stop() { this.stopped++; },
    onEvent() {}, onStatus() {},
  };
  let ids = 0;
  const deps: SessionDeps = {
    repo,
    rest: {
      getClock: async () => ({ isOpen, now, nextOpen: Date.UTC(2026, 10, 19, 14, 30), nextClose: Date.UTC(2026, 10, 18, 21) }),
      getCalendar: async (start: string, end: string) => CAL.filter((d) => d.date >= start && d.date <= end),
      getBars: async (symbol: string, start: number, end: number, feed: 'iex' | 'sip') => {
        barCalls.push({ symbol, feed, start, end });
        return genBars(start, end, opts.bars ?? {});
      },
    },
    liveStream: stream,
    send: (m) => sent.push(m),
    now: () => now,
    setInterval: (fn) => { intervals.add(fn); return () => intervals.delete(fn); },
    random: () => 0.5,
    idGen: () => `id${++ids}`,
  };
  const h = {
    sent, deps, repo, stream, barCalls,
    of: <T extends ServerMessage['type']>(type: T) => sent.filter((m) => m.type === type) as Extract<ServerMessage, { type: T }>[],
    last: <T extends ServerMessage['type']>(type: T) => h.of(type).at(-1) as Extract<ServerMessage, { type: T }> | undefined,
    tick: (ms = 250) => { now += ms; for (const f of [...intervals]) f(); },
    setNow: (t: number) => { now = t; },
    setOpen: (v: boolean) => { isOpen = v; },
    get now() { return now; },
    intervalCount: () => intervals.size,
  };
  return h;
}

const learnReplay = (over: Partial<SessionConfig> = {}): SessionConfig => ({
  dataSource: 'replay', helpLevel: 'learn', startingCash: 25000,
  rules: { ...DEFAULT_RULES, requireStop: true }, replayDate: '2026-11-13', replayStartTime: '09:30', ...over,
});
const challengeReplay = (over: Partial<SessionConfig> = {}): SessionConfig => ({
  dataSource: 'replay', helpLevel: 'challenge', startingCash: 25000, rules: DEFAULT_RULES, ...over,
});
const live = (over: Partial<SessionConfig> = {}): SessionConfig => ({
  dataSource: 'live', helpLevel: 'learn', startingCash: 25000, rules: DEFAULT_RULES, ...over,
});
const buy = (qty: number, extra: object = {}) => ({ type: 'submit_order' as const, req: { symbol: 'SPY', side: 'buy' as const, qty, type: 'market' as const, ...extra } });
const step = async (m: SessionManager, n = 1) => { for (let i = 0; i < n; i++) await m.handle({ type: 'replay_control', action: 'step' }); };
const quote = (bid: number, ask: number, ts: number, symbol = 'SPY'): PriceEvent => ({ kind: 'quote', quote: { symbol, bid, ask, ts } });

// ---------- tests ----------

describe('SessionManager: help gating', () => {
  it('Challenge: a no-stop order sends zero warnings, and the trade still records a no_stop break', async () => {
    const h = harness();
    const m = new SessionManager(h.deps);
    await m.start(challengeReplay());
    await step(m);
    await m.handle({ type: 'preview_order', req: buy(10).req });
    expect(h.last('preview')!.warnings).toEqual([]);
    await m.handle(buy(10));
    expect(h.of('fill')).toHaveLength(1);
    expect(h.of('warning')).toHaveLength(0);
    expect(h.of('note')).toHaveLength(0);
    await m.handle({ type: 'end_session' });
    const review = h.last('session_ended')!.review;
    expect(review.trades[0].ruleBreaks.map((b) => b.rule)).toEqual(['no_stop']);
    expect(review.observations).toBeUndefined();
  });

  it('Learn: a no-stop order sends a no_stop warning', async () => {
    const h = harness();
    const m = new SessionManager(h.deps);
    await m.start(learnReplay());
    await step(m);
    await m.handle(buy(10));
    expect(h.of('warning').map((w) => w.warning.code)).toContain('no_stop');
    await m.handle({ type: 'end_session' });
    expect(h.last('session_ended')!.review.observations).toBeDefined();
  });
});

describe('SessionManager: start', () => {
  it('refuses Live when the market is closed', async () => {
    const h = harness({ isOpen: false });
    const m = new SessionManager(h.deps);
    await m.start(live());
    expect(h.of('error')).toHaveLength(1);
    expect(h.of('session')).toHaveLength(0);
    expect(h.repo.activeSession()).toBeNull();
  });

  it('refuses a replay date that is not a trading day', async () => {
    const h = harness();
    const m = new SessionManager(h.deps);
    await m.start(learnReplay({ replayDate: '2026-11-14' })); // Saturday
    expect(h.of('error')[0].message).toMatch(/trading day/i);
    expect(h.of('session')).toHaveLength(0);
  });

  it('Challenge + Replay picks a random past day 7-730 days ago, hides it, locks speed, and reveals it at the end', async () => {
    const h = harness();
    const m = new SessionManager(h.deps);
    await m.start(challengeReplay({ replayDate: '2026-11-13' }));
    const s = h.last('session')!;
    expect(s.replayDate).toBeNull();
    const real = h.repo.activeSession()!.replayDate!;
    expect(real).not.toBe('2026-11-13');
    const age = (NOW - etTime(real, '12:00')) / 86_400_000;
    expect(age).toBeGreaterThanOrEqual(7);
    expect(age).toBeLessThanOrEqual(731);
    await m.handle({ type: 'replay_control', action: 'speed', speed: 10 });
    expect(h.last('clock')!.speed).toBe(1);
    for (const msg of h.sent) expect(JSON.stringify(msg)).not.toContain(real);
    await m.handle({ type: 'end_session' });
    expect(h.last('session_ended')!.review.replayDate).toBe(real);
  });

  it('emits the modeled_spread note on the first Replay session only', async () => {
    const h = harness();
    const m = new SessionManager(h.deps);
    await m.start(learnReplay());
    expect(h.of('note').map((n) => n.note.code)).toEqual(['modeled_spread']);
    await m.handle({ type: 'end_session' });
    await m.start(learnReplay());
    expect(h.of('note').map((n) => n.note.code)).toEqual(['modeled_spread']);
  });

  it('emits the iex_volume note on the first Live session and starts the stream', async () => {
    const h = harness({ isOpen: true });
    const m = new SessionManager(h.deps);
    await m.start(live());
    expect(h.of('note').map((n) => n.note.code)).toEqual(['iex_volume']);
    expect(h.stream.started[0]).toEqual(['SPY', 'QQQ', 'AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMD']);
  });
});

describe('SessionManager: orders', () => {
  it('rejects a live market order on a quote older than 5 s with stale_data (Review Focus #1)', async () => {
    const h = harness({ isOpen: true });
    const m = new SessionManager(h.deps);
    await m.start(live());
    m.onPrice(quote(49.99, 50, h.now - 6000));
    await m.handle(buy(10, { bracket: { stopLoss: 49 } }));
    expect(h.last('order_update')!.order).toMatchObject({ status: 'rejected', rejectReason: 'stale_data' });
    expect(h.of('fill')).toHaveLength(0);
    m.onPrice(quote(49.99, 50, h.now - 100));
    await m.handle(buy(10, { bracket: { stopLoss: 49 } }));
    expect(h.last('fill')!.fill.price).toBe(50);
  });

  it('a closed trade is saved and sent as trade_closed, with account updates', async () => {
    const h = harness();
    const m = new SessionManager(h.deps);
    await m.start(learnReplay());
    await step(m);
    await m.handle(buy(10, { bracket: { stopLoss: 49 } }));
    expect(h.last('account')!.state.positions.SPY.qty).toBe(10);
    await m.handle({ type: 'close_position', symbol: 'SPY' });
    const closed = h.last('trade_closed')!.trade;
    expect(closed).toMatchObject({ symbol: 'SPY', maxQty: 10, stopUsed: 49 });
    expect(h.repo.sessionTrades(h.repo.activeSession()!.id)).toHaveLength(1);
  });

  it('save_note updates a trade', async () => {
    const h = harness();
    const m = new SessionManager(h.deps);
    await m.start(learnReplay());
    await step(m);
    await m.handle(buy(10, { bracket: { stopLoss: 49 } }));
    await m.handle({ type: 'close_position', symbol: 'SPY' });
    const t = h.last('trade_closed')!.trade;
    await m.handle({ type: 'save_note', tradeId: t.id, note: 'test note' });
    expect(h.repo.sessionTrades(t.sessionId)[0].note).toBe('test note');
  });
});

describe('SessionManager: daily loss limit', () => {
  it('Learn: warns once when near, pauses buys at the limit, and records an override', async () => {
    const h = harness({ bars: DROP });
    const m = new SessionManager(h.deps);
    await m.start(learnReplay({ rules: { ...DEFAULT_RULES, requireStop: false } }));
    await step(m);
    await m.handle(buy(100));
    await step(m, 6); // 9:37 -> price 44: down ~$601
    expect(h.of('daily_limit').map((d) => d.state)).toEqual(['near']);
    await step(m, 2); // price 42: down ~$801
    expect(h.of('daily_limit').map((d) => d.state)).toEqual(['near', 'paused']);
    await m.handle(buy(1));
    expect(h.last('order_update')!.order).toMatchObject({ status: 'rejected', rejectReason: 'daily_limit' });
    await m.handle({ type: 'override_daily_limit' });
    expect(h.repo.overrides(h.repo.activeSession()!.id).map((o) => o.rule)).toEqual(['daily_limit_override']);
    await m.handle(buy(1));
    expect(h.last('order_update')!.order.status).toBe('filled');
    await m.handle({ type: 'end_session' });
    expect(h.last('session_ended')!.review.overrides).toHaveLength(1);
  });

  it('Challenge: hitting the limit ends the session, with no near warning', async () => {
    const h = harness({ bars: DROP });
    const m = new SessionManager(h.deps);
    await m.start(challengeReplay());
    await step(m);
    await m.handle(buy(100));
    await step(m, 8);
    expect(h.of('daily_limit')).toHaveLength(0);
    expect(h.last('session_ended')!.reason).toBe('daily_limit');
    expect(h.repo.activeSession()).toBeNull();
  });
});

describe('SessionManager: end and market close', () => {
  it('market close cancels working orders and sells positions at the bid (Review Focus #3)', async () => {
    const h = harness();
    const m = new SessionManager(h.deps);
    await m.start(learnReplay({ replayStartTime: '15:58' }));
    await step(m);
    await m.handle(buy(10, { bracket: { stopLoss: 49 } }));
    await m.handle({ type: 'submit_order', req: { symbol: 'SPY', side: 'buy', qty: 1, type: 'limit', limitPrice: 40 } });
    await step(m, 2);
    const ended = h.last('session_ended')!;
    expect(ended.reason).toBe('market_close');
    const closeFill = h.of('fill').at(-1)!.fill;
    expect(closeFill).toMatchObject({ side: 'sell', qty: 10, price: 49.99 });
    const finalOrders = h.last('account')!.state.orders;
    expect(finalOrders.filter((o) => o.status === 'working' || o.status === 'pending_parent')).toHaveLength(0);
    expect(h.repo.activeSession()).toBeNull();
    expect(h.intervalCount()).toBe(0);
  });

  it('half-day replay ends at the 13:00 ET early close', async () => {
    const h = harness();
    const halfDay = '2026-11-13';
    const cal = h.deps.rest.getCalendar;
    h.deps.rest.getCalendar = async (s, e) => (await cal(s, e)).map((d) => (d.date === halfDay ? { ...d, close: etTime(halfDay, '13:00') } : d));
    const m = new SessionManager(h.deps);
    await m.start(learnReplay({ replayStartTime: '12:59' }));
    await step(m);
    expect(h.last('session_ended')!.reason).toBe('market_close');
  });

  it('live checks the calendar close on the interval', async () => {
    const h = harness({ isOpen: true });
    const m = new SessionManager(h.deps);
    await m.start(live());
    h.setNow(Date.UTC(2026, 10, 18, 21));
    h.tick(0);
    expect(h.last('session_ended')!.reason).toBe('market_close');
  });
});

describe('SessionManager: replay loop and charts', () => {
  it('playing advances sim time by elapsed × speed and sends clock', async () => {
    const h = harness();
    const m = new SessionManager(h.deps);
    await m.start(learnReplay());
    const t0 = h.last('clock')!.simTs;
    await m.handle({ type: 'replay_control', action: 'speed', speed: 10 });
    await m.handle({ type: 'replay_control', action: 'play' });
    h.tick(1000);
    expect(h.last('clock')!).toMatchObject({ simTs: t0 + 10_000, playing: true, speed: 10 });
    expect(h.of('price').length).toBeGreaterThan(0);
  });

  it('select_symbol mid-replay returns only candles at or before sim time (Review Focus #5)', async () => {
    const h = harness();
    const m = new SessionManager(h.deps);
    await m.start(learnReplay());
    await step(m, 3);
    const simTs = h.last('clock')!.simTs;
    await m.handle({ type: 'select_symbol', symbol: 'AAPL' });
    const c = h.last('candles')!;
    expect(c.symbol).toBe('AAPL');
    expect(c.candles.length).toBeGreaterThan(0);
    expect(Math.max(...c.candles.map((k) => k.t))).toBeLessThanOrEqual(simTs);
    expect(c.candles.every((k) => k.t + 60000 <= simTs || k.t === Math.floor(simTs / 60000) * 60000)).toBe(true);
  });

  it('throttles price messages to at most 4 per second per symbol and kind, flushing the latest', async () => {
    const h = harness({ isOpen: true });
    const m = new SessionManager(h.deps);
    await m.start(live());
    const before = h.of('price').length;
    for (let i = 0; i < 10; i++) m.onPrice(quote(50 + i / 100, 50.02 + i / 100, h.now));
    expect(h.of('price').length - before).toBe(1);
    h.tick(250);
    const prices = h.of('price').slice(before);
    expect(prices).toHaveLength(2);
    expect((prices[1].event as Extract<PriceEvent, { kind: 'quote' }>).quote.bid).toBe(50.09);
  });

  it('live select_symbol loads today\'s IEX bars', async () => {
    const h = harness({ isOpen: true });
    const m = new SessionManager(h.deps);
    await m.start(live());
    await m.handle({ type: 'select_symbol', symbol: 'AAPL' });
    expect(h.barCalls.at(-1)).toMatchObject({ symbol: 'AAPL', feed: 'iex' });
    expect(h.last('candles')!.candles.length).toBeGreaterThan(0);
  });
});

describe('SessionManager: watchlist', () => {
  it('rejects more than 30 symbols, otherwise persists and updates the stream', async () => {
    const h = harness({ isOpen: true });
    const m = new SessionManager(h.deps);
    await m.start(live());
    await m.handle({ type: 'set_watchlist', symbols: Array.from({ length: 31 }, (_, i) => `S${i}`) });
    expect(h.of('error')).toHaveLength(1);
    await m.handle({ type: 'set_watchlist', symbols: ['SPY', 'IWM'] });
    expect(h.repo.getSetting('watchlist', [])).toEqual(['SPY', 'IWM']);
    expect(h.stream.symbols.at(-1)).toEqual(['SPY', 'IWM']);
  });
});

describe('SessionManager: restore (Review Focus #2)', () => {
  it('restores cash, positions, working orders and trades, with replay paused at the same sim time', async () => {
    const h = harness();
    const m = new SessionManager(h.deps);
    await m.start(learnReplay());
    await step(m);
    await m.handle(buy(10, { bracket: { stopLoss: 49 } }));
    await m.handle({ type: 'close_position', symbol: 'SPY' });
    await m.handle(buy(5, { bracket: { stopLoss: 49 } }));
    await m.handle({ type: 'submit_order', req: { symbol: 'SPY', side: 'buy', qty: 1, type: 'limit', limitPrice: 40 } });
    await m.handle({ type: 'replay_control', action: 'play' });
    h.tick(1000);
    await m.handle({ type: 'replay_control', action: 'pause' });
    const acct = h.last('account')!;
    const simTs = h.last('clock')!.simTs;
    m.dispose();

    const h2 = harness({ repo: h.repo });
    h2.setNow(h.now + 60_000);
    const r = await SessionManager.restore(h2.deps);
    expect(r).not.toBeNull();
    const acct2 = h2.last('account')!;
    expect(acct2.state).toEqual(acct.state);
    expect(h2.last('session')!).toMatchObject({ status: 'active', paused: true });
    expect(h2.last('clock')!).toMatchObject({ simTs, playing: false });
    expect(h2.of('trade_closed')).toHaveLength(1);
  });

  it('a live session restored after the market closed ends with market_close at the last bid', async () => {
    const h = harness({ isOpen: true });
    const m = new SessionManager(h.deps);
    await m.start(live());
    m.onPrice(quote(49.99, 50, h.now));
    await m.handle(buy(10, { bracket: { stopLoss: 49 } }));
    m.dispose();

    const h2 = harness({ repo: h.repo, isOpen: false });
    h2.setNow(Date.UTC(2026, 10, 19, 1));
    const r = await SessionManager.restore(h2.deps);
    expect(r).not.toBeNull();
    expect(h2.last('session_ended')!.reason).toBe('market_close');
    expect(h2.of('fill').at(-1)!.fill).toMatchObject({ side: 'sell', price: 49.99, qty: 10 });
    expect(h.repo.activeSession()).toBeNull();
  });

  it('returns null with no active session', async () => {
    const h = harness();
    expect(await SessionManager.restore(h.deps)).toBeNull();
  });
});
