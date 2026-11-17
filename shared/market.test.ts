import { formatChartTime, marketPhase, marketStatusLabel } from './market';

const day = { date: '2026-11-16', open: Date.UTC(2026, 10, 16, 14, 30), close: Date.UTC(2026, 10, 16, 21) };

describe('market helpers', () => {
  it('marketStatusLabel on a Saturday says it opens Monday', () => {
    const sat = Date.UTC(2026, 10, 14, 17); // Sat Nov 14 2026 12:00 ET
    expect(marketStatusLabel(false, Date.UTC(2026, 10, 16, 14, 30), sat)).toBe('Market closed, opens Mon 9:30am ET');
  });
  it('marketStatusLabel when open shows the close time', () => {
    expect(marketStatusLabel(true, Date.UTC(2026, 10, 16, 21), Date.UTC(2026, 10, 16, 16))).toBe('Market open, closes 4:00pm ET');
  });
  it('marketStatusLabel says today when it opens later today', () => {
    expect(marketStatusLabel(false, Date.UTC(2026, 10, 16, 14, 30), Date.UTC(2026, 10, 16, 12))).toBe('Market closed, opens today 9:30am ET');
  });
  it('marketPhase', () => {
    expect(marketPhase(Date.UTC(2026, 10, 16, 12), day)).toBe('pre');
    expect(marketPhase(Date.UTC(2026, 10, 16, 15), day)).toBe('open');
    expect(marketPhase(Date.UTC(2026, 10, 16, 21), day)).toBe('closed');
    expect(marketPhase(Date.UTC(2026, 10, 16, 15))).toBe('closed');
  });
  it('formatChartTime hides the date when asked', () => {
    const ts = Date.UTC(2026, 10, 14, 15, 42);
    expect(formatChartTime(ts, true)).toBe('10:42');
    expect(formatChartTime(ts, true)).not.toMatch(/Nov|14/);
    expect(formatChartTime(ts, false)).toBe('Nov 14 10:42');
  });
});
