/* Generic (non-personal) English UI copy — the en/example counterpart of
 * es.mjs, ported from the tracked `data/nutrition/plan-web.template.html`.
 * Key tree MUST mirror es.mjs exactly — see web/test/i18n.test.mjs. */
export default {
  strings: {
    nav: {
      ariaLabel: 'Sections',
      tabs: {
        dia: { icon: '🍽️', label: 'My day' },
        registro: { icon: '📋', label: 'Log' },
        tablas: { icon: '📊', label: 'Tables' },
        hoy: { icon: '🏋️', label: 'Today' },
        dash: { icon: '📈', label: 'Workouts' },
        health: { icon: '💗', label: 'Health' },
      },
    },
    dayToggle: {
      ariaLabel: 'Day type',
      train: '🏋️ Training',
      rest: '😴 Rest',
    },
    dia: {
      sectionHeading: 'The day',
    },
    registro: {
      heading: 'Food log',
      desayuno: 'Breakfast',
      comida: 'Lunch',
      proteina: 'Protein',
      carbo: 'Carb',
      postre: 'Dessert',
      opcion: 'Option',
      cena: 'Dinner',
      postentreno: 'Post-workout',
      anclaje: 'Protein anchor',
      offPlanHeading: 'Off plan / notes',
      offPlanNote: 'Anything not in the lists: eating out, restaurant, the weekend, or how you felt. Free text.',
      offPlanPlaceholder: 'E.g.: ate out — set menu (lentils + breaded fish + flan). 2 beers. Heavy meal.',
      copyButton: '📋 Copy for Claude',
      copyOutputLabel: 'Log text to copy',
      lessAriaLabel: (name) => `less ${name}`,
      moreAriaLabel: (name) => `more ${name}`,
      copiedMsg: 'Copied ✓ — paste it into the chat with Claude.',
      copiedFallbackMsg: 'Select the text above and copy it manually.',
    },
  },
  verdict: {
    proteinOk: (p) => `Protein ✓ — ${p} g`,
    proteinShort: (p, t) => `Protein a little short (${p} g, target ~${t}). Add an anchor (~25 g) or raise the serving.`,
    proteinVeryShort: (p, t) => `Protein very short (${p} g, target ~${t}). Add lean protein.`,
    overBudget: (diff, cuts) => `You are ~${diff} kcal over. To balance: ${cuts.join(' · ')}.`,
    underBudget: (under) => `You are ~${under} kcal under. Fine for a cut if you are not hungry; if you are, raise the carb (do not drop protein).`,
    onTarget: (diff) => `Calories on target (${diff >= 0 ? '+' : ''}${diff} kcal).`,
    fatHigh: (g) => `Fat high (${g} g). Usually from fatty protein or oily carbs — switch to lean/potato.`,
    cutExtras: (kcal) => `the extras weigh ~${kcal} kcal`,
    cutDessert: () => 'lighten the dessert (fruit or plain yogurt)',
    cutDinnerCarb: () => 'drop a portion of the dinner carb',
    alcohol: (name, n, kcal) => `🍺 ${n} ${name} ≈ ${kcal} kcal of alcohol (empty, slows fat burning that evening). Trim ~${kcal} kcal of carbs, not protein.`,
    sweetTreats: () => '🍫 Sweet treats: count them as the day\'s carbs. If you go over, cut the dinner carb or skip dessert.',
    mealReplace: (name) => `🍢 ${name} REPLACES dinner, it does not add to it. If you have ${name}, do not also mark dinner protein+carb.`,
  },
};
