export interface AppConfig { keyId?: string; secret?: string; keysPresent: boolean; port: number; dbPath: string }

export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  const keyId = env.ALPACA_KEY_ID?.trim() || undefined;
  const secret = env.ALPACA_SECRET_KEY?.trim() || undefined;
  const port = Number(env.PORT) > 0 ? Number(env.PORT) : 4100;
  return { keyId, secret, keysPresent: Boolean(keyId && secret), port, dbPath: env.DB_PATH || 'data/sim.db' };
}
