import { evaluateEntry, dailyLimitState, limitToDollars } from './rules';
import { DEFAULT_RULES, type OrderRequest, type Print, type Quote } from '../../shared/types';

const NOW = 10_000_000;
const quote: Quote = { symbol: 'AAPL', bid: 187.38, ask: 187.4, ts: NOW };
const ctx = (over: Partial<Parameters<typeof evaluateEntry>[1]> = {}) => ({
  quote, rules: DEFAULT_RULES, startingCash: 25000, sessionPnl: 0, recentPrints: [] as Print[], now: NOW, ...over,
});
const buy = (over: Partial<OrderRequest> = {}): OrderRequest => ({ symbol: 'AAPL', side: 'buy', qty: 20, type: 'market', bracket: { stopLoss: 186 }, ...over });

describe('limitToDollars', () => {
  it('converts percent of starting cash and passes dollars through', () => {
    expect(limitToDollars({ kind: 'percent', value: 1 }, 25000)).toBe(250);
    expect(limitToDollars({ kind: 'dollars', value: 100 }, 25000)).toBe(100);
  });
});

describe('evaluateEntry', () => {
  it('sells are not entries', () => {
    expect(evaluateEntry({ symbol: 'AAPL', side: 'sell', qty: 1, type: 'market' }, ctx())).toEqual({ warnings: [], breaks: [] });
  });
  it('a clean bracketed buy has no warnings or breaks', () => {
    expect(evaluateEntry(buy(), ctx())).toEqual({ warnings: [], breaks: [] });
  });
  it('no stop + requireStop gives one warning and one break', () => {
    const r = evaluateEntry(buy({ bracket: undefined }), ctx());
    expect(r.warnings).toEqual([{ code: 'no_stop', message: "This order has no stop-loss, so your possible loss isn't limited." }]);
    expect(r.breaks.map((b) => b.rule)).toEqual(['no_stop']);
    expect(r.breaks[0].ts).toBe(NOW);
  });
  it('no stop without requireStop warns but does not break', () => {
    const r = evaluateEntry(buy({ bracket: undefined }), ctx({ rules: { ...DEFAULT_RULES, requireStop: false } }));
    expect(r.warnings.map((w) => w.code)).toEqual(['no_stop']);
    expect(r.breaks).toEqual([]);
  });
  it('risk $300 on $25k with a 1% rule is risk_over_limit', () => {
    const q: Quote = { symbol: 'X', bid: 49.99, ask: 50, ts: NOW };
    const r = evaluateEntry({ symbol: 'X', side: 'buy', qty: 100, type: 'market', bracket: { stopLoss: 47 } }, ctx({ quote: q }));
    expect(r.warnings.map((w) => w.code)).toEqual(['risk_over_limit']);
    expect(r.breaks.map((b) => b.rule)).toEqual(['risk_over_limit']);
    expect(r.warnings[0].message).toContain('$300');
  });
  it('uses the limit price as the entry reference for limit orders', () => {
    const q: Quote = { symbol: 'X', bid: 49.99, ask: 50, ts: NOW };
    const r = evaluateEntry({ symbol: 'X', side: 'buy', qty: 100, type: 'limit', limitPrice: 49.5, bracket: { stopLoss: 47 } }, ctx({ quote: q }));
    expect(r.breaks.map((b) => b.rule)).toEqual([]); // risk 250 = limit, not over
  });
  it('wide spread warns', () => {
    const q: Quote = { symbol: 'X', bid: 10, ask: 10.05, ts: NOW };
    const r = evaluateEntry({ symbol: 'X', side: 'buy', qty: 10, type: 'market', bracket: { stopLoss: 9.9 } }, ctx({ quote: q }));
    expect(r.warnings.map((w) => w.code)).toEqual(['wide_spread']);
    expect(r.breaks).toEqual([]);
  });
  it('chasing warns after a >= 1% rise in the last 2 minutes, ignoring older prints', () => {
    const pr = (secAgo: number, price: number): Print => ({ symbol: 'AAPL', price, size: 1, ts: NOW - secAgo * 1000 });
    const r = evaluateEntry(buy(), ctx({ recentPrints: [pr(200, 150), pr(100, 185.5), pr(10, 187.4)] }));
    expect(r.warnings.map((w) => w.code)).toEqual(['chasing']);
    const calm = evaluateEntry(buy(), ctx({ recentPrints: [pr(200, 150), pr(100, 187), pr(10, 187.4)] }));
    expect(calm.warnings).toEqual([]);
  });
  it('near the daily limit warns', () => {
    const r = evaluateEntry(buy(), ctx({ sessionPnl: -600 }));
    expect(r.warnings.map((w) => w.code)).toEqual(['near_daily_limit']);
  });
  it('never tells the user to buy or sell', () => {
    const q: Quote = { symbol: 'X', bid: 10, ask: 10.05, ts: NOW };
    const pr = (secAgo: number, price: number): Print => ({ symbol: 'X', price, size: 1, ts: NOW - secAgo * 1000 });
    const r = evaluateEntry({ symbol: 'X', side: 'buy', qty: 1000, type: 'market' }, ctx({ quote: q, sessionPnl: -700, recentPrints: [pr(60, 9), pr(1, 10)] }));
    expect(r.warnings).toHaveLength(4);
    for (const w of r.warnings) expect(w.message).not.toMatch(/\b(you should|buy now|sell now|consider (buying|selling))\b/i);
  });
});

describe('dailyLimitState', () => {
  it('near at 80% of the limit, hit at 100%', () => {
    expect(dailyLimitState(-599, DEFAULT_RULES, 25000)).toBe('ok');
    expect(dailyLimitState(-600, DEFAULT_RULES, 25000)).toBe('near');
    expect(dailyLimitState(-750, DEFAULT_RULES, 25000)).toBe('hit');
    expect(dailyLimitState(500, DEFAULT_RULES, 25000)).toBe('ok');
  });
});
