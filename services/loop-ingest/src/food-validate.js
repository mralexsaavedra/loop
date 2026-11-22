/**
 * The bodies and queries of the food log routes (food.js): products, recipes, log entries and the summary
 * range. A label whose kcal disagree with 4 p + 4 c + 9 f by more than 25 % is refused with `atwater` unless the
 * request says `force: true` (fibre / polyols make real labels deviate). Limits: FOOD_LIMITS (food-calc.js,
 * generated from lib/nutrition/foodlog.mjs, which is authoritative).
 */
import {
  FOOD_STORES, FOOD_UNITS, ENTRY_UNITS, FOOD_SOURCES, RECIPE_KINDS, REF_TYPES, FOOD_MEALS, FOOD_LIMITS as L, RECIPE_BASIC_UNITS,
  atwaterOk
} from './food-calc.js'
import { httpError, validDate } from './http.js'
import { bad, isObj, strictKeys, absent, str, number, oneOf, pattern, flag, id } from './validate.js'

export const BARCODE_RE = new RegExp(L.barcodePattern)
const BASIC_KEY_RE = new RegExp(L.basicKeyPattern)
const REQUEST_ID_RE = /^[A-Za-z0-9-]{8,64}$/ // the page's per-add id (a UUID), makes a retry idempotent
const OFF_CODE_RE = /^[0-9]{1,14}$/

export function validateProduct (body) {
  strictKeys(body, ['name', 'brand', 'store', 'barcode', 'unit', 'per100', 'servingSize', 'servingDefault', 'source', 'offCode', 'force'])
  const p = {
    name: str(body.name, 'name', L.nameMax),
    brand: str(body.brand, 'brand', L.brandMax, true),
    store: oneOf(body.store, 'store', FOOD_STORES),
    barcode: pattern(body.barcode, 'barcode', BARCODE_RE),
    unit: oneOf(body.unit, 'unit', FOOD_UNITS),
    per100: null,
    servingSize: number(body.servingSize, 'servingSize', { max: L.servingMax, above: true, optional: true }),
    // the log sheet starts in servings (sql/014); only with a serving size
    servingDefault: flag(body.servingDefault, 'servingDefault'),
    source: oneOf(body.source, 'source', FOOD_SOURCES),
    offCode: pattern(body.offCode, 'offCode', OFF_CODE_RE)
  }
  if (p.servingDefault && p.servingSize == null) bad('servingDefault')
  strictKeys(body.per100, ['kcal', 'protein', 'carbs', 'fat'], 'per100.')
  p.per100 = {
    kcal: number(body.per100.kcal, 'per100.kcal', { max: L.kcal100Max }),
    protein: number(body.per100.protein, 'per100.protein', { max: L.macro100Max }),
    carbs: number(body.per100.carbs, 'per100.carbs', { max: L.macro100Max }),
    fat: number(body.per100.fat, 'per100.fat', { max: L.macro100Max })
  }
  const force = flag(body.force, 'force')
  if (!force && !atwaterOk(p.per100)) throw httpError(400, 'atwater')
  return p
}

// a basic snapshot's per-100 (per unit for a 'ud' food) value: finite, >= 0, within the per-100 limits,
// kept to 2 decimals (the precision of the baked basics table, so the page's preview is what is stored)
function snapshotValue (v, field, max) {
  if (typeof v !== 'number' || !Number.isFinite(v)) bad(field)
  const n = Math.round(v * 100 + 1e-9) / 100
  if (n < 0 || n > max) bad(field)
  return n
}

/** A recipe ingredient: a product {productId, amount}, or a basic of the public food DB as a SNAPSHOT
 * {basic, name, unit, amount, per100} (food-calc.js RECIPE_BASIC_UNITS). */
