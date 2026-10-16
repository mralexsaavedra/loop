-- The owner's file-style documents, moved off hand-edited JSON files in the clone: the nutrition plan
-- (`plan`, was data/nutrition/plan-data.json), the training program (`training`, was
-- data/training/training-data.json) and the profile (`profile`, was profile/profile.json). ONE row per kind.
-- Written through GET / PUT /documents/:kind (src/documents.js, bearer token only, never proxied by loop-web);
-- `revision` counts the saves, and a PUT names the revision it read, so two writers never overwrite each other
-- silently. `data` is JSON, not JSONB: JSON keeps the stored text, so the key order survives (the page lists a
-- plan's meals and options in file order; JSONB would sort the keys). `data` is checked structurally by the service and fully by the coach before a PUT and by the build.
-- Its own OPTIONAL `documents` group (migrations.js): a failure only disables /documents/*. Idempotent like 003-011.
CREATE TABLE IF NOT EXISTS app_document (
  kind        TEXT         PRIMARY KEY CHECK (kind IN ('plan', 'training', 'profile')),
  data        JSON         NOT NULL,
  revision    INTEGER      NOT NULL CHECK (revision > 0),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
