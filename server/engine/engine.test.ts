import { Engine, type EngineEvent } from './engine';
import { q, p, seqIds } from './testing';

const mk = (cash = 25000, feePerShare = 0) => new Engine({ startingCash: cash, feePerShare, idGen: seqIds() });
const fills = (ev: EngineEvent[]) => ev.filter((e) => e.kind === 'fill').map((e) => (e as Extract<EngineEvent, { kind: 'fill' }>).fill);
const notes = (ev: EngineEvent[]) => ev.filter((e) => e.kind === 'note');
const firstOrder = (ev: EngineEvent[]) => (ev[0] as Extract<EngineEvent, { kind: 'order_update' }>).order;

describe('Engine: validation', () => {
  it('rejects non-positive or fractional qty with invalid_qty', () => {
    const e = mk(); e.onPrice(q('AAPL', 187.38, 187.4));
    for (const qty of [0, -1, 1.5]) {
      const o = firstOrder(e.submit({ symbol: 'AAPL', side: 'buy', qty, type: 'market' }, 1));
      expect(o).toMatchObject({ status: 'rejected', rejectReason: 'invalid_qty' });
    }
  });
  it('rejects a limit price <= 0 with invalid_price', () => {
    const e = mk(); e.onPrice(q('AAPL', 187.38, 187.4));
    expect(firstOrder(e.submit({ symbol: 'AAPL', side: 'buy', qty: 1, type: 'limit', limitPrice: 0 }, 1)).rejectReason).toBe('invalid_price');
  });
  it('rejects a market order with no quote (no_quote)', () => {
    const e = mk();
    expect(firstOrder(e.submit({ symbol: 'AAPL', side: 'buy', qty: 1, type: 'market' }, 1)).rejectReason).toBe('no_quote');
  });
  it('rejects a sell with no position (no_position)', () => {
    const e = mk(); e.onPrice(q('AAPL', 187.38, 187.4));
    expect(firstOrder(e.submit({ symbol: 'AAPL', side: 'sell', qty: 1, type: 'market' }, 1)).rejectReason).toBe('no_position');
  });
  it('rejects a buy stop as unsupported (long-only)', () => {
    const e = mk(); e.onPrice(q('AAPL', 187.38, 187.4));
    expect(firstOrder(e.submit({ symbol: 'AAPL', side: 'buy', qty: 1, type: 'stop', stopPrice: 190 }, 1)).rejectReason).toBe('unsupported');
  });
});

describe('Engine: market orders', () => {
  it('market buy fills at the ask and deducts cash', () => {
    const e = mk(); e.onPrice(q('AAPL', 187.38, 187.4));
    const ev = e.submit({ symbol: 'AAPL', side: 'buy', qty: 20, type: 'market' }, 1);
    expect(fills(ev)[0]).toMatchObject({ price: 187.4, qty: 20, side: 'buy', fee: 0 });
    expect(e.state().cash).toBe(21252);
    expect(e.state().positions.AAPL).toEqual({ symbol: 'AAPL', qty: 20, avgPrice: 187.4 });
  });
  it('market sell fills at the bid', () => {
    const e = mk(); e.onPrice(q('AAPL', 187.38, 187.4));
    e.submit({ symbol: 'AAPL', side: 'buy', qty: 20, type: 'market' }, 1);
    const ev = e.submit({ symbol: 'AAPL', side: 'sell', qty: 20, type: 'market' }, 2);
    expect(fills(ev)[0].price).toBe(187.38);
    expect(e.state().positions.AAPL).toBeUndefined();
  });
  it('charges feePerShare × qty', () => {
    const e = mk(25000, 0.005); e.onPrice(q('AAPL', 187.38, 187.4));
    const ev = e.submit({ symbol: 'AAPL', side: 'buy', qty: 100, type: 'market' }, 1);
    expect(fills(ev)[0].fee).toBe(0.5);
    expect(e.state().cash).toBe(25000 - 18740 - 0.5);
  });
});

describe('Engine: cash limits', () => {
  it('rejects a market buy costing more than buying power', () => {
    const e = mk(1000); e.onPrice(q('AAPL', 187.38, 187.4));
    expect(firstOrder(e.submit({ symbol: 'AAPL', side: 'buy', qty: 6, type: 'market' }, 1)).rejectReason).toBe('insufficient_cash');
  });
  it('rejects a limit buy whose qty × limit exceeds buying power, counting working buy limits', () => {
    const e = mk(1000); e.onPrice(q('X', 49.98, 50.02));
    expect(firstOrder(e.submit({ symbol: 'X', side: 'buy', qty: 15, type: 'limit', limitPrice: 40 }, 1)).status).toBe('working');
    expect(e.buyingPower()).toBe(400);
    expect(firstOrder(e.submit({ symbol: 'X', side: 'buy', qty: 11, type: 'limit', limitPrice: 40 }, 2)).rejectReason).toBe('insufficient_cash');
  });
});

