import { loadConfig } from './config';

describe('loadConfig', () => {
  it('missing keys gives keysPresent:false and does not throw', () => {
    const c = loadConfig({});
    expect(c.keysPresent).toBe(false);
    expect(c.port).toBe(4100);
    expect(c.dbPath).toBe('data/sim.db');
  });
  it('reads keys when present', () => {
    const c = loadConfig({ ALPACA_KEY_ID: 'k', ALPACA_SECRET_KEY: 's' });
    expect(c).toMatchObject({ keyId: 'k', secret: 's', keysPresent: true });
  });
});
