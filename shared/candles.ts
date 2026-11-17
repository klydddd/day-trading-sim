import type { Candle, Print } from './types';

export const minuteOf = (ts: number) => Math.floor(ts / 60000) * 60000;

/** Builds 1-minute candles from trade prints. */
export class CandleBuilder {
  private candles: Candle[] = [];
  constructor(readonly symbol: string) {}

  seed(c: Candle[]): void {
    const merged = new Map<number, Candle>();
    for (const k of [...c, ...this.candles]) merged.set(k.t, { ...k });
    this.candles = [...merged.values()].sort((a, b) => a.t - b.t);
  }

  onPrint(p: Print): { closed?: Candle; current: Candle } {
    const t = minuteOf(p.ts);
    const last = this.candles[this.candles.length - 1];
    if (last && t === last.t) {
      last.h = Math.max(last.h, p.price);
      last.l = Math.min(last.l, p.price);
      last.c = p.price;
      last.v += p.size;
      return { current: { ...last } };
    }
    if (last && t < last.t) return { current: { ...last } }; // out-of-order print: ignore
    const current: Candle = { t, o: p.price, h: p.price, l: p.price, c: p.price, v: p.size };
    this.candles.push(current);
    return { closed: last ? { ...last } : undefined, current: { ...current } };
  }

  all(): Candle[] {
    return this.candles.map((c) => ({ ...c }));
  }
}

/**
 * Aggregate 1m candles into 5m/15m candles. US Eastern offsets are whole hours,
 * so epoch-aligned buckets line up with ET clock minutes (9:30, 9:35, ...).
 */
export function aggregateCandles(c1m: Candle[], minutes: 5 | 15): Candle[] {
  const size = minutes * 60000;
  const out: Candle[] = [];
  for (const c of c1m) {
    const t = Math.floor(c.t / size) * size;
    const last = out[out.length - 1];
    if (last && last.t === t) {
      last.h = Math.max(last.h, c.h);
      last.l = Math.min(last.l, c.l);
      last.c = c.c;
      last.v += c.v;
    } else {
      out.push({ t, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v });
    }
  }
  return out;
}
