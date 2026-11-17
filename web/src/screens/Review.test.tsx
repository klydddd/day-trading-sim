import { render, screen } from '@testing-library/react';
import { Review } from './Review';
import { HelpProvider } from '../learn/HelpContext';
import { DEFAULT_RULES, type Trade } from '../../../shared/types';
import type { Review as ReviewT } from '../../../shared/protocol';

const trade = (pnl: number, breaks = 0): Trade => ({
  id: `t${pnl}${breaks}`, sessionId: 's', symbol: 'SPY', openedAt: Date.UTC(2025, 2, 4, 15), closedAt: Date.UTC(2025, 2, 4, 15, 5), maxQty: 10,
  avgEntry: 50, avgExit: 51, pnl, fees: 0, stopUsed: 49,
  ruleBreaks: Array.from({ length: breaks }, () => ({ rule: 'no_stop' as const, detail: 'SPY: entered without a stop-loss.', ts: 0 })), fills: [],
});
const stats = (t: Trade[]) => ({ totalPnl: t.reduce((a, x) => a + x.pnl, 0), count: t.length, winRate: 1, avgWin: 10, avgLoss: 0, biggestLoss: 0,
  tradesFollowingRules: t.filter((x) => !x.ruleBreaks.length).length, ruleBreaks: t.reduce((a, x) => a + x.ruleBreaks.length, 0) });
function review(helpLevel: 'learn' | 'challenge', trades: Trade[], extra: Partial<ReviewT> = {}): ReviewT {
  return {
    sessionId: 's', config: { dataSource: 'replay', helpLevel, startingCash: 25000, rules: DEFAULT_RULES, profitTargetPct: 2 },
    replayDate: '2025-03-04', reason: 'user', stats: stats(trades), trades, sessionPnl: stats(trades).totalPnl, overrides: [], ...extra,
  };
}
const renderAs = (r: ReviewT) => render(
  <HelpProvider helpLevel={r.config.helpLevel}><Review review={r} candles={{}} onSend={() => {}} onNewSession={() => {}} /></HelpProvider>,
);

describe('Review', () => {
  it('Challenge shows "Passed" with the target hit and 0 breaks', () => {
    renderAs(review('challenge', [trade(600)], { profitTarget: { targetPct: 2, hit: true, passed: true } }));
    expect(screen.getByText('Passed')).toBeInTheDocument();
  });
  it('Challenge does not pass with the target hit but a rule broken', () => {
    renderAs(review('challenge', [trade(600, 1)], { profitTarget: { targetPct: 2, hit: true, passed: false } }));
    expect(screen.queryByText('Passed')).toBeNull();
    expect(screen.getByText('Not passed')).toBeInTheDocument();
    expect(screen.getByText('SPY: entered without a stop-loss.')).toBeInTheDocument();
  });
  it('Challenge does not pass with the target missed', () => {
    renderAs(review('challenge', [trade(10)], { profitTarget: { targetPct: 2, hit: false, passed: false } }));
    expect(screen.queryByText('Passed')).toBeNull();
  });
  it('reveals the replay date and the end reason in plain words', () => {
    renderAs(review('challenge', [], { reason: 'daily_limit' }));
    expect(screen.getByText(/Tue, Mar 4, 2025/)).toBeInTheDocument();
    expect(screen.getByText(/daily loss limit/i)).toBeInTheDocument();
  });
  it('Learn renders observations; Challenge does not', () => {
    const obs = ['2 of your 5 trades had no stop-loss.'];
    renderAs(review('learn', [trade(5)], { observations: obs }));
    expect(screen.getByText(obs[0])).toBeInTheDocument();
  });
  it('Challenge never renders observations', () => {
    renderAs(review('challenge', [trade(5)], { observations: ['should not show'] }));
    expect(screen.queryByText('should not show')).toBeNull();
  });
});
