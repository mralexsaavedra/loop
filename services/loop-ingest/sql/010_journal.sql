-- Daily behaviour journal (Q7): what the user did each day (alcohol, late caffeine, screen in bed...),
-- written from the LAN plan page through loop-web's /api/journal/ proxy (src/journal.js); a public
-- reverse proxy must NEVER forward /journal/*. Its own OPTIONAL migration group (db.js `journal`): a
-- failure only disables /journal/*. Idempotent like 003-009: safe to run on every start.
--
--   journal_day       one row per journaled LOCAL date (sent by the page): answers JSONB
--                     {behaviourKey: true | false | drinks count}, a missing key = not answered; the
--                     behaviour list and the value rules live in src/journal-calc.js / journal.js
--   journal_settings  ONE row (id = 1): the behaviours the user switched OFF (new ones default on)
CREATE TABLE IF NOT EXISTS journal_day (
  date        DATE         PRIMARY KEY CHECK (date BETWEEN DATE '2000-01-01' AND DATE '2100-12-31'),
  answers     JSONB        NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(answers) = 'object'),
  notes       TEXT         CHECK (notes IS NULL OR char_length(notes) BETWEEN 1 AND 500),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS journal_settings (
  id          SMALLINT     PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  disabled    TEXT[]       NOT NULL DEFAULT '{}',
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
