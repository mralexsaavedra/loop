-- Strava athlete profile + gear snapshot (src/athlete.js): ONE row, replaced at most once per
-- 24 h by the sync loop and read back by GET /export/athlete. `athlete` is the /athlete payload
-- verbatim (raw-first, like strava_activity); `gear` is the shaped {bikes, shoes} list built from
-- it and GET /gear/{id}. `gear_scope_missing` = the token lacks profile:read_all (Strava then
-- omits bikes / shoes): a coarse flag, never an error.
CREATE TABLE IF NOT EXISTS strava_athlete (
  id                  SMALLINT     PRIMARY KEY DEFAULT 1,
  fetched_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  athlete             JSONB        NOT NULL,
  gear                JSONB        NOT NULL DEFAULT '{"bikes": [], "shoes": []}',
  gear_scope_missing  BOOLEAN      NOT NULL DEFAULT false,
  CONSTRAINT strava_athlete_singleton CHECK (id = 1)
);
