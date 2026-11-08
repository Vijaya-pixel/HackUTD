-- Per-line, per-day, per-outcome counts. Powers the status card and the weekly summary.
CREATE MATERIALIZED VIEW IF NOT EXISTS line_daily
WITH (timescaledb.continuous) AS
SELECT line_id,
       time_bucket(INTERVAL '1 day', time) AS day,
       outcome,
       count(*) AS n
FROM call_events
GROUP BY line_id, day, outcome
WITH NO DATA;

SELECT add_continuous_aggregate_policy('line_daily',
  start_offset => INTERVAL '60 days',
  end_offset   => INTERVAL '1 minute',
  schedule_interval => INTERVAL '5 minutes',
  if_not_exists => TRUE);

-- Real-time aggregation: queries on line_daily also include rows not yet materialized.
ALTER MATERIALIZED VIEW line_daily SET (timescaledb.materialized_only = false);

SELECT add_retention_policy('call_events', INTERVAL '90 days', if_not_exists => TRUE);
