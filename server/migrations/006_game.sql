-- ScamShield Quest: per-line progress through the minigame map. Energy changes still go through pet_events.
CREATE TABLE IF NOT EXISTS game_progress (
  line_id   TEXT NOT NULL REFERENCES lines(id) ON DELETE CASCADE,
  node      TEXT NOT NULL,
  stars     INTEGER NOT NULL DEFAULT 0,
  best      INTEGER NOT NULL DEFAULT 0,
  plays     INTEGER NOT NULL DEFAULT 0,
  updated   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (line_id, node)
);
