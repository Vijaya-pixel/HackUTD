// Postgres storage for the scam drill: opted-in participants, the drill
// messages we send them, and whether they clicked (fell for it).
// Tables are created on first use. Needs DATABASE_URL in .env.

import pg from "pg";
import { randomBytes } from "node:crypto";

const { DATABASE_URL } = process.env;
export const drillDbConfigured = Boolean(DATABASE_URL);

// Certificate checking stays ON by default. Fresh Tiger Cloud services use a
// self-signed cert for ~30 min; until the signed one arrives you can set
// DB_SSL_NO_VERIFY=true (encrypted, but the server's identity is not checked).
// Remove that flag as soon as possible.
const noVerify = process.env.DB_SSL_NO_VERIFY === "true";
const connectionString = noVerify && DATABASE_URL
  ? DATABASE_URL.replace(/([?&])sslmode=[^&]*&?/, "$1").replace(/[?&]$/, "")
  : DATABASE_URL;

const pool = drillDbConfigured
  ? new pg.Pool({
    connectionString,
    ...(noVerify ? { ssl: { rejectUnauthorized: false } } : {}),
    max: 4,
    idleTimeoutMillis: 30_000,
  })
  : null;
if (noVerify) console.warn("DB_SSL_NO_VERIFY is on: database certificate is NOT being verified.");

let ready = null;
function init() {
  if (!pool) throw new Error("DATABASE_URL is not set");
  ready ??= pool.query(`
    CREATE TABLE IF NOT EXISTS drill_users (
      id          SERIAL PRIMARY KEY,
      handle      TEXT UNIQUE NOT NULL,          -- phone (E.164) or iMessage email
      name        TEXT NOT NULL,
      preferences JSONB NOT NULL DEFAULT '{}',   -- e.g. {"bank":"Chase","carrier":"T-Mobile","shops":["Amazon"]}
      consent     BOOLEAN NOT NULL DEFAULT FALSE,
      consent_at  TIMESTAMPTZ,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS drill_messages (
      id          SERIAL PRIMARY KEY,
      user_id     INTEGER NOT NULL REFERENCES drill_users(id) ON DELETE CASCADE,
      token       TEXT UNIQUE NOT NULL,
      scenario    TEXT NOT NULL,
      body        TEXT NOT NULL,
      red_flags   JSONB NOT NULL DEFAULT '[]',
      status      TEXT NOT NULL DEFAULT 'sent',  -- sent | simulated
      sent_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      clicked_at  TIMESTAMPTZ,
      debriefed_at TIMESTAMPTZ
    );
    -- One row per live scripted conversation (AI-written scam drill chat).
    -- history holds the full back-and-forth so the LLM has context on every
    -- turn. link_sent flips once the model has dropped the drill link.
    CREATE TABLE IF NOT EXISTS drill_conversations (
      id            SERIAL PRIMARY KEY,
      user_id       INTEGER NOT NULL REFERENCES drill_users(id) ON DELETE CASCADE,
      scenario      TEXT NOT NULL,
      history       JSONB NOT NULL DEFAULT '[]', -- [{role:"assistant"|"user", text, at}]
      link_sent     BOOLEAN NOT NULL DEFAULT FALSE,
      finished      BOOLEAN NOT NULL DEFAULT FALSE,
      message_token TEXT,                   -- drill_messages token once the link is sent
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS one_active_conversation_per_user_scenario
      ON drill_conversations (user_id, scenario) WHERE NOT finished;
  `).then(() => undefined);
  return ready;
}

async function q(text, params) {
  await init();
  return pool.query(text, params);
}

export async function upsertUser({ handle, name, preferences = {}, consent }) {
  const r = await q(
    `INSERT INTO drill_users (handle, name, preferences, consent, consent_at)
     VALUES ($1, $2, $3, $4, CASE WHEN $4 THEN now() END)
     ON CONFLICT (handle) DO UPDATE
       SET name = EXCLUDED.name, preferences = EXCLUDED.preferences,
           consent = EXCLUDED.consent,
           consent_at = CASE WHEN EXCLUDED.consent THEN COALESCE(drill_users.consent_at, now()) END
     RETURNING *`,
    [handle, name, JSON.stringify(preferences), Boolean(consent)],
  );
  return r.rows[0];
}

// Only users who explicitly opted in are ever returned for sending.
export async function consentedUsers(handle) {
  const r = await q(
    `SELECT * FROM drill_users WHERE consent = TRUE ${handle ? "AND handle = $1" : ""} ORDER BY id`,
    handle ? [handle] : [],
  );
  return r.rows;
}

export async function recordMessage({ userId, scenario, body, redFlags, status }) {
  const token = randomBytes(9).toString("base64url");
  const r = await q(
    `INSERT INTO drill_messages (user_id, token, scenario, body, red_flags, status)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [userId, token, scenario, body, JSON.stringify(redFlags), status],
  );
  return r.rows[0];
}

export async function markStatus(token, body, status) {
  await q(`UPDATE drill_messages SET body = $2, status = $3 WHERE token = $1`, [token, body, status]);
}

export async function getByToken(token) {
  const r = await q(`SELECT * FROM drill_messages WHERE token = $1`, [token]);
  return r.rows[0] || null;
}

export async function markDebriefed(token) {
  await q(`UPDATE drill_messages SET debriefed_at = COALESCE(debriefed_at, now()) WHERE token = $1`, [token]);
}

export async function markClicked(token) {
  const r = await q(
    `UPDATE drill_messages SET clicked_at = COALESCE(clicked_at, now()) WHERE token = $1 RETURNING *`,
    [token],
  );
  return r.rows[0] || null;
}

// ---------- AI-written scam drill conversations ----------

export async function startConversation({ userId, scenario, history }) {
  const r = await q(
    `INSERT INTO drill_conversations (user_id, scenario, history) VALUES ($1, $2, $3) RETURNING *`,
    [userId, scenario, JSON.stringify(history)],
  );
  return r.rows[0];
}

export async function getConversation(userId, scenario) {
  const r = await q(
    `SELECT * FROM drill_conversations WHERE user_id = $1 AND scenario = $2 AND finished = FALSE`,
    [userId, scenario],
  );
  return r.rows[0] || null;
}

export async function findActiveConversationByHandle(handle) {
  const r = await q(
    `SELECT c.*, u.handle, u.name, u.preferences
       FROM drill_conversations c JOIN drill_users u ON u.id = c.user_id
      WHERE u.handle = $1 AND c.finished = FALSE
      ORDER BY c.id DESC LIMIT 1`,
    [handle],
  );
  return r.rows[0] || null;
}

export async function appendHistory(id, history) {
  await q(`UPDATE drill_conversations SET history = $2, updated_at = now() WHERE id = $1`, [id, JSON.stringify(history)]);
}

export async function markLinkSent(id, messageToken) {
  await q(`UPDATE drill_conversations SET link_sent = TRUE, message_token = $2, updated_at = now() WHERE id = $1`, [id, messageToken]);
}

export async function finishConversation(id) {
  await q(`UPDATE drill_conversations SET finished = TRUE, updated_at = now() WHERE id = $1`, [id]);
}

export async function results() {
  const r = await q(
    `SELECT u.name, m.scenario, m.status, m.sent_at, m.clicked_at, (m.clicked_at IS NOT NULL) AS fell_for_it
       FROM drill_messages m JOIN drill_users u ON u.id = m.user_id
      ORDER BY m.sent_at DESC LIMIT 200`,
  );
  return r.rows;
}
