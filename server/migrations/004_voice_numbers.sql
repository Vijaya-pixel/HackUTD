-- Numbers each known scammer voice has called from, so a voice match can say
-- "this caller has also used (702) 555-0119 and (214) 555-0199".
ALTER TABLE scammer_profiles ADD COLUMN IF NOT EXISTS seed_key TEXT UNIQUE;
ALTER TABLE scammer_profiles ADD COLUMN IF NOT EXISTS reports INT NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS scammer_numbers (
  profile_id TEXT NOT NULL REFERENCES scammer_profiles(id) ON DELETE CASCADE,
  e164       TEXT NOT NULL,
  first_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen  TIMESTAMPTZ NOT NULL DEFAULT now(),
  times      INT NOT NULL DEFAULT 1,
  PRIMARY KEY (profile_id, e164)
);
