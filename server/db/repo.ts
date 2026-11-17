import type { Db } from './db';
import type { DataSource, EndReason, HelpLevel, RuleBreak, SessionConfig, Trade } from '../../shared/types';

export interface SessionRow {
  id: string; config: SessionConfig; replayDate: string | null; startedAt: number;
  endedAt: number | null; endReason: EndReason | null; pnl: number; tradeCount: number;
}
export interface ActiveSession { id: string; config: SessionConfig; replayDate: string | null; snapshot: unknown; simTs: number | null }

export class Repo {
  constructor(private readonly db: Db) {}

  getSetting<T>(key: string, fallback: T): T {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    if (!row) return fallback;
    try { return JSON.parse(row.value) as T; } catch { return fallback; }
  }

  setSetting(key: string, v: unknown): void {
    this.db.prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, JSON.stringify(v));
  }

  createSession(id: string, config: SessionConfig, replayDate: string | null, startedAt: number): void {
    this.db.prepare(`INSERT INTO sessions(id, config, replay_date, status, started_at) VALUES (?, ?, ?, 'active', ?)`)
      .run(id, JSON.stringify(config), replayDate, startedAt);
  }

  saveSnapshot(id: string, snapshot: unknown, simTs: number | null): void {
    this.db.prepare('UPDATE sessions SET snapshot = ?, sim_ts = ? WHERE id = ?').run(JSON.stringify(snapshot), simTs, id);
  }

  endSession(id: string, reason: EndReason, endedAt: number): void {
    this.db.prepare(`UPDATE sessions SET status = 'ended', end_reason = ?, ended_at = ? WHERE id = ?`).run(reason, endedAt, id);
  }

  addOverride(id: string, o: RuleBreak): void {
    const list = this.overrides(id);
    list.push(o);
    this.db.prepare('UPDATE sessions SET overrides = ? WHERE id = ?').run(JSON.stringify(list), id);
  }

  overrides(id: string): RuleBreak[] {
    const row = this.db.prepare('SELECT overrides FROM sessions WHERE id = ?').get(id) as { overrides: string } | undefined;
    return row ? (JSON.parse(row.overrides) as RuleBreak[]) : [];
  }

  activeSession(): ActiveSession | null {
    const row = this.db.prepare(`SELECT id, config, replay_date, snapshot, sim_ts FROM sessions WHERE status = 'active' ORDER BY started_at DESC LIMIT 1`)
      .get() as { id: string; config: string; replay_date: string | null; snapshot: string | null; sim_ts: number | null } | undefined;
    if (!row) return null;
    return {
      id: row.id, config: JSON.parse(row.config), replayDate: row.replay_date,
      snapshot: row.snapshot ? JSON.parse(row.snapshot) : null, simTs: row.sim_ts,
    };
  }

  saveTrade(t: Trade): void {
    this.db.prepare(`INSERT INTO trades(id, session_id, symbol, opened_at, closed_at, pnl, data) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET closed_at = excluded.closed_at, pnl = excluded.pnl, data = excluded.data`)
      .run(t.id, t.sessionId, t.symbol, t.openedAt, t.closedAt ?? null, t.pnl, JSON.stringify(t));
  }

  sessionTrades(id: string): Trade[] {
    const rows = this.db.prepare('SELECT data FROM trades WHERE session_id = ? ORDER BY opened_at, rowid').all(id) as { data: string }[];
    return rows.map((r) => JSON.parse(r.data) as Trade);
  }

  getTrade(id: string): Trade | null {
    const row = this.db.prepare('SELECT data FROM trades WHERE id = ?').get(id) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as Trade) : null;
  }

  getSession(id: string): SessionRow | null {
    return this.listSessions().find((s) => s.id === id) ?? null;
  }

  listSessions(filter: { helpLevel?: HelpLevel; dataSource?: DataSource } = {}): SessionRow[] {
    const rows = this.db.prepare(`
      SELECT s.id, s.config, s.replay_date, s.started_at, s.ended_at, s.end_reason,
        COALESCE(SUM(CASE WHEN t.closed_at IS NOT NULL THEN t.pnl END), 0) AS pnl,
        COUNT(t.closed_at) AS trade_count
      FROM sessions s LEFT JOIN trades t ON t.session_id = s.id
      GROUP BY s.id ORDER BY s.started_at`).all() as Array<{
        id: string; config: string; replay_date: string | null; started_at: number; ended_at: number | null;
        end_reason: EndReason | null; pnl: number; trade_count: number;
      }>;
    return rows
      .map((r) => ({
        id: r.id, config: JSON.parse(r.config) as SessionConfig, replayDate: r.replay_date, startedAt: r.started_at,
        endedAt: r.ended_at, endReason: r.end_reason, pnl: Math.round(r.pnl * 100) / 100, tradeCount: r.trade_count,
      }))
      .filter((s) => (!filter.helpLevel || s.config.helpLevel === filter.helpLevel)
        && (!filter.dataSource || s.config.dataSource === filter.dataSource));
  }
}
