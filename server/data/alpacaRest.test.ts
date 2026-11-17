import { AlpacaRest, RateLimitError } from './alpacaRest';

type Call = { url: string; headers: Record<string, string> };
function fakeFetch(responses: Array<{ status: number; body?: unknown; headers?: Record<string, string> }>) {
  const calls: Call[] = [];
  const fn = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string> });
    const r = responses.shift() ?? { status: 500 };
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status, headers: r.headers });
  }) as typeof fetch;
  return { fn, calls };
}
const mk = (f: typeof fetch) => new AlpacaRest({ keyId: 'K', secret: 'S', fetch: f });

describe('AlpacaRest', () => {
  it('sends auth headers and follows next_page_token across pages', async () => {
    const { fn, calls } = fakeFetch([
      { status: 200, body: { bars: [{ t: '2026-11-16T14:30:00Z', o: 1, h: 2, l: 0.5, c: 1.5, v: 100 }], next_page_token: 'abc' } },
      { status: 200, body: { bars: [{ t: '2026-11-16T14:31:00Z', o: 1.5, h: 2, l: 1, c: 2, v: 50 }], next_page_token: null } },
    ]);
    const bars = await mk(fn).getBars('AAPL', Date.UTC(2026, 10, 16, 14, 30), Date.UTC(2026, 10, 16, 21), 'sip');
    expect(bars).toEqual([
      { t: Date.UTC(2026, 10, 16, 14, 30), o: 1, h: 2, l: 0.5, c: 1.5, v: 100 },
      { t: Date.UTC(2026, 10, 16, 14, 31), o: 1.5, h: 2, l: 1, c: 2, v: 50 },
    ]);
    expect(calls[0].url).toContain('https://data.alpaca.markets/v2/stocks/AAPL/bars?');
    expect(calls[0].url).toContain('timeframe=1Min');
    expect(calls[0].url).toContain('feed=sip');
    expect(calls[1].url).toContain('page_token=abc');
    expect(calls[0].headers).toMatchObject({ 'APCA-API-KEY-ID': 'K', 'APCA-API-SECRET-KEY': 'S' });
  });

  it('retries after a 429 and then succeeds', async () => {
    const { fn, calls } = fakeFetch([
      { status: 429, headers: { 'Retry-After': '0' } },
      { status: 200, body: { timestamp: '2026-11-16T10:00:00-05:00', is_open: true, next_open: '2026-11-17T09:30:00-05:00', next_close: '2026-11-16T16:00:00-05:00' } },
    ]);
    const c = await mk(fn).getClock();
    expect(calls).toHaveLength(2);
    expect(c).toEqual({ isOpen: true, now: Date.UTC(2026, 10, 16, 15), nextOpen: Date.UTC(2026, 10, 17, 14, 30), nextClose: Date.UTC(2026, 10, 16, 21) });
  });

  it('throws RateLimitError after three 429s', async () => {
    const r429 = { status: 429, headers: { 'Retry-After': '0' } };
    const { fn, calls } = fakeFetch([r429, r429, r429, r429]);
    await expect(mk(fn).getClock()).rejects.toBeInstanceOf(RateLimitError);
    expect(calls).toHaveLength(3);
  });

  it('parses a half-day calendar close to 13:00 ET', async () => {
    const { fn, calls } = fakeFetch([{ status: 200, body: [{ date: '2026-11-27', open: '09:30', close: '13:00' }] }]);
    const days = await mk(fn).getCalendar('2026-11-27', '2026-11-27');
    expect(days).toEqual([{ date: '2026-11-27', open: Date.UTC(2026, 10, 27, 14, 30), close: Date.UTC(2026, 10, 27, 18) }]);
    expect(calls[0].url).toBe('https://paper-api.alpaca.markets/v2/calendar?start=2026-11-27&end=2026-11-27');
  });

  it('verifyKeys is false on 401/403 and true on 200', async () => {
    expect(await mk(fakeFetch([{ status: 401 }]).fn).verifyKeys()).toBe(false);
    expect(await mk(fakeFetch([{ status: 403 }]).fn).verifyKeys()).toBe(false);
    expect(await mk(fakeFetch([{ status: 200, body: { timestamp: '2026-11-16T10:00:00-05:00', is_open: true, next_open: '2026-11-17T09:30:00-05:00', next_close: '2026-11-16T16:00:00-05:00' } }]).fn).verifyKeys()).toBe(true);
  });
});
