-- ScamShield core schema (TigerData / TimescaleDB)
CREATE EXTENSION IF NOT EXISTS vector;
DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_textsearch;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_textsearch not available: %', SQLERRM;
END $$;

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  plan TEXT,
  premium BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS lines (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  name TEXT NOT NULL,
  device TEXT NOT NULL,
  msisdn TEXT UNIQUE NOT NULL,          -- the line's own number, E.164
  initials TEXT,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  photon_space_id TEXT,                 -- filled when the user texts the ScamShield line
  photon_sender_id TEXT,
  notify_guardian TEXT REFERENCES lines(id),
  toggles JSONB NOT NULL DEFAULT '{"scamBlock":true,"callerId":true,"scamLikely":true,"aiVoice":false,"inCall":false,"screener":false,"vmText":false,"safeWeb":true,"unknownVm":false,"callback":true,"weekly":true,"rosaAlerts":true}'
);

-- Reputation: one row per phone number
CREATE TABLE IF NOT EXISTS numbers (
  e164 TEXT PRIMARY KEY,
  display_name TEXT,
  carrier TEXT,
  line_type TEXT,
  location TEXT,
  category TEXT,
  risk SMALLINT NOT NULL DEFAULT 0,
  reports_30d INT NOT NULL DEFAULT 0,
  note TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Every call is a time-series event
CREATE TABLE IF NOT EXISTS call_events (
  time TIMESTAMPTZ NOT NULL DEFAULT now(),
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  line_id TEXT NOT NULL,
  e164 TEXT NOT NULL,
  outcome TEXT NOT NULL,            -- ringing|connected|blocked|scam|spam|identified|screened|ai|fraud|allowed
  category TEXT,
  risk SMALLINT,
  duration_s INT,
  transcript TEXT,
  verdict JSONB,
  note TEXT,
  source TEXT NOT NULL DEFAULT 'sim'  -- sim | twilio
);
SELECT create_hypertable('call_events', 'time', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS call_events_line_time ON call_events (line_id, time DESC);
CREATE INDEX IF NOT EXISTS call_events_id ON call_events (id);

CREATE TABLE IF NOT EXISTS list_entries (
  line_id TEXT NOT NULL REFERENCES lines(id),
  e164 TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('block','allow')),
  label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (line_id, e164, kind)
);

CREATE TABLE IF NOT EXISTS category_prefs (
  line_id TEXT NOT NULL REFERENCES lines(id),
  category TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (line_id, category)
);

CREATE TABLE IF NOT EXISTS reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  line_id TEXT REFERENCES lines(id),
  e164 TEXT NOT NULL,
  reason TEXT NOT NULL,
  text TEXT,
  source TEXT NOT NULL DEFAULT 'app',   -- app | photon | call
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lookups (
  line_id TEXT REFERENCES lines(id),
  e164 TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Known scam scripts for similarity matching. Embeddings are produced in app code (Gemini, 1024 dims).
CREATE TABLE IF NOT EXISTS scam_scripts (
  id SERIAL PRIMARY KEY,
  label TEXT NOT NULL,
  text TEXT NOT NULL,
  embedding vector(1024)
);
CREATE INDEX IF NOT EXISTS scam_scripts_hnsw ON scam_scripts USING hnsw (embedding vector_cosine_ops);
