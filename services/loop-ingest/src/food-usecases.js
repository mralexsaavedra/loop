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

/** The product ids of a recipe's ingredients (basics have none). */
function productIds (recipe) {
  return recipe.ingredients.filter((i) => i.basic == null).map((i) => i.productId)
}

function byIdOf (products) {
  const out = {}
  for (const p of products) out[p.id] = p
  return out
}

/** A recipe as the routes answer it: its ingredients (with each product's name and unit) and its COMPUTED macros. */
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
      : { productId: i.productId, amount: i.amount, name: byId[i.productId]?.name ?? null, unit: byId[i.productId]?.unit ?? null }),
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

/** A computed snapshot the columns cannot store is the amount's fault: 400 `invalid` on `amount`. */
function storable (snap) {
  for (const [k, max] of Object.entries(SNAPSHOT_MAX)) {
    const v = snap.macros[k]
    if (v != null && !(Math.round(v * 10) / 10 <= max)) bad('amount')
  }
  return snap
}

/** The macros SNAPSHOT a new log entry stores, with its label, amount and unit: a quick entry as typed (its
 * macros must pass Atwater unless forced), a product or a complete recipe computed here (food-calc.js). */
async function computeSnapshot (store, e) {
  if (e.refType === 'quick') {
    const macros = roundMacros(e.macros)
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

/** The food log's use cases over `store`. */
export function createFoodService (store) {
  async function recipeViews (recipes) {
    const ids = [...new Set(recipes.flatMap(productIds))]
    const byId = byIdOf(await store.getProducts(ids))
    return recipes.map((r) => recipeView(r, byId))
  }

  /** Recipe product ingredients must be ACTIVE products (a basic carries its own snapshot). */
  async function checkIngredients (r) {
    const ids = [...new Set(productIds(r))]
    const found = await store.getProducts(ids)
    if (found.filter((p) => !p.archived).length !== ids.length) throw httpError(400, 'unknown_product')
  }

  /** The row this request id already stored, if any (a retry of the same add). */
  async function existing (requestId) {
    return requestId ? store.getLogByRequest(requestId) : null
  }

  async function archived (ok) {
    if (!(await ok)) throw httpError(404, 'not_found')
  }

  return {
    listProducts: () => store.listProducts(),
    createProduct: (p) => store.insertProduct(p),
    async updateProduct (id, p) {
      const saved = await store.updateProduct(id, p)
      if (!saved) throw httpError(404, 'not_found')
      return saved
    },
    archiveProduct: (id) => archived(store.archiveProduct(id)),

    listRecipes: async () => recipeViews(await store.listRecipes()),
    async createRecipe (r) {
      await checkIngredients(r)
      const [view] = await recipeViews([await store.insertRecipe(r)])
      return view
    },
    async updateRecipe (id, r) {
      await checkIngredients(r)
      const saved = await store.updateRecipe(id, r)
      if (!saved) throw httpError(404, 'not_found')
      const [view] = await recipeViews([saved])
      return view
    },
    archiveRecipe: (id) => archived(store.archiveRecipe(id)),

    /** A day's entries and their totals. */
    async dayLog (date) {
      const entries = await store.listLog(date)
      return { entries, totals: dayTotals(entries) }
    },
    /** {entry, created, totals}: a retry with a known requestId returns the stored row, never a duplicate; the
     * totals are the entry's day after the add. */
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
    deleteLog: (id) => archived(store.deleteLog(id)),
    /** Per-day sums of the log between two dates (the page's adherence view). */
    summary: async (from, to) => daySummaries(await store.listLogRange(from, to)),

    getSettings: () => store.getSettings(),
    updateSettings: (s) => store.updateSettings(s),
    getProfile: () => store.getProfile(),
    putProfile: (p) => store.putProfile(p)
  }
}
