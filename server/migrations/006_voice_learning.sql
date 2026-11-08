-- Voices the system learns from live calls start as "pending": one report is a hint, not proof.
-- A second independent report confirms them. Anyone can dispute a profile; disputes lower trust.
ALTER TABLE scammer_profiles ADD COLUMN IF NOT EXISTS status   TEXT NOT NULL DEFAULT 'confirmed';  -- confirmed | pending
ALTER TABLE scammer_profiles ADD COLUMN IF NOT EXISTS origin   TEXT NOT NULL DEFAULT 'seed';       -- seed | learned
ALTER TABLE scammer_profiles ADD COLUMN IF NOT EXISTS disputes INT  NOT NULL DEFAULT 0;
