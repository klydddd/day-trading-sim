import 'dotenv/config';
import { loadConfig } from './config';
import { openDb } from './db/db';
import { Repo } from './db/repo';
import { AlpacaRest } from './data/alpacaRest';
import { AlpacaStream, type StreamStatus } from './data/alpacaStream';
import { SessionManager, type SessionDeps } from './session/sessionManager';
import { buildApp, Hub, type StatusMessage } from './api/ws';
import { etDate, marketPhase, type TradingDay } from '../shared/market';
import { DEFAULT_RULES, DEFAULT_WATCHLIST } from '../shared/types';

const cfg = loadConfig(process.env);
const repo = new Repo(openDb(cfg.dbPath));
const hub = new Hub();

const missingKeys = async (): Promise<never> => { throw new Error('Alpaca API keys are missing. Add them to .env and restart.'); };
const rest: SessionDeps['rest'] = cfg.keysPresent
  ? new AlpacaRest({ keyId: cfg.keyId!, secret: cfg.secret! })
  : { getClock: missingKeys, getCalendar: missingKeys, getBars: missingKeys };

let keysOk = false;
if (cfg.keysPresent) {
  try {
    keysOk = await (rest as AlpacaRest).verifyKeys();
    if (!keysOk) console.error('Alpaca rejected the API keys in .env (HTTP 401/403).');
  } catch (e) {
    keysOk = true; // keys present but Alpaca unreachable: don't send the user to key setup for a network problem
    console.warn(`Could not reach Alpaca to verify keys: ${(e as Error).message}`);
  }
}

const stream = keysOk ? new AlpacaStream({ keyId: cfg.keyId!, secret: cfg.secret! }) : undefined;
let dataStatus: StreamStatus = 'disconnected';

let market: StatusMessage['market'] = { phase: 'closed', isOpen: false, nextOpen: 0, nextClose: 0 };
let today: TradingDay | undefined;
async function refreshMarket() {
  if (!keysOk) return;
  try {
    const c = await rest.getClock();
    const d = etDate(c.now);
    if (today?.date !== d) today = (await rest.getCalendar(d, d))[0];
    market = { phase: marketPhase(c.now, today), isOpen: c.isOpen, nextOpen: c.nextOpen, nextClose: c.nextClose };
  } catch (e) {
    console.warn(`Market clock refresh failed: ${(e as Error).message}`);
  }
}
await refreshMarket();

const status = async (): Promise<StatusMessage> => ({
  type: 'status', keysOk, market, data: dataStatus,
  settings: {
    rules: repo.getSetting('rules', DEFAULT_RULES),
    watchlist: repo.getSetting('watchlist', DEFAULT_WATCHLIST),
    feePerShare: repo.getSetting('feePerShare', 0),
    walkthroughDone: repo.getSetting('walkthroughDone', false),
  },
});
const broadcastStatus = async () => hub.broadcast(await status());

const deps: SessionDeps = {
  repo, rest, liveStream: stream, send: hub.broadcast, now: Date.now,
  setInterval: (fn, ms) => { const h = setInterval(fn, ms); return () => clearInterval(h); },
};
const manager = (await SessionManager.restore(deps)) ?? new SessionManager(deps);

stream?.onEvent((ev) => manager.onPrice(ev));
stream?.onStatus((s) => { dataStatus = s; void broadcastStatus(); });
setInterval(() => { void refreshMarket().then(broadcastStatus); }, 60_000);

const app = await buildApp({ hub, repo, keysOk: () => keysOk, status, manager: () => manager });
await app.listen({ port: cfg.port, host: '127.0.0.1' });
console.log(`Day trading simulator server on http://127.0.0.1:${cfg.port} (keys ${keysOk ? 'OK' : 'missing/invalid'})`);

const shutdown = async () => {
  manager.dispose();
  stream?.stop();
  await app.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
