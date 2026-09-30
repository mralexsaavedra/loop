-- Refresh bookkeeping for the athlete snapshot (src/athlete.js), persisted so a restarted service
-- neither retries a failed refresh immediately nor forgets that the gear list was incomplete.
--   last_ok_at       last successful refresh
--   last_failure_at  last failed refresh (cleared on success); drives the 1 h retry backoff
--   gear_partial     a GET /gear/{id} failed transiently (5xx / network): the snapshot is kept but
--                    refreshed again after 1 h instead of 24 h
-- fetched_at becomes nullable: a failure before the first successful refresh is stored as a row
-- with no snapshot (fetched_at NULL, athlete '{}'), which GET /export/athlete reports as "none yet".
ALTER TABLE strava_athlete ADD COLUMN IF NOT EXISTS gear_partial BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE strava_athlete ADD COLUMN IF NOT EXISTS last_ok_at TIMESTAMPTZ;
ALTER TABLE strava_athlete ADD COLUMN IF NOT EXISTS last_failure_at TIMESTAMPTZ;
ALTER TABLE strava_athlete ALTER COLUMN fetched_at DROP NOT NULL;
