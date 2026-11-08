// Scam voice database.
//
// voice_profiles  one row per reported scam caller ("Scam caller #3")
// voice_samples   voiceprints (256 numbers each) for a profile; never audio
// voice_numbers   phone numbers a profile was reported calling from
// voice_matches   every time the voice was recognized on a later call
//
// Privacy: only voices that a customer reported (or that a team member
// enrolled on purpose) are stored. Profiles expire after RETENTION_DAYS.

import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const RETENTION_DAYS = 90;
const MAX_SAMPLES = 20;
// Tested with synthetic calls: same voice on a new number scored 0.87-0.95,
// a different voice saying the same script scored 0.44-0.66.
export const MATCH_THRESHOLD = Number(process.env.VOICE_MATCH_THRESHOLD) || 0.7;

const dataDir = fileURLToPath(new URL("../data/", import.meta.url));
mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(join(dataDir, "voices.db"));

db.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS voice_profiles (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    scam_type TEXT NOT NULL,
    reports INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    last_seen TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS voice_samples (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id TEXT NOT NULL REFERENCES voice_profiles(id) ON DELETE CASCADE,
    embedding TEXT NOT NULL,
    seconds REAL NOT NULL,
    source TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS voice_numbers (
    profile_id TEXT NOT NULL REFERENCES voice_profiles(id) ON DELETE CASCADE,
    number TEXT NOT NULL,
    first_seen TEXT NOT NULL,
    last_seen TEXT NOT NULL,
    times INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (profile_id, number)
  );
  CREATE TABLE IF NOT EXISTS voice_matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id TEXT NOT NULL REFERENCES voice_profiles(id) ON DELETE CASCADE,
    number TEXT NOT NULL,
    similarity REAL NOT NULL,
    at TEXT NOT NULL
  );
`);

// Added later: flag for callers the customer marked as an AI-generated voice.
try {
  db.exec("ALTER TABLE voice_profiles ADD COLUMN ai_voice INTEGER NOT NULL DEFAULT 0");
} catch { /* column already exists */ }

const now = () => new Date().toISOString();
const expiry = () => new Date(Date.now() + RETENTION_DAYS * 864e5).toISOString();

export function normalizeNumber(n) {
  const s = String(n || "").replace(/[^\d+]/g, "").slice(0, 16);
  if (!s) return "unknown";
  if (s.startsWith("+")) return s;
  if (s.length === 10) return `+1${s}`;
  if (s.length === 11 && s.startsWith("1")) return `+${s}`;
  return s;
}

function pretty(n) {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(n);
  return m ? `+1 (${m[1]}) ${m[2]}-${m[3]}` : n;
}

function cosine(a, b) {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

function purgeExpired() {
  if (db.prepare("DELETE FROM voice_profiles WHERE expires_at < ?").run(now()).changes) cache = null;
}

// Cache embeddings in memory; reload after writes.
let cache = null;
function samples() {
  if (!cache) {
    cache = db.prepare("SELECT profile_id, embedding FROM voice_samples").all()
      .map((r) => ({ profileId: r.profile_id, v: JSON.parse(r.embedding) }));
  }
  return cache;
}

export function getProfile(id) {
  const p = db.prepare("SELECT * FROM voice_profiles WHERE id = ?").get(id);
  if (!p) return null;
  const numbers = db.prepare("SELECT number, first_seen, last_seen, times FROM voice_numbers WHERE profile_id = ? ORDER BY first_seen").all(id);
  const matches = db.prepare("SELECT number, similarity, at FROM voice_matches WHERE profile_id = ? ORDER BY at DESC LIMIT 20").all(id);
  const s = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(seconds), 0) AS secs FROM voice_samples WHERE profile_id = ?").get(id);
  return {
    id: p.id,
    label: p.label,
    scamType: p.scam_type,
    reports: p.reports,
    aiVoice: Boolean(p.ai_voice),
    createdAt: p.created_at,
    lastSeen: p.last_seen,
    expiresAt: p.expires_at,
    voiceSamples: s.n,
    secondsOfSpeech: Math.round(s.secs),
    numbers: numbers.map((n) => ({ number: pretty(n.number), firstSeen: n.first_seen, lastSeen: n.last_seen, times: n.times })),
    matches: matches.map((m) => ({ number: pretty(m.number), similarity: Math.round(m.similarity * 100) / 100, at: m.at })),
  };
}

// Best matching profile for an embedding.
export function search(embedding) {
  purgeExpired();
  const best = new Map();
  for (const s of samples()) {
    const sim = cosine(embedding, s.v);
    if (sim > (best.get(s.profileId) ?? -1)) best.set(s.profileId, sim);
  }
  let top = null;
  for (const [profileId, sim] of best) if (!top || sim > top.sim) top = { profileId, sim };
  if (!top) return { matched: false, similarity: 0, profile: null };
  const matched = top.sim >= MATCH_THRESHOLD;
  return {
    matched,
    similarity: Math.round(Math.max(0, top.sim) * 100) / 100,
    profile: matched ? getProfile(top.profileId) : null,
  };
}

export function logMatch(profileId, number, similarity) {
  db.prepare("INSERT INTO voice_matches (profile_id, number, similarity, at) VALUES (?, ?, ?, ?)")
    .run(profileId, normalizeNumber(number), similarity, now());
  db.prepare("UPDATE voice_profiles SET last_seen = ? WHERE id = ?").run(now(), profileId);
}

function addNumber(profileId, number) {
  const n = normalizeNumber(number);
  db.prepare(`INSERT INTO voice_numbers (profile_id, number, first_seen, last_seen) VALUES (?, ?, ?, ?)
    ON CONFLICT(profile_id, number) DO UPDATE SET last_seen = excluded.last_seen, times = times + 1`)
    .run(profileId, n, now(), now());
}

function addSamples(profileId, items, source) {
  const ins = db.prepare("INSERT INTO voice_samples (profile_id, embedding, seconds, source, created_at) VALUES (?, ?, ?, ?, ?)");
  for (const it of items) ins.run(profileId, JSON.stringify(it.embedding), it.seconds, source, now());
  // Keep only the newest MAX_SAMPLES per profile.
  db.prepare(`DELETE FROM voice_samples WHERE profile_id = ? AND id NOT IN
    (SELECT id FROM voice_samples WHERE profile_id = ? ORDER BY id DESC LIMIT ?)`).run(profileId, profileId, MAX_SAMPLES);
  cache = null;
}

// Report a scam caller. If profileId is given (the voice already matched),
// add to that profile; otherwise create a new one.
export function report({ profileId, items, number, scamType, label, source = "call", aiVoice = false }) {
  if (!items.length) return null;
  let id = profileId && getProfile(profileId) ? profileId : null;
  if (id) {
    db.prepare("UPDATE voice_profiles SET reports = reports + 1, last_seen = ?, expires_at = ? WHERE id = ?").run(now(), expiry(), id);
  } else {
    id = `vp_${randomUUID().slice(0, 8)}`;
    const count = db.prepare("SELECT COUNT(*) AS n FROM voice_profiles").get().n;
    db.prepare("INSERT INTO voice_profiles (id, label, scam_type, created_at, last_seen, expires_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, label || `Scam caller #${count + 1}`, scamType || "Suspicious call", now(), now(), expiry());
  }
  if (aiVoice) db.prepare("UPDATE voice_profiles SET ai_voice = 1 WHERE id = ?").run(id);
  addSamples(id, items, source);
  addNumber(id, number);
  return { merged: Boolean(profileId && id === profileId), profile: getProfile(id) };
}

