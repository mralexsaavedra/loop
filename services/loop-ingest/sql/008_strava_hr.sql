-- Per-activity heart-rate time histogram (src/hr-zones.js): seconds spent at each whole bpm, from
-- Strava's /activities/{id}/streams (time + heartrate). Only this AGGREGATE is kept, never the raw
-- stream; the HR zones (% of max HR) are cut from it on the repo side (sync-strava.mjs). One row per
-- activity that got a definite answer: status 'ok' (hr_hist set), 'no_hr' (no heart-rate stream) or
-- 'not_found' (404), so it is never fetched again. fetched_at doubles as the rate-limit ledger (the
-- backfill counts its own calls of the last 15 min / 24 h). Idempotent like 002-007.
CREATE TABLE IF NOT EXISTS strava_activity_hr (
  activity_id  BIGINT       PRIMARY KEY REFERENCES strava_activity (id) ON DELETE CASCADE,
  fetched_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  status       TEXT         NOT NULL CHECK (status IN ('ok', 'no_hr', 'not_found')),
  seconds      INTEGER      NOT NULL DEFAULT 0,
  hr_hist      JSONB
);

CREATE INDEX IF NOT EXISTS strava_activity_hr_fetched_idx ON strava_activity_hr (fetched_at DESC);
