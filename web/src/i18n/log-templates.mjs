/* Client-side (browser, classic-script) format strings for the Registro
 * "copy for Claude" plain-text log — same rationale/constraint as
 * verdict-templates.mjs (client/nutrition.js is a classic script and
 * cannot import an ES module, so it can only receive plain JSON-safe data
 * baked by Bake.astro). Ported from the legacy buildDayText()'s line
 * templates in data/nutrition/plan-web.html. */
export const es = {
  header: 'REGISTRO — {date} · {dayLabel}',
  breakfast: 'Desayuno: {v}',
  lunch: 'Comida: {v}',
  dinner: 'Cena: {v}',
  extras: 'Extras: {v}',
  offPlan: 'Fuera de plan: {v}',
  total: 'TOTAL (calculado): ~{k} kcal · {p} P · {c} C · {g} G  (objetivo ~{tk} kcal / {tp} P)',
  dayLabelTrain: 'Entreno',
  dayLabelRest: 'Descanso',
  kcalSuffix: 'kcal · objetivo ~{t}',
};

export const en = {
  header: 'LOG — {date} · {dayLabel}',
  breakfast: 'Breakfast: {v}',
  lunch: 'Lunch: {v}',
  dinner: 'Dinner: {v}',
  extras: 'Extras: {v}',
  offPlan: 'Off plan: {v}',
  total: 'TOTAL (computed): ~{k} kcal · {p} P · {c} C · {g} G  (target ~{tk} kcal / {tp} P)',
  dayLabelTrain: 'Training',
  dayLabelRest: 'Rest',
  kcalSuffix: 'kcal · target ~{t}',
};
