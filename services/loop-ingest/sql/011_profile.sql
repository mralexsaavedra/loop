-- The in-page onboarding's answers for users without an AI coach: the profile (sex, birthdate, height,
-- weight, activity) and the nutrition targets they accepted, ONE row (id = 1). Written through loop-web's
-- /api/food/ proxy (GET / PUT /food/profile, src/food.js), so it sits behind the food routes' security
-- layers; `data` is validated by the service (validateProfile) and again by the host sync
-- (lib/profile/onboarding.mjs) and bounded by the build (lib/nutrition/energy.mjs checkTargets). Its own
-- OPTIONAL `profile` group (migrations.js): a failure only disables /food/profile. Idempotent like 003-010.
CREATE TABLE IF NOT EXISTS app_profile (
  id          SMALLINT     PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  data        JSONB        NOT NULL,
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
