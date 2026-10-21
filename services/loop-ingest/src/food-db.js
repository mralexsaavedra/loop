/**
 * Postgres access for the food log (sql/006_food.sql) and the user's settings (sql/007_settings.sql); the onboarding
 * (sql/011 + the profile document of sql/012) is profile-db.js.
 * Every query is parameterized; rows come
 * back as plain objects with numbers (pg returns NUMERIC / BIGINT as strings), ISO timestamps and
 * the log date as a YYYY-MM-DD string (to_char, so no timezone ever shifts it). Validation and the
 * macro math live in food.js / food-calc.js; this module only stores what it is given.
 *
 * Errors: a unique violation on the barcode becomes { status: 409, code: 'barcode_exists' }; any
 * other DB error propagates and the route answers a coarse 500 (raw DB text is never sent).
 */
import { createProfileStore } from './profile-db.js'

const PRODUCT_COLS = `id, name, brand, store, barcode, unit, kcal_100, protein_100, carbs_100, fat_100,
  serving_size, serving_default, source, off_code, archived, created_at, updated_at`
const RECIPE_COLS = 'id, name, kind, servings, cooked_weight_g, ingredients, archived, created_at, updated_at'
const LOG_COLS = `id, to_char(date, 'YYYY-MM-DD') AS date, meal, ref_type, ref_id, label, amount, unit,
  kcal, protein, carbs, fat, request_id, created_at`

