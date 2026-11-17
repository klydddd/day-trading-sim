import { ema, vwap } from './indicators';

describe('ema', () => {
  it('is seeded with the SMA of the first period values', () => {
    const r = ema([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3);
    expect(r[0]).toBeUndefined();
    expect(r[1]).toBeUndefined();
    expect(r[2]).toBe(2);
    expect(r[9]).toBe(9);
  });
});

describe('vwap', () => {
  it('is cumulative typical-price VWAP', () => {
    expect(vwap([{ t: 0, o: 10, h: 10, l: 10, c: 10, v: 100 }, { t: 60000, o: 20, h: 20, l: 20, c: 20, v: 300 }])).toEqual([10, 17.5]);
  });
});
