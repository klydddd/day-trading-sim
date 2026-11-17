import { roundCents, fmtUsd, fmtPct } from './money';

describe('money', () => {
  it('roundCents rounds half up at the cent', () => {
    expect(roundCents(1.005)).toBe(1.01);
    expect(roundCents(21252.0000001)).toBe(21252);
  });
  it('fmtUsd formats with grouping and sign', () => {
    expect(fmtUsd(3748, 0)).toBe('$3,748');
    expect(fmtUsd(-12.5)).toBe('-$12.50');
  });
  it('fmtPct formats a fraction as a percent', () => {
    expect(fmtPct(28 / 25000)).toBe('0.1%');
  });
});
