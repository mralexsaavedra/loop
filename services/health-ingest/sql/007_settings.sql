-- The user's nutrition settings (goal + target weight), shared by every device that opens the LAN
-- plan page (phone and Mac agree). Written through plan-web's /api/food/ proxy (GET / PUT
-- /food/settings, src/food.js), so it sits behind the food routes' security layers. ONE row (id = 1);
-- a NULL column = not set yet (the page then keeps its local fallback). Its own OPTIONAL migration
-- group (db.js `settings`): a failure only disables /food/settings. Idempotent like 003-006.
CREATE TABLE IF NOT EXISTS app_settings (
  id                SMALLINT     PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  goal              TEXT         CHECK (goal IS NULL OR goal IN ('maintain', 'cut', 'bulk')),
  target_weight_kg  NUMERIC(4,1) CHECK (target_weight_kg IS NULL OR target_weight_kg BETWEEN 35 AND 250),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT now()
);
