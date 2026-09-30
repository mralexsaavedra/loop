-- On-demand refresh bookkeeping (POST /sync, GET /sync/status). Timestamps and
-- a short error string only: GET /sync/status is unauthenticated, so nothing
-- here may ever hold health data.
CREATE TABLE IF NOT EXISTS sync_status (
  id                    SMALLINT     PRIMARY KEY DEFAULT 1,
  last_strava_ok_at     TIMESTAMPTZ,
  last_strava_error     TEXT,
  last_strava_error_at  TIMESTAMPTZ,
  last_trigger_at       TIMESTAMPTZ,
  CONSTRAINT sync_status_singleton CHECK (id = 1)
);

INSERT INTO sync_status (id) VALUES (1) ON CONFLICT DO NOTHING;

-- Strava may rotate the refresh token on any refresh. The rotated value is
-- stored here and preferred over STRAVA_REFRESH_TOKEN, which stays the
-- bootstrap. Never exposed by any endpoint.
CREATE TABLE IF NOT EXISTS strava_token (
  id             SMALLINT     PRIMARY KEY DEFAULT 1,
  refresh_token  TEXT         NOT NULL,
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT strava_token_singleton CHECK (id = 1)
);
