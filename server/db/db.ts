import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type Db = Database.Database;

const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, config TEXT NOT NULL, replay_date TEXT, status TEXT NOT NULL,
  end_reason TEXT, started_at INTEGER NOT NULL, ended_at INTEGER, sim_ts INTEGER,
  snapshot TEXT, overrides TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS trades (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), symbol TEXT NOT NULL,
  opened_at INTEGER NOT NULL, closed_at INTEGER, pnl REAL NOT NULL, data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS trades_session ON trades(session_id);
`;

/** Open (creating if needed) the SQLite database and apply the schema. */
export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  const version = db.pragma('user_version', { simple: true }) as number;
  if (version < 1) {
    db.exec(SCHEMA_V1);
    db.pragma('user_version = 1');
  }
  return db;
}
