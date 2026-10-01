/* Generic (non-personal) English UI copy — the en/example counterpart of
 * es.mjs, ported from the tracked `data/nutrition/plan-web.template.html`.
 * Key tree MUST mirror es.mjs exactly — see web/test/i18n.test.mjs. */
export default {
  strings: {
    nav: {
      ariaLabel: 'Sections',
      // four top-level tabs, in nav order; the former tabs are now sections (see `sections`)
      tabs: {
        home: { label: 'Home' },
        entreno: { label: 'Training' },
        health: { label: 'Health' },
        nutricion: { label: 'Nutrition' },
      },
      // headings of the sections that used to be tabs of their own (Mi día/Tablas keep theirs)
      sections: {
        hoy: "Today's session",
        dash: 'Workouts',
      },
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
};
