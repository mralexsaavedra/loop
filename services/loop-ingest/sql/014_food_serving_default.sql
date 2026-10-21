-- Log by serving by default: the page's log sheet starts a product in servings instead of g / ml (the product needs
-- a serving size: the API refuses the flag without one, src/food.js validateProduct). Part of the OPTIONAL `food`
-- group (migrations.js) after 006: a failure only disables /food. Idempotent (IF NOT EXISTS); every existing
-- product keeps logging in g / ml (DEFAULT false).
ALTER TABLE food_product ADD COLUMN IF NOT EXISTS serving_default BOOLEAN NOT NULL DEFAULT false;
