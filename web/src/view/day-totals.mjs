/* Day view-model shared by the Mi día section and the Inicio "today you eat" card, so both show
 * the same numbers. Pure presentation glue over lib/nutrition/macros.mjs's buildNutrition()
 * result (mealMacros per meal, summed) — no new computation. */
export function dayViewModel(nut, day) {
  const cfg = nut.DAYPLAN[day];
  const meals = cfg.meals.map((meal) => ({ meal, m: nut.mealMacros(meal) }));
  const totals = meals.reduce(
    (s, x) => ({ k: s.k + x.m.k, p: s.p + x.m.p, c: s.c + x.m.c, g: s.g + x.m.g }),
    { k: 0, p: 0, c: 0, g: 0 },
  );
  return { day, meals, totals, kcalNote: cfg.kcalNote };
}