// Caller ID lookup when a call rings: has this number been reported?
export function lookupNumber(number) {
  purgeExpired();
  const n = normalizeNumber(number);
  const reported = db.prepare("SELECT profile_id FROM voice_numbers WHERE number = ? ORDER BY last_seen DESC LIMIT 1").get(n);
  const matched = reported ? null : db.prepare("SELECT profile_id FROM voice_matches WHERE number = ? ORDER BY at DESC LIMIT 1").get(n);
  const id = reported?.profile_id || matched?.profile_id;
  if (!id) return { known: false };
  const p = getProfile(id);
  return { known: true, reported: Boolean(reported), label: p.label, scamType: p.scamType, reports: p.reports, numbersUsed: p.numbers.length, aiVoice: p.aiVoice };
}

export function listProfiles() {
  purgeExpired();
  return db.prepare("SELECT id FROM voice_profiles ORDER BY last_seen DESC").all().map((r) => getProfile(r.id));
}

export function updateProfile(id, { label, scamType, aiVoice }) {
  if (typeof aiVoice === "boolean") db.prepare("UPDATE voice_profiles SET ai_voice = ? WHERE id = ?").run(aiVoice ? 1 : 0, id);
  if (label) db.prepare("UPDATE voice_profiles SET label = ? WHERE id = ?").run(label, id);
  if (scamType) db.prepare("UPDATE voice_profiles SET scam_type = ? WHERE id = ?").run(scamType, id);
  return getProfile(id);
}

export function deleteProfile(id) {
  db.prepare("DELETE FROM voice_profiles WHERE id = ?").run(id);
  cache = null;
}

export function resetAll() {
  db.exec("DELETE FROM voice_matches; DELETE FROM voice_numbers; DELETE FROM voice_samples; DELETE FROM voice_profiles;");
  cache = null;
}
