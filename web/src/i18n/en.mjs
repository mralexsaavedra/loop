/* Generic (non-personal) English UI copy — the en/example counterpart of
 * es.mjs, ported from the tracked `data/nutrition/plan-web.template.html`.
 * Key tree MUST mirror es.mjs exactly — see web/test/i18n.test.mjs. */
export default {
  strings: {
    // the product name (document title, home-screen name): the same in every locale
    brand: 'LOOP',
    nav: {
      ariaLabel: 'Sections',
      // the top bar's wordmark button (opens Inicio)
      homeLink: 'LOOP · Home',
      // four top-level tabs, in nav order; the former tabs are now sections (see `sections`)
      tabs: {
        home: { label: 'Home' },
        entreno: { label: 'Training' },
        health: { label: 'Health' },
        nutricion: { label: 'Nutrition' },
      },
      // top bar date pill (the viewer's full date is the <time> inside it, read by assistive tech)
      today: 'Today',
      // the pill's day stepping (client/today-date.js): Inicio shows a past day; the label returns to today
      day: { group: 'Day shown', prev: 'Previous day', next: 'Next day', back: 'Back to today' },
      // the dock's "+" button and its popover (client/nav-actions.js lists only the available actions)
      actions: { open: 'Actions', close: 'Close actions', label: 'Quick actions', addFood: 'Add food', journal: 'Complete your journal', sync: 'Sync' },
      // headings of the sections that used to be tabs of their own (Mi día/Tablas keep theirs)
      sections: {
        hoy: "Today's session",
        dash: 'Intensity (HR)',
      },
    },
    tablas: {
      heading: 'Equivalences',
      refNote: 'Reference values per natural unit (a piece, a tablespoon or 100 g); they never change with the day. Today\'s amounts are in Today\'s plan.',
      cols: { food: 'Food', ref: 'Reference', f: 'F', typical: 'typical weight' },
      units: { raw: 'raw', dry: 'dry', cooked: 'cooked', serving: 'serving', unit: 'pc' },
      desayunos: {
        icon: '☕', label: 'Breakfasts',
        noteHtml: 'Pick the breakfast that fits the day. Target ~35–40 g protein. The protein anchor options live in the <button class="lnk" onclick="jump(\'acc-anclaje\')">🥛 Protein anchor</button> table.',
      },
      carboComida: { icon: '🍚', label: 'Lunch carbs', note: 'Rice and pasta per 100 g dry. Pasta shape does not matter: same dry weight = same macros.' },
      carboCena: { icon: '🥔', label: 'Dinner carbs', note: 'Potato and the like per 100 g cooked/ready to eat.' },
      proteina: {
        icon: '🥩', label: 'Protein',
        note: 'Meat and fish per 100 g raw. Lean every day; leave the red for treats.',
        lean: 'Lean — daily base', mod: 'Moderate — with awareness', fat: 'Fatty — occasional',
      },
      anclaje: { icon: '🥛', label: 'Protein anchor (~25 g)', note: 'Quick options for the rest day. The light yogurt does NOT count as protein.' },
      postentreno: { icon: '🍌', label: 'Post-workout', note: 'The shake already carries its carb (banana); the cold cuts go with 1 slice of toast. Timing is not critical.' },
      fruta: {
        icon: '🍎', label: 'Fruit',
        note: 'As dessert or with the meal. Per medium piece (a typical weight, not a label).',
      },
      postre: { icon: '🍨', label: 'Dessert', note: 'For lunch and dinner. Fruit is the lightest; the yogurt with nuts and honey is the richest. The light yogurt does NOT count as protein.' },
      verduras: { icon: '🥦', label: 'Vegetables', note: 'Eat them almost freely in a cut — they fill you up and add little. Standard reference values, per 100 g.' },
      quesos: { icon: '🧀', label: 'Cheeses & sauces', note: 'They add fat/salt → count them, they are not "free".' },
      supplementsHeading: 'Supplements',
      supplementsFallbackHtml: '<div class="meal">\n    <div class="supp"><span class="when">Lunch</span><div class="what">Creatine monohydrate<small>3 g, with water</small></div></div>\n    <div class="supp"><span class="when">Dinner</span><div class="what">Magnesium<small>follow product dosage · may support sleep</small></div></div>\n    <div class="supp"><span class="when">Workout</span><div class="what">Electrolytes<small>on hot days / long sessions</small></div></div>\n  </div>',
      howToHeading: 'How to use it',
      howToHtml: '<b>To swap a food, pick it in Today\'s plan:</b> protein swaps keep the same protein grams and the rest of the day is re-solved. These tables are the fixed reference. For protein, lean <b style="color:var(--lean)">green</b> every day; leave the <b style="color:var(--fat)">red</b> for treats. Count the fat added by oily carbs.',
    },
  },
};
