import Fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import type { WebSocket } from 'ws';
import { clientMessageSchema, type ServerMessage } from '../../shared/protocol';
import type { Repo } from '../db/repo';
import type { DataSource, HelpLevel } from '../../shared/types';

export type StatusMessage = Extract<ServerMessage, { type: 'status' }>;

/** Broadcasts server messages to every connected browser tab (single user, possibly several tabs). */
export class Hub {
  readonly clients = new Set<WebSocket>();
  broadcast = (m: ServerMessage): void => {
    const data = JSON.stringify(m);
    for (const ws of this.clients) if (ws.readyState === ws.OPEN) ws.send(data);
  };
}

/** Browsers always send Origin; only pages served from this machine may drive the simulator. */
export function isLocalOrigin(origin: string | undefined): boolean {
  if (!origin) return true; // non-browser local client
  try {
    const { hostname } = new URL(origin);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
  } catch {
    return false;
  }
}

export interface ManagerLike {
  handle(msg: import('../../shared/protocol').ClientMessage): Promise<void>;
  sync(): Promise<void>;
  activeChallengeReplayId(): string | null;
}

export async function buildApp(opts: {
  hub: Hub; repo: Repo; keysOk: () => boolean; status: () => Promise<StatusMessage>; manager: () => ManagerLike;
}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(websocket);

  app.get('/api/health', async () => ({ keysOk: opts.keysOk() }));

  app.get<{ Querystring: { helpLevel?: string; dataSource?: string } }>('/api/sessions', async (req) => {
    const helpLevel = (['learn', 'challenge'] as const).find((h) => h === req.query.helpLevel) as HelpLevel | undefined;
    const dataSource = (['live', 'replay'] as const).find((d) => d === req.query.dataSource) as DataSource | undefined;
    const hidden = opts.manager().activeChallengeReplayId();
    // Never leak the replay date of a running Challenge session.
    return opts.repo.listSessions({ helpLevel, dataSource }).map((s) => (s.id === hidden ? { ...s, replayDate: null } : s));
  });

  app.get<{ Params: { id: string } }>('/api/sessions/:id/trades', async (req) => opts.repo.sessionTrades(req.params.id));

  app.get('/ws', { websocket: true }, (socket: WebSocket, req) => {
    if (!isLocalOrigin(req.headers.origin)) {
      socket.close(1008, 'Origin not allowed');
      return;
    }
    const send = (m: ServerMessage) => socket.readyState === socket.OPEN && socket.send(JSON.stringify(m));
    opts.hub.clients.add(socket);
    socket.on('close', () => opts.hub.clients.delete(socket));
    socket.on('message', async (raw) => {
      let json: unknown;
      try { json = JSON.parse(String(raw)); } catch { return send({ type: 'error', message: 'Message was not valid JSON.' }); }
      const parsed = clientMessageSchema.safeParse(json);
      if (!parsed.success) return send({ type: 'error', message: `Invalid message: ${parsed.error.issues[0]?.message ?? 'unknown'}` });
      try {
        await opts.manager().handle(parsed.data);
      } catch (e) {
        send({ type: 'error', message: (e as Error).message });
      }
    });
    void (async () => {
      send(await opts.status());
      await opts.manager().sync();
    })();
  });

  return app;
}