function num (v) {
  if (v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
function iso (v) {
  if (v == null) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export function productFromRow (r) {
  return {
    id: num(r.id),
    name: r.name,
    brand: r.brand ?? null,
    store: r.store,
    barcode: r.barcode ?? null,
    unit: r.unit,
    per100: { kcal: num(r.kcal_100), protein: num(r.protein_100), carbs: num(r.carbs_100), fat: num(r.fat_100) },
    servingSize: num(r.serving_size),
    servingDefault: r.serving_default === true,
    source: r.source,
    offCode: r.off_code ?? null,
    archived: r.archived === true,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at)
  }
}

/** A recipe ingredient: a product ({productId, amount}) or a basic SNAPSHOT ({basic, name, unit, amount,
 * per100}, see food-calc.js RECIPE_BASIC_UNITS), both kept in the JSONB `ingredients` column. */
export function ingredientFromJson (i) {
  if (i && i.basic != null) {
    const m = i.per100 || {}
    return { basic: i.basic, name: i.name, unit: i.unit, amount: num(i.amount), per100: { kcal: num(m.kcal), protein: num(m.protein), carbs: num(m.carbs), fat: num(m.fat) } }
  }
  return { productId: num(i?.productId), amount: num(i?.amount) }
}

export function recipeFromRow (r) {
  return {
    id: num(r.id),
    name: r.name,
    kind: r.kind,
    servings: num(r.servings),
    cookedWeightG: num(r.cooked_weight_g),
    ingredients: Array.isArray(r.ingredients) ? r.ingredients.map(ingredientFromJson) : [],
    archived: r.archived === true,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at)
  }
}

export function logFromRow (r) {
  return {
    id: num(r.id),
    date: r.date,
    meal: r.meal,
    refType: r.ref_type,
    refId: num(r.ref_id),
    label: r.label,
    amount: num(r.amount),
    unit: r.unit,
    kcal: num(r.kcal),
    protein: num(r.protein),
    carbs: num(r.carbs),
    fat: num(r.fat),
    requestId: r.request_id ?? null,
    createdAt: iso(r.created_at)
  }
}

function productValues (p) {
  return [p.name, p.brand ?? null, p.store, p.barcode ?? null, p.unit, p.per100.kcal, p.per100.protein,
    p.per100.carbs, p.per100.fat, p.servingSize ?? null, p.source, p.offCode ?? null, p.servingDefault === true]
}

async function guardUnique (fn) {
  try {
    return await fn()
  } catch (err) {
    if (err && err.code === '23505') throw Object.assign(new Error('barcode exists'), { status: 409, code: 'barcode_exists' })
    throw err
  }
}

const SETTINGS_COLS = 'goal, target_weight_kg, locale, updated_at'
// a summary window's row cap (120 days x a generous ~165 entries a day): a read never grows unbounded
export const LOG_RANGE_MAX_ROWS = 20000

/** The settings row (sql/007_settings.sql + the locale column, sql/013_settings_locale.sql); no row yet = every field null. */
export function settingsFromRow (r) {
  return { goal: r?.goal ?? null, targetWeightKg: num(r?.target_weight_kg), locale: r?.locale ?? null, updatedAt: iso(r?.updated_at) }
}

export function createFoodStore (pool) {
  const profiles = createProfileStore(pool)
  return {
    // the onboarding's two rows (its own fields + the identity in the profile document): profile-db.js
    getProfile: () => profiles.getProfile(),
    putProfile: (data) => profiles.putProfile(data),

    async getSettings () {
      const { rows } = await pool.query(`SELECT ${SETTINGS_COLS} FROM app_settings WHERE id = 1`)
      return settingsFromRow(rows[0])
    },

    /** Partial upsert of the one row: only the keys present in `patch` change (targetWeightKg / locale null clears it). */
    async updateSettings (patch) {
      const has = (k) => Object.prototype.hasOwnProperty.call(patch, k)
      const hasGoal = has('goal')
      const hasTarget = has('targetWeightKg')
      const hasLocale = has('locale')
      const { rows } = await pool.query(
        `INSERT INTO app_settings (id, goal, target_weight_kg, locale) VALUES (1, $1, $2, $5)
         ON CONFLICT (id) DO UPDATE
            SET goal = CASE WHEN $3 THEN EXCLUDED.goal ELSE app_settings.goal END,
                target_weight_kg = CASE WHEN $4 THEN EXCLUDED.target_weight_kg ELSE app_settings.target_weight_kg END,
                locale = CASE WHEN $6 THEN EXCLUDED.locale ELSE app_settings.locale END,
                updated_at = now()
         RETURNING ${SETTINGS_COLS}`,
        [hasGoal ? patch.goal : null, hasTarget ? patch.targetWeightKg : null, hasGoal, hasTarget, hasLocale ? patch.locale : null, hasLocale]
      )
      return settingsFromRow(rows[0])
    },

    /** Every entry dated from..to (inclusive), oldest first: the adherence summary's input. */
    async listLogRange (from, to) {
      const { rows } = await pool.query(
        `SELECT ${LOG_COLS} FROM food_log WHERE date BETWEEN $1::date AND $2::date ORDER BY date, created_at, id LIMIT $3`,
        [from, to, LOG_RANGE_MAX_ROWS]
      )
      return rows.map(logFromRow)
    },

    async listProducts () {
      const { rows } = await pool.query(`SELECT ${PRODUCT_COLS} FROM food_product WHERE NOT archived ORDER BY store, lower(name), id`)
      return rows.map(productFromRow)
    },

    /** Archived ones included: recipes and old entries keep their products. */
    async getProducts (ids) {
      if (!ids.length) return []
      const { rows } = await pool.query(`SELECT ${PRODUCT_COLS} FROM food_product WHERE id = ANY($1::bigint[])`, [ids])
      return rows.map(productFromRow)
    },

    async getProduct (id) {
      const { rows } = await pool.query(`SELECT ${PRODUCT_COLS} FROM food_product WHERE id = $1`, [id])
      return rows[0] ? productFromRow(rows[0]) : null
    },

    insertProduct (p) {
      return guardUnique(async () => {
        const { rows } = await pool.query(
          `INSERT INTO food_product (name, brand, store, barcode, unit, kcal_100, protein_100, carbs_100, fat_100,
             serving_size, source, off_code, serving_default)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
           RETURNING ${PRODUCT_COLS}`,
          productValues(p)
        )
        return productFromRow(rows[0])
      })
    },

    /** Only an active product can be edited; null when there is none with that id. */
    updateProduct (id, p) {
      return guardUnique(async () => {
        const { rows } = await pool.query(
          `UPDATE food_product
              SET name = $1, brand = $2, store = $3, barcode = $4, unit = $5, kcal_100 = $6, protein_100 = $7,
                  carbs_100 = $8, fat_100 = $9, serving_size = $10, source = $11, off_code = $12, serving_default = $13,
                  updated_at = now()
            WHERE id = $14 AND NOT archived
            RETURNING ${PRODUCT_COLS}`,
          [...productValues(p), id]
        )
        return rows[0] ? productFromRow(rows[0]) : null
      })
    },

    async archiveProduct (id) {
      const { rowCount } = await pool.query('UPDATE food_product SET archived = true, updated_at = now() WHERE id = $1 AND NOT archived', [id])
      return rowCount > 0
    },

    async listRecipes () {
      const { rows } = await pool.query(`SELECT ${RECIPE_COLS} FROM food_recipe WHERE NOT archived ORDER BY lower(name), id`)
      return rows.map(recipeFromRow)
    },

    async getRecipe (id) {
      const { rows } = await pool.query(`SELECT ${RECIPE_COLS} FROM food_recipe WHERE id = $1`, [id])
      return rows[0] ? recipeFromRow(rows[0]) : null
    },

    async insertRecipe (r) {
      const { rows } = await pool.query(
        `INSERT INTO food_recipe (name, kind, servings, cooked_weight_g, ingredients)
         VALUES ($1, $2, $3, $4, $5::jsonb)
         RETURNING ${RECIPE_COLS}`,
        [r.name, r.kind, r.servings ?? null, r.cookedWeightG ?? null, JSON.stringify(r.ingredients)]
      )
      return recipeFromRow(rows[0])
    },

    async updateRecipe (id, r) {
      const { rows } = await pool.query(
        `UPDATE food_recipe
            SET name = $1, kind = $2, servings = $3, cooked_weight_g = $4, ingredients = $5::jsonb, updated_at = now()
          WHERE id = $6 AND NOT archived
          RETURNING ${RECIPE_COLS}`,
        [r.name, r.kind, r.servings ?? null, r.cookedWeightG ?? null, JSON.stringify(r.ingredients), id]
      )
      return rows[0] ? recipeFromRow(rows[0]) : null
    },

    async archiveRecipe (id) {
      const { rowCount } = await pool.query('UPDATE food_recipe SET archived = true, updated_at = now() WHERE id = $1 AND NOT archived', [id])
      return rowCount > 0
    },

    async listLog (date) {
      const { rows } = await pool.query(`SELECT ${LOG_COLS} FROM food_log WHERE date = $1::date ORDER BY created_at, id`, [date])
      return rows.map(logFromRow)
    },

    async getLogByRequest (requestId) {
      const { rows } = await pool.query(`SELECT ${LOG_COLS} FROM food_log WHERE request_id = $1`, [requestId])
      return rows[0] ? logFromRow(rows[0]) : null
    },

    /** null when a row with the same request id already exists (a concurrent retry won the race). */
    async insertLog (e) {
      const { rows } = await pool.query(
        `INSERT INTO food_log (date, meal, ref_type, ref_id, label, amount, unit, kcal, protein, carbs, fat, request_id)
         VALUES ($1::date, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (request_id) WHERE request_id IS NOT NULL DO NOTHING
         RETURNING ${LOG_COLS}`,
        [e.date, e.meal, e.refType, e.refId ?? null, e.label, e.amount, e.unit, e.kcal, e.protein, e.carbs, e.fat, e.requestId ?? null]
      )
      return rows[0] ? logFromRow(rows[0]) : null
    },

    async deleteLog (id) {
      const { rowCount } = await pool.query('DELETE FROM food_log WHERE id = $1', [id])
      return rowCount > 0
    }
  }
}
