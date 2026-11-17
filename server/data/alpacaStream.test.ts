import { WebSocketServer, type WebSocket } from 'ws';
import type { AddressInfo } from 'node:net';
import { AlpacaStream, type StreamStatus } from './alpacaStream';
import type { PriceEvent } from '../../shared/types';

function fakeAlpaca() {
  const wss = new WebSocketServer({ port: 0 });
  const conns: { ws: WebSocket; msgs: any[] }[] = [];
  wss.on('connection', (ws) => {
    const c = { ws, msgs: [] as any[] };
    conns.push(c);
    ws.send(JSON.stringify([{ T: 'success', msg: 'connected' }]));
    ws.on('message', (raw) => {
      const m = JSON.parse(String(raw));
      c.msgs.push(m);
      if (m.action === 'auth') ws.send(JSON.stringify([{ T: 'success', msg: 'authenticated' }]));
    });
  });
  const url = () => `ws://127.0.0.1:${(wss.address() as AddressInfo).port}`;
  return { wss, conns, url };
}
const waitFor = async (cond: () => boolean, ms = 2000) => {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 5));
  }
};

describe('AlpacaStream', () => {
  let srv: ReturnType<typeof fakeAlpaca>;
  let stream: AlpacaStream | undefined;
  beforeEach(() => { srv = fakeAlpaca(); });
  afterEach(async () => { stream?.stop(); await new Promise((r) => srv.wss.close(r)); });

  it('sends auth then subscribe, in order', async () => {
    stream = new AlpacaStream({ keyId: 'K', secret: 'S', url: srv.url() });
    stream.start(['AAPL', 'SPY']);
    await waitFor(() => srv.conns[0]?.msgs.length === 2);
    expect(srv.conns[0].msgs[0]).toEqual({ action: 'auth', key: 'K', secret: 'S' });
    expect(srv.conns[0].msgs[1]).toEqual({ action: 'subscribe', trades: ['AAPL', 'SPY'], quotes: ['AAPL', 'SPY'] });
  });

  it('maps quote and trade messages to PriceEvents', async () => {
    stream = new AlpacaStream({ keyId: 'K', secret: 'S', url: srv.url() });
    const evs: PriceEvent[] = [];
    stream.onEvent((e) => evs.push(e));
    stream.start(['AAPL']);
    await waitFor(() => srv.conns[0]?.msgs.length === 2);
    srv.conns[0].ws.send(JSON.stringify([
      { T: 'q', S: 'AAPL', bp: 187.38, ap: 187.4, bs: 1, as: 2, t: '2026-11-16T15:00:00.123456789Z' },
      { T: 't', S: 'AAPL', p: 187.39, s: 50, t: '2026-11-16T15:00:01Z' },
    ]));
    await waitFor(() => evs.length === 2);
    expect(evs[0]).toEqual({ kind: 'quote', quote: { symbol: 'AAPL', bid: 187.38, ask: 187.4, ts: Date.UTC(2026, 10, 16, 15, 0, 0, 123) } });
    expect(evs[1]).toEqual({ kind: 'print', print: { symbol: 'AAPL', price: 187.39, size: 50, ts: Date.UTC(2026, 10, 16, 15, 0, 1) } });
  });

  it('reconnects after the server drops the socket and re-subscribes', async () => {
    stream = new AlpacaStream({ keyId: 'K', secret: 'S', url: srv.url(), backoffMs: [10] });
    const statuses: StreamStatus[] = [];
    stream.onStatus((s) => statuses.push(s));
    stream.start(['AAPL']);
    await waitFor(() => statuses.includes('connected'));
    srv.conns[0].ws.close();
    await waitFor(() => srv.conns[1]?.msgs.length === 2);
    await waitFor(() => statuses.filter((s) => s === 'connected').length === 2);
    expect(statuses).toEqual(['connected', 'reconnecting', 'connected']);
    expect(srv.conns[1].msgs[1]).toEqual({ action: 'subscribe', trades: ['AAPL'], quotes: ['AAPL'] });
  });

  it('setSymbols subscribes added and unsubscribes removed symbols', async () => {
    stream = new AlpacaStream({ keyId: 'K', secret: 'S', url: srv.url() });
    stream.start(['AAPL', 'SPY']);
    await waitFor(() => srv.conns[0]?.msgs.length === 2);
    stream.setSymbols(['SPY', 'QQQ']);
    await waitFor(() => srv.conns[0].msgs.length === 4);
    expect(srv.conns[0].msgs.slice(2)).toEqual([
      { action: 'unsubscribe', trades: ['AAPL'], quotes: ['AAPL'] },
      { action: 'subscribe', trades: ['QQQ'], quotes: ['QQQ'] },
    ]);
  });

  it('start with 31 symbols throws', () => {
    stream = new AlpacaStream({ keyId: 'K', secret: 'S', url: srv.url() });
    expect(() => stream!.start(Array.from({ length: 31 }, (_, i) => `S${i}`))).toThrow();
  });
});
