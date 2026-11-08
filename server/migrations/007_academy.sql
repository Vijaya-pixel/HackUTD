-- Scam Academy: difficulty and gentle learning mode for each drill.
ALTER TABLE drill_sessions ADD COLUMN IF NOT EXISTS difficulty TEXT NOT NULL DEFAULT 'intermediate';  -- beginner | intermediate | expert
ALTER TABLE drill_sessions ADD COLUMN IF NOT EXISTS gentle BOOLEAN NOT NULL DEFAULT false;            -- larger text, no score
