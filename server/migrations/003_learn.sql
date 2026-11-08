-- Safe Signal practice (Learn tab): consent, practice sessions, messages (hypertable), skills.
CREATE TABLE IF NOT EXISTS learn_consents (
  line_id TEXT PRIMARY KEY REFERENCES lines(id),
  channel TEXT NOT NULL DEFAULT 'simulator',        -- simulator | imessage
  interests JSONB NOT NULL DEFAULT '[]',
  max_per_day INT NOT NULL DEFAULT 3,
  quiet_start SMALLINT, quiet_end SMALLINT,
  consent_version TEXT NOT NULL DEFAULT '1.0',
  consent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  active BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS learn_sessions (
  id TEXT PRIMARY KEY,
  line_id TEXT NOT NULL REFERENCES lines(id),
  scenario_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'created',
  stage_index INT NOT NULL DEFAULT 0,
  token TEXT NOT NULL UNIQUE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  clicked_at TIMESTAMPTZ,
  outcome TEXT,
  lesson JSONB
);
CREATE INDEX IF NOT EXISTS learn_sessions_line ON learn_sessions (line_id, started_at DESC);

CREATE TABLE IF NOT EXISTS learn_messages (
  time TIMESTAMPTZ NOT NULL DEFAULT now(),
  id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,                 -- scammer | user | system
  redacted_text TEXT NOT NULL,
  stage TEXT NOT NULL,
  red_flags JSONB NOT NULL DEFAULT '[]'
);
SELECT create_hypertable('learn_messages', 'time', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS learn_messages_session ON learn_messages (session_id, time);

CREATE TABLE IF NOT EXISTS learn_skills (
  line_id TEXT NOT NULL REFERENCES lines(id),
  category TEXT NOT NULL,
  encountered INT NOT NULL DEFAULT 0,
  caught INT NOT NULL DEFAULT 0,
  PRIMARY KEY (line_id, category)
);