describe('Engine: limit orders', () => {
  it('a marketable buy limit (>= ask) fills at once at the ask', () => {
    const e = mk(); e.onPrice(q('X', 49.98, 50.02));
    expect(fills(e.submit({ symbol: 'X', side: 'buy', qty: 10, type: 'limit', limitPrice: 51 }, 1))[0].price).toBe(50.02);
  });
  it('a marketable sell limit (<= bid) fills at once at the bid', () => {
    const e = mk(); e.onPrice(q('X', 49.98, 50.02));
    e.submit({ symbol: 'X', side: 'buy', qty: 10, type: 'market' }, 1);
    expect(fills(e.submit({ symbol: 'X', side: 'sell', qty: 10, type: 'limit', limitPrice: 49 }, 2))[0].price).toBe(49.98);
  });
  it('a resting buy limit only fills on a print strictly below it, and notes a touch once', () => {
    const e = mk(); e.onPrice(q('X', 49.98, 50.02));
    e.submit({ symbol: 'X', side: 'buy', qty: 100, type: 'limit', limitPrice: 50 }, 1);
    const touch = e.onPrice(p('X', 50.0));
    expect(fills(touch)).toHaveLength(0);
    expect(notes(touch)).toHaveLength(1);
    expect(notes(touch)[0]).toMatchObject({ kind: 'note', note: { code: 'limit_touched_no_fill' } });
    expect(notes(e.onPrice(p('X', 50.0)))).toHaveLength(0);
    const f = fills(e.onPrice(p('X', 49.99)));
    expect(f[0]).toMatchObject({ price: 50, qty: 100 });
  });
  it('a resting sell limit only fills on a print strictly above it', () => {
    const e = mk(); e.onPrice(q('X', 49.98, 50.02));
    e.submit({ symbol: 'X', side: 'buy', qty: 10, type: 'market' }, 1);
    e.submit({ symbol: 'X', side: 'sell', qty: 10, type: 'limit', limitPrice: 51 }, 2);
    const touch = e.onPrice(p('X', 51));
    expect(fills(touch)).toHaveLength(0);
    expect(notes(touch)).toHaveLength(1);
    expect(fills(e.onPrice(p('X', 51.01)))[0].price).toBe(51);
  });
});

describe('Engine: positions and P&L', () => {
  it('sell qty is capped at the position and remaining sells are cancelled at 0', () => {
    const e = mk(); e.onPrice(q('X', 49.98, 50.02));
    e.submit({ symbol: 'X', side: 'buy', qty: 10, type: 'market' }, 1);
    const lim = firstOrder(e.submit({ symbol: 'X', side: 'sell', qty: 10, type: 'limit', limitPrice: 60 }, 2));
    const ev = e.submit({ symbol: 'X', side: 'sell', qty: 50, type: 'market' }, 3);
    expect(fills(ev)[0].qty).toBe(10);
    expect(e.state().orders.find((o) => o.id === lim.id)!.status).toBe('cancelled');
  });
  it('avgPrice is the weighted average of buys and realizedPnl accrues per sell', () => {
    const e = mk(); e.onPrice(q('X', 9.99, 10));
    e.submit({ symbol: 'X', side: 'buy', qty: 10, type: 'market' }, 1);
    e.onPrice(q('X', 11.99, 12));
    e.submit({ symbol: 'X', side: 'buy', qty: 10, type: 'market' }, 2);
    expect(e.state().positions.X.avgPrice).toBe(11);
    e.onPrice(q('X', 13, 13.01));
    e.submit({ symbol: 'X', side: 'sell', qty: 5, type: 'market' }, 3);
    expect(e.state().realizedPnl).toBe(10);
  });
  it('equity uses the bid and buyingPower subtracts working buy limits', () => {
    const e = mk(); e.onPrice(q('X', 9.99, 10));
    e.submit({ symbol: 'X', side: 'buy', qty: 10, type: 'market' }, 1);
    expect(e.equity()).toBe(25000 - 100 + 99.9);
  });
});

describe('Engine: cancel / modify / close / snapshot', () => {
  it('cancel and cancelAll mark working orders cancelled', () => {
    const e = mk(); e.onPrice(q('X', 49.98, 50.02));
    const a = firstOrder(e.submit({ symbol: 'X', side: 'buy', qty: 1, type: 'limit', limitPrice: 40 }, 1));
    e.submit({ symbol: 'X', side: 'buy', qty: 1, type: 'limit', limitPrice: 41 }, 1);
    expect(firstOrder(e.cancel(a.id, 2)).status).toBe('cancelled');
    e.cancelAll(3);
    expect(e.state().orders.filter((o) => o.status === 'working')).toHaveLength(0);
  });
  it('modify changes the limit price of a working order', () => {
    const e = mk(); e.onPrice(q('X', 49.98, 50.02));
    const a = firstOrder(e.submit({ symbol: 'X', side: 'buy', qty: 1, type: 'limit', limitPrice: 40 }, 1));
    e.modify(a.id, { limitPrice: 45 }, 2);
    expect(e.state().orders.find((o) => o.id === a.id)!.limitPrice).toBe(45);
  });
  it('closePosition market-sells the full qty at the bid', () => {
    const e = mk(); e.onPrice(q('X', 49.98, 50.02));
    e.submit({ symbol: 'X', side: 'buy', qty: 7, type: 'market' }, 1);
    const f = fills(e.closePosition('X', 2));
    expect(f[0]).toMatchObject({ qty: 7, price: 49.98, side: 'sell' });
  });
  it('snapshot -> restore round-trips state exactly', () => {
    const e = mk(); e.onPrice(q('X', 49.98, 50.02));
    e.submit({ symbol: 'X', side: 'buy', qty: 7, type: 'market' }, 1);
    e.submit({ symbol: 'X', side: 'buy', qty: 3, type: 'limit', limitPrice: 45 }, 2);
    const r = Engine.restore(JSON.parse(JSON.stringify(e.snapshot())), { feePerShare: 0 });
    expect(r.state()).toEqual(e.state());
    expect(r.lastQuote('X')).toEqual(e.lastQuote('X'));
    expect(r.equity()).toBe(e.equity());
  });
});
