/**
 * Postgres access for the food log (sql/006_food.sql). Every query is parameterized; rows come
 * back as plain objects with numbers (pg returns NUMERIC / BIGINT as strings), ISO timestamps and
 * the log date as a YYYY-MM-DD string (to_char, so no timezone ever shifts it). Validation and the
 * macro math live in food.js / food-calc.js; this module only stores what it is given.
 *
 * Errors: a unique violation on the barcode becomes { status: 409, code: 'barcode_exists' }; any
 * other DB error propagates and the route answers a coarse 500 (raw DB text is never sent).
 */
const PRODUCT_COLS = `id, name, brand, store, barcode, unit, kcal_100, protein_100, carbs_100, fat_100,
  serving_size, source, off_code, archived, created_at, updated_at`
const RECIPE_COLS = 'id, name, kind, servings, cooked_weight_g, ingredients, archived, created_at, updated_at'
const LOG_COLS = `id, to_char(date, 'YYYY-MM-DD') AS date, meal, ref_type, ref_id, label, amount, unit,
  kcal, protein, carbs, fat, created_at`

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
    source: r.source,
    offCode: r.off_code ?? null,
    archived: r.archived === true,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at)
  }
}

export function recipeFromRow (r) {
  return {
    id: num(r.id),
    name: r.name,
    kind: r.kind,
    servings: num(r.servings),
    cookedWeightG: num(r.cooked_weight_g),
    ingredients: Array.isArray(r.ingredients) ? r.ingredients.map((i) => ({ productId: num(i.productId), amount: num(i.amount) })) : [],
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
    createdAt: iso(r.created_at)
  }
}

function productValues (p) {
  return [p.name, p.brand ?? null, p.store, p.barcode ?? null, p.unit, p.per100.kcal, p.per100.protein,
    p.per100.carbs, p.per100.fat, p.servingSize ?? null, p.source, p.offCode ?? null]
}

async function guardUnique (fn) {
  try {
    return await fn()
  } catch (err) {
    if (err && err.code === '23505') throw Object.assign(new Error('barcode exists'), { status: 409, code: 'barcode_exists' })
    throw err
  }
}

export function createFoodStore (pool) {
  return {
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
             serving_size, source, off_code)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
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
                  carbs_100 = $8, fat_100 = $9, serving_size = $10, source = $11, off_code = $12, updated_at = now()
            WHERE id = $13 AND NOT archived
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

    async insertLog (e) {
      const { rows } = await pool.query(
        `INSERT INTO food_log (date, meal, ref_type, ref_id, label, amount, unit, kcal, protein, carbs, fat)
         VALUES ($1::date, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING ${LOG_COLS}`,
        [e.date, e.meal, e.refType, e.refId ?? null, e.label, e.amount, e.unit, e.kcal, e.protein, e.carbs, e.fat]
      )
      return logFromRow(rows[0])
    },

    async deleteLog (id) {
      const { rowCount } = await pool.query('DELETE FROM food_log WHERE id = $1', [id])
      return rowCount > 0
    }
  }
}
