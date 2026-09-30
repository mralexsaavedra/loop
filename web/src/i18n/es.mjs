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
      // four top-level tabs, in nav order; the former tabs are now sections (see `sections`)
      tabs: {
        home: { icon: '🏠', label: 'Inicio' },
        entreno: { icon: '🏃', label: 'Entreno' },
        health: { icon: '💗', label: 'Salud' },
        nutricion: { icon: '🍽️', label: 'Nutrición' },
      },
      // headings of the sections that used to be tabs of their own (Mi día/Registro/Tablas keep theirs)
      sections: {
        hoy: 'Entreno de hoy',
        dash: 'Entrenamiento',
      },
    },
    dayToggle: {
      ariaLabel: 'Tipo de día',
      train: '🏋️ Entreno',
      rest: '😴 Descanso',
    },
    registro: {
      heading: 'Constructor de día',
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
      // Generic fallback only — the owner's real wording (if any) lives in
      // plan-data.json's page.notes['registro.offPlan'] / page.offPlanPlaceholder
      // (see scripts/migrate-plan-data.mjs), rendered via <Note> in Registro.astro.
      offPlanNoteHtml: 'Cualquier cosa que no esté en las listas: comer fuera, un día suelto, o cómo te sentó la comida. Texto libre.',
      offPlanPlaceholder: 'Ej.: comí fuera, plato combinado + postre. Algo copioso, cantidad aproximada.',
      copyButton: '📋 Copiar para Claude',
      copyOutputLabel: 'Texto del registro para copiar',
      lessAriaLabel: (name) => `menos ${name}`,
      moreAriaLabel: (name) => `más ${name}`,
      copiedMsg: 'Copiado ✓ — pégalo en el chat con Claude.',
      copiedFallbackMsg: 'Selecciona el texto de arriba y cópialo a mano.',
    },
    tablas: {
      heading: 'Equivalencias',
      trainCaption: '🏋️ Entreno',
      restCaption: '😴 Descanso',
      desayunos: {
        icon: '☕', label: 'Desayunos',
        noteHtml: 'Elige el desayuno que mejor encaje con el día. Objetivo ~35–40 g de proteína. Las opciones del anclaje proteico están en la tabla <button class="lnk" onclick="jump(\'acc-anclaje\')">🥛 Anclaje proteico</button>.',
      },
      carboComida: { icon: '🍚', label: 'Carbo de la comida', note: 'Peso en seco. El carbo que se reduce aquí se recupera en la cena. La forma de la pasta no importa: mismo peso seco = mismos macros.' },
      carboCena: { icon: '🥔', label: 'Carbo de la cena', note: 'Peso cocido/listo para comer. Ración mayor: compensa el carbo reducido en la comida.' },
      proteina: {
        icon: '🥩', label: 'Proteína',
        note: '~40 g de proteína por ración, peso crudo. Prioriza la magra a diario; deja la grasa para el capricho.',
        lean: 'Magras — base diaria', mod: 'Intermedias — con cabeza', fat: 'Grasas — capricho',
      },
      anclaje: { icon: '🥛', label: 'Anclaje proteico (~25 g)', note: 'Opciones rápidas para el día de descanso. El yogur ligero NO cuenta como proteína.' },
      postentreno: { icon: '🍌', label: 'Post-entreno', note: '~25–30 g de proteína. El batido ya lleva su carbo (plátano); los fiambres van con 1 tosta. El timing no es crítico.' },
      fruta: {
        icon: '🍎', label: 'Fruta',
        note: 'De postre o con la comida. Valores estándar orientativos, por pieza/ración.',
        portionLabel: 'Fruta (1 pieza)', portionQty: 'varía',
      },
      postre: { icon: '🍨', label: 'Postre', note: 'Para comida y cena. La fruta es lo más ligero; el yogur con frutos secos y miel, lo más completo. El yogur ligero NO cuenta como proteína.' },
      verduras: { icon: '🥦', label: 'Verduras', note: 'Cómelas casi libres en un déficit — sacian y suman poco. Valores estándar orientativos, por 100 g.' },
      quesos: { icon: '🧀', label: 'Quesos y salsas', note: 'Suman grasa/sal → cuéntalas, no son "gratis".' },
      supplementsHeading: 'Suplementación',
      supplementsFallbackHtml: '<div class="meal" style="padding:6px 16px">\n    <div class="supp"><span class="when">Comida</span><div class="what">Creatina monohidrato<small>3 g, con agua</small></div></div>\n    <div class="supp"><span class="when">Cena</span><div class="what">Magnesio<small>según dosis del producto · puede ayudar al sueño</small></div></div>\n    <div class="supp"><span class="when">Entreno</span><div class="what">Electrolitos<small>días de calor / sesiones largas</small></div></div>\n  </div>',
      howToHeading: 'Cómo usarlo',
      howToHtml: '<b>Dentro de cada tabla, todo vale lo mismo.</b> Elige la comida que te apetezca y mira sus gramos — el total del día no cambia. En proteína tira del <b style="color:var(--lean)">verde</b> a diario; deja el <b style="color:var(--fat)">rojo</b> de capricho. La grasa que añaden los carbos aceitosos o el guacamole, cuéntala.',
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
