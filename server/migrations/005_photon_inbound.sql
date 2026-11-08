-- Cross-process dedupe for Photon inbound messages. Every server that holds the shared Photon project's
-- stream receives every message; the first one to claim the message id here is the only one that replies.
CREATE TABLE IF NOT EXISTS photon_inbound (
  id         TEXT PRIMARY KEY,
  handled_by TEXT NOT NULL,
  time       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS photon_inbound_time ON photon_inbound (time DESC);
