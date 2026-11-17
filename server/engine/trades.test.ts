import { TradeTracker } from './trades';
import type { Fill, Order, Side } from '../../shared/types';

let n = 0;
function f(side: Side, qty: number, price: number, ts: number, fee = 0): { fill: Fill; order: Order } {
  const id = `o${++n}`;
  return {
    fill: { orderId: id, symbol: 'X', side, qty, price, fee, ts },
    order: { id, symbol: 'X', side, qty, type: 'market', status: 'filled', createdAt: ts, note: side === 'buy' ? 'breakout' : undefined },
  };
}
const ids = () => { let i = 0; return () => `t${++i}`; };

describe('TradeTracker', () => {
  it('scales in then out as one round trip', () => {
    const t = new TradeTracker('s1', ids());
    const a = f('buy', 10, 10, 1); const b = f('buy', 10, 12, 2); const c = f('sell', 20, 13, 3);
    expect(t.onFill(a.fill, a.order, 10).opened).toBeDefined();
    expect(t.onFill(b.fill, b.order, 20)).toEqual({});
    const { closed } = t.onFill(c.fill, c.order, 0);
    expect(closed).toMatchObject({ id: 't1', sessionId: 's1', symbol: 'X', maxQty: 20, avgEntry: 11, avgExit: 13, pnl: 40, openedAt: 1, closedAt: 3, note: 'breakout' });
    expect(closed!.fills).toHaveLength(3);
    expect(t.open()).toHaveLength(0);
  });

  it('two separate round trips make two closed trades', () => {
    const t = new TradeTracker('s1', ids());
    for (const [x, q] of [[f('buy', 5, 10, 1), 5], [f('sell', 5, 9, 2), 0], [f('buy', 5, 10, 3), 5], [f('sell', 5, 11, 4), 0]] as const) t.onFill(x.fill, x.order, q);
    expect(t.closed().map((c) => c.pnl)).toEqual([-5, 5]);
  });

  it('pnl subtracts fees', () => {
    const t = new TradeTracker('s1', ids());
    const a = f('buy', 10, 10, 1, 0.05); const b = f('sell', 10, 11, 2, 0.05);
    t.onFill(a.fill, a.order, 10);
    expect(t.onFill(b.fill, b.order, 0).closed!.pnl).toBe(9.9);
  });

  it('breaks attached before the entry fill end up on that trade; stop/target are recorded', () => {
    const t = new TradeTracker('s1', ids());
    t.attachBreaks('X', [{ rule: 'no_stop', detail: 'no stop', ts: 0 }]);
    const a = f('buy', 10, 10, 1);
    t.onFill(a.fill, a.order, 10);
    t.noteStop('X', 9.5); t.noteStop('X', 9.8); t.noteTarget('X', 11);
    expect(t.open()[0]).toMatchObject({ ruleBreaks: [{ rule: 'no_stop' }], stopUsed: 9.5, targetUsed: 11 });
  });

  it('snapshot / restore round-trips', () => {
    const t = new TradeTracker('s1', ids());
    const a = f('buy', 10, 10, 1); t.onFill(a.fill, a.order, 10);
    const b = f('sell', 10, 11, 2); t.onFill(b.fill, b.order, 0);
    const c = f('buy', 3, 10, 3); t.onFill(c.fill, c.order, 3);
    t.attachBreaks('Y', [{ rule: 'no_stop', detail: 'x', ts: 4 }]);
    const r = TradeTracker.restore(JSON.parse(JSON.stringify(t.snapshot())));
    expect(r.open()).toEqual(t.open());
    expect(r.closed()).toEqual(t.closed());
    expect(r.snapshot()).toEqual(t.snapshot());
  });
});
