import WebSocket from 'ws';
import { MAX_WATCHLIST, type PriceEvent } from '../../shared/types';

export type StreamStatus = 'connected' | 'reconnecting' | 'disconnected';
const DEFAULT_URL = 'wss://stream.data.alpaca.markets/v2/iex';
const DEFAULT_BACKOFF = [1000, 2000, 4000, 8000, 16000, 30000];

type AlpacaMsg =
  | { T: 'success'; msg: string }
  | { T: 'error'; code: number; msg: string }
  | { T: 'q'; S: string; bp: number; ap: number; t: string }
  | { T: 't'; S: string; p: number; s: number; t: string }
  | { T: string };

/** Alpaca's free IEX real-time stream, with auth, subscription diffing and reconnect-with-backoff. */
export class AlpacaStream {
  private ws?: WebSocket;
  private symbols = new Set<string>();
  private authed = false;
  private stopped = true;
  private attempt = 0;
  private timer?: NodeJS.Timeout;
  private status: StreamStatus = 'disconnected';
  private eventCbs: ((e: PriceEvent) => void)[] = [];
  private statusCbs: ((s: StreamStatus) => void)[] = [];
  private readonly url: string;
  private readonly backoff: number[];

  constructor(private readonly opts: { keyId: string; secret: string; url?: string; backoffMs?: number[] }) {
    this.url = opts.url ?? DEFAULT_URL;
    this.backoff = opts.backoffMs?.length ? opts.backoffMs : DEFAULT_BACKOFF;
  }

  start(symbols: string[]): void {
    if (symbols.length > MAX_WATCHLIST) throw new Error(`Alpaca's free stream allows at most ${MAX_WATCHLIST} symbols`);
    this.symbols = new Set(symbols.map((s) => s.toUpperCase()));
    this.stopped = false;
    this.connect();
  }

  setSymbols(symbols: string[]): void {
    if (symbols.length > MAX_WATCHLIST) throw new Error(`Alpaca's free stream allows at most ${MAX_WATCHLIST} symbols`);
    const next = new Set(symbols.map((s) => s.toUpperCase()));
    const removed = [...this.symbols].filter((s) => !next.has(s));
    const added = [...next].filter((s) => !this.symbols.has(s));
    this.symbols = next;
    if (!this.authed) return;
    if (removed.length) this.send({ action: 'unsubscribe', trades: removed, quotes: removed });
    if (added.length) this.send({ action: 'subscribe', trades: added, quotes: added });
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.timer);
    this.authed = false;
    const ws = this.ws;
    this.ws = undefined;
    if (ws) {
      ws.removeAllListeners();
      ws.on('error', () => {});
      ws.terminate();
    }
    this.setStatus('disconnected');
  }

  onEvent(cb: (e: PriceEvent) => void): void { this.eventCbs.push(cb); }
  onStatus(cb: (s: StreamStatus) => void): void { this.statusCbs.push(cb); }

  private connect() {
    const ws = new WebSocket(this.url);
    this.ws = ws;
    this.authed = false;
    ws.on('open', () => this.send({ action: 'auth', key: this.opts.keyId, secret: this.opts.secret }));
    ws.on('message', (raw) => this.onMessage(String(raw)));
    ws.on('error', () => { /* 'close' follows; reconnect happens there */ });
    ws.on('close', () => {
      if (this.ws !== ws) return;
      this.authed = false;
      if (this.stopped) return;
      this.setStatus('reconnecting');
      const delay = this.backoff[Math.min(this.attempt, this.backoff.length - 1)];
      this.attempt++;
      this.timer = setTimeout(() => { if (!this.stopped) this.connect(); }, delay);
    });
  }

  private onMessage(raw: string) {
    let msgs: AlpacaMsg[];
    try {
      const parsed = JSON.parse(raw);
      msgs = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return;
    }
    for (const m of msgs) {
      if (m.T === 'success' && (m as { msg: string }).msg === 'authenticated') {
        this.authed = true;
        this.attempt = 0;
        const syms = [...this.symbols];
        if (syms.length) this.send({ action: 'subscribe', trades: syms, quotes: syms });
        this.setStatus('connected');
      } else if (m.T === 'q') {
        const q = m as Extract<AlpacaMsg, { T: 'q' }>;
        this.emit({ kind: 'quote', quote: { symbol: q.S, bid: q.bp, ask: q.ap, ts: Date.parse(q.t) } });
      } else if (m.T === 't') {
        const t = m as Extract<AlpacaMsg, { T: 't' }>;
        this.emit({ kind: 'print', print: { symbol: t.S, price: t.p, size: t.s, ts: Date.parse(t.t) } });
      } else if (m.T === 'error') {
        const e = m as Extract<AlpacaMsg, { T: 'error' }>;
        console.warn(`[alpaca stream] error ${e.code}: ${e.msg}`);
      }
    }
  }

  private emit(e: PriceEvent) {
    if (!Number.isFinite(e.kind === 'quote' ? e.quote.ts : e.print.ts)) return;
    for (const cb of this.eventCbs) cb(e);
  }

  private send(m: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  private setStatus(s: StreamStatus) {
    if (s === this.status) return;
    this.status = s;
    for (const cb of this.statusCbs) cb(s);
  }
}
