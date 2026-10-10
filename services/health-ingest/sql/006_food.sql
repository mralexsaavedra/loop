-- Food log (Nutrición part 2): the user's supermarket products, their own recipes and what they ate.
-- Written from the LAN plan page through plan-web's /api/food/ proxy (src/food.js); a public
-- reverse proxy must NEVER forward /food/*. Idempotent like 003-005: safe to run on every start.
--
--   food_product  per-100 g / ml macros from the label or Open Food Facts, confirmed by the user;
--                 archived instead of deleted, so recipes and old log entries keep their reference
--   food_recipe   ingredients [{productId, amount}] (amount in the product's unit); macros are
--                 COMPUTED from the products (per serving, or per 100 g cooked for a batch), never typed
--   food_log      one eaten item per row, dated with the user's LOCAL date sent by the page, with a
--                 SNAPSHOT of its macros taken at log time (a later product edit never rewrites history);
--                 macros may be NULL only for quick entries whose macros the user did not know
CREATE TABLE IF NOT EXISTS food_product (
  id            BIGSERIAL    PRIMARY KEY,
  name          TEXT         NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  brand         TEXT         CHECK (brand IS NULL OR char_length(brand) BETWEEN 1 AND 80),
  store         TEXT         NOT NULL CHECK (store IN ('mercadona', 'dia', 'eroski', 'other')),
  barcode       TEXT         CHECK (barcode IS NULL OR barcode ~ '^[0-9]{8,14}$'),
  unit          TEXT         NOT NULL CHECK (unit IN ('g', 'ml')),
  kcal_100      NUMERIC(5,1) NOT NULL CHECK (kcal_100 BETWEEN 0 AND 900),
  protein_100   NUMERIC(4,1) NOT NULL CHECK (protein_100 BETWEEN 0 AND 100),
  carbs_100     NUMERIC(4,1) NOT NULL CHECK (carbs_100 BETWEEN 0 AND 100),
  fat_100       NUMERIC(4,1) NOT NULL CHECK (fat_100 BETWEEN 0 AND 100),
  serving_size  NUMERIC(6,1) CHECK (serving_size IS NULL OR serving_size > 0),
  source        TEXT         NOT NULL CHECK (source IN ('off', 'label', 'manual')),
  off_code      TEXT         CHECK (off_code IS NULL OR off_code ~ '^[0-9]{1,14}$'),
  archived      BOOLEAN      NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);
-- a barcode is unique among ACTIVE products (an archived one may be re-added)
CREATE UNIQUE INDEX IF NOT EXISTS food_product_barcode_uq ON food_product (barcode) WHERE barcode IS NOT NULL AND NOT archived;

CREATE TABLE IF NOT EXISTS food_recipe (
  id               BIGSERIAL    PRIMARY KEY,
  name             TEXT         NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  kind             TEXT         NOT NULL CHECK (kind IN ('serving', 'batch')),
  servings         INTEGER      CHECK (servings IS NULL OR servings BETWEEN 1 AND 100),
  cooked_weight_g  NUMERIC(7,1) CHECK (cooked_weight_g IS NULL OR cooked_weight_g > 0),
  ingredients      JSONB        NOT NULL CHECK (jsonb_typeof(ingredients) = 'array'),
  archived         BOOLEAN      NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT food_recipe_kind_chk CHECK (
    (kind = 'serving' AND servings IS NOT NULL AND cooked_weight_g IS NULL) OR
    (kind = 'batch' AND cooked_weight_g IS NOT NULL AND servings IS NULL))
);

CREATE TABLE IF NOT EXISTS food_log (
  id          BIGSERIAL    PRIMARY KEY,
  date        DATE         NOT NULL,
  meal        TEXT         NOT NULL CHECK (meal IN ('breakfast', 'lunch', 'preworkout', 'postworkout', 'dinner', 'snack')),
  ref_type    TEXT         NOT NULL CHECK (ref_type IN ('product', 'recipe', 'quick')),
  ref_id      BIGINT,
  label       TEXT         NOT NULL CHECK (char_length(label) BETWEEN 1 AND 120),
  amount      NUMERIC(7,1) NOT NULL CHECK (amount > 0),
  unit        TEXT         NOT NULL CHECK (unit IN ('g', 'ml', 'serving')),
  kcal        NUMERIC(7,1) NOT NULL CHECK (kcal >= 0),
  protein     NUMERIC(6,1) CHECK (protein IS NULL OR protein >= 0),
  carbs       NUMERIC(6,1) CHECK (carbs IS NULL OR carbs >= 0),
  fat         NUMERIC(6,1) CHECK (fat IS NULL OR fat >= 0),
  request_id  TEXT         CHECK (request_id IS NULL OR request_id ~ '^[A-Za-z0-9-]{8,64}$'),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT food_log_ref_chk CHECK ((ref_type = 'quick') = (ref_id IS NULL))
);
CREATE INDEX IF NOT EXISTS food_log_date_idx ON food_log (date);
-- the page's per-add id: a retry of the same add (after a timeout / lost answer) finds this row
CREATE UNIQUE INDEX IF NOT EXISTS food_log_request_uq ON food_log (request_id) WHERE request_id IS NOT NULL;
