import { roundCents } from './money';
import type { Trade } from './types';

export interface Stats {
  totalPnl: number; count: number; winRate: number; avgWin: number; avgLoss: number;
  biggestLoss: number; tradesFollowingRules: number; ruleBreaks: number;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const closedOnly = (trades: Trade[]) => trades.filter((t) => t.closedAt !== undefined);

/** Stats over closed trades. A win is pnl > 0, a loss pnl < 0; avgLoss and biggestLoss are positive. */
export function computeStats(trades: Trade[]): Stats {
  const ts = closedOnly(trades);
  const wins = ts.filter((t) => t.pnl > 0).map((t) => t.pnl);
  const losses = ts.filter((t) => t.pnl < 0).map((t) => -t.pnl);
  return {
    totalPnl: roundCents(ts.reduce((a, t) => a + t.pnl, 0)),
    count: ts.length,
    winRate: ts.length ? wins.length / ts.length : 0,
    avgWin: roundCents(mean(wins)),
    avgLoss: roundCents(mean(losses)),
    biggestLoss: losses.length ? roundCents(Math.max(...losses)) : 0,
    tradesFollowingRules: ts.filter((t) => t.ruleBreaks.length === 0).length,
    ruleBreaks: ts.reduce((a, t) => a + t.ruleBreaks.length, 0),
  };
}

const ratio = (x: number) => {
  const s = x.toFixed(1);
  return s.endsWith('.0') ? s.slice(0, -2) : s;
};

/** Plain-English observations about the session (Learn mode review). Describes, never prescribes trades. */
export function observations(trades: Trade[]): string[] {
  const ts = closedOnly(trades);
  const out: string[] = [];
  const s = computeStats(ts);
  if (s.avgWin > 0 && s.avgLoss > 0 && s.avgLoss / s.avgWin > 1.5) {
    out.push(`Your average loss was ${ratio(s.avgLoss / s.avgWin)}× your average win; even a 60% win rate loses money this way.`);
  }
  const noStop = ts.filter((t) => t.stopUsed === undefined).length;
  if (noStop > 0) out.push(`${noStop} of your ${ts.length} trades had no stop-loss.`);
  const hold = (t: Trade) => (t.closedAt as number) - t.openedAt;
  const winHold = mean(ts.filter((t) => t.pnl > 0).map(hold));
  const lossHold = mean(ts.filter((t) => t.pnl < 0).map(hold));
  if (winHold > 0 && lossHold / winHold > 1.5) {
    out.push(`You held losing trades about ${ratio(lossHold / winHold)}× longer than winning ones.`);
  }
  if (ts.length > 20) {
    out.push(`You made ${ts.length} trades. Every trade pays the spread, so fewer, better trades usually beat more trades.`);
  }
  return out;
}
