-- Raw landing zone. We do NOT parse Health Auto Export payloads yet: the
-- vendor does not publish a schema, so we store what actually arrives and
-- write the normalizer against real samples.
CREATE TABLE IF NOT EXISTS raw_payload (
  id              BIGSERIAL PRIMARY KEY,
  received_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  source          TEXT         NOT NULL,
  automation      TEXT,
  aggregation     TEXT,
  period          TEXT,
  session_id      TEXT,
  byte_size       INTEGER      NOT NULL,
  payload         JSONB        NOT NULL
);

CREATE INDEX IF NOT EXISTS raw_payload_received_at_idx ON raw_payload (received_at DESC);
CREATE INDEX IF NOT EXISTS raw_payload_source_idx      ON raw_payload (source, received_at DESC);
CREATE INDEX IF NOT EXISTS raw_payload_session_idx     ON raw_payload (session_id);
