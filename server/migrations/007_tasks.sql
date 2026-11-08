-- Weekly T-Mobile tasks: each checkpoint gets one randomly assigned task per ISO week, worth points by length
-- and importance. Points fill the weekly bar; reaching the goal earns a T-Mobile reward.
CREATE TABLE IF NOT EXISTS game_tasks (
  line_id    TEXT NOT NULL REFERENCES lines(id) ON DELETE CASCADE,
  week       TEXT NOT NULL,              -- e.g. 2026-W46
  node       TEXT NOT NULL,
  task_id    TEXT NOT NULL,
  label      TEXT NOT NULL,
  points     INTEGER NOT NULL,
  need_stars INTEGER NOT NULL DEFAULT 1,
  done_at    TIMESTAMPTZ,
  PRIMARY KEY (line_id, week, node)
);
CREATE TABLE IF NOT EXISTS game_rewards (
  line_id   TEXT NOT NULL REFERENCES lines(id) ON DELETE CASCADE,
  week      TEXT NOT NULL,
  reward    TEXT NOT NULL,
  earned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (line_id, week)
);
