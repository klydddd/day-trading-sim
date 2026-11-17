import { etTime, type TradingDay } from '../../shared/market';
import type { Bar } from '../../shared/types';

export type { TradingDay };
export const PAPER_URL = 'https://paper-api.alpaca.markets';
export const DATA_URL = 'https://data.alpaca.markets';
const MAX_ATTEMPTS = 3;

export class RateLimitError extends Error {
  constructor(url: string) { super(`Alpaca rate limit hit (HTTP 429) for ${url.split('?')[0]}`); this.name = 'RateLimitError'; }
}
export class AlpacaHttpError extends Error {
  constructor(readonly status: number, url: string, body: string) {
    super(`Alpaca HTTP ${status} for ${url.split('?')[0]}: ${body.slice(0, 200)}`);
    this.name = 'AlpacaHttpError';
  }
}

/**
 * Market data, clock and calendar only. This client never places orders:
 * it has no method that POSTs to the trading API.
 */
export class AlpacaRest {
  private readonly fetch: typeof fetch;
  constructor(private readonly opts: { keyId: string; secret: string; fetch?: typeof fetch }) {
    this.fetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async verifyKeys(): Promise<boolean> {
    try {
      await this.get(`${PAPER_URL}/v2/clock`);
      return true;
    } catch (e) {
      if (e instanceof AlpacaHttpError && (e.status === 401 || e.status === 403)) return false;
      throw e;
    }
  }

  async getClock(): Promise<{ isOpen: boolean; nextOpen: number; nextClose: number; now: number }> {
    const c = await this.get<{ timestamp: string; is_open: boolean; next_open: string; next_close: string }>(`${PAPER_URL}/v2/clock`);
    return { isOpen: c.is_open, now: Date.parse(c.timestamp), nextOpen: Date.parse(c.next_open), nextClose: Date.parse(c.next_close) };
  }

  async getCalendar(start: string, end: string): Promise<TradingDay[]> {
    const days = await this.get<Array<{ date: string; open: string; close: string }>>(`${PAPER_URL}/v2/calendar?start=${start}&end=${end}`);
    return days.map((d) => ({ date: d.date, open: etTime(d.date, d.open), close: etTime(d.date, d.close) }));
  }

  async getBars(symbol: string, start: number, end: number, feed: 'iex' | 'sip'): Promise<Bar[]> {
    const out: Bar[] = [];
    let pageToken: string | null | undefined;
    do {
      const qs = new URLSearchParams({
        timeframe: '1Min', start: new Date(start).toISOString(), end: new Date(end).toISOString(),
        feed, limit: '10000', adjustment: 'raw', sort: 'asc',
      });
      if (pageToken) qs.set('page_token', pageToken);
      const r = await this.get<{ bars: Array<{ t: string; o: number; h: number; l: number; c: number; v: number }> | null; next_page_token?: string | null }>(
        `${DATA_URL}/v2/stocks/${encodeURIComponent(symbol)}/bars?${qs}`,
      );
      for (const b of r.bars ?? []) out.push({ t: Date.parse(b.t), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v });
      pageToken = r.next_page_token;
    } while (pageToken);
    return out;
  }

  private async get<T>(url: string): Promise<T> {
    const headers = { 'APCA-API-KEY-ID': this.opts.keyId, 'APCA-API-SECRET-KEY': this.opts.secret, Accept: 'application/json' };
    for (let attempt = 1; ; attempt++) {
      const res = await this.fetch(url, { headers });
      if (res.status === 429) {
        if (attempt >= MAX_ATTEMPTS) throw new RateLimitError(url);
        const ra = Number(res.headers.get('Retry-After'));
        await sleep(Number.isFinite(ra) && res.headers.get('Retry-After') !== null ? ra * 1000 : 2000);
        continue;
      }
      if (!res.ok) throw new AlpacaHttpError(res.status, url, await res.text().catch(() => ''));
      return (await res.json()) as T;
    }
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
