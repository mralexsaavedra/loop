/**
 * The food log's use cases (docs/nutrition-food-log.md), between the HTTP routes (food.js) and the store
 * (food-db.js, or any object with the same methods: the tests pass an in-memory one). Inputs are already
 * validated (food-validate.js, settings-profile.js); outputs are what the routes answer. A use case that cannot
 * proceed throws an httpError (http.js) with a coarse code, never raw store text.
 *
 * The macros of a log entry are a SNAPSHOT computed here when it is added (food-calc.js, generated from
 * lib/nutrition/foodlog.mjs): editing a product or recipe later never rewrites past entries.
 */
import { round1, roundMacros, productEntry, recipeBasis, recipeEntry, dayTotals, daySummaries, atwaterOk } from './food-calc.js'
import { httpError } from './http.js'
import { bad } from './validate.js'

/** @typedef {import('../../../lib/nutrition/foodlog.mjs').Macros} Macros */
/** @typedef {import('../../../lib/nutrition/foodlog.mjs').Product} Product */
/** @typedef {import('../../../lib/nutrition/foodlog.mjs').ProductsById} ProductsById */
/** @typedef {import('../../../lib/nutrition/foodlog.mjs').Recipe} Recipe */
/** @typedef {import('./food-validate.js').ProductInput} ProductInput */
/** @typedef {import('./food-validate.js').IngredientInput} IngredientInput */
/** @typedef {import('./food-validate.js').RecipeInput} RecipeInput */
/** @typedef {import('./food-validate.js').LogInput} LogInput */
/** @typedef {import('./food-db.js').FoodStore} FoodStore */
/** @typedef {import('./food-db.js').SettingsPatch} SettingsPatch */
/** A new entry's macros SNAPSHOT with its label, amount and unit (computeSnapshot).
 * @typedef {{ macros: Macros, label: string, amount: number, unit: string }} Snapshot */

/** The product ids of a recipe's ingredients (basics have none).
 * @param {{ ingredients: readonly IngredientInput[] }} recipe @returns {number[]} */
function productIds (recipe) {
  // a product ingredient always has its productId (validateIngredient, ingredientFromJson)
  return recipe.ingredients.filter((i) => i.basic == null).map((i) => /** @type {number} */ (i.productId))
}

/** @param {readonly Product[]} products */
function byIdOf (products) {
  /** @type {ProductsById} */
  const out = {}
  for (const p of products) out[p.id] = p
  return out
}

/** A recipe as the routes answer it: its ingredients (with each product's name and unit) and its COMPUTED macros.
 * @param {Recipe} recipe @param {ProductsById} byId */
export function recipeView (recipe, byId) {
  const b = recipeBasis(recipe, byId)
  return {
    id: recipe.id,
    name: recipe.name,
    kind: recipe.kind,
    servings: recipe.servings,
    cookedWeightG: recipe.cookedWeightG,
    ingredients: recipe.ingredients.map((i) => i.basic != null
      ? { basic: i.basic, name: i.name, unit: i.unit, amount: i.amount, per100: i.per100 }
      : { productId: i.productId, amount: i.amount, name: byId[/** @type {number} */ (i.productId)]?.name ?? null, unit: byId[/** @type {number} */ (i.productId)]?.unit ?? null }),
    rawWeight: round1(b.rawWeight),
    complete: b.complete,
    missing: b.missing,
    totals: b.complete ? roundMacros(b.totals) : null,
    perServing: roundMacros(b.perServing),
    per100: roundMacros(b.per100),
    createdAt: recipe.createdAt,
    updatedAt: recipe.updatedAt
  }
}

// The food_log columns (sql/006_food.sql): kcal NUMERIC(7,1), protein / carbs / fat NUMERIC(6,1). Every input is
// within its own limit, yet a large serving times a large amount can still exceed them (Postgres: numeric field
// overflow), so the computed snapshot is checked before the insert.
const SNAPSHOT_MAX = Object.freeze({ kcal: 999999.9, protein: 99999.9, carbs: 99999.9, fat: 99999.9 })

/** A computed snapshot the columns cannot store is the amount's fault: 400 `invalid` on `amount`.
 * @param {Snapshot} snap */
function storable (snap) {
  for (const [k, max] of Object.entries(SNAPSHOT_MAX)) {
    const v = snap.macros[/** @type {keyof Macros} */ (k)]
    if (v != null && !(Math.round(v * 10) / 10 <= max)) bad('amount')
  }
  return snap
}

/** The macros SNAPSHOT a new log entry stores, with its label, amount and unit: a quick entry as typed (its
 * macros must pass Atwater unless forced), a product or a complete recipe computed here (food-calc.js).
 * @param {FoodStore} store @param {LogInput} e @returns {Promise<Snapshot>} */