function validateIngredient (ing) {
  if (!isObj(ing) || !('basic' in ing)) {
    strictKeys(ing, ['productId', 'amount'], 'ingredients.')
    return { productId: id(ing.productId, 'ingredients.productId'), amount: number(ing.amount, 'ingredients.amount', { max: L.ingredientAmountMax, above: true }) }
  }
  strictKeys(ing, ['basic', 'name', 'unit', 'amount', 'per100'], 'ingredients.')
  const out = {
    basic: pattern(ing.basic, 'ingredients.basic', BASIC_KEY_RE, false),
    name: str(ing.name, 'ingredients.name', L.nameMax),
    unit: oneOf(ing.unit, 'ingredients.unit', RECIPE_BASIC_UNITS),
    amount: number(ing.amount, 'ingredients.amount', { max: L.ingredientAmountMax, above: true }),
    per100: null
  }
  strictKeys(ing.per100, ['kcal', 'protein', 'carbs', 'fat'], 'ingredients.per100.')
  out.per100 = {
    kcal: snapshotValue(ing.per100.kcal, 'ingredients.per100.kcal', L.kcal100Max),
    protein: snapshotValue(ing.per100.protein, 'ingredients.per100.protein', L.macro100Max),
    carbs: snapshotValue(ing.per100.carbs, 'ingredients.per100.carbs', L.macro100Max),
    fat: snapshotValue(ing.per100.fat, 'ingredients.per100.fat', L.macro100Max)
  }
  return out
}

export function validateRecipe (body) {
  strictKeys(body, ['name', 'kind', 'servings', 'cookedWeightG', 'ingredients', 'force'])
  const kind = oneOf(body.kind, 'kind', RECIPE_KINDS)
  const r = { name: str(body.name, 'name', L.nameMax), kind, servings: null, cookedWeightG: null, ingredients: [] }
  if (kind === 'serving') {
    if (!absent(body.cookedWeightG)) bad('cookedWeightG')
    r.servings = number(body.servings, 'servings', { min: 1, max: L.servingsMax, integer: true })
  } else {
    if (!absent(body.servings)) bad('servings')
    r.cookedWeightG = number(body.cookedWeightG, 'cookedWeightG', { max: L.cookedMax, above: true })
  }
  if (!Array.isArray(body.ingredients) || body.ingredients.length < 1 || body.ingredients.length > L.ingredientsMax) bad('ingredients')
  r.ingredients = body.ingredients.map(validateIngredient)
  // a basic's snapshot is checked like a product label (alcohol, polyols: "save anyway"); force is not stored
  const force = flag(body.force, 'force')
  if (!force && r.ingredients.some((i) => i.basic != null && !atwaterOk(i.per100))) throw httpError(400, 'atwater')
  return r
}

/** Shape only; the snapshot needs the store (food-usecases.js addLog). */
export function validateLog (body) {
  strictKeys(body, ['date', 'meal', 'refType', 'refId', 'amount', 'unit', 'label', 'kcal', 'protein', 'carbs', 'fat', 'force', 'requestId'])
  const e = {
    date: validDate(body.date) ?? bad('date'),
    meal: oneOf(body.meal, 'meal', FOOD_MEALS),
    refType: oneOf(body.refType, 'refType', REF_TYPES),
    requestId: pattern(body.requestId, 'requestId', REQUEST_ID_RE)
  }
  if (e.refType === 'quick') {
    for (const k of ['refId', 'amount', 'unit']) if (!absent(body[k])) bad(k)
    e.label = str(body.label, 'label', L.nameMax)
    e.macros = {
      kcal: number(body.kcal, 'kcal', { max: L.quickKcalMax }),
      protein: number(body.protein, 'protein', { max: L.quickMacroMax, optional: true }),
      carbs: number(body.carbs, 'carbs', { max: L.quickMacroMax, optional: true }),
      fat: number(body.fat, 'fat', { max: L.quickMacroMax, optional: true })
    }
    e.force = flag(body.force, 'force')
    return e
  }
  for (const k of ['label', 'kcal', 'protein', 'carbs', 'fat', 'force']) if (!absent(body[k])) bad(k)
  e.refId = id(body.refId, 'refId')
  e.amount = number(body.amount, 'amount', { max: L.amountMax, above: true })
  e.unit = oneOf(body.unit, 'unit', ENTRY_UNITS)
  return e
}

/** ?from=&to= (YYYY-MM-DD, from <= to, at most FOOD_LIMITS.summaryDaysMax days inclusive). */
export function validateRange (params) {
  const from = validDate(params.get('from')) ?? bad('from')
  const to = validDate(params.get('to')) ?? bad('to')
  const days = Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86_400_000) + 1
  if (days < 1 || days > L.summaryDaysMax) bad('to')
  return { from, to }
}
