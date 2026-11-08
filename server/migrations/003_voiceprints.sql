-- Scammer voice identity database.
-- One profile per known scammer (e.g. "IRS gift-card scammer", "grandparent scammer ring A").
-- Each profile can have many voiceprints: short speaker embeddings extracted from call audio.
-- Matching uses cosine similarity on the average embedding, same pattern as scam_scripts.

CREATE TABLE IF NOT EXISTS scammer_profiles (
  id          TEXT PRIMARY KEY DEFAULT 'sp_' || replace(gen_random_uuid()::text, '-', ''),
  name        TEXT NOT NULL,               -- display name, e.g. "IRS Gift-Card Scammer"
  scam_type   TEXT NOT NULL DEFAULT 'Unknown',
  notes       TEXT,
  ai_voice    BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Each row is one short audio segment (≥ 1.5 s) turned into a speaker embedding.
-- Embeddings come from the voice/ project's sherpa-onnx speaker ID model (256 dims)
-- or from any other 256-dim speaker encoder. Store them as vector(256).
CREATE TABLE IF NOT EXISTS voiceprints (
  id          SERIAL PRIMARY KEY,
  profile_id  TEXT NOT NULL REFERENCES scammer_profiles(id) ON DELETE CASCADE,
  embedding   vector(256) NOT NULL,
  duration_s  REAL,
  source      TEXT DEFAULT 'enroll',       -- enroll | call | drill
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS voiceprints_hnsw ON voiceprints
  USING hnsw (embedding vector_cosine_ops);

-- Per-number match log: when a live call matched a known scammer profile.
CREATE TABLE IF NOT EXISTS voice_matches (
  id          SERIAL PRIMARY KEY,
  profile_id  TEXT NOT NULL REFERENCES scammer_profiles(id) ON DELETE CASCADE,
  e164        TEXT NOT NULL,
  call_id     TEXT,               -- UUID from call_events (may be null for Twilio)
  similarity  REAL NOT NULL,
  matched_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
