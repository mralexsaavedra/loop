-- On-demand refresh bookkeeping (POST /sync, GET /sync/status). Timestamps,
-- sequence numbers and COARSE error codes only (strava_auth, strava_network,
-- strava_other, trigger_write): GET /sync/status is unauthenticated, so
-- nothing here may ever hold health data or raw error text.
CREATE TABLE IF NOT EXISTS sync_status (
  id                    SMALLINT     PRIMARY KEY DEFAULT 1,
  last_strava_ok_at     TIMESTAMPTZ,
  last_strava_error     TEXT,
  last_strava_error_at  TIMESTAMPTZ,
  last_trigger_at       TIMESTAMPTZ,
  CONSTRAINT sync_status_singleton CHECK (id = 1)
);

-- Sequence protocol (POST /sync assigns trigger_seq; the host refresh reports
-- the highest one it published as processedSeq). ADD COLUMN IF NOT EXISTS keeps
-- this idempotent for databases created by an earlier version of this file.
ALTER TABLE sync_status ADD COLUMN IF NOT EXISTS trigger_seq              BIGINT  NOT NULL DEFAULT 0;
ALTER TABLE sync_status ADD COLUMN IF NOT EXISTS last_trigger_error       TEXT;
ALTER TABLE sync_status ADD COLUMN IF NOT EXISTS last_trigger_error_seq   BIGINT;
ALTER TABLE sync_status ADD COLUMN IF NOT EXISTS strava_token_save_failed BOOLEAN NOT NULL DEFAULT false;

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
