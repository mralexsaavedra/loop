-- Per-activity retry state for the HR-stream backfill (src/hr-zones.js). A transient failure of one
-- activity (5xx, network error, timeout) is stored as status 'retry' with attempts + last_error_at,
-- and that activity is skipped until its back-off has elapsed (30 min * 2^(attempts - 1), capped at
-- 24 h); the 5th failure stores 'failed' and it is never asked again. So one activity that keeps
-- failing no longer blocks the whole backfill. Idempotent: the columns are IF NOT EXISTS and the
-- status check is dropped only to be re-created with the two new values (no row is touched).
ALTER TABLE strava_activity_hr ADD COLUMN IF NOT EXISTS attempts      INTEGER      NOT NULL DEFAULT 0;
ALTER TABLE strava_activity_hr ADD COLUMN IF NOT EXISTS last_error_at TIMESTAMPTZ;
ALTER TABLE strava_activity_hr DROP CONSTRAINT IF EXISTS strava_activity_hr_status_check;
ALTER TABLE strava_activity_hr ADD CONSTRAINT strava_activity_hr_status_check
  CHECK (status IN ('ok', 'no_hr', 'not_found', 'retry', 'failed'));
