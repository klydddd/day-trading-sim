import { computeStats, observations } from './stats';
import type { Trade } from './types';

let i = 0;
const t = (pnl: number, o: Partial<Trade> = {}): Trade => ({
  id: `t${++i}`, sessionId: 's', symbol: 'X', openedAt: 0, closedAt: 60_000, maxQty: 1, avgEntry: 1, avgExit: 1,
  pnl, fees: 0, stopUsed: 1, ruleBreaks: [], fills: [], ...o,
});

describe('computeStats', () => {
  it('computes win rate, averages and rule counts', () => {
    const s = computeStats([t(100), t(-50, { ruleBreaks: [{ rule: 'no_stop', detail: '', ts: 0 }] }), t(-150), t(50)]);
    expect(s).toEqual({ totalPnl: -50, count: 4, winRate: 0.5, avgWin: 75, avgLoss: 100, biggestLoss: 150, tradesFollowingRules: 3, ruleBreaks: 1 });
  });
  it('handles no trades', () => {
    expect(computeStats([])).toMatchObject({ count: 0, winRate: 0, avgWin: 0, avgLoss: 0 });
  });
  it('ignores open trades', () => {
    expect(computeStats([t(10), t(5, { closedAt: undefined })]).count).toBe(1);
  });
});

describe('observations', () => {
  it('flags average loss much bigger than average win', () => {
    const obs = observations([t(50), t(50), t(50), t(-100), t(-100)]);
    expect(obs).toContain('Your average loss was 2× your average win; even a 60% win rate loses money this way.');
  });
  it('shows one decimal when the ratio is not whole', () => {
    expect(observations([t(40), t(-100)])).toContain('Your average loss was 2.5× your average win; even a 60% win rate loses money this way.');
  });
  it('counts trades without a stop', () => {
    const obs = observations([t(1, { stopUsed: undefined }), t(1, { stopUsed: undefined }), t(1), t(1), t(1)]);
    expect(obs).toContain('2 of your 5 trades had no stop-loss.');
  });
  it('flags holding losers longer than winners', () => {
    const obs = observations([t(10, { closedAt: 60_000 }), t(-10, { closedAt: 180_000 })]);
    expect(obs).toContain('You held losing trades about 3× longer than winning ones.');
  });
  it('flags overtrading above 20 trades', () => {
    const many = Array.from({ length: 21 }, () => t(1));
    expect(observations(many)).toContain('You made 21 trades. Every trade pays the spread, so fewer, better trades usually beat more trades.');
  });
  it('says nothing when nothing stands out', () => {
    expect(observations([t(10), t(-5)])).toEqual([]);
  });
});
