import { Engine, type EngineEvent } from './engine';
import { q, p, seqIds } from './testing';
import type { Order } from '../../shared/types';

const mk = () => new Engine({ startingCash: 25000, feePerShare: 0, idGen: seqIds() });
const fills = (ev: EngineEvent[]) => ev.flatMap((e) => (e.kind === 'fill' ? [e.fill] : []));
const notes = (ev: EngineEvent[]) => ev.flatMap((e) => (e.kind === 'note' ? [e.note] : []));
const updates = (ev: EngineEvent[]) => ev.flatMap((e) => (e.kind === 'order_update' ? [e.order] : []));
const byId = (e: Engine, id: string) => e.state().orders.find((o) => o.id === id)!;

function longWithStop(e: Engine, stop = 49) {
  e.onPrice(q('X', 49.98, 50.0));
  e.submit({ symbol: 'X', side: 'buy', qty: 100, type: 'market' }, 1);
  return updates(e.submit({ symbol: 'X', side: 'sell', qty: 100, type: 'stop', stopPrice: stop }, 2))[0];
}

describe('Engine: stop orders', () => {
  it('a sell stop triggers on a print <= stop and fills on the next quote at the bid', () => {
    const e = mk();
    const stop = longWithStop(e);
    expect(fills(e.onPrice(p('X', 49.5)))).toHaveLength(0);
    const trig = e.onPrice(p('X', 49.0));
    expect(fills(trig)).toHaveLength(0);
    expect(byId(e, stop.id).triggered).toBe(true);
    const f = fills(e.onPrice(q('X', 48.99, 49.01)));
    expect(f[0]).toMatchObject({ price: 48.99, qty: 100, slippage: 0.01 });
  });

  it('gap through the stop: fills at the next bid, records slippage, emits a note (Review Focus #4)', () => {
    const e = mk();
    longWithStop(e, 49);
    const trig = e.onPrice(p('X', 48.0));
    expect(fills(trig)).toHaveLength(0);
    const ev = e.onPrice(q('X', 47.95, 47.97));
    expect(fills(ev)[0]).toMatchObject({ price: 47.95, slippage: 1.05 });
    const n = notes(ev);
    expect(n).toHaveLength(1);
    expect(n[0].code).toBe('stop_slippage');
    expect(n[0].message).toBe("Your stop at $49.00 filled at $47.95 ($1.05 worse) because the price jumped past it. Stops limit losses but don't guarantee your price.");
    expect(e.state().positions.X).toBeUndefined();
  });

  it('no slippage note when the stop fills at its price', () => {
    const e = mk();
    longWithStop(e, 49);
    e.onPrice(p('X', 49));
    const ev = e.onPrice(q('X', 49.0, 49.02));
    expect(fills(ev)[0].price).toBe(49);
    expect(notes(ev)).toHaveLength(0);
  });
});

describe('Engine: bracket orders', () => {
  const bracketBuy = (e: Engine, type: 'market' | 'limit' = 'market', limitPrice?: number) =>
    updates(e.submit({ symbol: 'X', side: 'buy', qty: 10, type, limitPrice, bracket: { stopLoss: 49, takeProfit: 52 } }, 1));

  it('creates two pending children with a shared ocoGroup and parentId', () => {
    const e = mk(); e.onPrice(q('X', 49.98, 50.02));
    const ups = bracketBuy(e, 'limit', 49.5);
    const parent = ups[0];
    const kids = e.state().orders.filter((o) => o.parentId === parent.id);
    expect(kids).toHaveLength(2);
    const stop = kids.find((k) => k.type === 'stop')!;
    const tp = kids.find((k) => k.type === 'limit')!;
    expect(stop).toMatchObject({ side: 'sell', stopPrice: 49, qty: 10, status: 'pending_parent' });
    expect(tp).toMatchObject({ side: 'sell', limitPrice: 52, qty: 10, status: 'pending_parent' });
    expect(stop.ocoGroup).toBeDefined();
    expect(stop.ocoGroup).toBe(tp.ocoGroup);
  });

  it('children become working when the parent fills', () => {
    const e = mk(); e.onPrice(q('X', 49.98, 50.02));
    const parent = bracketBuy(e)[0];
    const kids = e.state().orders.filter((o) => o.parentId === parent.id);
    expect(kids.map((k) => k.status)).toEqual(['working', 'working']);
  });

  it('when one child fills, the sibling is cancelled', () => {
    const e = mk(); e.onPrice(q('X', 49.98, 50.02));
    const parent = bracketBuy(e)[0];
    e.onPrice(p('X', 52.01));
    const kids = e.state().orders.filter((o) => o.parentId === parent.id);
    expect(kids.find((k) => k.type === 'limit')!.status).toBe('filled');
    expect(kids.find((k) => k.type === 'stop')!.status).toBe('cancelled');
  });

  it('cancelling the parent cancels its children', () => {
    const e = mk(); e.onPrice(q('X', 49.98, 50.02));
    const parent = bracketBuy(e, 'limit', 49.5)[0];
    e.cancel(parent.id, 2);
    const kids = e.state().orders.filter((o: Order) => o.parentId === parent.id);
    expect(kids.map((k) => k.status)).toEqual(['cancelled', 'cancelled']);
  });

  it('closePosition cancels the bracket children', () => {
    const e = mk(); e.onPrice(q('X', 49.98, 50.02));
    const parent = bracketBuy(e)[0];
    e.closePosition('X', 2);
    const kids = e.state().orders.filter((o) => o.parentId === parent.id);
    expect(kids.map((k) => k.status)).toEqual(['cancelled', 'cancelled']);
    expect(e.state().positions.X).toBeUndefined();
  });

  it('rejects a bracket whose stop is not below / target not above the entry reference (invalid_price)', () => {
    const e = mk(); e.onPrice(q('X', 49.98, 50.02));
    const bad1 = updates(e.submit({ symbol: 'X', side: 'buy', qty: 1, type: 'market', bracket: { stopLoss: 50.02 } }, 1))[0];
    expect(bad1.rejectReason).toBe('invalid_price');
    const bad2 = updates(e.submit({ symbol: 'X', side: 'buy', qty: 1, type: 'limit', limitPrice: 48, bracket: { takeProfit: 48 } }, 1))[0];
    expect(bad2.rejectReason).toBe('invalid_price');
    expect(e.state().orders.filter((o) => o.parentId)).toHaveLength(0);
  });
});
