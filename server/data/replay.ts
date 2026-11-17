import type { Bar, PriceEvent } from '../../shared/types';

const cents = (x: number) => Math.round(x * 100);
const fromCents = (c: number) => c / 100;

/** Modeled bid/ask spread for bar-only replay data: 2 basis points, rounded up to the cent, at least 1¢. */
export function modeledSpread(price: number): number {
  const c = Math.ceil(Number((price * 0.0002 * 100).toFixed(6)));
  return Math.max(0.01, fromCents(c));
}

/**
 * A plausible price path through a 1-minute bar. Up bars (c ≥ o) go o→l→h→c, down bars o→h→l→c,
 * so the bar's whole range is traded (stops and limits inside the range get hit; never a rosier path
 * that skips them). Ticks are spaced by distance, rounded to cents; o, h, l, c are each hit exactly.
 */
export function synthesizeTicks(bar: Bar, n = 60): number[] {
  const up = bar.c >= bar.o;
  const path = up ? [bar.o, bar.l, bar.h, bar.c] : [bar.o, bar.h, bar.l, bar.c];
  const seg = [0, 1, 2].map((i) => Math.abs(path[i + 1] - path[i]));
  const total = seg[0] + seg[1] + seg[2];
  if (total === 0 || n < 4) return Array.from({ length: n }, () => bar.o);
  // Anchor indices for the two extremes, kept strictly ordered inside [1, n-2] when they differ from o/c.
  const last = n - 1;
  let i1 = Math.round((seg[0] / total) * last);
  let i2 = Math.round(((seg[0] + seg[1]) / total) * last);
  if (seg[0] > 0) i1 = Math.max(1, i1);
  if (seg[2] > 0) i2 = Math.min(last - 1, i2);
  if (seg[1] > 0 && i2 <= i1) i2 = Math.min(last - (seg[2] > 0 ? 1 : 0), i1 + 1);
  if (i2 <= i1 && seg[1] > 0) i1 = i2 - 1;
  const anchors: [number, number][] = [[0, path[0]], [i1, path[1]], [i2, path[2]], [last, path[3]]];
  const out = new Array<number>(n);
  for (let k = 0; k < 3; k++) {
    const [a, pa] = anchors[k];
    const [b, pb] = anchors[k + 1];
    for (let i = a; i <= b; i++) {
      const f = b === a ? 1 : (i - a) / (b - a);
      out[i] = fromCents(cents(pa + (pb - pa) * f));
    }
  }
  out[0] = bar.o;
  out[i1] = path[1];
  out[i2] = path[2];
  out[last] = bar.c;
  return out;
}

interface Cursor { bar: number; tick: number; ticks?: number[] }

/** Plays historical 1-minute bars back as one synthesized print + quote per second. */
export class ReplayFeed {
  private readonly bars: Record<string, Bar[]>;
  private readonly cursors: Record<string, Cursor> = {};

  constructor(barsBySymbol: Record<string, Bar[]>, private readonly close: number) {
    this.bars = Object.fromEntries(Object.entries(barsBySymbol).map(([s, b]) => [s, [...b].sort((x, y) => x.t - y.t)]));
    for (const s of Object.keys(this.bars)) this.cursors[s] = { bar: 0, tick: 0 };
  }

  symbols(): string[] { return Object.keys(this.bars); }

  addSymbol(symbol: string, bars: Bar[], simTs: number): PriceEvent[] {
    if (this.bars[symbol]) return [];
    this.bars[symbol] = [...bars].sort((x, y) => x.t - y.t);
    this.cursors[symbol] = { bar: 0, tick: 0 };
    return this.skipSymbol(symbol, simTs);
  }

  advanceTo(simTs: number): PriceEvent[] {
    const out: PriceEvent[] = [];
    for (const s of Object.keys(this.bars)) out.push(...this.advanceSymbol(s, simTs));
    return out.sort((a, b) => evTs(a) - evTs(b));
  }

  /** Jump forward without replaying every tick; returns the latest print + quote per symbol. */
  skipTo(simTs: number): PriceEvent[] {
    const out: PriceEvent[] = [];
    for (const s of Object.keys(this.bars)) out.push(...this.skipSymbol(s, simTs));
    return out;
  }

  barsUpTo(symbol: string, simTs: number): Bar[] {
    return (this.bars[symbol] ?? []).filter((b) => b.t + 60000 <= simTs).map((b) => ({ ...b }));
  }

  isFinished(simTs: number): boolean {
    return simTs >= this.close;
  }

  private skipSymbol(symbol: string, simTs: number): PriceEvent[] {
    const evs = this.advanceSymbol(symbol, simTs);
    return evs.slice(-2);
  }

  private advanceSymbol(symbol: string, simTs: number): PriceEvent[] {
    const bars = this.bars[symbol];
    const cur = this.cursors[symbol];
    const out: PriceEvent[] = [];
    while (cur.bar < bars.length) {
      const bar = bars[cur.bar];
      const ticks = (cur.ticks ??= synthesizeTicks(bar));
      const ts = bar.t + cur.tick * 1000;
      if (ts > simTs) break;
      const price = ticks[cur.tick];
      const spreadC = cents(modeledSpread(price));
      const bidC = cents(price) - Math.ceil(spreadC / 2);
      out.push({ kind: 'print', print: { symbol, price, size: Math.round(bar.v / 60), ts } });
      out.push({ kind: 'quote', quote: { symbol, bid: fromCents(bidC), ask: fromCents(bidC + spreadC), ts } });
      cur.tick++;
      if (cur.tick >= ticks.length) { cur.bar++; cur.tick = 0; cur.ticks = undefined; }
    }
    return out;
  }
}

const evTs = (e: PriceEvent) => (e.kind === 'quote' ? e.quote.ts : e.print.ts);
