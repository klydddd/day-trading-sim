import { reduce, initialState } from './store';
import type { Order } from '../../shared/types';
import type { ServerMessage } from '../../shared/protocol';

const order = (id: string, status: Order['status']): Order => ({ id, symbol: 'SPY', side: 'buy', qty: 1, type: 'limit', limitPrice: 10, status, createdAt: 1 });
const apply = (msgs: ServerMessage[]) => msgs.reduce(reduce, initialState());

describe('store reduce', () => {
  it('order_update inserts then updates an order by id', () => {
    const s = apply([
      { type: 'order_update', order: order('a', 'working') },
      { type: 'order_update', order: order('b', 'working') },
      { type: 'order_update', order: order('a', 'cancelled') },
    ]);
    expect(Object.values(s.orders).map((o) => [o.id, o.status])).toEqual([['a', 'cancelled'], ['b', 'working']]);
  });
  it('a rejected order_update is surfaced as lastReject', () => {
    const s = apply([{ type: 'order_update', order: { ...order('a', 'rejected'), rejectReason: 'stale_data' } }]);
    expect(s.lastReject?.rejectReason).toBe('stale_data');
  });
  it('fill appends fills', () => {
    const f = { orderId: 'a', symbol: 'SPY', side: 'buy' as const, qty: 1, price: 10, fee: 0, ts: 5 };
    const s = apply([{ type: 'fill', fill: f }, { type: 'fill', fill: { ...f, ts: 6 } }]);
    expect(s.fills.map((x) => x.ts)).toEqual([5, 6]);
  });
  it('candle updates the last candle or appends a new minute', () => {
    const c = (t: number, c_: number) => ({ t, o: 1, h: 2, l: 0, c: c_, v: 1 });
    const s = apply([
      { type: 'candles', symbol: 'SPY', candles: [c(0, 1), c(60000, 1)] },
      { type: 'candle', symbol: 'SPY', candle: c(60000, 1.5) },
      { type: 'candle', symbol: 'SPY', candle: c(120000, 2) },
    ]);
    expect(s.candles.SPY.map((k) => [k.t, k.c])).toEqual([[0, 1], [60000, 1.5], [120000, 2]]);
  });
  it('a new session id resets session-scoped data', () => {
    const cfg = { dataSource: 'replay' as const, helpLevel: 'learn' as const, startingCash: 1, rules: { maxLossPerTrade: { kind: 'percent' as const, value: 1 }, dailyLossLimit: { kind: 'percent' as const, value: 3 }, requireStop: true } };
    const s = apply([
      { type: 'session', id: 's1', config: cfg, replayDate: null, status: 'active', paused: true },
      { type: 'order_update', order: order('a', 'working') },
      { type: 'session', id: 's2', config: cfg, replayDate: null, status: 'active', paused: true },
    ]);
    expect(s.orders).toEqual({});
  });
});
