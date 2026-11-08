-- Scam drill (education suite): a consented, AI-written fake scam conversation over iMessage.
-- Nothing here is real: the link points at our own debrief page and collects nothing.
CREATE TABLE IF NOT EXISTS drill_sessions (
  id            TEXT PRIMARY KEY DEFAULT 'ds_' || replace(gen_random_uuid()::text, '-', ''),
  token         TEXT UNIQUE NOT NULL,           -- unguessable; the only thing in the link
  handle        TEXT NOT NULL,                  -- E.164 phone of the consenting participant
  name          TEXT NOT NULL,
  scenario      TEXT NOT NULL,
  interests     JSONB NOT NULL DEFAULT '[]',
  status        TEXT NOT NULL DEFAULT 'active', -- active | link_sent | clicked | ended
  history       JSONB NOT NULL DEFAULT '[]',    -- [{role:'assistant'|'user', text, at}]
  ended_reason  TEXT,                           -- clicked | stopped | silent | replied_after_link
  consent_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  link_sent_at  TIMESTAMPTZ,
  clicked_at    TIMESTAMPTZ,
  debriefed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- At most one live drill per phone number.
CREATE UNIQUE INDEX IF NOT EXISTS drill_one_live_per_handle ON drill_sessions (handle) WHERE status IN ('active', 'link_sent');
CREATE INDEX IF NOT EXISTS drill_sessions_created ON drill_sessions (created_at DESC);
