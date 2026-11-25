-- Garmin Connect Personal API (optional source, src/garmin.js + garmin-sync.js; docs/lan-services.md -> Garmin).
-- Its own OPTIONAL `garmin` group (migrations.js): a failure only disables the Garmin loop and /export/garmin.
-- Idempotent like 002-014. The API key is NEVER stored here (it lives in the server's environment only).
--
-- garmin_activity: one row per activity of the activity list, the numeric fields the plan-vs-done view uses as
-- columns, plus the activity summary verbatim in `payload` for later phases. /export/garmin never returns the
-- payload, nor any name (privacy boundary, like strava_activity).
CREATE TABLE IF NOT EXISTS garmin_activity (
  id                 BIGINT            PRIMARY KEY,
  start_local        TIMESTAMP         NOT NULL,
  start_utc          TIMESTAMPTZ       NOT NULL,
  type               TEXT              NOT NULL,
  duration_s         DOUBLE PRECISION,
  moving_duration_s  DOUBLE PRECISION,
  avg_power          DOUBLE PRECISION,
  norm_power         DOUBLE PRECISION,
  avg_hr             DOUBLE PRECISION,
  max_hr             DOUBLE PRECISION,
  payload            JSONB             NOT NULL,
  synced_at          TIMESTAMPTZ       NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS garmin_activity_start_idx ON garmin_activity (start_utc DESC);

-- The planned workout an activity followed (GET /activity-service/activity/{id}/workouts), one row per activity
-- that got an answer: 'ok' (steps = the compact steps, no names or notes), 'none' (it followed no workout),
-- 'retry' (a transient failure: attempts + last_error_at, due again after a back-off) or 'failed' (gave up).
CREATE TABLE IF NOT EXISTS garmin_activity_workout (
  activity_id    BIGINT       PRIMARY KEY REFERENCES garmin_activity (id) ON DELETE CASCADE,
  status         TEXT         NOT NULL CHECK (status IN ('ok', 'none', 'retry', 'failed')),
  steps          JSONB,
  attempts       INTEGER      NOT NULL DEFAULT 0,
  last_error_at  TIMESTAMPTZ,
  fetched_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Single row: whether a full history walk finished once (until then every run walks the whole list, so a first
-- pull cut short never leaves a gap), and the Garmin freshness status (coarse codes only, like sync_status).
CREATE TABLE IF NOT EXISTS garmin_sync_state (
  id                SMALLINT     PRIMARY KEY DEFAULT 1,
  history_complete  BOOLEAN      NOT NULL DEFAULT false,
  ok_at             TIMESTAMPTZ,
  error             TEXT,
  error_at          TIMESTAMPTZ,
  CONSTRAINT garmin_sync_state_singleton CHECK (id = 1)
);

INSERT INTO garmin_sync_state (id) VALUES (1) ON CONFLICT DO NOTHING;
