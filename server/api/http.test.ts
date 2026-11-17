import { buildApp, Hub } from './ws';
import { openDb } from '../db/db';
import { Repo } from '../db/repo';
import { DEFAULT_RULES, type SessionConfig } from '../../shared/types';

const cfg = (helpLevel: 'learn' | 'challenge'): SessionConfig => ({ dataSource: 'replay', helpLevel, startingCash: 25000, rules: DEFAULT_RULES });

async function setup(hiddenId: string | null = null) {
  const repo = new Repo(openDb(':memory:'));
  repo.createSession('a', cfg('learn'), '2026-11-10', 1);
  repo.createSession('b', cfg('challenge'), '2025-03-04', 2);
  repo.endSession('a', 'user', 3);
  repo.saveTrade({ id: 't1', sessionId: 'b', symbol: 'SPY', openedAt: 1, closedAt: 2, maxQty: 1, avgEntry: 1, pnl: 5, fees: 0, ruleBreaks: [], fills: [] });
  const manager = { handle: vi.fn(async () => {}), sync: async () => {}, activeChallengeReplayId: () => hiddenId };
  const app = await buildApp({
    hub: new Hub(), repo, keysOk: () => true, manager: () => manager,
    status: async () => ({ type: 'status', keysOk: true, market: { phase: 'closed', isOpen: false, nextOpen: 0, nextClose: 0 }, data: 'disconnected' }),
  });
  return { app, manager };
}

describe('HTTP API', () => {
  it('GET /api/sessions?helpLevel=challenge returns only challenge sessions', async () => {
    const { app } = await setup();
    const res = await app.inject({ method: 'GET', url: '/api/sessions?helpLevel=challenge' });
    expect(res.json().map((s: { id: string }) => s.id)).toEqual(['b']);
    const all = await app.inject({ method: 'GET', url: '/api/sessions' });
    expect(all.json()).toHaveLength(2);
  });
  it('hides the replay date of the running Challenge session', async () => {
    const { app } = await setup('b');
    const res = await app.inject({ method: 'GET', url: '/api/sessions?helpLevel=challenge' });
    expect(res.json()[0].replayDate).toBeNull();
    expect(res.body).not.toContain('2025-03-04');
  });
  it('GET /api/sessions/:id/trades returns the session trades', async () => {
    const { app } = await setup();
    const res = await app.inject({ method: 'GET', url: '/api/sessions/b/trades' });
    expect(res.json().map((t: { id: string }) => t.id)).toEqual(['t1']);
  });
  it('GET /api/health reports keysOk', async () => {
    const { app } = await setup();
    expect((await app.inject({ method: 'GET', url: '/api/health' })).json()).toEqual({ keysOk: true });
  });
  it('the websocket sends status on connect and rejects invalid messages', async () => {
    const { app, manager } = await setup();
    await app.ready();
    const msgs: any[] = [];
    const ws = await app.injectWS('/ws', {}, { onInit: (w) => w.on('message', (d) => msgs.push(JSON.parse(String(d)))) });
    const wait = async (n: number) => { for (let i = 0; i < 100 && msgs.length < n; i++) await new Promise((r) => setTimeout(r, 5)); };
    await wait(1);
    expect(msgs[0].type).toBe('status');
    ws.send(JSON.stringify({ type: 'submit_order', req: { symbol: 'SPY' } }));
    await wait(2);
    expect(msgs[1].type).toBe('error');
    ws.send(JSON.stringify({ type: 'cancel_all' }));
    for (let i = 0; i < 100 && manager.handle.mock.calls.length === 0; i++) await new Promise((r) => setTimeout(r, 5));
    expect(manager.handle).toHaveBeenCalledWith({ type: 'cancel_all' });
    ws.terminate();
    await app.close();
  });
});
