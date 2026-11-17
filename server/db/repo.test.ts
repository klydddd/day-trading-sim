import { openDb } from './db';
import { Repo } from './repo';
import { DEFAULT_RULES, type SessionConfig, type Trade } from '../../shared/types';

const cfg = (helpLevel: 'learn' | 'challenge', dataSource: 'live' | 'replay' = 'replay'): SessionConfig => ({
  dataSource, helpLevel, startingCash: 25000, rules: DEFAULT_RULES,
});
const trade = (id: string, sessionId: string, pnl: number, closedAt?: number): Trade => ({
  id, sessionId, symbol: 'X', openedAt: 1, closedAt, maxQty: 1, avgEntry: 1, pnl, fees: 0, ruleBreaks: [], fills: [],
});

describe('Repo', () => {
  let repo: Repo;
  beforeEach(() => { repo = new Repo(openDb(':memory:')); });

  it('sets user_version to 1', () => {
    const db = openDb(':memory:');
    expect(db.pragma('user_version', { simple: true })).toBe(1);
  });

  it('settings fall back to defaults and round-trip JSON', () => {
    expect(repo.getSetting('watchlist', ['SPY'])).toEqual(['SPY']);
    repo.setSetting('watchlist', ['AAPL', 'MSFT']);
    expect(repo.getSetting('watchlist', ['SPY'])).toEqual(['AAPL', 'MSFT']);
    repo.setSetting('walkthroughDone', true);
    expect(repo.getSetting('walkthroughDone', false)).toBe(true);
  });

  it('session lifecycle: active until ended, snapshots saved', () => {
    expect(repo.activeSession()).toBeNull();
    repo.createSession('s1', cfg('learn'), '2026-11-13', 100);
    repo.saveSnapshot('s1', { a: 1 }, 555);
    expect(repo.activeSession()).toEqual({ id: 's1', config: cfg('learn'), replayDate: '2026-11-13', snapshot: { a: 1 }, simTs: 555 });
    repo.endSession('s1', 'user', 200);
    expect(repo.activeSession()).toBeNull();
  });

  it('trades upsert by id', () => {
    repo.createSession('s1', cfg('learn'), null, 100);
    repo.saveTrade(trade('t1', 's1', 0));
    repo.saveTrade({ ...trade('t1', 's1', 25, 50), note: 'why' });
    expect(repo.sessionTrades('s1')).toEqual([{ ...trade('t1', 's1', 25, 50), note: 'why' }]);
  });

  it('listSessions filters by help level and data source and sums closed-trade pnl', () => {
    repo.createSession('a', cfg('learn'), null, 100);
    repo.createSession('b', cfg('challenge'), '2026-10-01', 200);
    repo.createSession('c', cfg('challenge', 'live'), null, 300);
    repo.saveTrade(trade('t1', 'b', 10, 5));
    repo.saveTrade(trade('t2', 'b', -4, 6));
    repo.saveTrade(trade('t3', 'b', 99)); // open: not counted
    repo.endSession('b', 'daily_limit', 250);
    const ch = repo.listSessions({ helpLevel: 'challenge' });
    expect(ch.map((s) => s.id)).toEqual(['b', 'c']);
    expect(ch[0]).toMatchObject({ id: 'b', replayDate: '2026-10-01', startedAt: 200, endedAt: 250, endReason: 'daily_limit', pnl: 6, tradeCount: 2 });
    expect(repo.listSessions({ helpLevel: 'challenge', dataSource: 'live' }).map((s) => s.id)).toEqual(['c']);
    expect(repo.listSessions().map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('records daily-limit overrides on the session', () => {
    repo.createSession('s1', cfg('learn'), null, 100);
    repo.addOverride('s1', { rule: 'daily_limit_override', detail: 'x', ts: 5 });
    expect(repo.overrides('s1')).toEqual([{ rule: 'daily_limit_override', detail: 'x', ts: 5 }]);
  });
});
