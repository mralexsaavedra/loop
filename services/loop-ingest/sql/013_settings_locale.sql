-- The page language (es / en) the user picks in the page's settings: the page build uses it before HC_LOCALE and
-- the plan's locale (web/src/env.mjs). A NULL = not chosen (the build falls back). Part of the OPTIONAL `settings`
-- group (migrations.js) after 007: a failure only disables /food/settings. Idempotent (IF NOT EXISTS: the column
-- and its CHECK are added once).
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS locale TEXT CHECK (locale IS NULL OR locale IN ('es', 'en'));