async function computeSnapshot (store, e) {
  if (e.refType === 'quick') {
    // non-null: roundMacros answers null only for no macros at all
    const macros = /** @type {Macros} */ (roundMacros(e.macros))
    const { protein, carbs, fat } = macros
    if (!e.force && protein != null && carbs != null && fat != null && !atwaterOk(macros)) throw httpError(400, 'atwater')
    return { macros, label: e.label, amount: 1, unit: 'serving' }
  }
  if (e.refType === 'product') {
    const p = await store.getProduct(e.refId)
    if (!p || p.archived) throw httpError(400, 'unknown_product')
    const macros = productEntry(p, e.amount, e.unit)
    if (!macros) throw httpError(400, 'unit')
    return { macros, label: p.name, amount: e.amount, unit: e.unit }
  }
  const r = await store.getRecipe(e.refId)
  if (!r || r.archived) throw httpError(400, 'unknown_recipe')
  const byId = byIdOf(await store.getProducts(productIds(r)))
  if (!recipeBasis(r, byId).complete) throw httpError(400, 'recipe_incomplete')
  const macros = recipeEntry(r, byId, e.amount, e.unit)
  if (!macros) throw httpError(400, 'unit')
  return { macros, label: r.name, amount: e.amount, unit: e.unit }
}

/** The food log's use cases over `store`. @param {FoodStore} store */
export function createFoodService (store) {
  /** @param {readonly Recipe[]} recipes */
  async function recipeViews (recipes) {
    const ids = [...new Set(recipes.flatMap(productIds))]
    const byId = byIdOf(await store.getProducts(ids))
    return recipes.map((r) => recipeView(r, byId))
  }

  /** Recipe product ingredients must be ACTIVE products (a basic carries its own snapshot). @param {RecipeInput} r */
  async function checkIngredients (r) {
    const ids = [...new Set(productIds(r))]
    const found = await store.getProducts(ids)
    if (found.filter((p) => !p.archived).length !== ids.length) throw httpError(400, 'unknown_product')
  }

  /** The row this request id already stored, if any (a retry of the same add). @param {string | null} requestId */
  async function existing (requestId) {
    return requestId ? store.getLogByRequest(requestId) : null
  }

  /** @param {Promise<boolean>} ok */
  async function archived (ok) {
    if (!(await ok)) throw httpError(404, 'not_found')
  }

  return {
    listProducts: () => store.listProducts(),
    /** @param {ProductInput} p */
    createProduct: (p) => store.insertProduct(p),
    /** @param {number} id @param {ProductInput} p */
    async updateProduct (id, p) {
      const saved = await store.updateProduct(id, p)
      if (!saved) throw httpError(404, 'not_found')
      return saved
    },
    /** @param {number} id */
    archiveProduct: (id) => archived(store.archiveProduct(id)),

    listRecipes: async () => recipeViews(await store.listRecipes()),
    /** @param {RecipeInput} r */
    async createRecipe (r) {
      await checkIngredients(r)
      const [view] = await recipeViews([await store.insertRecipe(r)])
      return view
    },
    /** @param {number} id @param {RecipeInput} r */
    async updateRecipe (id, r) {
      await checkIngredients(r)
      const saved = await store.updateRecipe(id, r)
      if (!saved) throw httpError(404, 'not_found')
      const [view] = await recipeViews([saved])
      return view
    },
    /** @param {number} id */
    archiveRecipe: (id) => archived(store.archiveRecipe(id)),

    /** A day's entries and their totals. @param {string} date */
    async dayLog (date) {
      const entries = await store.listLog(date)
      return { entries, totals: dayTotals(entries) }
    },
    /** {entry, created, totals}: a retry with a known requestId returns the stored row, never a duplicate; the
     * totals are the entry's day after the add.
     * @param {LogInput} e */
    async addLog (e) {
      let entry = await existing(e.requestId)
      let created = false
      if (!entry) {
        const { macros, label, amount, unit } = storable(await computeSnapshot(store, e))
        entry = await store.insertLog({
          date: e.date, meal: e.meal, refType: e.refType, refId: e.refType === 'quick' ? null : e.refId, label, amount, unit, ...macros, requestId: e.requestId
        })
        created = !!entry
        // a concurrent retry stored it first (the unique request id): answer that row
        if (!entry) entry = await existing(e.requestId)
        if (!entry) throw new Error('log insert returned no row')
      }
      return { entry, created, totals: dayTotals(await store.listLog(e.date)) }
    },
    /** @param {number} id */
    deleteLog: (id) => archived(store.deleteLog(id)),
    /** Per-day sums of the log between two dates (the page's adherence view). @param {string} from @param {string} to */
    summary: async (from, to) => daySummaries(await store.listLogRange(from, to)),

    getSettings: () => store.getSettings(),
    /** @param {SettingsPatch} s */
    updateSettings: (s) => store.updateSettings(s),
    getProfile: () => store.getProfile(),
    /** @param {Parameters<FoodStore['putProfile']>[0]} p */
    putProfile: (p) => store.putProfile(p)
  }
}

/** The food log's use cases (createFoodService). @typedef {ReturnType<typeof createFoodService>} FoodService */
