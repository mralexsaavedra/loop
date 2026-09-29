/* Generic (non-personal) Spanish UI copy — ported verbatim from the hand-
 * maintained legacy `data/nutrition/plan-web.html` for the tabs/strings
 * that exist so far (astro-plan-web slice 3: Mi día + Registro). Anything
 * PERSONAL (page title/kicker/h1/sub/footer/notes) lives in the owner's
 * gitignored `plan-data.json` `page` block instead — see
 * scripts/migrate-plan-data.mjs and web/test/leak.test.mjs. */
export default {
  strings: {
    nav: {
      ariaLabel: 'Secciones',
      tabs: {
        dia: { icon: '🍽️', label: 'Mi día' },
        registro: { icon: '📋', label: 'Registro' },
        tablas: { icon: '📊', label: 'Tablas' },
        hoy: { icon: '🏋️', label: 'Hoy' },
        dash: { icon: '📈', label: 'Entrenos' },
        health: { icon: '💗', label: 'Salud' },
      },
    },
    dayToggle: {
      ariaLabel: 'Tipo de día',
      train: '🏋️ Entreno',
      rest: '😴 Descanso',
    },
    dia: {
      sectionHeading: 'El día',
    },
    registro: {
      heading: 'Registro de comida',
      desayuno: 'Desayuno',
      comida: 'Comida',
      proteina: 'Proteína',
      carbo: 'Carbo',
      postre: 'Postre',
      opcion: 'Opción',
      cena: 'Cena',
      postentreno: 'Post-entreno',
      anclaje: 'Anclaje proteico',
      offPlanHeading: 'Fuera de plan / notas',
      offPlanNote: 'Lo que no está en las listas: comida fuera, restaurante, lo del finde, o cómo te sentaste. Texto libre.',
      offPlanPlaceholder: 'Ej: comí fuera — menú del día (lentejas + merluza rebozada + flan). 2 cañas. Comida copiosa.',
      copyButton: '📋 Copiar para Claude',
      copyOutputLabel: 'Texto del registro para copiar',
      lessAriaLabel: (name) => `menos ${name}`,
      moreAriaLabel: (name) => `más ${name}`,
      copiedMsg: 'Copiado ✓ — pégalo en el chat con Claude.',
      copiedFallbackMsg: 'Selecciona el texto de arriba y cópialo a mano.',
    },
  },
  verdict: {
    proteinOk: (p) => `Proteína ✓ — ${p} g`,
    proteinShort: (p, t) => `Proteína algo corta (${p} g, objetivo ~${t}). Suma un anclaje (~25 g) o sube la ración.`,
    proteinVeryShort: (p, t) => `Proteína muy corta (${p} g, objetivo ~${t}). Añade proteína magra.`,
    overBudget: (diff, cuts) => `Te pasas ~${diff} kcal. Para cuadrar: ${cuts.join(' · ')}.`,
    underBudget: (under) => `Vas ~${under} kcal por debajo. Bien para definición si no tienes hambre; si la tienes, sube el carbo (no bajes proteína).`,
    onTarget: (diff) => `Calorías en objetivo (${diff >= 0 ? '+' : ''}${diff} kcal).`,
    fatHigh: (g) => `Grasa alta (${g} g). Suele venir de proteína roja o carbo aceitoso — cambia a verde/patata.`,
    cutExtras: (kcal) => `los extras pesan ~${kcal} kcal`,
    cutDessert: () => 'aligera el postre (fruta o yogur solo)',
    cutDinnerCarb: () => 'baja una porción el carbo de la cena',
    alcohol: (name, n, kcal) => `🍺 ${n} ${name} ≈ ${kcal} kcal de alcohol (vacías, frenan la quema de grasa esa noche). Recorta ~${kcal} kcal de carbo, no de proteína.`,
    sweetTreats: () => '🍫 Caprichos dulces: cuéntalos como carbo del día. Si te pasas, recorta el carbo de la cena o salta el postre.',
    mealReplace: (name) => `🍢 ${name} reemplaza la cena, no se suma. Si cenas ${name}, no marques también proteína+carbo de cena.`,
  },
};
