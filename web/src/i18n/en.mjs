/* Generic (non-personal) English UI copy — the en/example counterpart of
 * es.mjs, ported from the tracked `data/nutrition/plan-web.template.html`.
 * Key tree MUST mirror es.mjs exactly — see web/test/i18n.test.mjs. */
export default {
  strings: {
    nav: {
      ariaLabel: 'Sections',
      // three top-level tabs; the former tabs are now sections (see `sections`)
      tabs: {
        home: { icon: '🏠', label: 'Home' },
        nutricion: { icon: '🍽️', label: 'Nutrition' },
        health: { icon: '💗', label: 'Health' },
      },
      // headings of the sections that used to be tabs of their own (Mi día/Registro/Tablas keep theirs)
      sections: {
        hoy: "Today's session",
        dash: 'Training',
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
      // Generic fallback only — the owner's real wording (if any) lives in
      // plan-data.json's page.notes['registro.offPlan'] / page.offPlanPlaceholder
      // (see scripts/migrate-plan-data.mjs), rendered via <Note> in Registro.astro.
      offPlanNoteHtml: 'Anything not in the lists: eating out, a one-off day, or how the meal sat with you. Free text.',
      offPlanPlaceholder: 'E.g.: ate out — a combo plate + dessert. Something heavier than usual, rough amounts are fine.',
      copyButton: '📋 Copy for Claude',
      copyOutputLabel: 'Log text to copy',
      lessAriaLabel: (name) => `less ${name}`,
      moreAriaLabel: (name) => `more ${name}`,
      copiedMsg: 'Copied ✓ — paste it into the chat with Claude.',
      copiedFallbackMsg: 'Select the text above and copy it manually.',
    },
    tablas: {
      heading: 'Equivalences',
      trainCaption: '🏋️ Training',
      restCaption: '😴 Rest',
      desayunos: {
        icon: '☕', label: 'Breakfasts',
        noteHtml: 'Pick the breakfast that fits the day. Target ~35–40 g protein. The protein anchor options live in the <button class="lnk" onclick="jump(\'acc-anclaje\')">🥛 Protein anchor</button> table.',
      },
      carboComida: { icon: '🍚', label: 'Lunch carbs', note: 'Dry weight. Carbs dropped here are made up at dinner. Pasta shape does not matter: same dry weight = same macros.' },
      carboCena: { icon: '🥔', label: 'Dinner carbs', note: 'Cooked/ready weight. Larger portion: absorbs the carbs dropped from lunch.' },
      proteina: {
        icon: '🥩', label: 'Protein',
        note: '~40 g protein per serving, raw weight. Lean every day; leave the red for treats.',
        lean: 'Lean — daily base', mod: 'Moderate — with awareness', fat: 'Fatty — occasional',
      },
      anclaje: { icon: '🥛', label: 'Protein anchor (~25 g)', note: 'Quick options for the rest day. The light yogurt does NOT count as protein.' },
      postentreno: { icon: '🍌', label: 'Post-workout', note: '~25–30 g protein. The shake already carries its carb (banana); the cold cuts go with 1 slice of toast. Timing is not critical.' },
      fruta: {
        icon: '🍎', label: 'Fruit',
        note: 'As dessert or with the meal. Standard reference values, per piece/serving.',
        portionLabel: 'Fruit (1 piece)', portionQty: 'varies',
      },
      postre: { icon: '🍨', label: 'Dessert', note: 'For lunch and dinner. Fruit is the lightest; the yogurt with nuts and honey is the richest. The light yogurt does NOT count as protein.' },
      verduras: { icon: '🥦', label: 'Vegetables', note: 'Eat them almost freely in a cut — they fill you up and add little. Standard reference values, per 100 g.' },
      quesos: { icon: '🧀', label: 'Cheeses & sauces', note: 'They add fat/salt → count them, they are not "free".' },
      supplementsHeading: 'Supplements',
      supplementsFallbackHtml: '<div class="meal" style="padding:6px 16px">\n    <div class="supp"><span class="when">Lunch</span><div class="what">Creatine monohydrate<small>3 g, with water</small></div></div>\n    <div class="supp"><span class="when">Dinner</span><div class="what">Magnesium<small>follow product dosage · may support sleep</small></div></div>\n    <div class="supp"><span class="when">Workout</span><div class="what">Electrolytes<small>on hot days / long sessions</small></div></div>\n  </div>',
      howToHeading: 'How to use it',
      howToHtml: '<b>Inside each table, every option is worth the same.</b> Pick the food you fancy and look at its grams — the day total does not change. For protein, lean <b style="color:var(--lean)">green</b> every day; leave the <b style="color:var(--fat)">red</b> for treats. Count the fat added by oily carbs.',
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
