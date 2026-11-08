import { sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { mkdirSync, readFileSync } from "fs";
import * as schema from "./schema.js";

/**
 * Database client.
 *
 *  - DATABASE_URL set   → TigerData (Timescale Cloud) / any Postgres via `pg`.
 *                         `messages` becomes a hypertable when the timescaledb
 *                         extension is available.
 *  - DATABASE_URL unset → PGlite, an embedded Postgres (WASM, no native build),
 *                         persisted under DATABASE_PATH (default ./data/pglite).
 *
 * Both paths speak the same SQL and the same Drizzle pg-core API, so the rest of
 * the server does not know which one it is talking to.
 */

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface DbInfo {
  driver: "tigerdata" | "pglite";
  hypertable: boolean;
  host?: string;
  ssl?: "verify-ca" | "system-ca" | "off";
}

let _db: Db | null = null;
let _init: Promise<Db> | null = null;
let _info: DbInfo = { driver: "pglite", hypertable: false };

export function getDbInfo(): DbInfo {
  return _info;
}

export function getDb(): Promise<Db> {
  if (_db) return Promise.resolve(_db);
  if (!_init) _init = init();
  return _init;
}

async function init(): Promise<Db> {
  const url = process.env["DATABASE_URL"];
  let db: Db;

  if (url) {
    const { Pool } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const host = safeHost(url);
    const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(host);
    const sslEnv = process.env["DATABASE_SSL"];
    const ssl = sslEnv ? sslEnv !== "false" : !isLocal;
    // Tiger Cloud signs its servers with a private CA (CN=ca.timescale.com) that is
    // not in Node's bundled trust store. Point DATABASE_SSL_CA at the CA .pem from
    // the Tiger Cloud console to verify the chain properly instead of disabling it.
    const caPath = process.env["DATABASE_SSL_CA"];
    const ca = caPath ? readFileSync(caPath, "utf8") : undefined;
    // `pg` lets sslmode=... in the URL override an explicit `ssl` object, which
    // would drop our pinned CA. Strip the libpq-only params and configure SSL here.
    const cleaned = new URL(url);
    for (const k of ["sslmode", "sslrootcert", "sslcert", "sslkey", "uselibpqcompat"]) cleaned.searchParams.delete(k);
    const pool = new Pool({
      connectionString: cleaned.toString(),
      ssl: ssl
        ? {
            ca,
            rejectUnauthorized: process.env["DATABASE_SSL_STRICT"] !== "false",
          }
        : undefined,
      max: Number(process.env["DATABASE_POOL_MAX"] ?? 5),
    });
    db = drizzle(pool, { schema }) as unknown as Db;
    _info = { driver: "tigerdata", hypertable: false, host, ssl: ssl ? (ca ? "verify-ca" : "system-ca") : "off" };
  } else {
    const { PGlite } = await import("@electric-sql/pglite");
    const { drizzle } = await import("drizzle-orm/pglite");
    const dir = process.env["DATABASE_PATH"] ?? "./data/pglite";
    mkdirSync(dir, { recursive: true });
    const client = new PGlite(dir);
    await client.waitReady;
    db = drizzle(client, { schema }) as unknown as Db;
    _info = { driver: "pglite", hypertable: false };
  }

  await runMigrations(db);
  _db = db;
  return db;
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

const MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    phone TEXT NOT NULL UNIQUE,
    name TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS consents (
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
    active BOOLEAN NOT NULL DEFAULT TRUE
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
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
    expires_at TEXT NOT NULL,
    ts TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS messages (
    id TEXT NOT NULL,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    role TEXT NOT NULL,
    redacted_text TEXT NOT NULL,
    stage_at_send TEXT NOT NULL,
    red_flags_json TEXT NOT NULL DEFAULT '[]',
    sent_at TEXT NOT NULL,
    ts TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (id, ts)
  )`,
  `CREATE TABLE IF NOT EXISTS skills_stats (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    category TEXT NOT NULL,
    times_encountered INTEGER NOT NULL DEFAULT 0,
    times_caught INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)`,
  `CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, ts)`,
  `CREATE INDEX IF NOT EXISTS idx_skills_user ON skills_stats(user_id)`,
];

async function runMigrations(db: Db): Promise<void> {
  for (const stmt of MIGRATIONS) {
    await db.execute(sql.raw(stmt));
  }

  // TigerData: turn `messages` into a hypertable partitioned by `ts`.
  // Silently skipped where the timescaledb extension is unavailable (PGlite,
  // vanilla Postgres), so the same code runs everywhere.
  try {
    await db.execute(sql.raw(`CREATE EXTENSION IF NOT EXISTS timescaledb`));
    await db.execute(
      sql.raw(`SELECT create_hypertable('messages', 'ts', if_not_exists => TRUE, migrate_data => TRUE)`)
    );
    _info = { ..._info, hypertable: true };
  } catch {
    _info = { ..._info, hypertable: false };
  }
}
