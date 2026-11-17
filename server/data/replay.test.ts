import { modeledSpread, synthesizeTicks, ReplayFeed } from './replay';
import { ReplayClock } from './replayClock';
import type { Bar, PriceEvent } from '../../shared/types';

const T930 = Date.UTC(2026, 10, 16, 14, 30);
const bar = (i: number, o: number, h: number, l: number, c: number, v = 600): Bar => ({ t: T930 + i * 60000, o, h, l, c, v });
const ts = (e: PriceEvent) => (e.kind === 'quote' ? e.quote.ts : e.print.ts);

describe('modeledSpread', () => {
  it('is 2bp of price rounded up to the cent, at least a cent', () => {
    expect(modeledSpread(187.4)).toBe(0.04);
    expect(modeledSpread(20)).toBe(0.01);
    expect(modeledSpread(50)).toBe(0.01);
  });
});

describe('synthesizeTicks', () => {
  it('up bar goes o -> l -> h -> c with exact extremes', () => {
    const t = synthesizeTicks({ t: 0, o: 10, h: 12, l: 9, c: 11, v: 1 });
    expect(t).toHaveLength(60);
    expect(t[0]).toBe(10);
    expect(t[59]).toBe(11);
    expect(Math.min(...t)).toBe(9);
    expect(Math.max(...t)).toBe(12);
    expect(t.indexOf(9)).toBeLessThan(t.indexOf(12));
    for (const x of t) expect(Math.round(x * 100) / 100).toBe(x);
  });
  it('down bar goes o -> h -> l -> c', () => {
    const t = synthesizeTicks({ t: 0, o: 11, h: 12, l: 9, c: 10, v: 1 });
    expect(t[0]).toBe(11);
    expect(t[59]).toBe(10);
    expect(Math.min(...t)).toBe(9);
    expect(Math.max(...t)).toBe(12);
    expect(t.indexOf(12)).toBeLessThan(t.indexOf(9));
  });
  it('flat bar is all one price', () => {
    expect(new Set(synthesizeTicks({ t: 0, o: 5, h: 5, l: 5, c: 5, v: 1 }))).toEqual(new Set([5]));
  });
});

describe('ReplayFeed', () => {
  const bars = { X: [bar(0, 10, 12, 9, 11), bar(1, 11, 11.5, 10.5, 11.2), bar(2, 11.2, 11.3, 11, 11.1)] };

  it('emits a print then a quote around it, never after simTs, never twice', () => {
    const f = new ReplayFeed(bars, T930 + 3 * 60000);
    const a = f.advanceTo(T930 + 10_500);
    expect(a).toHaveLength(22); // ticks at 0..10 s
    expect(a[0]).toEqual({ kind: 'print', print: { symbol: 'X', price: 10, size: 10, ts: T930 } });
    expect(a[1]).toEqual({ kind: 'quote', quote: { symbol: 'X', bid: 9.99, ask: 10, ts: T930 } });
    for (const e of a) expect(ts(e)).toBeLessThanOrEqual(T930 + 10_500);
    const b = f.advanceTo(T930 + 10_900);
    expect(b).toHaveLength(0);
    const c = f.advanceTo(T930 + 70_000);
    expect(ts(c[0])).toBe(T930 + 11_000);
    expect(c.every((e) => ts(e) <= T930 + 70_000)).toBe(true);
  });

  it('quotes keep the modeled spread', () => {
    const f = new ReplayFeed({ Y: [bar(0, 187.4, 187.4, 187.4, 187.4)] }, T930 + 60000);
    const q = f.advanceTo(T930).find((e) => e.kind === 'quote')!;
    expect(q).toEqual({ kind: 'quote', quote: { symbol: 'Y', bid: 187.38, ask: 187.42, ts: T930 } });
  });

  it('barsUpTo excludes the in-progress minute', () => {
    const f = new ReplayFeed(bars, T930 + 3 * 60000);
    expect(f.barsUpTo('X', T930 + 119_999)).toHaveLength(1);
    expect(f.barsUpTo('X', T930 + 120_000)).toHaveLength(2);
    expect(f.barsUpTo('NOPE', T930 + 120_000)).toEqual([]);
  });

  it('skipTo jumps silently and returns only the latest print+quote per symbol', () => {
    const f = new ReplayFeed(bars, T930 + 3 * 60000);
    const s = f.skipTo(T930 + 61_000);
    expect(s).toHaveLength(2);
    expect(ts(s[0])).toBe(T930 + 61_000);
    expect(ts(f.advanceTo(T930 + 62_000)[0])).toBe(T930 + 62_000);
  });

  it('isFinished at a 13:00 ET half-day close', () => {
    const close = Date.UTC(2026, 10, 27, 18); // 13:00 ET
    const f = new ReplayFeed(bars, close);
    expect(f.isFinished(close - 1)).toBe(false);
    expect(f.isFinished(close)).toBe(true);
  });
});

describe('ReplayClock', () => {
  it('advances by elapsed × speed only while playing', () => {
    const c = new ReplayClock(T930, { speed: 5 });
    expect(c.tick(1000)).toBe(T930);
    c.play();
    expect(c.tick(1000)).toBe(T930 + 5000);
    c.pause();
    expect(c.tick(1000)).toBe(T930 + 5000);
  });
  it('lockedSpeed ignores setSpeed', () => {
    const c = new ReplayClock(T930, { lockedSpeed: true });
    c.setSpeed(10);
    expect(c.speed).toBe(1);
    const d = new ReplayClock(T930);
    d.setSpeed(10);
    expect(d.speed).toBe(10);
  });
  it('stepMinute jumps to the next minute boundary, only while paused', () => {
    const c = new ReplayClock(T930 + 80_000); // 9:31:20
    expect(c.stepMinute()).toBe(T930 + 120_000); // 9:32:00
    c.play();
    expect(c.stepMinute()).toBe(T930 + 120_000);
  });
  it('has no way to move backwards', () => {
    const proto = Object.getOwnPropertyNames(ReplayClock.prototype);
    expect(proto.filter((n) => /back|rewind|seek|setSimTs/i.test(n))).toEqual([]);
    expect(new ReplayClock(T930).tick(-5000)).toBe(T930);
  });
});
