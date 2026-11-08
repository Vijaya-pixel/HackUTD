-- ScamShield Buddy: a pet whose health reflects the subscriber's security habits.
-- Every change in health is an event; the current state is computed from the last 30 days of events
-- plus the line's protection toggles, so nothing here can drift out of sync with the rest of the app.
CREATE TABLE IF NOT EXISTS pet_events (
  id        BIGSERIAL PRIMARY KEY,
  line_id   TEXT NOT NULL REFERENCES lines(id) ON DELETE CASCADE,
  kind      TEXT NOT NULL,              -- caught | fell | trap | quiz_right | quiz_wrong | report | bonus
  delta     INTEGER NOT NULL,           -- health change, negative for damage
  note      TEXT,
  meta      JSONB NOT NULL DEFAULT '{}',
  time      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pet_events_line_time ON pet_events (line_id, time DESC);
