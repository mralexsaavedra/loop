-- Strava landing zone. The API schema IS documented and stable, but we keep the
-- same raw-first discipline as Apple Health: store the activity verbatim and
-- derive columns from it, so a change upstream never loses data.
CREATE TABLE IF NOT EXISTS strava_activity (
  id            BIGINT       PRIMARY KEY,
  start_local   TIMESTAMP    NOT NULL,
  sport_type    TEXT         NOT NULL,
  name          TEXT,
  synced_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  payload       JSONB        NOT NULL
);

CREATE INDEX IF NOT EXISTS strava_activity_start_idx ON strava_activity (start_local DESC);
CREATE INDEX IF NOT EXISTS strava_activity_sport_idx ON strava_activity (sport_type, start_local DESC);

-- Single-row cursor so a restart resumes instead of re-walking the history.
CREATE TABLE IF NOT EXISTS strava_sync_state (
  id              SMALLINT     PRIMARY KEY DEFAULT 1,
  last_synced_at  TIMESTAMPTZ,
  last_start_local TIMESTAMP,
  CONSTRAINT strava_sync_state_singleton CHECK (id = 1)
);

INSERT INTO strava_sync_state (id) VALUES (1) ON CONFLICT DO NOTHING;
