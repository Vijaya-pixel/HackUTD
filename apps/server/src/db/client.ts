import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "fs";
import { dirname } from "path";
import * as schema from "./schema.js";

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb() {
  if (!_db) {
    const dbPath = process.env["DATABASE_PATH"] ?? "./data/safesignal.db";
    mkdirSync(dirname(dbPath), { recursive: true });
    const sqlite = new Database(dbPath);
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");
    _db = drizzle(sqlite, { schema });
    runMigrations(sqlite);
  }
  return _db;
}

function runMigrations(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      phone TEXT NOT NULL UNIQUE,
      name TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS consents (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      phone TEXT NOT NULL,
      channel TEXT NOT NULL,
      interests TEXT NOT NULL,
      quiet_hours_start INTEGER,
      quiet_hours_end INTEGER,
      max_per_day INTEGER NOT NULL DEFAULT 1,
      consent_version TEXT NOT NULL DEFAULT '1.0',
      consent_at TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      scenario_id TEXT NOT NULL,
      channel TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'created',
      current_stage_index INTEGER NOT NULL DEFAULT 0,
      token TEXT NOT NULL UNIQUE,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      outcome TEXT,
      lesson_json TEXT,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      role TEXT NOT NULL,
      redacted_text TEXT NOT NULL,
      stage_at_send TEXT NOT NULL,
      red_flags_json TEXT NOT NULL DEFAULT '[]',
      sent_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS skills_stats (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      category TEXT NOT NULL,
      times_encountered INTEGER NOT NULL DEFAULT 0,
      times_caught INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
    CREATE INDEX IF NOT EXISTS idx_skills_user ON skills_stats(user_id);
  `);
}
