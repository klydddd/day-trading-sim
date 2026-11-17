import { CandleBuilder, aggregateCandles } from './candles';
import type { Candle } from './types';

// 2026-11-16 09:30 ET = 14:30 UTC
const T930 = Date.UTC(2026, 10, 16, 14, 30);
const pr = (sec: number, price: number, size = 100) => ({ symbol: 'X', price, size, ts: T930 + sec * 1000 });

describe('CandleBuilder', () => {
  it('closes a minute candle when a print arrives in the next minute', () => {
    const b = new CandleBuilder('X');
    b.onPrint(pr(5, 10, 100));
    b.onPrint(pr(40, 12, 200));
    b.onPrint(pr(50, 9, 300));
    const r = b.onPrint(pr(61, 11, 50));
    expect(r.closed).toEqual({ t: T930, o: 10, h: 12, l: 9, c: 9, v: 600 });
    expect(r.current).toEqual({ t: T930 + 60000, o: 11, h: 11, l: 11, c: 11, v: 50 });
    expect(b.all()).toHaveLength(2);
  });
  it('seed then continues the current candle', () => {
    const b = new CandleBuilder('X');
    b.seed([{ t: T930, o: 1, h: 2, l: 1, c: 2, v: 10 }]);
    const r = b.onPrint(pr(30, 3, 5));
    expect(r.closed).toBeUndefined();
    expect(r.current).toEqual({ t: T930, o: 1, h: 3, l: 1, c: 3, v: 15 });
  });
});

describe('aggregateCandles', () => {
  it('ten 1m candles become two 5m candles aligned to 9:30/9:35', () => {
    const c1: Candle[] = Array.from({ length: 10 }, (_, i) => ({ t: T930 + i * 60000, o: 10 + i, h: 20 + i, l: 5 + i, c: 11 + i, v: 100 }));
    const c5 = aggregateCandles(c1, 5);
    expect(c5).toEqual([
      { t: T930, o: 10, h: 24, l: 5, c: 15, v: 500 },
      { t: T930 + 5 * 60000, o: 15, h: 29, l: 10, c: 20, v: 500 },
    ]);
  });
});
